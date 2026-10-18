// Runs the plugin's server module (compiled with esbuild, as Home Quarters does) against a fake `hq`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function loadPlugin() {
  const dir = mkdtempSync(join(tmpdir(), "poketoken-"));
  const out = join(dir, "main.mjs");
  await build({ entryPoints: ["plugin/poketoken/main.ts"], bundle: true, format: "esm", target: "es2020", outfile: out, logLevel: "silent" });
  const kv = new Map();
  const routes = new Map();
  const sent = []; // [to, msg] ; to = "all" for broadcasts
  let budget = true;
  globalThis.hq = {
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => { assert.equal(typeof v, "string"); assert.ok(v.length <= 4096); kv.set(k, v); }, delete: (k) => kv.delete(k) },
    route: (m, p, h, o) => routes.set(m + " " + p, { h, o }),
    send: (id, msg) => { assert.ok(JSON.stringify(msg).length <= 4096); sent.push([id, msg]); return true; },
    broadcast: (msg) => { assert.ok(Buffer.byteLength(JSON.stringify(msg)) <= 4096); if (!budget) return false; sent.push(["all", msg]); return true; },
    players: () => [],
    log: () => {},
    now: () => Date.now() / 1000,
    settings: () => ({}),
  };
  const mod = await import(pathToFileURL(out).href + "?" + Math.random());
  rmSync(dir, { recursive: true, force: true });
  mod.load();
  const call = (key, player, body = "") => routes.get(key).h({ player, body, query: {} });
  return { mod, kv, routes, sent, call, setBudget: (b) => { budget = b; } };
}

const ann = { id: 7, name: "Ann", role: "member" };
const bob = { id: 8, name: "Bob", role: "member" };

test("routes are open to app tokens", async () => {
  const { routes } = await loadPlugin();
  for (const k of ["POST /pokemon", "GET /pokemon", "POST /clear"]) assert.deepEqual(routes.get(k).o, { token: true }, k);
});

test("a report reaches every page on the next update", async () => {
  const { mod, call, sent } = await loadPlugin();
  mod.onJoin(ann);
  mod.onJoin(bob);
  mod.update();
  sent.length = 0;
  const r = await call("POST /pokemon", ann, JSON.stringify({ dex: 6, form: "", shiny: true, name: "Charizard" }));
  assert.equal(r.status, undefined);
  assert.equal(r.body.ok, true);
  assert.deepEqual(sent.find(([to]) => to === 7)[1].current, { dex: 6, form: "", shiny: true, name: "Charizard" });
  mod.update();
  assert.deepEqual(sent.find(([to]) => to === "all")[1], { t: "roster", e: [[7, 6, "", 1, "Charizard"]], full: false });
});

test("bad reports are refused", async () => {
  const { call } = await loadPlugin();
  for (const body of ["nope", "[]", "null", '{"dex":1026}', '{"dex":1.5}', '{"dex":25,"form":"Sky!"}', '{"dex":25,"shiny":"yes"}']) {
    const r = await call("POST /pokemon", ann, body);
    assert.equal(r.status, 400, body);
  }
});

test("names are one line, at most 24 characters; eggs have no form or colours", async () => {
  const { call } = await loadPlugin();
  const report = async (o) => { await call("POST /pokemon", ann, JSON.stringify(o)); return (await call("GET /pokemon", ann)).body.current; };
  assert.equal((await report({ dex: 25, name: "a" + String.fromCharCode(10) + "b" + String.fromCharCode(0x2028) + "c" })).name, "a b c");
  assert.equal(Array.from((await report({ dex: 25, name: "😀".repeat(40) })).name).length, 24);
  assert.equal((await report({ dex: 25 })).name, "#25");
  assert.deepEqual(await report({ dex: 0, form: "q", shiny: true }), { dex: 0, form: "", shiny: false, name: "Egg" });
});

test("the module exports only what Home Quarters calls", async () => {
  const { mod } = await loadPlugin();
  const allowed = new Set(["load", "update", "onJoin", "onLeave", "onMessage", "onSettings", "unload"]);
  for (const k of Object.keys(mod)) assert.ok(allowed.has(k), k);
});

test("a page that starts gets the whole roster, cut under 4 KB", async () => {
  const { mod, call, sent } = await loadPlugin();
  for (let id = 1; id <= 300; id++) {
    const p = { id, name: "m" + id, role: "member" };
    mod.onJoin(p);
    await call("POST /pokemon", p, JSON.stringify({ dex: 1 + (id % 649), name: "名前".repeat(12) }));
  }
  sent.length = 0;
  mod.onMessage(ann, { t: "get" });
  const pieces = sent.filter(([to, m]) => to === 7 && m.t === "roster").map(([, m]) => m);
  assert.ok(pieces.length > 1);
  assert.equal(pieces[0].full, true);
  assert.ok(pieces.slice(1).every((p) => !p.full));
  assert.equal(pieces.reduce((n, p) => n + p.e.length, 0), 300);
  assert.ok(sent.some(([to, m]) => to === 7 && m.t === "me"));
});

test("hiding takes the entry away for everybody; leaving too", async () => {
  const { mod, call, sent } = await loadPlugin();
  mod.onJoin(ann);
  await call("POST /pokemon", ann, JSON.stringify({ dex: 25, name: "Pikachu" }));
  mod.update();
  sent.length = 0;
  mod.onMessage(ann, { t: "hide", on: true });
  mod.update();
  assert.deepEqual(sent.find(([to]) => to === "all")[1].e, [[7]]);
  sent.length = 0;
  mod.onMessage(ann, { t: "hide", on: false }); // throttled: within 0.5 s of the last one
  mod.update();
  assert.equal(sent.length, 0);
  mod.onLeave(ann);
  mod.update();
  assert.deepEqual(sent.find(([to]) => to === "all")[1].e, [[7]]);
});

test("a spent budget keeps the changes for the next update", async () => {
  const { mod, call, sent, setBudget } = await loadPlugin();
  mod.onJoin(ann);
  await call("POST /pokemon", ann, JSON.stringify({ dex: 25 }));
  setBudget(false);
  mod.update();
  setBudget(true);
  sent.length = 0;
  mod.update();
  assert.deepEqual(sent.find(([to]) => to === "all")[1].e, [[7, 25, "", 0, "#25"]]);
});

test("the state survives a restart (kv)", async () => {
  const a = await loadPlugin();
  await a.call("POST /pokemon", ann, JSON.stringify({ dex: 201, form: "q", name: "Unown" }));
  const b = await loadPlugin();
  for (const [k, v] of a.kv) b.kv.set(k, v);
  const r = await b.call("GET /pokemon", ann);
  assert.deepEqual(r.body.current, { dex: 201, form: "q", shiny: false, name: "Unown" });
  const c = await b.call("POST /clear", ann);
  assert.equal(c.body.ok, true);
  assert.equal((await b.call("GET /pokemon", ann)).body.current, null);
});

test("messages from pages are checked", async () => {
  const { mod, sent } = await loadPlugin();
  for (const m of [null, 3, "x", [], { t: "hide" }, { t: "hide", on: "yes" }, { t: "nope" }]) mod.onMessage(ann, m);
  assert.equal(sent.length, 0);
});
