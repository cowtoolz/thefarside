import { AtpAgent } from "npm:@atproto/api";
import "jsr:@std/dotenv/load";
import { DOMParser } from "jsr:@b-fuze/deno-dom";

const count = +Deno.env.get("STATE")!;

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

    const blobResp = await agent.uploadBlob(imageBlob);

    console.log(blobResp);

    await agent.post({
      text: text,
      embed: {
        $type: "app.bsky.embed.images",
        images: [{
          image: blobResp.data.blob,
          alt: text,
        }],
      },
    });
    console.log("Just posted!");
  } catch (err) {
    console.error(err);
  }
}

main();

await Deno.writeTextFile("state", `${count + 1}`);
