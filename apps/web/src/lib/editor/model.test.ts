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
  activeLayers,
  addPhotos,
  addToBento,
  applyBento,
  regenerate,
  removeAsset,
  removeLayer,
  setSpacing,
  type Asset,
  type BentoNode,
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
      expect(activeLayers(empty)).toEqual([]);
      expect(empty.bento.tree).toBeUndefined();
    }
    expect(layout(assets.slice(0, 1), 'bento').bento.layers).toHaveLength(1);
  });
  it('uses every source once and keeps Bento tiles inside the global scene', () => {
    for (let n = 3; n <= 15; n++) {
      const input = Array.from({ length: n }, (_, i) => ({ id: String(i) }) as Asset);
      for (let seed = 0; seed < 3; seed++) {
        const { layers } = layout(input, 'bento', seed).bento;
        expect(new Set(layers.map((l) => l.assetId)).size).toBe(n);
        for (const l of layers) {
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
  const layers = activeLayers(w);
  for (let i = 0; i < layers.length; i++)
    for (let j = i + 1; j < layers.length; j++) {
      const a = layers[i];
      const b = layers[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0.001);
    }
}
it('produces distinct geometric templates and gap-free shared partitions for 3–15 photos', () => {
  const geometries = new Set(
    TEMPLATES.map((t) =>
      JSON.stringify(
        layout(assets, 'bento', 0, t).bento.layers.map((l) => [l.x, l.y, l.width, l.height]),
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
            expect(next.bento.layers.map((l) => l.assetId)).toEqual(
              w.bento.layers.map((l) => l.assetId),
            );
            for (const l of next.bento.layers) {
              expect(l.width).toBeGreaterThanOrEqual(MIN_TILE - 0.001);
              expect(l.height).toBeGreaterThanOrEqual(MIN_TILE - 0.001);
            }
          }
        }
      }
});
it('resizes rotated photos about the opposite corner without changing aspect ratio', () => {
  const l = {
    ...layout(assets, 'scrapbook').scrapbook.layers[0],
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
  const [a, b] = w.bento.layers;
  a.zoom = 2;
  const swapped = swapPhotos(w, a.id, b.id);
  expect(swapped.bento.layers[0].assetId).toBe(b.assetId);
  expect(swapped.bento.layers[1].zoom).toBe(2);
  expect(swapped.bento.layers[0].x).toBe(a.x);
  const scrap = {
    ...w,
    style: 'scrapbook' as const,
    scrapbook: {
      layers: [
        { ...a, x: 100, y: 100, width: 400, height: 400, rotation: 0 },
        { ...b, x: 100, y: 100, width: 400, height: 400, rotation: 45 },
      ],
    },
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
    w.bento.layers[0] = { ...w.bento.layers[0], zoom: 2, panX: 0.1, panY: 0.9 };
    for (const [aspect, slides] of [
      ['9:16', 5],
      ['1:1', 1],
      ['3:4', 20],
    ] as const) {
      const next = resize(w, aspect, slides);
      expect(next.bento.layers.map((l) => [l.id, l.assetId, l.zoom, l.panX, l.panY])).toEqual(
        w.bento.layers.map((l) => [l.id, l.assetId, l.zoom, l.panX, l.panY]),
      );
      noOverlap(next);
      const right = Math.max(...next.bento.layers.map((l) => l.x + l.width));
      const bottom = Math.max(...next.bento.layers.map((l) => l.y + l.height));
      expect(right).toBeCloseTo(WIDTH * slides - 24);
      expect(bottom).toBeCloseTo(ASPECTS[aspect] - 24);
    }
    expect(resize(layout([], 'bento'), '9:16', 4).bento).toMatchObject({ layers: [] });
    expect(resize(layout([], 'bento'), '9:16', 4).bento.tree).toBeUndefined();
  });
  it('Scrapbook ratio changes scale layers without distortion', () => {
    const w = layout(assets, 'scrapbook', 1);
    const next = resize(w, '9:16', 3);
    const k = 1920 / 1350;
    next.scrapbook.layers.forEach((l, i) => {
      const before = w.scrapbook.layers[i];
      expect(l.width / l.height).toBeCloseTo(before.width / before.height);
      expect(l.height).toBeCloseTo(before.height * k);
      expect(center(l).x).toBeCloseTo(center(before).x);
      expect(center(l).y).toBeCloseTo(center(before).y * k);
      expect(l.rotation).toBe(before.rotation);
    });
    expect(resize(next, '4:5', 3).scrapbook.layers.map((l) => l.width)).toEqual(
      w.scrapbook.layers.map((l) => expect.closeTo(l.width)),
    );
  });
  it('Scrapbook keeps layers when adding slides and pulls removed ones onto the last slide', () => {
    const w = layout(assets, 'scrapbook', 1);
    expect(resize(w, '4:5', 7).scrapbook.layers).toEqual(w.scrapbook.layers);
    const one = resize(w, '4:5', 1);
    one.scrapbook.layers.forEach((l, i) => {
      const before = w.scrapbook.layers[i];
      if (center(before).x <= WIDTH) expect(l).toEqual(before);
      else {
        expect(l.x).toBeGreaterThanOrEqual(0);
        expect(l.x + l.width).toBeLessThanOrEqual(WIDTH);
        expect(l.y).toBe(before.y);
      }
    });
    expect(w.scrapbook.layers.filter((l) => center(l).x > WIDTH).length).toBeGreaterThan(0);
  });
  it('Bento keeps every cell at least MIN_TILE, placing photos in order up to 6 per slide', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }) as Asset);
    const check = (w: Workspace, input: Asset[]) => {
      const { layers } = w.bento;
      expect(layers.length).toBeGreaterThan(0);
      expect(layers.length).toBeLessThanOrEqual(BENTO_PER_SLIDE * w.slides);
      expect(new Set(layers.map((l) => l.assetId))).toEqual(
        new Set(input.slice(0, layers.length).map((a) => a.id)),
      );
      for (const l of layers) {
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
        wide.bento.layers.map((l) => ({ id: l.assetId }) as Asset),
      );
      // Rebuilds keep the surviving layers in their existing order.
      expect(square.bento.layers.map((l) => l.id)).toEqual(
        wide.bento.layers.slice(0, square.bento.layers.length).map((l) => l.id),
      );
    }
  });
  it('keeps a grabbable part of rotated Scrapbook layers on the canvas after ratio changes', () => {
    const w = layout(assets.slice(0, 1), 'scrapbook', 0, undefined, { aspect: '9:16', slides: 1 });
    w.scrapbook.layers[0] = {
      ...w.scrapbook.layers[0],
      x: -352,
      y: 800,
      width: 400,
      height: 300,
      rotation: 0,
    };
    const [l] = resize(w, '1:1', 1).scrapbook.layers;
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
describe('Bento editing', () => {
  const cell = (w: Workspace, id: string) => {
    const { x, y, width, height } = w.bento.layers.find((l) => l.id === id)!;
    return { x, y, width, height };
  };
  const manual = (tree: BentoNode, ids: string[]): Workspace => {
    const base = layout(
      ids.map((id) => ({ id }) as Asset),
      'bento',
    );
    const layers = ids.map((id, i) => ({ ...base.bento.layers[i], id, assetId: id }));
    return applyBento({ ...base, bento: { ...base.bento, tree, layers } });
  };
  // a | (b / (c | d))
  const nested = () =>
    manual(
      {
        axis: 'x',
        ratio: 0.3,
        first: { layerId: 'a' },
        second: {
          axis: 'y',
          ratio: 0.6,
          first: { layerId: 'b' },
          second: {
            axis: 'x',
            ratio: 0.4,
            first: { layerId: 'c' },
            second: { layerId: 'd' },
          },
        },
      },
      ['a', 'b', 'c', 'd'],
    );
  it('deleting a cell gives its rect to the sibling and keeps other cells and ratios', () => {
    const w = nested();
    const c = removeLayer(w, 'c');
    // d takes over the parent's rect; a and b never move.
    const parent = { ...cell(w, 'c'), width: cell(w, 'd').x + cell(w, 'd').width - cell(w, 'c').x };
    expect(cell(c, 'd')).toEqual(parent);
    expect(cell(c, 'a')).toEqual(cell(w, 'a'));
    expect(cell(c, 'b')).toEqual(cell(w, 'b'));
    expect(c.bento.tree).toEqual({
      axis: 'x',
      ratio: 0.3,
      first: { layerId: 'a' },
      second: { axis: 'y', ratio: 0.6, first: { layerId: 'b' }, second: { layerId: 'd' } },
    });
    // A whole subtree can be the sibling too, keeping its own ratio.
    const a = removeLayer(w, 'a');
    expect(a.bento.tree).toEqual((w.bento.tree as { second: BentoNode }).second);
    expect(a.bento.layers.map((l) => l.id)).toEqual(['b', 'c', 'd']);
  });
  it('deleting the last photo leaves the background only', () => {
    const w = layout(assets.slice(0, 1), 'bento');
    const empty = removeLayer(w, w.bento.layers[0].id);
    expect(empty.bento.tree).toBeUndefined();
    expect(empty.bento.layers).toEqual([]);
    expect(dividers(empty)).toEqual([]);
    // The next photo fills the strip again.
    const again = addToBento(empty, 'new');
    expect(again.bento.layers[0]).toMatchObject({ assetId: 'new', x: 24, y: 24, width: 3192 });
  });
  it('adding splits the selected cell, or else the largest, along its longer side', () => {
    const w = nested();
    const selected = addToBento(w, 'new', 'a');
    const before = cell(w, 'a');
    expect(before.height).toBeGreaterThan(before.width);
    expect(cell(selected, 'a')).toEqual({ ...before, height: (before.height - 12) / 2 });
    expect(selected.bento.layers.at(-1)).toMatchObject({
      assetId: 'new',
      x: before.x,
      y: before.y + (before.height - 12) / 2 + 12,
      width: before.width,
      height: (before.height - 12) / 2,
    });
    for (const id of ['b', 'c', 'd']) expect(cell(selected, id)).toEqual(cell(w, id));
    const largest = addToBento(w, 'new');
    const biggest = [...w.bento.layers].sort((p, q) => q.width * q.height - p.width * p.height)[0];
    expect(cell(largest, biggest.id).width).toBeCloseTo((biggest.width - 12) / 2);
    expect(largest.bento.layers).toHaveLength(5);
  });
  it('refuses a split below MIN_TILE, using the actual gap', () => {
    // A cell exactly 2 × MIN_TILE + gap wide splits; anything narrower does not.
    const fit = setSpacing(layout(assets.slice(0, 2), 'bento'), 'margin', 0);
    const w: Workspace = {
      ...fit,
      aspect: '1:1',
      slides: 1,
      bento: { ...fit.bento, tree: { layerId: fit.bento.layers[0].id }, gap: 12 },
    };
    let narrow = applyBento(w);
    narrow = {
      ...narrow,
      bento: {
        ...narrow.bento,
        layers: [{ ...narrow.bento.layers[0], width: 2 * MIN_TILE + 12, height: 200 }],
      },
    };
    expect(addToBento(narrow, 'new').bento.layers).toHaveLength(2);
    const tooNarrow = {
      ...narrow,
      bento: { ...narrow.bento, layers: [{ ...narrow.bento.layers[0], width: 2 * MIN_TILE + 11 }] },
    };
    expect(addToBento(tooNarrow, 'new')).toBe(tooNarrow);
    const wider = { ...narrow, bento: { ...narrow.bento, gap: 13 } };
    expect(addToBento(wider, 'new')).toBe(wider);
  });
  it('manual adds ignore the automatic cap and many uploads stop at MIN_TILE', () => {
    let w = layout(assets, 'bento', 0, undefined, { aspect: '1:1', slides: 1 });
    expect(w.bento.layers).toHaveLength(BENTO_PER_SLIDE);
    w = addToBento(w, 'seventh');
    expect(w.bento.layers).toHaveLength(BENTO_PER_SLIDE + 1);
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}` }) as Asset);
    const full = addPhotos(w, many);
    expect(full.bento.layers.length).toBeGreaterThan(BENTO_PER_SLIDE + 1);
    expect(full.bento.layers.length).toBeLessThan(67);
    for (const l of full.bento.layers) {
      expect(l.width).toBeGreaterThanOrEqual(MIN_TILE);
      expect(l.height).toBeGreaterThanOrEqual(MIN_TILE);
    }
    noOverlap(full);
    // Every upload still reaches the other layout.
    expect(full.scrapbook.layers).toHaveLength(66);
  });
  it('spacing values change cell rects and never push a cell under MIN_TILE', () => {
    const w = layout(assets.slice(0, 2), 'bento', 0, 'balanced');
    const [before] = w.bento.layers;
    const gap = setSpacing(w, 'gap', 40);
    expect(gap.bento.gap).toBe(40);
    noOverlap(gap);
    const gapped = gap.bento.layers;
    expect(gapped[1].x - (gapped[0].x + gapped[0].width)).toBeCloseTo(40);
    const margin = setSpacing(w, 'margin', 100);
    expect(margin.bento.layers[0]).toMatchObject({ x: 100, y: 100 });
    expect(margin.bento.layers[0].width).toBeLessThan(before.width);
    expect(setSpacing(w, 'radius', 30).bento.layers).toEqual(w.bento.layers);
    // The tightest template stops where a cell would drop below MIN_TILE.
    const tight = layout(assets, 'bento', 0, undefined, { aspect: '1:1', slides: 1 });
    const stopped = setSpacing(tight, 'margin', 120);
    expect(stopped.bento.margin).toBeLessThanOrEqual(120);
    for (const l of stopped.bento.layers)
      expect(Math.min(l.width, l.height)).toBeGreaterThanOrEqual(MIN_TILE - 0.001);
    if (stopped.bento.margin < 120) {
      const next = applyBento({
        ...stopped,
        bento: { ...stopped.bento, margin: stopped.bento.margin + 1 },
      });
      expect(Math.min(...next.bento.layers.map((l) => Math.min(l.width, l.height)))).toBeLessThan(
        MIN_TILE,
      );
    }
    // New layouts, rebuilds and resizes keep the chosen spacing.
    expect(regenerate(gap, assets, 1).bento.gap).toBe(40);
    expect(resize(gap, '9:16', 2).bento.gap).toBe(40);
    const small = dividers(setSpacing(w, 'gap', 0))[0];
    expect(small.position).toBeCloseTo(
      w.bento.margin + (w.bento.layers[0].width + 12 + w.bento.layers[1].width) / 2,
      0,
    );
  });
  it('keeps both layouts across style switches and shuffles only the active one', () => {
    const w = layout(assets, 'bento', 1);
    const moved: Workspace = {
      ...w,
      scrapbook: {
        layers: w.scrapbook.layers.map((l, i) => (i ? l : { ...l, x: 777, y: 55 })),
      },
    };
    const edited = setSpacing(removeLayer(moved, moved.bento.layers[0].id), 'gap', 30);
    const scrap: Workspace = { ...edited, style: 'scrapbook' };
    expect(activeLayers(scrap)).toEqual(moved.scrapbook.layers);
    const back: Workspace = { ...scrap, style: 'bento' };
    expect(back).toEqual(edited);
    const shuffled = regenerate(scrap, assets, 2);
    expect(shuffled.bento).toEqual(edited.bento);
    expect(regenerate(edited, assets, 2).scrapbook).toEqual(edited.scrapbook);
    expect(regenerate(edited, assets, 2).background).toBe(edited.background);
  });
  it('photos added in one style appear in the other; library removal clears both', () => {
    const start = layout(assets.slice(0, 2), 'scrapbook');
    const added = addPhotos(start, [{ id: 'new' } as Asset]);
    expect(added.scrapbook.layers.some((l) => l.assetId === 'new')).toBe(true);
    expect(added.bento.layers.some((l) => l.assetId === 'new')).toBe(true);
    expect(addPhotos(layout([], 'scrapbook'), assets).bento.layers).toHaveLength(6);
    const gone = removeAsset(added, 'new');
    expect(gone.scrapbook.layers).toEqual(start.scrapbook.layers);
    expect(gone.bento.layers.some((l) => l.assetId === 'new')).toBe(false);
    expect(gone.bento.layers).toHaveLength(2);
    noOverlap(gone);
    // Deleting a cell leaves the other layout alone until the library photo itself goes.
    const asBento: Workspace = { ...added, style: 'bento' };
    const cut = removeLayer(asBento, asBento.bento.layers.find((l) => l.assetId === 'new')!.id);
    expect(cut.scrapbook).toEqual(added.scrapbook);
    expect(removeAsset(cut, 'new').scrapbook.layers).toHaveLength(2);
  });
  it('ratio and slide changes apply to both stored layouts', () => {
    const w = layout(assets, 'scrapbook', 1);
    const next = resize(w, '9:16', 3);
    expect(next.scrapbook.layers[0].height).toBeCloseTo(
      (w.scrapbook.layers[0].height * 1920) / 1350,
    );
    expect(Math.max(...next.bento.layers.map((l) => l.y + l.height))).toBeCloseTo(1920 - 24);
  });
});
