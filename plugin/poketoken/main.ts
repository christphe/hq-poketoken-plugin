// Server side of poketoken. A member's desktop companion (holding the member's app token) reports which
// Pokémon PokeTokenBar is raising; this plugin keeps it and tells every page, whose browser code draws it
// following its trainer. Sprites are never stored here: each page fetches them from PMD SpriteCollab.
//
// kv: "m:<member>" -> JSON Saved.
import type { Entry, Pokemon, ToPage } from "./public/messages";
import { DEX_MAX, FORM_RE, NAME_MAX } from "./public/messages";

interface Saved { current: Pokemon | null; hidden: boolean; at: number }

/** A broadcast stays under the 4 KB a message carries, whatever the script of the names. */
const PIECE_BYTES = 3500;

const online = new Map<number, Saved>(); // member -> their state, while visible-online
const dirty = new Set<number>(); // members whose entry the pages have not been told yet
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

function write(id: number, s: Saved): void {
  hq.kv.set("m:" + id, JSON.stringify(s));
  if (online.has(id)) {
    online.set(id, s);
    dirty.add(id);
  }
}

function entry(id: number, s: Saved | undefined): Entry {
  const p = s && !s.hidden ? s.current : null;
  return p ? [id, p.dex, p.form, p.shiny ? 1 : 0, p.name] : [id];
}

/** UTF-8 length of a JSON value, to cut broadcasts below the message size. */
function bytes(v: unknown): number {
  const s = JSON.stringify(v);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3;
  }
  return n;
}

/** Cuts entries into messages that each fit in PIECE_BYTES. */
function pieces(entries: Entry[], full: boolean): ToPage[] {
  const out: ToPage[] = [];
  let cur: Entry[] = [];
  let size = 40;
  for (const e of entries) {
    const n = bytes(e) + 1;
    if (cur.length && size + n > PIECE_BYTES) {
      out.push({ t: "roster", e: cur, full: full && out.length === 0 });
      cur = [];
      size = 40;
    }
    cur.push(e);
    size += n;
  }
  if (cur.length || (full && out.length === 0)) out.push({ t: "roster", e: cur, full: full && out.length === 0 });
  return out;
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

const me = (s: Saved): ToPage => ({ t: "me", current: s.current, hidden: s.hidden, at: s.at });

export function load(): void {
  // The companion: the Pokémon PokeTokenBar is raising now (it calls this when that changes).
  hq.route("POST", "/pokemon", (req) => {
    const p = parseReport(req.body);
    if (typeof p === "string") return { status: 400, body: { ok: false, error: p } };
    const s = read(req.player.id);
    s.current = p;
    s.at = Math.floor(Date.now() / 1000);
    write(req.player.id, s);
    hq.send(req.player.id, me(s));
    return { body: { ok: true, hidden: s.hidden } };
  }, { token: true });

  // The companion: what the office shows for me now.
  hq.route("GET", "/pokemon", (req) => ({ body: { ok: true, ...read(req.player.id) } }), { token: true });

  // The companion: show nothing until the next report.
  hq.route("POST", "/clear", (req) => {
    const s = read(req.player.id);
    s.current = null;
    s.at = Math.floor(Date.now() / 1000);
    write(req.player.id, s);
    hq.send(req.player.id, me(s));
    return { body: { ok: true } };
  }, { token: true });
}

export function onJoin(player: HQ.Player): void {
  online.set(player.id, read(player.id));
  dirty.add(player.id);
}

export function onLeave(player: HQ.Player): void {
  online.delete(player.id);
  lastHide.delete(player.id);
  dirty.add(player.id); // an entry with no Pokémon: pages take it away
}

export function onMessage(player: HQ.Player, msg: unknown): void {
  if (typeof msg !== "object" || msg === null) return;
  const m = msg as Record<string, unknown>;
  if (m.t === "get") {
    // a page (re)started: the whole roster, and the member's own state for their modal
    const all = [...online.entries()].map(([id, s]) => entry(id, s));
    for (const piece of pieces(all, true)) hq.send(player.id, piece);
    hq.send(player.id, me(online.get(player.id) ?? read(player.id)));
  } else if (m.t === "hide" && typeof m.on === "boolean") {
    const now = hq.now();
    if (now - (lastHide.get(player.id) ?? -1) < 0.5) return;
    lastHide.set(player.id, now);
    const s = read(player.id);
    s.hidden = m.on;
    write(player.id, s);
    hq.send(player.id, me(s));
  }
}

/** Tells every page what changed since the last tick, one piece per tick. */
export function update(): void {
  if (!dirty.size) return;
  const ids = [...dirty];
  const [piece] = pieces(ids.map((id) => entry(id, online.get(id))), false);
  if (!piece || piece.t !== "roster") return;
  if (!hq.broadcast(piece)) return; // the budget is spent: try again next tick
  for (const e of piece.e) dirty.delete(e[0]);
}

export function unload(): void {
  online.clear();
  dirty.clear();
  lastHide = new Map();
}
