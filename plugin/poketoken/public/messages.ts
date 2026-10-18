// What the poketoken plugin's server and browser code say to each other, typed once for both sides
// (main.ts imports it as ./public/messages, public/client.ts as ./messages). Types and small constants only.

/** The Pokémon a member shows, as their desktop companion reported it. */
export interface Pokemon {
  /** National Pokédex number, 1-DEX_MAX; 0 for an egg. */
  dex: number;
  /** PokeTokenBar's form name ("sky", "q", "therian"...), "" for the default form. */
  form: string;
  shiny: boolean;
  /** Shown on hover: nickname or species name, at most NAME_MAX characters. */
  name: string;
}

export const DEX_MAX = 1025;
/** A form name as PokeTokenBar writes it. */
export const FORM_RE = /^[a-z0-9-]{0,16}$/;
export const NAME_MAX = 24;

/** One member's entry in the office roster: [member, dex, form, shiny 0/1, name], or [member] when they
 * show nothing (no Pokémon, hidden, or gone). */
export type Entry = [id: number, dex?: number, form?: string, shiny?: 0 | 1, name?: string];

/** Page -> server. */
export type ToServer =
  | { t: "get" } // send me the roster and my own state
  | { t: "hide"; on: boolean }; // take my Pokémon off the map, or put it back

/** Server -> page. */
export type ToPage =
  | { t: "roster"; e: Entry[]; full: boolean } // full: the first piece of a whole roster (forget the old one)
  | { t: "me"; current: Pokemon | null; hidden: boolean; at: number };
