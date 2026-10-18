// Builds a Home Quarters sprite sheet for one Pokémon from PMD SpriteCollab, in the browser: nothing of
// SpriteCollab is stored or served by this plugin. The page downloads Walk-Anim.png, Idle-Anim.png and
// AnimData.xml from GitHub, crops the frames around the creature (feet on the bottom of the cell) and
// lays them out as 8 rows: walk down, left, right, up, then idle down, left, right, up.
import forms from "./forms.json";

/** PokeTokenBar form names (Sources/PokeTokenBar/Core/PokemonForm.swift) -> SpriteCollab form folders
 * (sprite/<dex>/<form>/), per species; a species' first form is its base sprite and is not listed. Matched
 * against SpriteCollab's tracker.json on 2026-10-18. The companion reads the same file. */
const PMD_FORMS = forms as Record<string, Record<string, number> | undefined>;

const BASE = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite/";
/** SpriteCollab rows: down, down-right, right, up-right, up, up-left, left, down-left. Ours: down, left, right, up. */
const PMD_ROWS = [0, 6, 2, 4];
/** Taller creatures are drawn at half size so a Wailord does not hide a meeting room. */
const MAX_H = 72;
/** SpriteCollab durations count game frames, 60 a second. */
const TICKS = 60;

export interface Built {
  blob: Blob;
  frameW: number;
  frameH: number;
  anims: HQ.Anims;
}

interface Anim { img: ImageBitmap; fw: number; fh: number; durations: number[] }

const pad = (n: number) => String(n).padStart(4, "0");

/** The SpriteCollab folders to try, best first: the form in its colours, the form, the base in its colours, the base. */
export function folders(dex: number, form: string, shiny: boolean): string[] {
  const f = PMD_FORMS[String(dex)]?.[form] ?? 0;
  const d = BASE + pad(dex) + "/";
  const out: string[] = [];
  if (f && shiny) out.push(d + pad(f) + "/0001/");
  if (f) out.push(d + pad(f) + "/");
  if (shiny) out.push(d + "0000/0001/");
  out.push(d);
  return out;
}

async function anims(dir: string): Promise<Map<string, Element>> {
  const res = await fetch(dir + "AnimData.xml");
  if (!res.ok) throw new Error("AnimData " + res.status);
  const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
  const out = new Map<string, Element>();
  for (const a of Array.from(doc.getElementsByTagName("Anim"))) {
    const name = a.getElementsByTagName("Name")[0]?.textContent?.trim();
    if (name) out.set(name, a);
  }
  return out;
}

const tag = (a: Element, name: string) => a.getElementsByTagName(name)[0]?.textContent?.trim() ?? "";

async function anim(dir: string, all: Map<string, Element>, name: string): Promise<Anim | null> {
  let a = all.get(name);
  for (let hops = 0; a && tag(a, "CopyOf") && hops < 4; hops++) {
    name = tag(a, "CopyOf");
    a = all.get(name);
  }
  if (!a) return null;
  const fw = Number(tag(a, "FrameWidth")), fh = Number(tag(a, "FrameHeight"));
  const durations = Array.from(a.getElementsByTagName("Duration")).map((d) => Number(d.textContent) || 1);
  if (!(fw > 0 && fh > 0 && durations.length)) return null;
  const res = await fetch(dir + name + "-Anim.png");
  if (!res.ok) return null;
  return { img: await createImageBitmap(await res.blob()), fw, fh, durations };
}

/** The opaque box of an animation's frames on our four rows, relative to the frame's bottom centre. */
function box(a: Anim): { half: number; top: number; bottom: number } {
  const c = new OffscreenCanvas(a.img.width, a.img.height);
  const g = c.getContext("2d")!;
  g.drawImage(a.img, 0, 0);
  const px = g.getImageData(0, 0, a.img.width, a.img.height).data;
  const rows = Math.max(1, Math.floor(a.img.height / a.fh));
  let half = 0, top = a.fh, bottom = 0;
  for (const r of PMD_ROWS.map((r) => Math.min(r, rows - 1))) {
    for (let f = 0; f < a.durations.length; f++) {
      for (let y = 0; y < a.fh; y++) {
        for (let x = 0; x < a.fw; x++) {
          if (px[((r * a.fh + y) * a.img.width + f * a.fw + x) * 4 + 3] < 16) continue;
          half = Math.max(half, Math.abs(x + 0.5 - a.fw / 2) + 0.5);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
  }
  return { half: Math.ceil(half), top, bottom };
}

function fps(durations: number[]): number {
  const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
  return Math.max(1, Math.min(60, Math.round(TICKS / avg)));
}

/** Downloads and lays out the sheet of that Pokémon; null when SpriteCollab has no walk animation for it. */
export async function build(dex: number, form: string, shiny: boolean): Promise<Built | null> {
  for (const dir of folders(dex, form, shiny)) {
    let all: Map<string, Element>;
    try {
      all = await anims(dir);
    } catch {
      continue;
    }
    const walk = await anim(dir, all, "Walk");
    if (!walk) continue;
    const idle = (await anim(dir, all, "Idle")) ?? walk;
    return layout(walk, idle);
  }
  return null;
}

async function layout(walk: Anim, idle: Anim): Promise<Built> {
  const bw = box(walk), bi = idle === walk ? bw : box(idle);
  const tall = Math.max(bw.bottom - bw.top, bi.bottom - bi.top, 1);
  const s = tall > MAX_H ? 0.5 : 1;
  const frameW = Math.max(8, Math.ceil(2 * Math.max(bw.half, bi.half, 1) * s));
  const frameH = Math.max(8, Math.ceil(tall * s));
  const cols = Math.min(64, Math.max(walk.durations.length, idle.durations.length));
  const c = new OffscreenCanvas(cols * frameW, 8 * frameH);
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  const anims: HQ.Anims = {};
  const dirs = ["down", "left", "right", "up"];
  [walk, idle].forEach((a, k) => {
    const b = k === 0 ? bw : bi;
    const rows = Math.max(1, Math.floor(a.img.height / a.fh));
    const n = Math.min(cols, a.durations.length);
    PMD_ROWS.forEach((pr, i) => {
      const row = k * 4 + i, src = Math.min(pr, rows - 1);
      for (let f = 0; f < n; f++) {
        // the frame's bottom centre (its box's bottom) lands on the cell's bottom centre
        const dx = f * frameW + frameW / 2 - (a.fw / 2) * s, dy = (row + 1) * frameH - b.bottom * s;
        g.save();
        g.beginPath();
        g.rect(f * frameW, row * frameH, frameW, frameH);
        g.clip();
        g.drawImage(a.img, f * a.fw, src * a.fh, a.fw, a.fh, Math.round(dx), Math.round(dy), a.fw * s, a.fh * s);
        g.restore();
      }
      const frames = Array.from({ length: n }, (_, f) => f);
      anims[(k === 0 ? "walk-" : "idle-") + dirs[i]] = { row, frames, fps: fps(a.durations.slice(0, n)) };
    });
  });
  walk.img.close();
  if (idle !== walk) idle.img.close();
  return { blob: await c.convertToBlob({ type: "image/png" }), frameW, frameH, anims };
}

/** A small egg drawn here (cream with green spots), 3 wobble frames, the same on all four rows. */
export async function egg(): Promise<Built> {
  const W = 16, H = 18, c = new OffscreenCanvas(W * 3, H * 8), g = c.getContext("2d")!;
  for (let row = 0; row < 8; row++) {
    for (let f = 0; f < 3; f++) {
      const ox = f * W + (f === 1 ? -1 : f === 2 ? 1 : 0), oy = row * H;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 14; x++) {
          const nx = (x - 6.5) / 6.5, ny = (y - 9) / (y < 9 ? 9 : 7);
          const d = nx * nx + ny * ny;
          if (d > 1) continue;
          const edge = d > 0.72;
          const spot = (x - 4) ** 2 + (y - 6) ** 2 < 5 || (x - 9) ** 2 + (y - 10) ** 2 < 6 || (x - 5) ** 2 + (y - 12) ** 2 < 2;
          g.fillStyle = edge ? "#3b3a2e" : spot ? "#5fae4e" : y > 11 ? "#e9dfb4" : "#fbf5d8";
          g.fillRect(ox + 1 + x, oy + H - 17 + y, 1, 1);
        }
      }
    }
  }
  const anims: HQ.Anims = {};
  ["down", "left", "right", "up"].forEach((d, i) => {
    anims["walk-" + d] = { row: i, frames: [1, 0, 2, 0], fps: 8 };
    anims["idle-" + d] = { row: 4 + i, frames: [0, 0, 0, 0, 1, 0, 2, 0], fps: 4 };
  });
  return { blob: await c.convertToBlob({ type: "image/png" }), frameW: W, frameH: H, anims };
}
