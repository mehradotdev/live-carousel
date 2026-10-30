import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  HEIGHT,
  SLIDES,
  WIDTH,
  slideLayers,
  type Asset,
  type Layer,
  type Workspace,
} from './model';
import { draw, paint, sourceRect, syncPreviews } from './render';
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
  it('renders slide i as exactly the region [i*WIDTH, 0, WIDTH, HEIGHT]', () => {
    for (let i = 0; i < SLIDES; i++) {
      const calls: [string, unknown[]][] = [];
      const canvas = recorder(calls);
      const workspace = { style: 'bento', background: '#fff', layers: [] } as unknown as Workspace;
      paint({ workspace, assets: [] }, new Map(), canvas, 1, i);
      expect([canvas.width, canvas.height]).toEqual([WIDTH, HEIGHT]);
      expect(calls.find(([k]) => k === 'translate')?.[1]).toEqual([-i * WIDTH, 0]);
    }
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
      return { close: () => closed.push(b.id) };
    });
    const make = (id: string) => ({ ...asset, id, previewBlob: { id } }) as unknown as Asset;
    const cache = new Map<string, Promise<ImageBitmap>>();
    await syncPreviews(cache, [make('a'), make('b')], 720);
    const images = await syncPreviews(cache, [make('a'), make('b'), make('c')], 720);
    expect(decoded).toEqual(['a 720x480', 'b 720x480', 'c 720x480']);
    expect([...images.keys()]).toEqual(['a', 'b', 'c']);
    await syncPreviews(cache, [make('c')], 720);
    await Promise.resolve();
    expect(closed).toEqual(['a', 'b']);
    expect(decoded).toHaveLength(3);
  });
  it('rejects saved projects that would break the editor', () => {
    const good = () => ({
      record: { workspace: { layers: [layer(0)] }, assetIds: ['a'] },
      assets: [{ ...asset, name: 'a.jpg', masterBlob: new Blob(), previewBlob: new Blob() }],
    });
    const ok = good();
    expect(validProject(ok.record, ok.assets)).toBe(true);
    const cases: ((p: ReturnType<typeof good>) => void)[] = [
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
