import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { ASPECTS, WIDTH, slideLayers, type Asset, type Layer, type Workspace } from './model';
import { draw, paint, previewCache, previewEdges, sourceRect, syncPreviews } from './render';
import { fit, MASTER, PREVIEW, transparent, validProject } from './storage';
const layer = (x: number, extra: Partial<Layer> = {}): Layer => ({
  id: `l${x}`,
  assetId: 'a',
  x,
  y: 100,
  width: 400,
  height: 500,
  rotation: 0,
  zoom: 1.4,
  panX: 0.3,
  panY: 0.7,
  ...extra,
});
const asset = { id: 'a', width: 4096, height: 2731 } as Asset;
const recorder = (calls: [string, unknown[]][]) => {
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get:
      (_, key: string) =>
      (...args: unknown[]) =>
        calls.push([key, args]),
    set: () => true,
  });
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
};
afterEach(() => vi.unstubAllGlobals());
describe('image pipeline', () => {
  it('caps the long edge without upscaling and keeps orientation-swapped dimensions', () => {
    expect(fit(6000, 4000, MASTER)).toEqual({ width: 4096, height: 2731 });
    expect(fit(4000, 6000, MASTER)).toEqual({ width: 2731, height: 4096 });
    expect(fit(4000, 3000, PREVIEW)).toEqual({ width: 1440, height: 1080 });
    expect(fit(800, 600, MASTER)).toEqual({ width: 800, height: 600 });
    expect(fit(20000, 10, PREVIEW)).toEqual({ width: 1440, height: 1 });
  });
  it('keeps PNG only for inputs that actually carry transparency, read at master size', () => {
    const opaque = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    // One transparent pixel in a full 4096² master, which a 1440 preview could average away.
    const master = new Uint8ClampedArray(MASTER * MASTER * 4).fill(255);
    master[master.length - 1] = 0;
    expect(transparent('image/png', () => opaque)).toBe(false);
    expect(transparent('image/png', () => master)).toBe(true);
    expect(transparent('image/webp', () => master)).toBe(true);
    const read = vi.fn(() => master);
    expect(transparent('image/jpeg', read)).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it('frames previews and masters identically', () => {
    const l = layer(0);
    const master = sourceRect(asset, asset, l);
    const preview = sourceRect(asset, { width: 1440, height: 960 }, l);
    expect(preview.x / 1440).toBeCloseTo(master.x / 4096, 10);
    expect(preview.y / 960).toBeCloseTo(master.y / 2731, 10);
    expect(preview.width / 1440).toBeCloseTo(master.width / 4096, 10);
    expect(preview.height / 960).toBeCloseTo(master.height / 2731, 10);
  });
  it('renders slide i as exactly the region [i*WIDTH, 0, WIDTH, height] for every size', async () => {
    for (const [aspect, slides] of [
      ['4:5', 3],
      ['9:16', 20],
      ['1:1', 1],
    ] as const) {
      const workspace = {
        aspect,
        slides,
        style: 'bento',
        background: '#fff',
        layers: [],
      } as unknown as Workspace;
      for (let i = 0; i < slides; i++) {
        const calls: [string, unknown[]][] = [];
        const canvas = recorder(calls);
        await draw({ workspace, assets: [] }, canvas, 1, i);
        expect([canvas.width, canvas.height]).toEqual([WIDTH, ASPECTS[aspect]]);
        expect(calls.find(([k]) => k === 'translate')?.[1]).toEqual([-i * WIDTH, 0]);
      }
      const calls: [string, unknown[]][] = [];
      const wide = recorder(calls);
      await draw({ workspace, assets: [] }, wide, 0.5);
      expect([wide.width, wide.height]).toEqual([WIDTH * slides * 0.5, ASPECTS[aspect] * 0.5]);
    }
  });
  it('the editor view paints the world through its transform and skips off-screen layers', () => {
    const calls: [string, unknown[]][] = [];
    const canvas = Object.assign(recorder(calls), { width: 800, height: 600 });
    const layers = [layer(0), layer(3 * WIDTH, { id: 'far' })];
    const workspace = { aspect: '4:5', slides: 4, style: 'bento', background: '#fff', layers };
    const image = { width: 1440, height: 960 } as ImageBitmap;
    paint(
      { workspace: workspace as unknown as Workspace, assets: [asset] },
      new Map([['a', image]]),
      canvas,
      { x: 10, y: 20, scale: 0.5 },
    );
    expect(calls.filter(([k]) => k === 'setTransform').at(-1)![1]).toEqual([
      0.5, 0, 0, 0.5, 10, 20,
    ]);
    expect(calls.filter(([k]) => k === 'drawImage')).toHaveLength(1);
    // Layers are clipped to the strip, as export would crop them.
    const keys = calls.map(([k]) => k);
    expect(calls.find(([k]) => k === 'rect')![1]).toEqual([0, 0, 4 * WIDTH, 1350]);
    expect(keys.indexOf('rect')).toBeLessThan(keys.indexOf('drawImage'));
    expect(keys.lastIndexOf('restore')).toBeGreaterThan(keys.indexOf('drawImage'));
  });
  it('sizes previews for on-screen layers at the current zoom, in coarse steps up to the stored preview', () => {
    const workspace = { layers: [layer(0), layer(12 * WIDTH, { id: 'far', assetId: 'b' })] };
    const project = {
      workspace: workspace as unknown as Workspace,
      assets: [asset, { ...asset, id: 'b' }],
    };
    const viewport = { width: 1000, height: 800 };
    expect(previewEdges(project, { x: 0, y: 0, scale: 0.1 }, viewport)).toEqual(
      new Map([['a', 360]]),
    );
    expect(previewEdges(project, { x: 0, y: 0, scale: 0.8 }, viewport).get('a')).toBe(1440);
    expect(previewEdges(project, { x: 0, y: 0, scale: 0.4 }, viewport).get('a')).toBe(720);
  });
  it('decodes only the layers that can reach a slide, including seam-crossing ones', () => {
    const seam = layer(WIDTH - 200, { rotation: 27 });
    const far = layer(2 * WIDTH + 300);
    const w = { layers: [layer(100), seam, far] } as Workspace;
    expect(slideLayers(w, 0).map((l) => l.id)).toEqual(['l100', seam.id]);
    expect(slideLayers(w, 1).map((l) => l.id)).toEqual([seam.id]);
    expect(slideLayers(w, 2).map((l) => l.id)).toEqual([far.id]);
  });
  it('export holds at most one decoded master, painting layers in z-order', async () => {
    const events: string[] = [];
    vi.stubGlobal('createImageBitmap', async (b: Blob & { id: string }) => {
      events.push(`decode ${b.id}`);
      return { width: 4096, height: 2731, close: () => events.push(`close ${b.id}`) };
    });
    const calls: [string, unknown[]][] = [];
    const canvas = recorder(calls);
    const assets = ['a', 'b'].map(
      (id) => ({ ...asset, id, masterBlob: { id } }) as unknown as Asset,
    );
    const layers = [layer(0), layer(1, { assetId: 'b' }), layer(2)];
    const workspace = { style: 'bento', background: '#fff', layers } as unknown as Workspace;
    const original = calls.push.bind(calls);
    calls.push = (...c) => (c[0][0] === 'drawImage' && events.push('paint'), original(...c));
    await draw({ workspace, assets }, canvas, 1, 0);
    expect(events).toEqual([
      'decode a',
      'paint',
      'close a',
      'decode b',
      'paint',
      'close b',
      'decode a',
      'paint',
      'close a',
    ]);
  });
  it('preview cache decodes only new assets at display size and closes removed ones', async () => {
    const decoded: string[] = [];
    const closed: string[] = [];
    vi.stubGlobal('createImageBitmap', async (b: { id: string }, o: ImageBitmapOptions) => {
      decoded.push(`${b.id} ${o.resizeWidth}x${o.resizeHeight}`);
      return { close: () => closed.push(`${b.id} ${o.resizeWidth}`) };
    });
    const make = (id: string) => ({ ...asset, id, previewBlob: { id } }) as unknown as Asset;
    const cache = previewCache();
    await syncPreviews(cache, [make('a'), make('b')], () => 720);
    const images = await syncPreviews(cache, [make('a'), make('b'), make('c')], () => 720);
    expect(decoded).toEqual(['a 720x480', 'b 720x480', 'c 720x480']);
    expect([...images!.keys()]).toEqual(['a', 'b', 'c']);
    await syncPreviews(cache, [make('c')], () => 720);
    await Promise.resolve();
    expect(closed).toEqual(['a 720', 'b 720']);
    expect(decoded).toHaveLength(3);
    // Zooming in re-decodes sharper and closes the old bitmap only once the new set is ready.
    await syncPreviews(cache, [make('c')], () => 1440);
    await Promise.resolve();
    expect(decoded.at(-1)).toBe('c 1440x960');
    expect(closed).toEqual(['a 720', 'b 720', 'c 720']);
  });
  it('a superseded or failed preview sync keeps the shown bitmap; only the latest success retires it', async () => {
    const closed: number[] = [];
    const pending = new Map<number, { resolve: () => void; reject: () => void }>();
    vi.stubGlobal(
      'createImageBitmap',
      (_: Blob, o: ImageBitmapOptions) =>
        new Promise((resolve, reject) => {
          const edge = o.resizeWidth!;
          pending.set(edge, {
            resolve: () => resolve({ width: edge, close: () => closed.push(edge) }),
            reject: () => reject(new Error(`decode ${edge} failed`)),
          });
        }),
    );
    const a = { id: 'a', width: 4000, height: 2000, previewBlob: {} } as unknown as Asset;
    const cache = previewCache();
    const first = syncPreviews(cache, [a], () => 360);
    pending.get(360)!.resolve();
    expect((await first)!.get('a')!.width).toBe(360);
    const mid = syncPreviews(cache, [a], () => 720);
    const last = syncPreviews(cache, [a], () => 1440);
    // The older decode lands first: it is superseded, closes only its own bitmap and leaves 360 on screen.
    pending.get(720)!.resolve();
    expect(await mid).toBeNull();
    expect(closed).toEqual([720]);
    expect(cache.shown.get('a')!.width).toBe(360);
    // The latest one fails: the error surfaces and 360 is still drawn.
    pending.get(1440)!.reject();
    await expect(last).rejects.toThrow('decode 1440 failed');
    expect(closed).toEqual([720]);
    expect(cache.shown.get('a')!.width).toBe(360);
    // A retry re-decodes, and its success finally retires 360.
    const retry = syncPreviews(cache, [a], () => 1440);
    pending.get(1440)!.resolve();
    expect((await retry)!.get('a')!.width).toBe(1440);
    expect(closed).toEqual([720, 360]);
  });
  it('rejects saved projects that would break the editor', () => {
    const good = () => ({
      record: { workspace: { aspect: '4:5', slides: 3, layers: [layer(0)] }, assetIds: ['a'] },
      assets: [{ ...asset, name: 'a.jpg', masterBlob: new Blob(), previewBlob: new Blob() }],
    });
    const ok = good();
    expect(validProject(ok.record, ok.assets)).toBe(true);
    const cases: ((p: ReturnType<typeof good>) => void)[] = [
      (p) => (p.record.workspace.aspect = '2:3'),
      (p) => (p.record.workspace.slides = 0),
      (p) => (p.record.workspace.slides = 21),
      (p) => (p.record.workspace.slides = 2.5),
      (p) => ((p.record.workspace.layers as unknown[]) = [null]),
      (p) => (p.record.workspace.layers[0].zoom = NaN),
      (p) => ((p.record.workspace.layers[0] as unknown as { x: string }).x = '10'),
      (p) => (p.record.workspace.layers[0].assetId = 'missing'),
      (p) => p.record.workspace.layers.push(layer(0)),
      (p) => ((p.assets[0] as { width: unknown }).width = '4096'),
      (p) => (p.assets[0].height = Infinity),
      (p) => (p.assets[0].width = MASTER + 1),
      (p) => (p.assets[0].width = 0),
      (p) => ((p.assets as unknown[])[0] = undefined),
      (p) => {
        p.record.assetIds.push('a');
        p.assets.push(p.assets[0]);
      },
      (p) => {
        p.record.assetIds = Array.from({ length: 101 }, (_, i) => (i ? `a${i}` : 'a'));
        p.assets = p.record.assetIds.map((id) => ({ ...p.assets[0], id }));
      },
    ];
    for (const change of cases) {
      const p = good();
      change(p);
      expect(validProject(p.record, p.assets)).toBe(false);
    }
  });
});
