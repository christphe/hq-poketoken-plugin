// Builds sheets with public/pmd.ts in a real Chrome (headless, opaque origin like the plugin's iframe),
// downloading from PMD SpriteCollab, and writes them to a folder to look at:
//   node test/sprites.mjs <out dir> [dex[:form][:s] ...]
// Needs network access, and Chrome (CHROME_PATH, or the usual install path).
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] || "sprites-out";
const cases = process.argv.slice(3).length ? process.argv.slice(3) : ["25", "25::s", "6", "201:q", "492:sky", "321", "132", "0", "514"];
const chrome = process.env.CHROME_PATH || ({
  win32: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
}[process.platform] ?? "/usr/bin/google-chrome");

const bundle = await build({
  entryPoints: ["plugin/poketoken/public/pmd.ts"], bundle: true, format: "iife", globalName: "pmd", target: "es2020", write: false,
});
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
let failed = 0;
try {
  const page = await browser.newPage();
  // a sandboxed iframe, as Home Quarters runs plugin code: opaque origin, scripts only
  await page.setContent(`<iframe sandbox="allow-scripts" srcdoc="<script>${bundle.outputFiles[0].text.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}</script>"></iframe>`);
  const frame = await (await page.$("iframe")).contentFrame();
  await frame.waitForFunction(() => typeof pmd === "object");
  for (const c of cases) {
    const [dex, form = "", s = ""] = c.split(":");
    const r = await frame.evaluate(async (dex, form, shiny) => {
      const b = dex === 0 ? await pmd.egg() : await pmd.build(dex, form, shiny);
      if (!b) return null;
      const bytes = new Uint8Array(await b.blob.arrayBuffer());
      let bin = "";
      for (const x of bytes) bin += String.fromCharCode(x);
      return { png: btoa(bin), frameW: b.frameW, frameH: b.frameH, anims: b.anims, origin: String(self.origin) };
    }, Number(dex), form, s === "s");
    if (!r) {
      console.log(c.padEnd(10), "no sprite");
      continue;
    }
    const name = c.replace(/:/g, "_");
    writeFileSync(join(out, name + ".png"), Buffer.from(r.png, "base64"));
    const walk = r.anims["walk-down"], idle = r.anims["idle-down"];
    console.log(c.padEnd(10), `${r.frameW}x${r.frameH}`, `walk ${walk.frames.length}@${walk.fps}`, `idle ${idle.frames.length}@${idle.fps}`, `origin ${r.origin}`);
    if (r.frameW < 8 || r.frameH < 8 || r.frameW > 256 || r.frameH > 256) failed++;
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
