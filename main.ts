import { AtpAgent } from "npm:@atproto/api";
import "jsr:@std/dotenv/load";
import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { Image } from "npm:imagescript";

const count = +Deno.env.get("RUN_COUNT")!;

async function main() {
  try {
    const response = await fetch("https://www.thefarside.com/");
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html")!;
    const card = doc.querySelectorAll(".card-body")![count % 5];
    const text = card.querySelector(".figure-caption")!.innerText.trim();
    const imageUrl = card.querySelector("img")!.getAttribute("data-src")!;
    const imageResponse = await fetch(imageUrl);
    const imageBlob = await imageResponse.blob();

    const agent = new AtpAgent({
      service: "https://bsky.social",
    });

    await agent.login({
      identifier: Deno.env.get("BLUESKY_USERNAME")!,
      password: Deno.env.get("BLUESKY_PASSWORD")!,
    });

    const panel = Image.decode(await imageBlob.arrayBuffer());
    const w = (await panel).width;
    const h = (await panel).height;

    const mat = new Image(w, h + (0.05 * h));
    mat.fill(Image.rgbaToColor(255, 255, 255, 0xff));
    const composite = mat.composite(await panel, 0, (0.05 * h) / 2);
    const buffer = await composite.encodeJPEG();

    const compBlob = new Blob([buffer]);

    const blobResp = await agent.uploadBlob(compBlob);

    console.log(blobResp);

    await agent.post({
      text: text,
      embed: {
        $type: "app.bsky.embed.images",
        images: [{
          image: blobResp.data.blob,
          alt: text,
          aspectRatio: {
            width: composite.width,
            height: composite.height,
          },
        }],
      },
    });
    console.log("Just posted!");
  } catch (err) {
    console.error(err);
  }
}

main();
