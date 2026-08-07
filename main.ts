import { AtpAgent } from "npm:@atproto/api@^0.15.0";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { Image } from "npm:imagescript@^1.3.0";
import "jsr:@std/dotenv/load";

const SEEN_FILE = Deno.env.get("SEEN_FILE") ?? "seen.json";

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function loadSeen(): Promise<Set<string>> {
  try {
    const { date, urls } = JSON.parse(await Deno.readTextFile(SEEN_FILE));
    return date === today() ? new Set<string>(urls) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

async function saveSeen(seen: Set<string>) {
  await Deno.writeTextFile(
    SEEN_FILE,
    JSON.stringify({ date: today(), urls: [...seen] }),
  );
}

const MAT_RATIO = 0.05;

function env(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing env var: ${key}`);
  return value;
}

async function scrapePanel(seen: Set<string>): Promise<
  | {
      caption?: string;
      bytes: Uint8Array<ArrayBufferLike>;
      url: string;
    }
  | undefined
> {
  let caption = undefined;
  const parser = new DOMParser();

  const UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

  const res = await fetch("https://www.thefarside.com/", { headers: { "user-agent": UA } });
  if (!res.ok) {
    console.error(res.status, res.headers.get("cf-mitigated"), res.headers.get("server"));
    console.error((await res.text()).slice(0, 500));
    throw new Error(`Page fetch failed: ${res.status}`);
  }
  if (!res.ok) throw new Error(`Page fetch failed: ${res.status}`);

  const doc = parser.parseFromString(await res.text(), "text/html")!;

  const cards = doc.querySelectorAll(".card-body");
  for (const card of cards) {
    const url = card.querySelector("img")!.getAttribute("data-src")!;
    if (seen.has(url)) {
      continue;
    }

    const fc_el = card.querySelector(".figure-caption");
    if (fc_el) {
      caption = fc_el.innerText.trim();
    }

    const img_res = await fetch(url, {
      headers: { "user-agent": UA, referer: "https://www.thefarside.com/" },
    });

    if (!img_res.ok) throw new Error(`Image fetch failed: ${img_res.status}`);

    return { caption, url, bytes: new Uint8Array(await img_res.arrayBuffer()) };
  }
}

async function matte(bytes: Uint8Array) {
  const panel = await Image.decode(bytes);
  const pad = Math.round(panel.height * MAT_RATIO);
  const mat = new Image(panel.width, panel.height + pad);
  mat.fill(Image.rgbaToColor(255, 255, 255, 255));
  mat.composite(panel, 0, Math.round(pad / 2));

  return {
    bytes: await mat.encodeJPEG(90),
    width: mat.width,
    height: mat.height,
  };
}

async function main() {
  const seen = await loadSeen();

  const scraped = await scrapePanel(seen);
  if (!scraped) {
    Deno.exit(0);
  }

  const { caption = "", bytes, url } = scraped!;

  seen.add(url);
  await saveSeen(seen);

  const image = await matte(bytes);

  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: env("BLUESKY_USERNAME"),
    password: env("BLUESKY_PASSWORD"),
  });

  const { data } = await agent.uploadBlob(image.bytes, {
    encoding: "image/jpeg",
  });

  await agent.post({
    text: caption ?? "",
    embed: {
      $type: "app.bsky.embed.images",
      images: [
        {
          image: data.blob,
          alt: caption ?? `Cartoon panel from Gary Larson's "The Far Side."`,
          aspectRatio: { width: image.width, height: image.height },
        },
      ],
    },
  });

  console.log("Posted:", caption);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    Deno.exit(1);
  });
}
