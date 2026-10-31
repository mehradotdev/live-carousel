import { openDB } from 'idb';
import {
  ASPECTS,
  MAX_PHOTOS,
  MAX_SLIDES,
  MIN_TILE,
  MAX_TEXT,
  SPACING_MAX,
  TEMPLATES,
  TEXT_ALIGNS,
  TEXT_SIZE,
  applyBento,
  type Asset,
  type BentoNode,
  type Layer,
  type Project,
  type Spacing,
  type TextLayer,
  type Workspace,
} from './model';
import { blob } from './render';
export const MASTER = 4096;
export const PREVIEW = 1440;
const db = () =>
  openDB('living-carousel-v5', 1, {
    upgrade(db) {
      db.createObjectStore('project');
      db.createObjectStore('assets', { keyPath: 'id' });
    },
  });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const NUMBERS = ['x', 'y', 'width', 'height', 'rotation', 'zoom', 'panX', 'panY'] as const;
const GEOMETRY = ['x', 'y', 'width', 'height', 'rotation'] as const;
const TOLERANCE = 0.001;
const HEX = /^#[0-9a-f]{6}$/i;
// The name lands in a canvas font string, so it cannot be allowed to end its quotes.
const FONT_NAME = /^[^"\\\n]{1,100}$/;
function textOk(l: TextLayer | null) {
  return (
    !!l &&
    typeof l === 'object' &&
    l.type === 'text' &&
    typeof l.id === 'string' &&
    typeof l.text === 'string' &&
    l.text.length <= MAX_TEXT &&
    typeof l.fontFamily === 'string' &&
    FONT_NAME.test(l.fontFamily) &&
    GEOMETRY.every((k) => finite(l[k])) &&
    l.width > 0 &&
    l.height > 0 &&
    finite(l.size) &&
    l.size >= TEXT_SIZE.min &&
    l.size <= TEXT_SIZE.max &&
    typeof l.color === 'string' &&
    HEX.test(l.color) &&
    (l.highlight === undefined || (typeof l.highlight === 'string' && HEX.test(l.highlight))) &&
    typeof l.bold === 'boolean' &&
    typeof l.italic === 'boolean' &&
    TEXT_ALIGNS.includes(l.align)
  );
}
// Collects leaf ids; false for any malformed node.
function treeLeaves(node: BentoNode | null | undefined, out: string[]): boolean {
  if (!node || typeof node !== 'object') return false;
  if ('layerId' in node) return out.push(node.layerId) > 0;
  return (
    (node.axis === 'x' || node.axis === 'y') &&
    finite(node.ratio) &&
    node.ratio > 0 &&
    node.ratio < 1 &&
    treeLeaves(node.first, out) &&
    treeLeaves(node.second, out)
  );
}
// Plain checks on what comes back from IndexedDB; any failure keeps the stored data untouched.
export function validProject(
  record: unknown,
  assets: unknown[],
): record is { workspace: Workspace } {
  const r = record as { workspace?: Workspace; assetIds?: unknown[] } | undefined;
  const ids = r?.assetIds;
  const { aspect, slides = 0, style, background, bento, scrapbook, overlays } = r?.workspace ?? {};
  if (!Array.isArray(ids) || ids.length > MAX_PHOTOS) return false;
  if (!Array.isArray(bento?.layers) || !Array.isArray(scrapbook?.layers)) return false;
  if (!Array.isArray(overlays) || !Array.isArray(scrapbook.order)) return false;
  if (style !== 'bento' && style !== 'scrapbook') return false;
  if (typeof background !== 'string' || !HEX.test(background)) return false;
  if (!TEMPLATES.includes(bento.template)) return false;
  const spacingOk = (Object.keys(SPACING_MAX) as (keyof Spacing)[]).every(
    (k) => finite(bento[k]) && bento[k] >= 0 && bento[k] <= SPACING_MAX[k],
  );
  if (!spacingOk) return false;
  if (typeof aspect !== 'string' || !Object.hasOwn(ASPECTS, aspect)) return false;
  if (!Number.isInteger(slides) || slides < 1 || slides > MAX_SLIDES) return false;
  if (new Set(ids).size !== ids.length || ids.length !== assets.length) return false;
  const assetOk = assets.every((value, i) => {
    const a = value as Asset | undefined;
    return (
      !!a &&
      a.id === ids[i] &&
      typeof a.name === 'string' &&
      a.masterBlob instanceof Blob &&
      a.previewBlob instanceof Blob &&
      finite(a.width) &&
      finite(a.height) &&
      a.width > 0 &&
      a.height > 0 &&
      a.width <= MASTER &&
      a.height <= MASTER
    );
  });
  const layersOk = (layers: (Layer | null)[]) => {
    const seen = new Set<string>();
    return layers.every((l) => {
      if (!l || typeof l !== 'object' || typeof l.id !== 'string' || seen.has(l.id)) return false;
      seen.add(l.id);
      return (
        l.type === 'photo' &&
        ids.includes(l.assetId) &&
        NUMBERS.every((k) => finite(l[k])) &&
        l.width > 0 &&
        l.height > 0
      );
    });
  };
  // The tree and the Bento layers must describe exactly the same cells.
  const leaves: string[] = [];
  if (bento.tree !== undefined && !treeLeaves(bento.tree, leaves)) return false;
  const cells = new Set(bento.layers.map((l) => l?.id));
  const treeOk =
    leaves.length === bento.layers.length &&
    new Set(leaves).size === leaves.length &&
    leaves.every((id) => cells.has(id));
  if (!assetOk || !layersOk(bento.layers) || !layersOk(scrapbook.layers) || !treeOk) return false;
  if (!overlays.every(textOk)) return false;
  // Text ids share a stack with both layouts' photos, and `order` may only name what exists.
  const textIds = overlays.map((l) => l.id);
  const photoIds = [...bento.layers, ...scrapbook.layers].map((l) => l.id);
  if (new Set(textIds).size !== textIds.length || textIds.some((id) => photoIds.includes(id)))
    return false;
  const listed = new Set([...scrapbook.layers.map((l) => l.id), ...textIds]);
  const { order } = scrapbook;
  if (new Set(order).size !== order.length || !order.every((id) => listed.has(id))) return false;
  // The next Bento edit recomputes every cell from the tree, so the two must already agree.
  return applyBento(r!.workspace!).bento.layers.every(
    (cell, i) =>
      GEOMETRY.every((k) => Math.abs(cell[k] - bento.layers[i][k]) <= TOLERANCE) &&
      Math.min(cell.width, cell.height) >= MIN_TILE - TOLERANCE,
  );
}
export async function loadProject(): Promise<Project | undefined> {
  const d = await db();
  try {
    const tx = d.transaction(['project', 'assets']);
    const record: { workspace: Workspace; assetIds: string[] } | undefined = await tx
      .objectStore('project')
      .get('active');
    if (!record) return undefined;
    if (!Array.isArray(record.assetIds) || record.assetIds.length > MAX_PHOTOS)
      throw new Error('The collage saved on this device is unreadable. Start a new collage.');
    const assets = await Promise.all(record.assetIds.map((id) => tx.objectStore('assets').get(id)));
    if (!validProject(record, assets))
      throw new Error('The collage saved on this device is unreadable. Start a new collage.');
    return { workspace: record.workspace, assets };
  } finally {
    d.close();
  }
}
// One transaction: on quota or any other failure nothing is written and the previous save stays intact.
export async function saveProject(project: Project | null) {
  const d = await db();
  try {
    const tx = d.transaction(['project', 'assets'], 'readwrite');
    const assets = tx.objectStore('assets');
    if (!project) {
      await Promise.all([assets.clear(), tx.objectStore('project').delete('active'), tx.done]);
      return;
    }
    // Assets are immutable, so only new ones are written; rewriting every blob per autosave would copy hundreds of MB.
    const stored = new Set(await assets.getAllKeys());
    const assetIds = project.assets.map((a) => a.id);
    await Promise.all([
      // A photo removed from the library leaves the device too.
      ...[...stored]
        .filter((id) => !assetIds.includes(id as string))
        .map((id) => assets.delete(id)),
      ...project.assets.filter((a) => !stored.has(a.id)).map((a) => assets.put(a)),
      tx.objectStore('project').put({ workspace: project.workspace, assetIds }, 'active'),
      tx.done,
    ]);
  } finally {
    d.close();
  }
}
export function fit(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
// Only PNG and WebP can carry transparency, so JPEG skips the read; `pixels` returns RGBA.
export function transparent(type: string, pixels: () => ArrayLike<number>) {
  if (type === 'image/jpeg') return false;
  const data = pixels();
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}
function scaled(image: ImageBitmap, max: number) {
  const canvas = document.createElement('canvas');
  Object.assign(canvas, fit(image.width, image.height, max));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}
export async function ingest(files: FileList | File[], currentCount: number) {
  if (files.length + currentCount > MAX_PHOTOS)
    throw new Error(`Keep your collage to ${MAX_PHOTOS} photos or fewer.`);
  const result: Asset[] = [];
  try {
    for (const file of Array.from(files)) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error(`${file.name}: use JPEG, PNG or WebP.`);
      if (file.size > 20 * 1024 * 1024)
        throw new Error(`${file.name}: the limit is 20 MB per photo.`);
      const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      try {
        if (image.width * image.height > 40_000_000)
          throw new Error(`${file.name}: choose a photo below 40 megapixels.`);
        // Re-encoding through a canvas drops EXIF/GPS; the uploaded file is not kept.
        // Alpha is read at master resolution so thin transparent details cannot average away in the preview.
        const master = scaled(image, MASTER);
        let type: string, masterBlob: Blob, width: number, height: number;
        try {
          ({ width, height } = master.canvas);
          type = transparent(file.type, () => master.ctx.getImageData(0, 0, width, height).data)
            ? 'image/png'
            : 'image/jpeg';
          masterBlob = await blob(master.canvas, type, 0.92);
        } finally {
          master.canvas.width = master.canvas.height = 0;
        }
        const preview = scaled(image, PREVIEW);
        try {
          result.push({
            id: crypto.randomUUID(),
            name: file.name,
            masterBlob,
            previewBlob: await blob(preview.canvas, type, 0.85),
            width,
            height,
          });
        } finally {
          preview.canvas.width = preview.canvas.height = 0;
        }
      } finally {
        image.close();
      }
    }
    return result;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Could not open these photos.');
  }
}
