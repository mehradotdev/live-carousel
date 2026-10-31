import { zipSync } from 'fflate';
import {
  activeLayers,
  coverCrop,
  fitTextBox,
  fontOf,
  lineHeight,
  slideLayers,
  slideSize,
  stack,
  textLines,
  textPad,
  type AnyLayer,
  type Asset,
  type Layer,
  type Project,
  type TextLayer,
  type Workspace,
} from './model';
import { fit, PREVIEW } from './storage';
import { reaches, visibleRect, type Size, type View } from './view';
// Crop in master pixels, mapped onto whichever bitmap (preview or master) was decoded.
export function sourceRect(asset: Asset, image: { width: number; height: number }, layer: Layer) {
  const crop = coverCrop(
    asset.width,
    asset.height,
    layer.width,
    layer.height,
    layer.zoom,
    layer.panX,
    layer.panY,
  );
  const sx = image.width / asset.width;
  const sy = image.height / asset.height;
  return { x: crop.x * sx, y: crop.y * sy, width: crop.width * sx, height: crop.height * sy };
}
function begin(workspace: Workspace, canvas: HTMLCanvasElement, scale: number, slide?: number) {
  const { width, height } = slideSize(workspace.aspect);
  canvas.width = Math.round((slide === undefined ? width * workspace.slides : width) * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.scale(scale, scale);
  ctx.fillStyle = workspace.background;
  ctx.fillRect(0, 0, width * workspace.slides, height);
  if (slide !== undefined) ctx.translate(-slide * width, 0);
  return ctx;
}
function paintLayer(
  ctx: CanvasRenderingContext2D,
  workspace: Workspace,
  asset: Asset,
  image: ImageBitmap,
  layer: Layer,
  scale: number,
) {
  const crop = sourceRect(asset, image, layer);
  ctx.save();
  ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  if (workspace.style === 'scrapbook') {
    ctx.fillStyle = '#fffdf8';
    ctx.shadowColor = '#29201630';
    ctx.shadowBlur = 18 * scale;
    ctx.shadowOffsetY = 8 * scale;
    ctx.fillRect(
      -layer.width / 2 - 12,
      -layer.height / 2 - 12,
      layer.width + 24,
      layer.height + 44,
    );
    ctx.shadowColor = 'transparent';
  }
  ctx.beginPath();
  ctx.roundRect(
    -layer.width / 2,
    -layer.height / 2,
    layer.width,
    layer.height,
    workspace.style === 'bento' ? workspace.bento.radius : 0,
  );
  ctx.clip();
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    -layer.width / 2,
    -layer.height / 2,
    layer.width,
    layer.height,
  );
  ctx.restore();
}
const fontKey = (l: TextLayer) => fontOf({ ...l, size: 16 });
const fonts = new Map<string, Promise<void>>();
const loaded = new Set<string>();
const fontError = (l: TextLayer) =>
  `The font ${l.fontFamily} could not load, so text using it cannot be shown or exported. Reload the page and try again.`;
export const fontReady = (l: TextLayer) => loaded.has(fontKey(l));
// A canvas silently draws fallback text until a face has loaded, so everything that paints text goes through here.
// shortcut: failures are cached, as a failed FontFace stays failed until the page reloads.
export function loadFonts(layers: TextLayer[]) {
  return Promise.all(
    layers.map((l) => {
      const key = fontKey(l);
      let font = fonts.get(key);
      if (!font) {
        // The sample touches both bundled unicode-range subsets; without it only the Latin one would load.
        font = document.fonts.load(key, 'AĀ').then(
          (faces) => {
            if (!faces.length) throw new Error(fontError(l));
            loaded.add(key);
          },
          () => {
            throw new Error(fontError(l));
          },
        );
        fonts.set(key, font);
      }
      return font;
    }),
  );
}
const measurer = () => {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  return ctx;
};
let measuring: CanvasRenderingContext2D | undefined;
// Refits a text box's height. A cold font would measure fallback text, so the box keeps its height until
// the page's correction after the font loads, or the refit before export.
export function fitText(l: TextLayer) {
  if (!fontReady(l)) return l;
  const ctx = (measuring ??= measurer());
  ctx.font = fontOf(l);
  return fitTextBox(l, (s) => ctx.measureText(s).width);
}
export const fitTexts = (workspace: Workspace): Workspace => ({
  ...workspace,
  overlays: workspace.overlays.map(fitText),
});
function paintText(ctx: CanvasRenderingContext2D, l: TextLayer) {
  ctx.save();
  ctx.translate(l.x + l.width / 2, l.y + l.height / 2);
  ctx.rotate((l.rotation * Math.PI) / 180);
  ctx.font = fontOf(l);
  ctx.textAlign = l.align;
  ctx.textBaseline = 'middle';
  const pad = textPad(l);
  const height = lineHeight(l);
  const x = { left: -l.width / 2 + pad, center: 0, right: l.width / 2 - pad }[l.align];
  const lines = textLines(l, (s) => ctx.measureText(s).width);
  const y = (i: number) => -l.height / 2 + height * (i + 0.5);
  // Pills first, so one line's pill never covers the descenders of the line above.
  if (l.highlight) {
    ctx.fillStyle = l.highlight;
    lines.forEach((line, i) => {
      if (!line) return;
      const width = ctx.measureText(line).width;
      const left = { left: x, center: x - width / 2, right: x - width }[l.align];
      ctx.beginPath();
      ctx.roundRect(left - pad, y(i) - height / 2, width + 2 * pad, height, l.size * 0.2);
      ctx.fill();
    });
  }
  ctx.fillStyle = l.color;
  lines.forEach((line, i) => ctx.fillText(line, x, y(i)));
  ctx.restore();
}
// Editor view onto an already-sized canvas, in device px; layers off the canvas are skipped.
export function paint(
  { workspace, assets }: Project,
  images: Map<string, ImageBitmap>,
  canvas: HTMLCanvasElement,
  view: View,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  const { width, height } = slideSize(workspace.aspect);
  const visible = visibleRect(view, canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
  ctx.fillStyle = workspace.background;
  ctx.fillRect(0, 0, width * workspace.slides, height);
  // Export drops pixels outside the strip, so the editor does too.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width * workspace.slides, height);
  ctx.clip();
  for (const layer of stack(workspace)) {
    if (layer.type === 'text') {
      if (fontReady(layer) && reaches(layer, visible)) paintText(ctx, layer);
      continue;
    }
    const image = images.get(layer.assetId);
    const asset = assets.find((a) => a.id === layer.assetId);
    // A closed bitmap (replaced by a sharper decode) has zero size.
    if (image?.width && asset && reaches(layer, visible))
      paintLayer(ctx, workspace, asset, image, layer, view.scale);
  }
  ctx.restore();
}
// Masters are decoded, painted and closed one layer at a time in z-order, so peak memory is one master.
export async function draw(
  { workspace, assets }: Project,
  canvas: HTMLCanvasElement,
  scale = 1,
  slide?: number,
  layers: AnyLayer[] = stack(workspace),
) {
  await loadFonts(layers.filter((l) => l.type === 'text'));
  const ctx = begin(workspace, canvas, scale, slide);
  for (const layer of layers) {
    if (layer.type === 'text') {
      paintText(ctx, layer);
      continue;
    }
    const asset = assets.find((a) => a.id === layer.assetId);
    if (!asset) throw new Error('A photo referenced by the collage is missing.');
    const image = await createImageBitmap(asset.masterBlob);
    try {
      paintLayer(ctx, workspace, asset, image, layer, scale);
    } finally {
      image.close();
    }
  }
}
// Decoded long edge per on-screen asset so photos stay sharp at `view` (device px), in 360/720/1440 steps so zooming rarely re-decodes.
export function previewEdges({ workspace, assets }: Project, view: View, viewport: Size) {
  const visible = visibleRect(view, viewport);
  const edges = new Map<string, number>();
  for (const layer of activeLayers(workspace)) {
    const asset = assets.find((a) => a.id === layer.assetId);
    if (!asset || !reaches(layer, visible)) continue;
    const crop = coverCrop(
      asset.width,
      asset.height,
      layer.width,
      layer.height,
      layer.zoom,
      layer.panX,
      layer.panY,
    );
    const need = (Math.max(asset.width, asset.height) * layer.width * view.scale) / crop.width;
    const edge = Math.min(
      PREVIEW,
      MIN_EDGE * 2 ** Math.max(0, Math.ceil(Math.log2(need / MIN_EDGE))),
    );
    edges.set(asset.id, Math.max(edges.get(asset.id) ?? 0, edge));
  }
  return edges;
}
export const MIN_EDGE = 360;
// `entries` is the latest wanted decode per asset; `shown` is what the canvas draws now.
export type Previews = {
  generation: number;
  entries: Map<string, { edge: number; image: Promise<ImageBitmap> }>;
  shown: Map<string, ImageBitmap>;
};
export const previewCache = (): Previews => ({
  generation: 0,
  entries: new Map(),
  shown: new Map(),
});
// Only the latest sync swaps its set in and retires shown bitmaps, so a superseded or failed sync never blanks a photo.
// Resolves to null when superseded. A dropped decode is closed unless it is on screen (the next swap closes that one).
export function syncPreviews(cache: Previews, assets: Asset[], edgeOf: (asset: Asset) => number) {
  const generation = ++cache.generation;
  const drop = (id: string, entry: { image: Promise<ImageBitmap> }) =>
    void entry.image.then(
      (b) => cache.shown.get(id) !== b && b.close(),
      () => {},
    );
  const ids = new Set(assets.map((a) => a.id));
  for (const [id, entry] of cache.entries)
    if (!ids.has(id)) {
      cache.entries.delete(id);
      drop(id, entry);
    }
  for (const asset of assets) {
    const edge = edgeOf(asset);
    const old = cache.entries.get(asset.id);
    if (old?.edge === edge) continue;
    if (old) drop(asset.id, old);
    const size = fit(asset.width, asset.height, edge);
    const entry = {
      edge,
      image: createImageBitmap(asset.previewBlob, {
        resizeWidth: size.width,
        resizeHeight: size.height,
        resizeQuality: 'high',
      }),
    };
    // A failed decode is retried on the next sync instead of being cached.
    entry.image.catch(
      () => cache.entries.get(asset.id) === entry && cache.entries.delete(asset.id),
    );
    cache.entries.set(asset.id, entry);
  }
  const latest = () => generation === cache.generation;
  return Promise.all(
    assets.map(async (a) => [a.id, await cache.entries.get(a.id)!.image] as const),
  ).then(
    (entries) => {
      if (!latest()) return null;
      const next = new Map(entries);
      for (const [id, b] of cache.shown) if (next.get(id) !== b) b.close();
      cache.shown = next;
      return new Map(next);
    },
    (error) => {
      if (latest()) throw error;
      return null;
    },
  );
}
export function blob(canvas: HTMLCanvasElement, type: string, quality = 0.94): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Image export failed.'))),
      type,
      quality,
    ),
  );
}
// One slide-sized canvas and one master at a time, to stay under phone canvas and memory limits.
export async function exportSlides(project: Project, format: 'png' | 'jpeg') {
  const files: File[] = [];
  const canvas = document.createElement('canvas');
  try {
    // Slide culling trusts each height, which is stale while a font is still loading.
    await loadFonts(project.workspace.overlays);
    const workspace = fitTexts(project.workspace);
    for (let i = 0; i < workspace.slides; i++) {
      await draw({ ...project, workspace }, canvas, 1, i, slideLayers(workspace, i));
      const number = String(i + 1).padStart(2, '0');
      const name = `living-carousel-${number}.${format === 'jpeg' ? 'jpg' : 'png'}`;
      files.push(
        new File([await blob(canvas, `image/${format}`)], name, { type: `image/${format}` }),
      );
    }
    return files;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
export async function zip(files: File[]) {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.name] = new Uint8Array(await file.arrayBuffer());
  return new Blob([zipSync(entries, { level: 0 })], { type: 'application/zip' });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function backup(project: Project) {
  const files: Record<string, Uint8Array> = {
    'workspace.json': new TextEncoder().encode(
      JSON.stringify(
        {
          workspace: project.workspace,
          assets: project.assets.map(({ masterBlob: _m, previewBlob: _p, ...a }) => a),
        },
        null,
        2,
      ),
    ),
  };
  for (const asset of project.assets)
    files[`assets/${asset.id}.${asset.masterBlob.type === 'image/png' ? 'png' : 'jpg'}`] =
      new Uint8Array(await asset.masterBlob.arrayBuffer());
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
