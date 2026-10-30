import { describe, expect, it } from 'vite-plus/test';
import {
  layout,
  coverCrop,
  WIDTH,
  HEIGHT,
  dividers,
  resizeDivider,
  resizeLayer,
  hitLayer,
  reorderLayer,
  swapPhotos,
  TEMPLATES,
  MIN_TILE,
  type Asset,
  type Workspace,
} from './model';
const assets = Array.from({ length: 6 }, (_, i) => ({ id: String(i) }) as Asset);
describe('collage geometry', () => {
  it('rejects an empty layout and supports intentional deletion down to one photo', () => {
    expect(() => layout([], 'bento')).toThrow();
    expect(layout(assets.slice(0, 1), 'bento').layers).toHaveLength(1);
  });
  it('uses every source once and keeps Bento tiles inside the global scene', () => {
    for (let n = 3; n <= 15; n++) {
      const input = Array.from({ length: n }, (_, i) => ({ id: String(i) }) as Asset);
      for (let seed = 0; seed < 3; seed++) {
        const w = layout(input, 'bento', seed);
        expect(new Set(w.layers.map((l) => l.assetId)).size).toBe(n);
        for (const l of w.layers) {
          expect(l.x).toBeGreaterThanOrEqual(0);
          expect(l.y).toBeGreaterThanOrEqual(0);
          expect(l.x + l.width).toBeLessThanOrEqual(WIDTH * 3);
          expect(l.y + l.height).toBeLessThanOrEqual(HEIGHT);
        }
      }
    }
  });
  it('has deterministic shuffle variations', () => {
    expect(layout(assets, 'bento')).toEqual(layout(assets, 'bento'));
    expect(layout(assets, 'bento', 1)).not.toEqual(layout(assets, 'bento'));
  });
  it('never stretches or crops outside source pixels, including extreme pan', () => {
    for (const [sw, sh] of [
      [4000, 1000],
      [1000, 4000],
      [500, 500],
    ])
      for (const pan of [-1, 0, 0.5, 1, 2]) {
        const c = coverCrop(sw, sh, 600, 800, 2, pan, pan);
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.width).toBeLessThanOrEqual(sw);
        expect(c.y + c.height).toBeLessThanOrEqual(sh);
        expect(c.width / c.height).toBeCloseTo(600 / 800);
      }
  });
});

function noOverlap(w: Workspace) {
  for (let i = 0; i < w.layers.length; i++)
    for (let j = i + 1; j < w.layers.length; j++) {
      const a = w.layers[i];
      const b = w.layers[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0.001);
    }
}
it('produces distinct geometric templates and gap-free shared partitions for 3–15 photos', () => {
  const geometries = new Set(
    TEMPLATES.map((t) =>
      JSON.stringify(
        layout(assets, 'bento', 0, t).layers.map((l) => [l.x, l.y, l.width, l.height]),
      ),
    ),
  );
  expect(geometries.size).toBeGreaterThanOrEqual(3);
  for (let n = 3; n <= 15; n++)
    for (const template of TEMPLATES)
      for (let seed = 0; seed < 5; seed++) {
        const input = Array.from({ length: n }, (_, i) => ({ id: String(i) }) as Asset);
        const w = layout(input, 'bento', seed, template);
        noOverlap(w);
        for (const d of dividers(w)) {
          for (const pos of [d.min - 1000, d.position + 50, d.max + 1000]) {
            const next = resizeDivider(w, d.path, pos);
            noOverlap(next);
            expect(next.layers.map((l) => l.assetId)).toEqual(w.layers.map((l) => l.assetId));
            for (const l of next.layers) {
              expect(l.width).toBeGreaterThanOrEqual(MIN_TILE - 0.001);
              expect(l.height).toBeGreaterThanOrEqual(MIN_TILE - 0.001);
            }
          }
        }
      }
});
it('resizes rotated photos about the opposite corner without changing aspect ratio', () => {
  const l = {
    ...layout(assets, 'scrapbook').layers[0],
    x: 500,
    y: 300,
    width: 400,
    height: 600,
    rotation: 30,
  };
  const angle = (l.rotation * Math.PI) / 180;
  const anchor = (a: typeof l) => ({
    x: a.x + a.width / 2 - (a.width / 2) * Math.cos(angle) + (a.height / 2) * Math.sin(angle),
    y: a.y + a.height / 2 - (a.width / 2) * Math.sin(angle) - (a.height / 2) * Math.cos(angle),
  });
  const before = anchor(l);
  const next = resizeLayer(l, { x: 1200, y: 1100 }, 'se');
  const after = anchor(next);
  expect(next.width / next.height).toBeCloseTo(400 / 600);
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
});
it('swaps image content and crops while preserving cells; stacking affects hit testing', () => {
  const w = layout(assets, 'bento');
  const [a, b] = w.layers;
  a.zoom = 2;
  const swapped = swapPhotos(w, a.id, b.id);
  expect(swapped.layers[0].assetId).toBe(b.assetId);
  expect(swapped.layers[1].zoom).toBe(2);
  expect(swapped.layers[0].x).toBe(a.x);
  const scrap = {
    ...w,
    style: 'scrapbook' as const,
    layers: [
      { ...a, x: 100, y: 100, width: 400, height: 400, rotation: 0 },
      { ...b, x: 100, y: 100, width: 400, height: 400, rotation: 45 },
    ],
  };
  expect(hitLayer(scrap, { x: 300, y: 300 })?.id).toBe(b.id);
  expect(hitLayer(reorderLayer(scrap, b.id, 'back'), { x: 300, y: 300 })?.id).toBe(a.id);
});
