// Browser side of poketoken: draws every member's PokeTokenBar Pokémon following them, and the member's
// own modal (app token for the desktop companion, hide/show). Sheets are built here from PMD SpriteCollab
// (pmd.ts) and handed to the page as image data.
import type { Entry, Pokemon, ToPage } from "./messages";
import { build, egg, type Built } from "./pmd";

/** The page API this plugin needs on top of client.d.ts: a sheet from image data the plugin produced.
 * Requested in christphe/homequarters#10; until a Home Quarters release has it, the page refuses the
 * command and stops this plugin on that page (with the reason in the console). */
type LoadFromData = (key: string, image: Blob, opts: { frameW: number; frameH: number; anims?: HQ.Anims }) => void;
const loadSpriteData = hq.loadSprite as unknown as LoadFromData;

/** Sheets a page may load for one plugin (Home Quarters' limit). */
const SHEETS_MAX = 32;
/** Behind the member's own pets (hq-pets walks them 20, 36, 52 px behind). */
const FOLLOW = { gap: 30, beside: 34, roam: 24 };

interface Want { sheet: string; dex: number; form: string; shiny: boolean; name: string }

const roster = new Map<number, Want>(); // member -> what they show
const drawn = new Map<number, string>(); // member -> the sheet id their sprite is drawn with
const sheets = new Map<string, Promise<string | null>>(); // sheet id -> hq sheet key (null: none)
let mine: { current: Pokemon | null; hidden: boolean; at: number } = { current: null, hidden: false, at: 0 };
let modalOpen = false;

const sheetId = (dex: number, form: string, shiny: boolean) => dex === 0 ? "egg" : `${dex}-${form}-${shiny ? 1 : 0}`;
const spriteId = (member: number) => "p" + member;

function sheet(w: Want): Promise<string | null> {
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
        loadSpriteData(key, b.blob, { frameW: b.frameW, frameH: b.frameH, anims: b.anims });
        return key;
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
    const key = await sheet(w);
    if (roster.get(member) !== w) return; // it changed while the sheet loaded
    if (!key) return;
    const first = !drawn.has(member);
    drawn.set(member, w.sheet);
    hq.spawn(spriteId(member), key); // an existing sprite keeps its place, only its picture changes
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

function openModal(): void {
  modalOpen = true;
  const when = mine.at ? new Date(mine.at * 1000).toLocaleString() : "";
  hq.ui.modal({ title: "PokeToken", size: "medium", onClose: () => { modalOpen = false; } }, [
    hq.ui.text(describe(mine.current)),
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
