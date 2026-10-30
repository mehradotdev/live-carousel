import { openDB } from 'idb';
import type { Project } from './model';
const db = () =>
  openDB('living-carousel', 1, {
    upgrade(db) {
      db.createObjectStore('project');
    },
  });
export async function loadProject(): Promise<Project | undefined> {
  const d = await db();
  try {
    return await d.get('project', 'active');
  } finally {
    d.close();
  }
}
export async function saveProject(project: Project | null) {
  const d = await db();
  try {
    const tx = d.transaction('project', 'readwrite');
    if (project) await tx.store.put(project, 'active');
    else await tx.store.delete('active');
    await tx.done;
  } finally {
    d.close();
  }
}
export async function ingest(files: FileList | File[], currentCount: number) {
  if (files.length + currentCount > 15) throw new Error('Keep your collage to 15 photos or fewer.');
  const result = [];
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
        result.push({
          id: crypto.randomUUID(),
          name: file.name,
          blob: file,
          width: image.width,
          height: image.height,
        });
      } finally {
        image.close();
      }
    }
    return result;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Could not open these photos.');
  }
}
