// Runs the plugin's server module (compiled with esbuild, as Home Quarters does) against a fake `hq` whose
// pets plugin records the setPet / removePet calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function loadPlugin({ pets = "on" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "poketoken-"));
  const out = join(dir, "main.mjs");
  await build({ entryPoints: ["plugin/poketoken/main.ts"], bundle: true, format: "esm", target: "es2020", outfile: out, logLevel: "silent" });
  const kv = new Map();
  const routes = new Map();
  const sent = []; // [to, msg]
  const calls = []; // [hook, args]
  const state = { pets };
  globalThis.hq = {
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => { assert.equal(typeof v, "string"); assert.ok(v.length <= 4096); kv.set(k, v); }, delete: (k) => kv.delete(k) },
    route: (m, p, h, o) => routes.set(m + " " + p, { h, o }),
    send: (id, msg) => { assert.ok(JSON.stringify(msg).length <= 4096); sent.push([id, msg]); return true; },
    broadcast: () => true,
    players: () => [],
    log: () => {},
    now: () => Date.now() / 1000,
    settings: () => ({}),
    plugins: {
      call: async (plugin, hook, args) => {
        assert.equal(plugin, "hq-pets");
        assert.ok(JSON.stringify(args).length <= 4096);
        if (state.pets === "off") throw new Error("hq-pets is off");
        calls.push([hook, args]);
        if (state.pets === "full" && hook === "setPet") return { ok: false, error: "full" };
        return { ok: true };
      },
    },
  };
  const mod = await import(pathToFileURL(out).href + "?" + Math.random());
  rmSync(dir, { recursive: true, force: true });
  mod.load();
  const call = (key, player, body = "") => routes.get(key).h({ player, body, query: {} });
  return { mod, kv, routes, sent, calls, state, call };
}

const ann = { id: 7, name: "Ann", role: "member" };

test("routes are open to app tokens", async () => {
  const { routes } = await loadPlugin();
  for (const k of ["POST /pokemon", "GET /pokemon", "POST /clear"]) assert.deepEqual(routes.get(k).o, { token: true }, k);
});

test("the module exports only what Home Quarters calls", async () => {
  const { mod } = await loadPlugin();
  const allowed = new Set(["load", "update", "onJoin", "onLeave", "onMessage", "onSettings", "unload"]);
  for (const k of Object.keys(mod)) assert.ok(allowed.has(k), k);
});

test("a report becomes a guest pet of hq-pets, by metadata: the browser code draws it", async () => {
  const { call, calls, sent } = await loadPlugin();
  const r = await call("POST /pokemon", ann, JSON.stringify({ dex: 492, form: "sky", shiny: true, name: "Shaymin" }));
  assert.equal(r.status, 200);
  assert.deepEqual(calls, [["setPet", { id: "pokemon", metadata: { dex: 492, form: "sky", shiny: true }, name: "Shaymin" }]]);
  const me = sent.filter(([to]) => to === 7).at(-1)[1];
  assert.deepEqual(me.current, { dex: 492, form: "sky", shiny: true, name: "Shaymin" });
  assert.equal(me.error, null);
});

test("bad reports are refused and give no pet", async () => {
  const { call, calls } = await loadPlugin();
  for (const body of ["nope", "[]", "null", '{"dex":1026}', '{"dex":1.5}', '{"dex":25,"form":"Sky!"}', '{"dex":25,"shiny":"yes"}']) {
    const r = await call("POST /pokemon", ann, body);
    assert.equal(r.status, 400, body);
  }
  assert.equal(calls.length, 0);
});

test("names are one line, at most 24 characters; eggs have no form or colours", async () => {
  const { call } = await loadPlugin();
  const report = async (o) => { await call("POST /pokemon", ann, JSON.stringify(o)); return (await call("GET /pokemon", ann)).body.current; };
  assert.equal((await report({ dex: 25, name: "a" + String.fromCharCode(10) + "b" + String.fromCharCode(0x2028) + "c" })).name, "a b c");
  assert.equal(Array.from((await report({ dex: 25, name: "😀".repeat(40) })).name).length, 24);
  assert.equal((await report({ dex: 25 })).name, "#25");
  assert.deepEqual(await report({ dex: 0, form: "q", shiny: true }), { dex: 0, form: "", shiny: false, name: "Egg" });
});

test("hiding takes the guest pet away, showing puts it back; clear takes it away", async () => {
  const { mod, call, calls } = await loadPlugin();
  await call("POST /pokemon", ann, JSON.stringify({ dex: 25, name: "Pikachu" }));
  calls.length = 0;
  await mod.onMessage(ann, { t: "hide", on: true });
  assert.deepEqual(calls, [["removePet", { id: "pokemon" }]]);
  await mod.onMessage(ann, { t: "hide", on: false }); // within 0.5 s of the last one: throttled
  assert.equal(calls.length, 1);
  await new Promise((r) => setTimeout(r, 550));
  await mod.onMessage(ann, { t: "hide", on: false });
  assert.equal(calls[1][0], "setPet");
  await call("POST /clear", ann);
  assert.deepEqual(calls[2], ["removePet", { id: "pokemon" }]);
});

test("when hq-pets refuses or is off, the member is told why", async () => {
  const full = await loadPlugin({ pets: "full" });
  const r = await full.call("POST /pokemon", ann, JSON.stringify({ dex: 25 }));
  assert.equal(r.status, 409);
  assert.match(full.sent.at(-1)[1].error, /4 pets/);
  const off = await loadPlugin({ pets: "off" });
  await off.call("POST /pokemon", ann, JSON.stringify({ dex: 25 }));
  assert.match(off.sent.at(-1)[1].error, /pets plugin is off/);
});

test("on start (onJoin) the saved Pokémon goes back to hq-pets, unless hidden or none", async () => {
  const a = await loadPlugin();
  await a.call("POST /pokemon", ann, JSON.stringify({ dex: 25, name: "Pikachu" }));
  const b = await loadPlugin(); // the plugin restarted: hq-pets took its pets away
  for (const [k, v] of a.kv) b.kv.set(k, v);
  await b.mod.onJoin(ann);
  assert.deepEqual(b.calls, [["setPet", { id: "pokemon", metadata: { dex: 25, form: "", shiny: false }, name: "Pikachu" }]]);
  b.calls.length = 0;
  await b.mod.onJoin({ id: 8, name: "Bob", role: "member" }); // nothing saved for Bob
  b.kv.set("m:7", JSON.stringify({ current: { dex: 25, form: "", shiny: false, name: "Pikachu" }, hidden: true, at: 1 }));
  await b.mod.onJoin(ann); // hidden: stays away
  assert.equal(b.calls.length, 0);
});

test("the state survives a restart (kv)", async () => {
  const a = await loadPlugin();
  await a.call("POST /pokemon", ann, JSON.stringify({ dex: 201, form: "q", name: "Unown" }));
  const b = await loadPlugin();
  for (const [k, v] of a.kv) b.kv.set(k, v);
  assert.deepEqual((await b.call("GET /pokemon", ann)).body.current, { dex: 201, form: "q", shiny: false, name: "Unown" });
});

test("messages from pages are checked", async () => {
  const { mod, sent, calls } = await loadPlugin();
  for (const m of [null, 3, "x", [], { t: "hide" }, { t: "hide", on: "yes" }, { t: "nope" }]) await mod.onMessage(ann, m);
  assert.equal(sent.length + calls.length, 0);
});
