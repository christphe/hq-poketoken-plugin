// The few browser APIs the plugin's iframe uses, declared by hand: the SDK's client.d.ts declares its own
// `console`, which clashes with TypeScript's "DOM" lib. Types only; the iframe has the real ones.
declare global {
  interface Blob { readonly size: number; readonly type: string }
  interface Response { readonly ok: boolean; readonly status: number; text(): Promise<string>; blob(): Promise<Blob> }
  function fetch(url: string): Promise<Response>;
  interface ImageBitmap { readonly width: number; readonly height: number; close(): void }
  function createImageBitmap(image: Blob): Promise<ImageBitmap>;
  interface ImageData { readonly data: Uint8ClampedArray }
  interface OffscreenCanvasRenderingContext2D {
    imageSmoothingEnabled: boolean;
    fillStyle: string;
    drawImage(image: ImageBitmap, dx: number, dy: number): void;
    drawImage(image: ImageBitmap, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    getImageData(x: number, y: number, w: number, h: number): ImageData;
    fillRect(x: number, y: number, w: number, h: number): void;
    save(): void;
    restore(): void;
    beginPath(): void;
    rect(x: number, y: number, w: number, h: number): void;
    clip(): void;
  }
  class OffscreenCanvas {
    constructor(width: number, height: number);
    getContext(kind: "2d"): OffscreenCanvasRenderingContext2D | null;
    convertToBlob(opts?: { type?: string }): Promise<Blob>;
  }
  interface Element { readonly textContent: string | null; getElementsByTagName(name: string): ArrayLike<Element> }
  interface XMLDocument { getElementsByTagName(name: string): ArrayLike<Element> }
  class DOMParser { parseFromString(text: string, type: "application/xml"): XMLDocument }
}

export {};
