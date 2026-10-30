import { WIDTH, clamp, type Layer, type Point } from './model';
// Screen = world × scale + (x, y), in CSS px relative to the viewport's top-left.
export type View = { x: number; y: number; scale: number };
export type Size = { width: number; height: number };
export type Rect = Size & { x: number; y: number };
// Fit leaves this much screen space around what it fits.
export const PAD = 16;
export function fitRect(rect: Rect, viewport: Size): View {
  const scale = Math.min(
    (viewport.width - 2 * PAD) / rect.width,
    (viewport.height - 2 * PAD) / rect.height,
  );
  return {
    scale,
    x: viewport.width / 2 - (rect.x + rect.width / 2) * scale,
    y: viewport.height / 2 - (rect.y + rect.height / 2) * scale,
  };
}
// Out to the whole strip; in to 4× that, or until one slide fills the viewport twice over, whichever is larger (enough to work on one photo in a 1–20 slide strip).
export function scaleBounds(world: Size, slide: Size, viewport: Size) {
  const min = fitRect({ x: 0, y: 0, ...world }, viewport).scale;
  return { min, max: Math.max(4 * min, 2 * fitRect({ x: 0, y: 0, ...slide }, viewport).scale) };
}
// Per axis: a world that fits pans only as far as centring its first or last slide; a larger one pans until its edge reaches the viewport centre.
export function clampView(
  view: View,
  world: Size,
  viewport: Size,
  bounds: { min: number; max: number },
): View {
  const scale = clamp(view.scale, bounds.min, bounds.max);
  const axis = (offset: number, size: number, length: number, slide: number) =>
    size * scale <= length
      ? clamp(offset, length / 2 - (size - slide / 2) * scale, length / 2 - (slide / 2) * scale)
      : clamp(offset, length / 2 - size * scale, length / 2);
  return {
    scale,
    x: axis(view.x, world.width, viewport.width, WIDTH),
    y: axis(view.y, world.height, viewport.height, world.height),
  };
}
// Smallest pan that brings `rect` inside the padded viewport; zooms out to fit it only when it is too large at this scale.
export function reveal(view: View, rect: Rect, viewport: Size): View {
  const { scale } = view;
  if (
    rect.width * scale > viewport.width - 2 * PAD ||
    rect.height * scale > viewport.height - 2 * PAD
  )
    return fitRect(rect, viewport);
  const axis = (offset: number, start: number, size: number, length: number) =>
    clamp(offset, PAD - start * scale, length - PAD - (start + size) * scale);
  return {
    scale,
    x: axis(view.x, rect.x, rect.width, viewport.width),
    y: axis(view.y, rect.y, rect.height, viewport.height),
  };
}
// The world point under `at` stays under it.
export function zoomAt(view: View, at: Point, scale: number): View {
  const f = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * f, y: at.y - (at.y - view.y) * f };
}
export const visibleRect = (view: View, viewport: Size): Rect => ({
  x: -view.x / view.scale,
  y: -view.y / view.scale,
  width: viewport.width / view.scale,
  height: viewport.height / view.scale,
});
export const centredSlide = (view: View, viewport: Size, slides: number) =>
  clamp(Math.floor((viewport.width / 2 - view.x) / view.scale / WIDTH), 0, slides - 1);
// Conservative: a rotated layer plus the Scrapbook frame and shadow stays within this circle.
export function reaches(l: Layer, rect: Rect) {
  const r = Math.hypot(l.width, l.height) / 2 + 60;
  const cx = l.x + l.width / 2;
  const cy = l.y + l.height / 2;
  return (
    cx + r > rect.x &&
    cx - r < rect.x + rect.width &&
    cy + r > rect.y &&
    cy - r < rect.y + rect.height
  );
}
