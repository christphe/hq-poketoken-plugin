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

/** What hq-pets keeps with the guest pet, and hands back to this plugin's provideSheet on each page. */
export interface SheetMetadata {
  dex: number;
  form: string;
  shiny: boolean;
}

export const DEX_MAX = 1025;
/** A form name as PokeTokenBar writes it. */
export const FORM_RE = /^[a-z0-9-]{0,16}$/;
export const NAME_MAX = 24;

/** Page -> server. */
export type ToServer =
  | { t: "get" } // send me my state
  | { t: "hide"; on: boolean }; // take my Pokémon off the map, or put it back

/** Server -> page: the member's own state, for their modal. error: why the pets plugin refused the pet. */
export type ToPage = { t: "me"; current: Pokemon | null; hidden: boolean; at: number; error: string | null };
