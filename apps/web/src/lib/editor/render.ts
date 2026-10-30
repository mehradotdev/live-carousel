import { zipSync } from 'fflate';
import {
  coverCrop,
  slideLayers,
  slideSize,
  type Asset,
  type Layer,
  type Project,
  type Workspace,
} from './model';
import { fit, PREVIEW } from './storage';
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
    workspace.style === 'bento' ? 12 : 0,
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
export function paint(
  { workspace, assets }: Project,
  images: Map<string, ImageBitmap>,
  canvas: HTMLCanvasElement,
  scale = 1,
  slide?: number,
) {
  const ctx = begin(workspace, canvas, scale, slide);
  for (const layer of workspace.layers) {
    const image = images.get(layer.assetId);
    const asset = assets.find((a) => a.id === layer.assetId);
    if (image && asset) paintLayer(ctx, workspace, asset, image, layer, scale);
  }
}
// Masters are decoded, painted and closed one layer at a time in z-order, so peak memory is one master.
export async function draw(
  { workspace, assets }: Project,
  canvas: HTMLCanvasElement,
  scale = 1,
  slide?: number,
  layers = workspace.layers,
) {
  const ctx = begin(workspace, canvas, scale, slide);
  for (const layer of layers) {
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
// Editor tiles rarely exceed ~720 CSS px, so this is as sharp as the screen shows while using a quarter of the memory on 1x displays.
export const previewEdge = () =>
  Math.min(PREVIEW, Math.ceil(720 * (globalThis.devicePixelRatio || 1)));
// One display-sized bitmap per asset: only new assets are decoded and removed ones are closed.
export function syncPreviews(
  cache: Map<string, Promise<ImageBitmap>>,
  assets: Asset[],
  edge: number,
) {
  const ids = new Set(assets.map((a) => a.id));
  for (const [id, image] of cache)
    if (!ids.has(id)) {
      cache.delete(id);
      void image.then(
        (b) => b.close(),
        () => {},
      );
    }
  for (const asset of assets)
    if (!cache.has(asset.id)) {
      const size = fit(asset.width, asset.height, edge);
      const image = createImageBitmap(asset.previewBlob, {
        resizeWidth: size.width,
        resizeHeight: size.height,
        resizeQuality: 'high',
      });
      // A failed decode is retried on the next sync instead of being cached.
      image.catch(() => cache.get(asset.id) === image && cache.delete(asset.id));
      cache.set(asset.id, image);
    }
  return Promise.all(assets.map(async (a) => [a.id, await cache.get(a.id)!] as const)).then(
    (entries) => new Map(entries),
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
    for (let i = 0; i < project.workspace.slides; i++) {
      await draw(project, canvas, 1, i, slideLayers(project.workspace, i));
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
