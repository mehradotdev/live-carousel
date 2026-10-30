import { zipSync } from 'fflate';
import { coverCrop, WIDTH, HEIGHT, SLIDES, type Project, type Workspace } from './model';
export function paint(
  workspace: Workspace,
  images: Map<string, ImageBitmap>,
  canvas: HTMLCanvasElement,
  scale = 1,
  slide?: number,
) {
  canvas.width = Math.round((slide === undefined ? WIDTH * SLIDES : WIDTH) * scale);
  canvas.height = Math.round(HEIGHT * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.scale(scale, scale);
  ctx.fillStyle = workspace.background;
  ctx.fillRect(0, 0, WIDTH * SLIDES, HEIGHT);
  if (slide !== undefined) ctx.translate(-slide * WIDTH, 0);
  for (const layer of workspace.layers) {
    const image = images.get(layer.assetId);
    if (!image) continue;
    const crop = coverCrop(
      image.width,
      image.height,
      layer.width,
      layer.height,
      layer.zoom,
      layer.panX,
      layer.panY,
    );
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
}
export async function decodeImages(project: Project) {
  const images = new Map<string, ImageBitmap>();
  try {
    for (const asset of project.assets)
      images.set(asset.id, await createImageBitmap(asset.blob, { imageOrientation: 'from-image' }));
    for (const layer of project.workspace.layers)
      if (!images.has(layer.assetId))
        throw new Error('A photo referenced by the collage is missing.');
    return images;
  } catch (error) {
    images.forEach((image) => image.close());
    throw error;
  }
}
export async function draw(project: Project, canvas: HTMLCanvasElement, scale = 1, slide?: number) {
  const images = await decodeImages(project);
  try {
    paint(project.workspace, images, canvas, scale, slide);
  } finally {
    images.forEach((image) => image.close());
  }
}
function blob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image export failed.'))), type, 0.94),
  );
}
export async function exportSlides(project: Project, format: 'png' | 'jpeg') {
  const files: Record<string, Uint8Array> = {};
  const canvas = document.createElement('canvas');
  const wide = document.createElement('canvas');
  const images = await decodeImages(project);
  try {
    // Slice one raster so rotated edges and shadows cannot drift between slides.
    paint(project.workspace, images, wide);
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable.');
    for (let i = 0; i < SLIDES; i++) {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.drawImage(wide, i * WIDTH, 0, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT);
      files[`living-carousel-${i + 1}.${format === 'jpeg' ? 'jpg' : 'png'}`] = new Uint8Array(
        await (await blob(canvas, `image/${format}`)).arrayBuffer(),
      );
    }
    return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
  } finally {
    images.forEach((image) => image.close());
    canvas.width = canvas.height = 0;
    wide.width = wide.height = 0;
  }
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
        { workspace: project.workspace, assets: project.assets.map(({ blob: _blob, ...a }) => a) },
        null,
        2,
      ),
    ),
  };
  for (const asset of project.assets)
    files[`assets/${asset.id}`] = new Uint8Array(await asset.blob.arrayBuffer());
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
