import { describe, expect, it } from 'vite-plus/test';
import { WIDTH } from './model';
import { PAD, centredSlide, clampView, fitRect, reveal, scaleBounds, zoomAt } from './view';
const viewport = { width: 800, height: 600 };
const world = { width: WIDTH * 3, height: 1350 };
const slide = { width: WIDTH, height: 1350 };
const bounds = scaleBounds(world, slide, viewport);
describe('viewport', () => {
  it('fit shows the whole strip centred inside the padding', () => {
    const v = fitRect({ x: 0, y: 0, ...world }, viewport);
    expect(v.scale).toBeCloseTo((800 - 2 * PAD) / world.width);
    expect(v.x).toBeCloseTo(PAD);
    expect(v.y + (world.height * v.scale) / 2).toBeCloseTo(300);
    expect(bounds.min).toBe(v.scale);
  });
  it('fit to a slide fills the viewport with that slide and centres it', () => {
    const v = fitRect({ x: 2 * WIDTH, y: 0, ...slide }, viewport);
    expect(v.scale).toBeCloseTo((600 - 2 * PAD) / 1350);
    expect(v.x + 2.5 * WIDTH * v.scale).toBeCloseTo(400);
    expect(centredSlide(v, viewport, 3)).toBe(2);
    // The last slide stays centred after clamping.
    expect(clampView(v, world, viewport, bounds)).toEqual(v);
    expect(bounds.max).toBeCloseTo(Math.max(4 * bounds.min, 2 * v.scale));
  });
  it('zooming at a point keeps that world point under it', () => {
    const v = { x: 30, y: -40, scale: 0.4 };
    const at = { x: 250, y: 170 };
    const before = { x: (at.x - v.x) / v.scale, y: (at.y - v.y) / v.scale };
    const z = zoomAt(v, at, 0.9);
    expect((at.x - z.x) / z.scale).toBeCloseTo(before.x);
    expect((at.y - z.y) / z.scale).toBeCloseTo(before.y);
  });
  it('clamps scale to the bounds, centres an axis that fits and limits pan elsewhere', () => {
    expect(clampView({ x: 0, y: 0, scale: 100 }, world, viewport, bounds).scale).toBe(bounds.max);
    const small = clampView({ x: 500, y: 500, scale: bounds.min }, world, viewport, bounds);
    expect(small.y + (world.height * small.scale) / 2).toBeCloseTo(300);
    const scale = bounds.max;
    const far = clampView({ x: 5000, y: 5000, scale }, world, viewport, bounds);
    expect([far.x, far.y]).toEqual([400, 300]);
    const end = clampView({ x: -1e6, y: -1e6, scale }, world, viewport, bounds);
    expect(end.x + world.width * scale).toBeCloseTo(400);
    expect(end.y + world.height * scale).toBeCloseTo(300);
  });
  it('a strip that fits can still centre each of its slides', () => {
    const viewport = { width: 1000, height: 600 };
    const slide = { width: WIDTH, height: 1920 };
    const world = { width: 2 * WIDTH, height: 1920 };
    const bounds = scaleBounds(world, slide, viewport);
    for (const i of [0, 1]) {
      const v = fitRect({ x: i * WIDTH, y: 0, ...slide }, viewport);
      expect(world.width * v.scale).toBeLessThan(1000);
      const c = clampView(v, world, viewport, bounds);
      expect(c).toEqual(v);
      expect(centredSlide(c, viewport, 2)).toBe(i);
    }
    // But no further than centring the outer slides.
    const far = clampView({ x: 5000, y: 5000, scale: bounds.min }, world, viewport, bounds);
    expect(far.x + (WIDTH / 2) * far.scale).toBeCloseTo(500);
    expect(far.y + (1920 / 2) * far.scale).toBeCloseTo(300);
  });
  it('reveal pans just enough to show a rect, zooming out only when it cannot fit', () => {
    const v = { x: 0, y: 0, scale: 1 };
    const right = reveal(v, { x: 1000, y: 100, width: 200, height: 100 }, viewport);
    expect(right).toEqual({ x: 800 - PAD - 1200, y: 0, scale: 1 });
    expect(reveal(v, { x: 100, y: 100, width: 50, height: 50 }, viewport)).toEqual(v);
    const left = reveal(
      { x: -900, y: 0, scale: 1 },
      { x: 0, y: 0, width: 100, height: 100 },
      viewport,
    );
    expect(left.x).toBe(PAD);
    const huge = reveal(v, { x: 0, y: 0, width: 2000, height: 100 }, viewport);
    expect(huge.scale).toBeLessThan(1);
  });
});
