// Browser side of poketoken: draws, on this page, the sheet of every Pokémon this plugin put as a guest pet
// of hq-pets (provideSheet: hq-pets asks with the pet's metadata, then walks it like the member's other
// pets), and the member's own modal (app token for the desktop companion, hide/show, a preview).
import type { Pokemon, SheetMetadata, ToPage } from "./messages";
import { build, egg, type Built } from "./pmd";

let mine: { current: Pokemon | null; hidden: boolean; at: number; error: string | null } = { current: null, hidden: false, at: 0, error: null };
let modalOpen = false;

/** One build per Pokémon on this page: hq-pets asks for each guest pet, the modal for its preview. */
const built = new Map<string, Promise<Built>>();
const keyOf = (m: SheetMetadata) => m.dex === 0 ? "egg" : `${m.dex}-${m.form}-${m.shiny ? 1 : 0}`;

function sheetFor(m: SheetMetadata): Promise<Built> {
  const k = keyOf(m);
  let p = built.get(k);
  if (!p) {
    p = (m.dex === 0 ? egg() : build(m.dex, m.form, m.shiny))
      .catch((err): Built | null => {
        console.warn("poketoken: no sprite for", k, err);
        return null;
      })
      .then((b) => b ?? egg()); // SpriteCollab has not drawn it (or is out of reach): an egg stands in
    built.set(k, p);
  }
  return p;
}

hq.provideSheet(async (metadata: SheetMetadata) => {
  const b = await sheetFor({ dex: Number(metadata?.dex) || 0, form: String(metadata?.form ?? ""), shiny: metadata?.shiny === true });
  return { image: b.blob, frameW: b.frameW, frameH: b.frameH };
});

/** The member's own Pokémon standing, facing down, once its sheet is loaded on this page. */
let preview: { key: string; sheet: string; w: number; h: number } | null = null;
let previews = 0;

function describe(p: Pokemon | null): string {
  if (!p) return "Nothing yet. Start the PokeToken companion on the computer running PokeTokenBar.";
  const what = p.dex === 0 ? "an egg" : `${p.name} (#${p.dex}${p.form ? ", " + p.form : ""}${p.shiny ? ", shiny" : ""})`;
  return `PokeTokenBar is raising ${what}.`;
}

function openModal(): void {
  modalOpen = true;
  const p = mine.current;
  const want = p ? keyOf(p) : null;
  if (p && want && preview?.sheet !== want) {
    void sheetFor(p).then((b) => {
      if (!mine.current || keyOf(mine.current) !== want || previews >= 8) return;
      const key = "preview" + previews++;
      hq.loadSprite(key, b.blob, { frameW: b.frameW, frameH: b.frameH });
      preview = { key, sheet: want, w: b.frameW, h: b.frameH };
      if (modalOpen) openModal();
    });
  }
  const pic = p && preview?.sheet === want ? preview : null;
  const when = mine.at ? new Date(mine.at * 1000).toLocaleString() : "";
  hq.ui.modal({ title: "PokeToken", size: "medium", onClose: () => { modalOpen = false; } }, [
    ...(pic && p ? [hq.ui.sprite({ sheet: pic.key, frame: [0, 0, pic.w, pic.h], scale: pic.h > 48 ? 1 : 2, alt: p.name.slice(0, 40) })] : []),
    hq.ui.text(describe(p)),
    ...(mine.error ? [hq.ui.text("Not shown: " + mine.error + ".")] : []),
    ...(when ? [hq.ui.text("Last change reported " + when + ".", { muted: true })] : []),
    hq.ui.button({
      label: mine.hidden ? "Show my Pokémon" : "Hide my Pokémon",
      pressed: mine.hidden,
      onClick: () => hq.send({ t: "hide", on: !mine.hidden }),
    }),
    hq.ui.text("It walks with your pets: Let pets wander and Call pets move it too. The companion app reads PokeTokenBar's save once a minute and sends the current Pokémon here. Create a token, then paste it with this office's address in the companion's settings."),
    hq.ui.appToken(),
    hq.ui.text("Sprites: PMD SpriteCollab (CC BY-NC 4.0), downloaded by your browser from GitHub. Pokémon is © Nintendo, Creatures, GAME FREAK and The Pokémon Company; this is an unofficial fan plugin.", { muted: true }),
  ]);
}

hq.onLoad(() => {
  hq.ui.slot("open", "sidebar", { label: "PokeToken", onClick: openModal });
  hq.send({ t: "get" });
});

hq.onMessage<ToPage>((m) => {
  if (m.t === "me") {
    mine = { current: m.current, hidden: m.hidden, at: m.at, error: m.error };
    if (modalOpen) openModal();
  }
});
