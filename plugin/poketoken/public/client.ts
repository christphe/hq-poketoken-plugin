// Browser side of poketoken: draws every member's PokeTokenBar Pokémon following them, and the member's
// own modal (app token for the desktop companion, hide/show). Sheets are built here from PMD SpriteCollab
// (pmd.ts) and handed to the page as image data.
import type { Entry, Pokemon, ToPage } from "./messages";
import { build, egg, type Built } from "./pmd";

/** Sheets a page may load for one plugin (Home Quarters' limit). */
const SHEETS_MAX = 32;
/** Behind the member's own pets (hq-pets walks them 20, 36, 52 px behind). */
const FOLLOW = { gap: 30, beside: 34, roam: 24 };

interface Want { sheet: string; dex: number; form: string; shiny: boolean; name: string }

const roster = new Map<number, Want>(); // member -> what they show
const drawn = new Map<number, string>(); // member -> the sheet id their sprite is drawn with
/** A sheet handed to the page: its key and cell size (rows 0-3 walk, 4-7 standing). */
interface Loaded { key: string; w: number; h: number }
const sheets = new Map<string, Promise<Loaded | null>>(); // sheet id -> the loaded sheet (null: none)
let mine: { current: Pokemon | null; hidden: boolean; at: number } = { current: null, hidden: false, at: 0 };
let modalOpen = false;

const sheetId = (dex: number, form: string, shiny: boolean) => dex === 0 ? "egg" : `${dex}-${form}-${shiny ? 1 : 0}`;
const spriteId = (member: number) => "p" + member;

function sheet(w: Want): Promise<Loaded | null> {
  let p = sheets.get(w.sheet);
  if (!p) {
    if (sheets.size >= SHEETS_MAX) return Promise.resolve(null);
    const key = "s" + sheets.size;
    p = (w.dex === 0 ? egg() : build(w.dex, w.form, w.shiny))
      .catch((err): Built | null => {
        console.warn("poketoken: no sprite for", w.sheet, err);
        return null;
      })
      .then(async (b) => b ?? (w.dex === 0 ? null : await egg())) // no SpriteCollab sprite: an egg stands in
      .then((b) => {
        if (!b) return null;
        hq.loadSprite(key, b.blob, { frameW: b.frameW, frameH: b.frameH, anims: b.anims });
        return { key, w: b.frameW, h: b.frameH };
      });
    sheets.set(w.sheet, p);
  }
  return p;
}

async function draw(member: number): Promise<void> {
  const w = roster.get(member);
  if (!w) {
    if (drawn.delete(member)) hq.remove(spriteId(member));
    return;
  }
  if (drawn.get(member) !== w.sheet) {
    const loaded = await sheet(w);
    if (roster.get(member) !== w) return; // it changed while the sheet loaded
    if (!loaded) return;
    const first = !drawn.has(member);
    drawn.set(member, w.sheet);
    hq.spawn(spriteId(member), loaded.key); // an existing sprite keeps its place, only its picture changes
    if (first) hq.follow(spriteId(member), member, FOLLOW);
  }
  hq.setLabel(spriteId(member), w.name || null, { owner: member });
}

function apply(e: Entry): void {
  const [id, dex, form, shiny, name] = e;
  if (dex === undefined) {
    roster.delete(id);
  } else {
    roster.set(id, { sheet: sheetId(dex, form ?? "", shiny === 1), dex, form: form ?? "", shiny: shiny === 1, name: name ?? "" });
  }
  void draw(id);
}

function describe(p: Pokemon | null): string {
  if (!p) return "Nothing yet. Start the PokeToken companion on the computer running PokeTokenBar.";
  const what = p.dex === 0 ? "an egg" : `${p.name} (#${p.dex}${p.form ? ", " + p.form : ""}${p.shiny ? ", shiny" : ""})`;
  return `PokeTokenBar is raising ${what}.`;
}

const wantOf = (p: Pokemon): Want => ({ sheet: sheetId(p.dex, p.form, p.shiny), ...p });

/** The member's own Pokémon standing, facing down, once its sheet is loaded. */
let preview: { sheet: string; loaded: Loaded } | null = null;

function openModal(): void {
  modalOpen = true;
  const p = mine.current;
  const want = p ? wantOf(p) : null;
  if (want && preview?.sheet !== want.sheet) {
    void sheet(want).then((loaded) => {
      if (loaded && mine.current && wantOf(mine.current).sheet === want.sheet) {
        preview = { sheet: want.sheet, loaded };
        if (modalOpen) openModal();
      }
    });
  }
  const pic = want && preview?.sheet === want.sheet && preview.loaded.w <= 128 && preview.loaded.h <= 128 ? preview.loaded : null;
  const when = mine.at ? new Date(mine.at * 1000).toLocaleString() : "";
  hq.ui.modal({ title: "PokeToken", size: "medium", onClose: () => { modalOpen = false; } }, [
    ...(pic && p ? [hq.ui.sprite({ sheet: pic.key, frame: [0, 4 * pic.h, pic.w, pic.h], scale: pic.h > 48 ? 1 : 2, alt: p.name.slice(0, 40) })] : []),
    hq.ui.text(describe(p)),
    ...(when ? [hq.ui.text("Last change reported " + when + ".", { muted: true })] : []),
    hq.ui.button({
      label: mine.hidden ? "Show my Pokémon" : "Hide my Pokémon",
      pressed: mine.hidden,
      onClick: () => hq.send({ t: "hide", on: !mine.hidden }),
    }),
    hq.ui.text("The companion app reads PokeTokenBar's save once a minute and sends the current Pokémon here. Create a token, then paste it with this office's address in the companion's settings."),
    hq.ui.appToken(),
    hq.ui.text("Sprites: PMD SpriteCollab (CC BY-NC 4.0), downloaded by your browser from GitHub. Pokémon is © Nintendo, Creatures, GAME FREAK and The Pokémon Company; this is an unofficial fan plugin.", { muted: true }),
  ]);
}

hq.onLoad(() => {
  hq.ui.slot("open", "sidebar", { label: "PokeToken", onClick: openModal });
  hq.send({ t: "get" });
});

hq.onMessage<ToPage>((m) => {
  if (m.t === "roster") {
    if (m.full) {
      const keep = new Set(m.e.map((e) => e[0]));
      for (const id of [...roster.keys()]) if (!keep.has(id)) apply([id]);
    }
    for (const e of m.e) apply(e);
  } else if (m.t === "me") {
    mine = { current: m.current, hidden: m.hidden, at: m.at };
    if (modalOpen) openModal();
  }
});
