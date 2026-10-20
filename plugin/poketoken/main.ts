// Server side of poketoken. A member's desktop companion (holding the member's app token) reports which
// Pokémon PokeTokenBar is raising; this plugin keeps it and gives it to the member as a guest pet of the
// pets plugin (hq-pets), by metadata: on each page, this plugin's browser code draws its sheet from PMD
// SpriteCollab (provideSheet), and hq-pets walks it like the member's other pets.
//
// kv: "m:<member>" -> JSON Saved.
import type { Pokemon, SheetMetadata, ToPage } from "./public/messages";
import { DEX_MAX, FORM_RE, NAME_MAX } from "./public/messages";

interface Saved { current: Pokemon | null; hidden: boolean; at: number }

const PET_ID = "pokemon";
const errors = new Map<number, string | null>(); // member -> why hq-pets last refused, for their modal
let lastHide = new Map<number, number>(); // member -> hq.now() of their last hide/show

function read(id: number): Saved {
  const raw = hq.kv.get("m:" + id);
  if (raw) {
    try {
      const s = JSON.parse(raw) as Saved;
      return { current: s.current ?? null, hidden: !!s.hidden, at: s.at || 0 };
    } catch {
      // a broken value is replaced on the next report
    }
  }
  return { current: null, hidden: false, at: 0 };
}

function cleanName(v: unknown): string {
  // one line: control characters and line or paragraph separators become spaces
  const s = typeof v === "string" ? Array.from(v, (ch) => {
    const c = ch.codePointAt(0)!;
    return c < 0x20 || (c >= 0x7f && c < 0xa0) || c === 0x2028 || c === 0x2029 ? " " : ch;
  }).join("").replace(/\s+/g, " ").trim() : "";
  return Array.from(s).slice(0, NAME_MAX).join("");
}

/** Checks what the companion sent: { dex, form?, shiny?, name? }; dex 0 is an egg. */
function parseReport(body: string): Pokemon | string {
  let o: unknown;
  try {
    o = JSON.parse(body);
  } catch {
    return "body is not JSON";
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return "body is not an object";
  const r = o as Record<string, unknown>;
  const dex = r.dex, form = r.form ?? "", shiny = r.shiny ?? false;
  if (typeof dex !== "number" || !Number.isInteger(dex) || dex < 0 || dex > DEX_MAX) return `dex must be an integer 0-${DEX_MAX}`;
  if (typeof form !== "string" || !FORM_RE.test(form)) return "form must be a PokeTokenBar form name";
  if (typeof shiny !== "boolean") return "shiny must be a boolean";
  return { dex, form: dex === 0 ? "" : form, shiny: dex !== 0 && shiny, name: cleanName(r.name) || (dex === 0 ? "Egg" : "#" + dex) };
}

/** Saves the member's state, then gives (or takes away) their pet in hq-pets. Must be the caller's first
 * await: after an awaited answer, Home Quarters no longer knows which member a hook call is for. */
async function save(id: number, s: Saved): Promise<string | null> {
  hq.kv.set("m:" + id, JSON.stringify(s));
  let err: string | null = null;
  try {
    if (s.current && !s.hidden) {
      const metadata: SheetMetadata = { dex: s.current.dex, form: s.current.form, shiny: s.current.shiny };
      const r = await hq.plugins.call<{ ok: boolean; error?: string }>("hq-pets", "setPet", { id: PET_ID, metadata, name: s.current.name });
      if (!r?.ok) err = r?.error === "full" ? "you already have 4 pets from other plugins" : r?.error || "the pets plugin refused the pet";
    } else {
      await hq.plugins.call("hq-pets", "removePet", { id: PET_ID });
    }
  } catch {
    err = "the pets plugin is off: an administrator has to turn it on";
  }
  errors.set(id, err);
  hq.send(id, me(id, s));
  return err;
}

const me = (id: number, s: Saved): ToPage => ({ t: "me", current: s.current, hidden: s.hidden, at: s.at, error: errors.get(id) ?? null });

export function load(): void {
  // The companion: the Pokémon PokeTokenBar is raising now (it calls this when that changes).
  hq.route("POST", "/pokemon", async (req) => {
    const p = parseReport(req.body);
    if (typeof p === "string") return { status: 400, body: { ok: false, error: p } };
    const s = read(req.player.id);
    s.current = p;
    s.at = Math.floor(Date.now() / 1000);
    const err = await save(req.player.id, s);
    return { status: err ? 409 : 200, body: { ok: !err, error: err, hidden: s.hidden } };
  }, { token: true });

  // The companion: what the office shows for me now.
  hq.route("GET", "/pokemon", (req) => ({ body: { ok: true, ...read(req.player.id) } }), { token: true });

  // The companion: show nothing until the next report.
  hq.route("POST", "/clear", async (req) => {
    const s = read(req.player.id);
    s.current = null;
    s.at = Math.floor(Date.now() / 1000);
    const err = await save(req.player.id, s);
    return { body: { ok: !err, error: err } };
  }, { token: true });
}

// Turned on (or restarted), and for each member who arrives: hq-pets takes a plugin's guest pets away when
// it stops (turned off, crashed), so the saved Pokémon goes back without waiting for the next report.
export async function onJoin(player: HQ.Player): Promise<void> {
  const s = read(player.id);
  if (s.current && !s.hidden) await save(player.id, s);
}

export async function onMessage(player: HQ.Player, msg: unknown): Promise<void> {
  if (typeof msg !== "object" || msg === null) return;
  const m = msg as Record<string, unknown>;
  if (m.t === "get") {
    hq.send(player.id, me(player.id, read(player.id)));
  } else if (m.t === "hide" && typeof m.on === "boolean") {
    const now = hq.now();
    if (now - (lastHide.get(player.id) ?? -1) < 0.5) return;
    lastHide.set(player.id, now);
    const s = read(player.id);
    s.hidden = m.on;
    await save(player.id, s);
  }
}

export function onLeave(player: HQ.Player): void {
  errors.delete(player.id);
  lastHide.delete(player.id);
}

export function unload(): void {
  errors.clear();
  lastHide = new Map();
}
