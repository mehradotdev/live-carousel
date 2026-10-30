import { openDB } from 'idb';
import { MAX_PHOTOS, type Asset, type Layer, type Project, type Workspace } from './model';
import { blob } from './render';
export const MASTER = 4096;
export const PREVIEW = 1440;
const db = () =>
  openDB('living-carousel-v2', 1, {
    upgrade(db) {
      db.createObjectStore('project');
      db.createObjectStore('assets', { keyPath: 'id' });
    },
  });
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const NUMBERS = ['x', 'y', 'width', 'height', 'rotation', 'zoom', 'panX', 'panY'] as const;
// Plain checks on what comes back from IndexedDB; any failure keeps the stored data untouched.
export function validProject(
  record: unknown,
  assets: unknown[],
): record is { workspace: Workspace } {
  const r = record as { workspace?: Workspace; assetIds?: unknown[] } | undefined;
  const ids = r?.assetIds;
  const layers = r?.workspace?.layers;
  if (!Array.isArray(ids) || !Array.isArray(layers) || ids.length > MAX_PHOTOS) return false;
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
  const layerIds = new Set<string>();
  const layerOk = layers.every((l: Layer | null) => {
    if (!l || typeof l !== 'object' || typeof l.id !== 'string' || layerIds.has(l.id)) return false;
    layerIds.add(l.id);
    return ids.includes(l.assetId) && NUMBERS.every((k) => finite(l[k]));
  });
  return assetOk && layerOk;
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
