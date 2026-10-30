import { describe, expect, it } from 'vite-plus/test';
import {
  layout,
  coverCrop,
  WIDTH,
  ASPECTS,
  slideSize,
  resize,
  dividers,
  resizeDivider,
  resizeLayer,
  hitLayer,
  reorderLayer,
  swapPhotos,
  TEMPLATES,
  MIN_TILE,
  BENTO_PER_SLIDE,
  GRAB,
  keepOnCanvas,
  type Asset,
  type Workspace,
} from './model';
const assets = Array.from({ length: 6 }, (_, i) => ({ id: String(i) }) as Asset);
describe('collage geometry', () => {
  it('derives 1080-wide slide sizes from the aspect', () => {
    expect(Object.keys(ASPECTS).map((a) => slideSize(a as keyof typeof ASPECTS))).toEqual([
      { width: 1080, height: 1350 },
      { width: 1080, height: 1440 },
      { width: 1080, height: 1080 },
      { width: 1080, height: 1920 },
    ]);
  });
  it('lays out zero photos as background only and supports a single photo', () => {
    for (const style of ['bento', 'scrapbook'] as const) {
      const empty = layout([], style);
      expect(empty.layers).toEqual([]);
      expect(empty.bento).toBeUndefined();
    }
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
          expect(l.y + l.height).toBeLessThanOrEqual(1350);
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
  const next = resizeLayer(l, { x: 1200, y: 1100 }, 'se', { width: 3240, height: 1350 });
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
describe('aspect and slide-count changes', () => {
  const center = (l: { x: number; y: number; width: number; height: number }) => ({
    x: l.x + l.width / 2,
    y: l.y + l.height / 2,
  });
  it('Bento rebuilds the full strip keeping photo order and crops', () => {
    const w = layout(assets, 'bento', 2);
    w.layers[0] = { ...w.layers[0], zoom: 2, panX: 0.1, panY: 0.9 };
    for (const [aspect, slides] of [
      ['9:16', 5],
      ['1:1', 1],
      ['3:4', 20],
    ] as const) {
      const next = resize(w, aspect, slides);
      expect(next.layers.map((l) => [l.id, l.assetId, l.zoom, l.panX, l.panY])).toEqual(
        w.layers.map((l) => [l.id, l.assetId, l.zoom, l.panX, l.panY]),
      );
      noOverlap(next);
      const right = Math.max(...next.layers.map((l) => l.x + l.width));
      const bottom = Math.max(...next.layers.map((l) => l.y + l.height));
      expect(right).toBeCloseTo(WIDTH * slides - 24);
      expect(bottom).toBeCloseTo(ASPECTS[aspect] - 24);
    }
    expect(resize(layout([], 'bento'), '9:16', 4)).toMatchObject({ layers: [], bento: undefined });
  });
  it('Scrapbook ratio changes scale layers without distortion', () => {
    const w = layout(assets, 'scrapbook', 1);
    const next = resize(w, '9:16', 3);
    const k = 1920 / 1350;
    next.layers.forEach((l, i) => {
      const before = w.layers[i];
      expect(l.width / l.height).toBeCloseTo(before.width / before.height);
      expect(l.height).toBeCloseTo(before.height * k);
      expect(center(l).x).toBeCloseTo(center(before).x);
      expect(center(l).y).toBeCloseTo(center(before).y * k);
      expect(l.rotation).toBe(before.rotation);
    });
    expect(resize(next, '4:5', 3).layers.map((l) => l.width)).toEqual(
      w.layers.map((l) => expect.closeTo(l.width)),
    );
  });
  it('Scrapbook keeps layers when adding slides and pulls removed ones onto the last slide', () => {
    const w = layout(assets, 'scrapbook', 1);
    expect(resize(w, '4:5', 7).layers).toEqual(w.layers);
    const one = resize(w, '4:5', 1);
    one.layers.forEach((l, i) => {
      const before = w.layers[i];
      if (center(before).x <= WIDTH) expect(l).toEqual(before);
      else {
        expect(l.x).toBeGreaterThanOrEqual(0);
        expect(l.x + l.width).toBeLessThanOrEqual(WIDTH);
        expect(l.y).toBe(before.y);
      }
    });
    expect(w.layers.filter((l) => center(l).x > WIDTH).length).toBeGreaterThan(0);
  });
  it('Bento keeps every cell at least MIN_TILE, placing photos in order up to 6 per slide', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }) as Asset);
    const check = (w: Workspace, input: Asset[]) => {
      expect(w.layers.length).toBeGreaterThan(0);
      expect(w.layers.length).toBeLessThanOrEqual(BENTO_PER_SLIDE * w.slides);
      expect(new Set(w.layers.map((l) => l.assetId))).toEqual(
        new Set(input.slice(0, w.layers.length).map((a) => a.id)),
      );
      for (const l of w.layers) {
        expect(l.width).toBeGreaterThanOrEqual(MIN_TILE);
        expect(l.height).toBeGreaterThanOrEqual(MIN_TILE);
      }
    };
    for (const template of TEMPLATES) {
      const twenty = many(20);
      check(layout(twenty, 'bento', 0, template, { aspect: '1:1', slides: 1 }), twenty);
      const hundred = many(100);
      check(layout(hundred, 'bento', 3, template, { aspect: '9:16', slides: 20 }), hundred);
      const wide = layout(twenty, 'bento', 1, template, { aspect: '4:5', slides: 20 });
      const square = resize(wide, '1:1', 1);
      check(
        square,
        wide.layers.map((l) => ({ id: l.assetId }) as Asset),
      );
      // Rebuilds keep the surviving layers in their existing order.
      expect(square.layers.map((l) => l.id)).toEqual(
        wide.layers.slice(0, square.layers.length).map((l) => l.id),
      );
    }
  });
  it('keeps a grabbable part of rotated Scrapbook layers on the canvas after ratio changes', () => {
    const w = layout(assets.slice(0, 1), 'scrapbook', 0, undefined, { aspect: '9:16', slides: 1 });
    w.layers[0] = { ...w.layers[0], x: -352, y: 800, width: 400, height: 300, rotation: 0 };
    const [l] = resize(w, '1:1', 1).layers;
    expect(l.x + l.width).toBeGreaterThanOrEqual(GRAB - 1e-9);
    const rotated = { ...l, x: 5000, y: -5000, rotation: 45 };
    const kept = keepOnCanvas(rotated, 1080, 1080);
    const half = ((rotated.width + rotated.height) * Math.SQRT1_2) / 2;
    expect(kept.x + kept.width / 2 - half).toBeCloseTo(1080 - GRAB);
    expect(kept.y + kept.height / 2 + half).toBeCloseTo(GRAB);
    // Wider than the canvas: limits stay ordered and the layer still overlaps it.
    const huge = keepOnCanvas({ ...l, x: -9000, width: 3000, rotation: 0 }, 1080, 1080);
    expect(huge.x + huge.width).toBeCloseTo(GRAB);
    expect(keepOnCanvas({ ...l, x: 10, y: 10 }, 1080, 1080)).toEqual({ ...l, x: 10, y: 10 });
  });
});
