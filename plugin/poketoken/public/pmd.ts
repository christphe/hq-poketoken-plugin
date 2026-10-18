// Builds a Home Quarters sprite sheet for one Pokémon from PMD SpriteCollab, in the browser: nothing of
// SpriteCollab is stored or served by this plugin. The page downloads Walk-Anim.png, Idle-Anim.png and
// AnimData.xml from GitHub, crops the frames around the creature (feet on the bottom of the cell) and
// lays them out as hq-pets draws its pets (4 rows of 3 cells: standing, step, step), shrunk to pet size.
import forms from "./forms.json";

/** PokeTokenBar form names (Sources/PokeTokenBar/Core/PokemonForm.swift) -> SpriteCollab form folders
 * (sprite/<dex>/<form>/), per species; a species' first form is its base sprite and is not listed. Matched
 * against SpriteCollab's tracker.json on 2026-10-18. The companion reads the same file. */
const PMD_FORMS = forms as Record<string, Record<string, number> | undefined>;

const BASE = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite/";
/** SpriteCollab rows: down, down-right, right, up-right, up, up-left, left, down-left. Ours: down, left, right, up. */
const PMD_ROWS = [0, 6, 2, 4];
/** SpriteCollab draws creatures about avatar-sized; a pet is smaller (hq-pets' pets are 16 x 20), so
 * sheets are shrunk 1.5 times (a Pikachu stands 21 px), and 3 times past BIG px so a Wailord does not hide
 * a meeting room: drawn UP times larger, then each DOWN x DOWN block becomes one pixel. */
const BIG = 56;


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
function box(a: Anim, frames: number[]): { half: number; top: number; bottom: number } {
  const c = new OffscreenCanvas(a.img.width, a.img.height);
  const g = c.getContext("2d")!;
  g.drawImage(a.img, 0, 0);
  const px = g.getImageData(0, 0, a.img.width, a.img.height).data;
  const rows = Math.max(1, Math.floor(a.img.height / a.fh));
  let half = 0, top = a.fh, bottom = 0;
  for (const r of PMD_ROWS.map((r) => Math.min(r, rows - 1))) {
    for (const f of frames) {
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
    return layout(walk, (await anim(dir, all, "Idle")) ?? walk);
  }
  return null;
}

/** hq-pets' format: 4 rows (down, left, right, up) of 3 cells. The first is the Pokémon standing, the
 * first frame of its idle animation held still (the animation itself jitters at pet size and draws the
 * eye); the other two are steps of its walk, which hq-pets plays step, stand, step, stand. */
async function layout(walk: Anim, idle: Anim): Promise<Built> {
  const n = walk.durations.length;
  const steps = n >= 4 ? [Math.floor(n / 4), Math.floor((3 * n) / 4)] : [0, n - 1]; // 1 and 3 of a 4-frame walk
  const bw = box(walk, steps), bi = box(idle, [0]);
  const tall = Math.max(bw.bottom - bw.top, bi.bottom - bi.top, 1);
  const [UP, DOWN] = tall > BIG ? [1, 3] : [2, 3]; // shrunk DOWN / UP times
  const fit = (v: number) => Math.ceil(v / DOWN) * DOWN; // cells that shrink to whole pixels
  const frameW = Math.max(fit(8 * DOWN / UP), fit(2 * Math.max(bw.half, bi.half, 1)));
  const frameH = Math.max(fit(8 * DOWN / UP), fit(tall));
  const c = new OffscreenCanvas(3 * frameW, 4 * frameH);
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  // a frame's bottom centre (its animation's box bottom) lands on the cell's bottom centre
  const draw = (a: Anim, b: typeof bw, f: number, col: number, row: number) => {
    const src = Math.min(PMD_ROWS[row], Math.max(1, Math.floor(a.img.height / a.fh)) - 1);
    const dx = col * frameW + frameW / 2 - a.fw / 2, dy = (row + 1) * frameH - b.bottom;
    g.save();
    g.beginPath();
    g.rect(col * frameW, row * frameH, frameW, frameH);
    g.clip();
    g.drawImage(a.img, f * a.fw, src * a.fh, a.fw, a.fh, Math.round(dx), Math.round(dy), a.fw, a.fh);
    g.restore();
  };
  const anims: HQ.Anims = {};
  ["down", "left", "right", "up"].forEach((d, row) => {
    draw(idle, bi, 0, 0, row);
    draw(walk, bw, steps[0], 1, row);
    draw(walk, bw, steps[1], 2, row);
    anims["walk-" + d] = { row, frames: [1, 0, 2, 0], fps: 8 }; // as hq-pets plays it
    anims["idle-" + d] = { row, frames: [0], fps: 0 };
  });
  walk.img.close();
  if (idle !== walk) idle.img.close();
  const small = shrink(grow(c, UP), DOWN);
  return { blob: await small.convertToBlob({ type: "image/png" }), frameW: frameW * UP / DOWN, frameH: frameH * UP / DOWN, anims };
}

/** Each pixel becomes n x n. */
function grow(src: OffscreenCanvas, n: number): OffscreenCanvas {
  if (n === 1) return src;
  const out = new OffscreenCanvas(src.width * n, src.height * n);
  const g = out.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/** Each n x n block becomes one pixel: transparent when under a third is opaque, else its most frequent colour
 * (an average would blur the pixel art), the darkest on a tie so 1 px outlines stay closed. */
function shrink(src: OffscreenCanvas, n: number): OffscreenCanvas {
  const W = Math.floor(src.width / n), H = Math.floor(src.height / n);
  const a = src.getContext("2d")!.getImageData(0, 0, src.width, src.height).data;
  const out = new OffscreenCanvas(W, H);
  const g = out.getContext("2d")!;
  const img = g.createImageData(W, H), d = img.data;
  const px: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      px.length = 0;
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) {
          const i = ((n * y + dy) * src.width + n * x + dx) * 4;
          if (a[i + 3] >= 128) px.push(i);
        }
      }
      if (3 * px.length < n * n) continue; // a third is enough: 1 px tips (ears, tails, outlines) stay
      const o = (y * W + x) * 4;
      let best = px[0], bestN = 0, bestL = 1e9;
      for (const i of px) {
        const n = px.filter((j) => a[j] === a[i] && a[j + 1] === a[i + 1] && a[j + 2] === a[i + 2]).length;
        const l = a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11;
        if (n > bestN || (n === bestN && l < bestL)) { best = i; bestN = n; bestL = l; }
      }
      d[o] = a[best]; d[o + 1] = a[best + 1]; d[o + 2] = a[best + 2];
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

/** A small egg drawn here (cream with green spots): it wobbles while it follows, stands still otherwise. */
export async function egg(): Promise<Built> {
  const W = 16, H = 18, c = new OffscreenCanvas(W * 3, H * 4), g = c.getContext("2d")!;
  for (let row = 0; row < 4; row++) {
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
    anims["idle-" + d] = { row: i, frames: [0], fps: 0 };
  });
  return { blob: await c.convertToBlob({ type: "image/png" }), frameW: W, frameH: H, anims };
}
