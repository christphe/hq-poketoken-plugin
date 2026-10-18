// Checks the plugin in a running Home Quarters office (dev mode, empty database), as the companion and two
// members' browsers would use it, and saves screenshots to look at. Run the published image with the plugin
// mounted, then:
//   docker run -d --name pt-office -p 127.0.0.1:28095:8080 -e HQ_ENV=dev -e HQ_DB=/data/hq.db \
//     -v "$PWD/plugin/poketoken:/app/plugins/installed/poketoken:ro" ghcr.io/christphe/homequarters:<tag>
//   node test/office.mjs [out dir]        (HQ_URL, CHROME_PATH to override)
// The first member to join a fresh office becomes its administrator: this script must be the first.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const URL_ = process.env.HQ_URL || "http://127.0.0.1:28095";
const OUT = process.argv[2] || "office-out";
const chrome = process.env.CHROME_PATH || ({
  win32: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
}[process.platform] ?? "/usr/bin/google-chrome");
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (what, ok, detail = "") => {
  console.log((ok ? "PASS " : "FAIL ") + what + (detail ? " — " + detail : ""));
  if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(250);
  }
}

async function join(name) {
  const r = await fetch(URL_ + "/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, avatar: { sk: 2, hs: 2, hc: 0, sh: 6, pa: 0 } }) });
  if (!r.ok) throw new Error(`join ${name}: ${r.status} ${await r.text()}`);
  const cookie = /hq_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
  return { name, cookie, id: (await r.json()).id };
}
const as = (m, path, init = {}) => fetch(URL_ + path, { ...init, headers: { ...init.headers, Cookie: "hq_session=" + m.cookie } });

const admin = await join("Admin");
const on = await as(admin, "/api/admin/plugins/poketoken", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
check("the administrator turns the plugin on", on.ok, String(on.status));
const list = await (await as(admin, "/api/admin/plugins")).json();
const row = list.find((p) => p.name === "poketoken");
check("the plugin is running", row?.state === "running", JSON.stringify(row));

const mia = await join("Mia"), rem = await join("Rem");
const token = (await (await as(rem, "/api/plugins/poketoken/token", { method: "POST" })).json()).token;
check("Rem creates an app token", typeof token === "string" && token.startsWith("hqp_"));
const report = (body) => fetch(URL_ + "/plugins/poketoken/api/pokemon", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
try {
  const open = async (m) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 3 });
    await page.setCookie({ name: "hq_session", value: m.cookie, url: URL_ });
    const warnings = [];
    page.on("console", (c) => { if (c.type() === "warn" || c.type() === "error") warnings.push(c.text()); });
    await page.goto(URL_, { waitUntil: "networkidle2" });
    await waitFor(() => page.evaluate(() => !!window.__hq?.state?.meId));
    return { ...m, page, warnings };
  };
  const pm = await open(mia), pr = await open(rem);
  const mon = (u, owner) => u.page.evaluate((id) => (window.__hq.session.plugins?.debug("poketoken") ?? []).find((c) => c.player === id && c.visible) ?? null, owner);
  const shot = async (u, owner, name) => {
    const c = await mon(u, owner);
    if (!c) return;
    await sleep(1200);
    const at = await u.page.evaluate(({ x, y }) => window.__hq.view.pageOf(x, y), { x: c.x, y: c.y });
    await u.page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: Math.max(0, at.x - 80), y: Math.max(0, at.y - 70), width: 160, height: 100 } });
  };

  const r = await report({ dex: 25, name: "Pikachu" });
  check("the companion's report is accepted", r.ok, String(r.status));
  // on Rem's own page: Mia may stand too far away to have Rem on screen
  const p = await waitFor(() => mon(pr, rem.id));
  check("Rem's Pikachu is drawn following Rem", p?.mode === "follow" && p?.label === "Pikachu", JSON.stringify(p));
  await shot(pr, rem.id, "pikachu");
  for (const [body, name] of [[{ dex: 6, shiny: true, name: "Dracaufeu" }, "charizard-shiny"], [{ dex: 321, name: "Wailord" }, "wailord"], [{ dex: 0 }, "egg"]]) {
    await report(body);
    const c = await waitFor(async () => { const m = await mon(pr, rem.id); return m && m.label === (body.name ?? "Egg") ? m : null; });
    check(`${body.name ?? "the egg"} replaces it`, !!c);
    await shot(pr, rem.id, name);
  }
  const warns = [...pm.warnings, ...pr.warnings].filter((w) => /poketoken|plugin|Content Security/i.test(w));
  check("no warnings about the plugin in the consoles", warns.length === 0, JSON.stringify(warns.slice(0, 5)));
} finally {
  await browser.close();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
