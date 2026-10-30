import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
async function upload(page: Page, count = 6) {
  const images = await page.evaluate(async (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = i % 2 ? 360 : 240;
      c.height = i % 2 ? 240 : 360;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, ['#be9270', '#7d936b', '#7495a4', '#b88983', '#9685a1', '#c7ab6c'][i % 6]);
      g.addColorStop(1, '#e6dfc4');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#fff8';
      ctx.beginPath();
      ctx.arc(c.width / 2, c.height / 2, 65, 0, Math.PI * 2);
      ctx.fill();
      out.push(c.toDataURL().split(',')[1]);
    }
    return out;
  }, count);
  await page.getByLabel('Upload photos').setInputFiles(
    images.map((data, i) => ({
      name: `photo-${i}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    })),
  );
  await expect(page.locator('.photo-hit')).toHaveCount(count);
}
test('guest creates, crops, undoes, restores and exports three full-resolution slides', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page);
  await expect(page.getByLabel('Your continuous 3-slide collage')).toBeVisible();
  await page.getByLabel('Photo zoom').fill('2');
  await expect(page.getByLabel('Photo zoom')).toHaveValue('2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Photo zoom')).toHaveValue('1');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Photo zoom')).toHaveValue('2');
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Photo zoom')).toHaveValue('2');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download images/ }).click();
  const stream = await (await downloaded).createReadStream();
  const chunks = [];
  for await (const c of stream!) chunks.push(c);
  const files = unzipSync(Buffer.concat(chunks));
  expect(Object.keys(files)).toHaveLength(3);
  for (const png of Object.values(files)) {
    const bytes = Buffer.from(png);
    expect(bytes.readUInt32BE(16)).toBe(1080);
    expect(bytes.readUInt32BE(20)).toBe(1350);
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true });
});
test('single editing tab hands ownership over without losing the workspace', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 3);
  await expect(page.getByLabel('Your continuous 3-slide collage')).toBeVisible();
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByLabel('Upload photos')).toBeDisabled();
  await second.getByRole('button', { name: 'Edit here', exact: true }).click();
  await expect(second.getByLabel('Upload photos')).toBeEnabled();
  await expect(page.getByLabel('Upload photos')).toBeDisabled();
  await expect(second.getByLabel('Your continuous 3-slide collage')).toBeVisible();
});
test('unsupported files fail visibly and mobile layout stays within the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await page
    .getByLabel('Upload photos')
    .setInputFiles({ name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('invalid') });
  await expect(page.getByRole('alert')).toContainText('use JPEG, PNG or WebP');
  await upload(page, 3);
  await page.getByRole('button', { name: /Scrapbook/ }).click();
  await expect(page.getByLabel('Your continuous 3-slide collage')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true });
});

test('auth proxy resolves guest sessions and invalid links preserve the local collage', async ({
  page,
  request,
}) => {
  const session = await request.get('/api/auth/get-session');
  expect([200, 503]).toContain(session.status());
  if (session.status() === 200) expect(await session.json()).toBeNull();
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 3);
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible();
  await page.goto('/?sign_in_error=1');
  await expect(page.getByRole('alert')).toContainText('invalid or expired');
  await expect(page.getByLabel('Your continuous 3-slide collage')).toBeVisible();
  if (session.status() === 200) {
    await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
    await page.route('**/api/auth/sign-in/magic-link', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Too many requests' }),
      }),
    );
    await page.getByLabel('Email address', { exact: true }).fill('test@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.locator('.auth-error')).toContainText('wait a minute');
    await expect(page.getByLabel('Your continuous 3-slide collage')).toBeVisible();
  }
});

async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible();
  return page.evaluate(async () => {
    const path = '/src/lib/editor/storage.ts';
    const storage: typeof import('../apps/web/src/lib/editor/storage') = await import(path);
    const project = (await storage.loadProject())!;
    const { workspace } = project;
    return {
      // Existing checks read the active layout's layers.
      workspace: { ...workspace, layers: workspace[workspace.style].layers },
      assets: project.assets.map((a) => ({ id: a.id, name: a.name })),
    };
  });
}
async function drag(page: Page, selector: string, dx: number, dy: number) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
}
test('Scrapbook mouse editing supports move, resize, rotate, stacking, delete, restore and one-step undo', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 13);
  await page.getByRole('button', { name: /Scrapbook/ }).click();
  const original = await saved(page);
  const first = original.workspace.layers[0];
  const selector = `[data-layer-id="${first.id}"]`;
  await drag(page, selector, 95, 35);
  let project = await saved(page);
  expect(project.workspace.layers.find((l) => l.id === first.id)!.x).toBeGreaterThan(first.x + 100);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).workspace.layers).toEqual(original.workspace.layers);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  const beforeResize = (await saved(page)).workspace.layers.find((l) => l.id === first.id)!;
  await drag(page, '[aria-label="Resize photo se"]', 35, 25);
  project = await saved(page);
  expect(project.workspace.layers.find((l) => l.id === first.id)!.width).toBeGreaterThan(
    beforeResize.width,
  );
  const beforeRotate = project.workspace.layers.find((l) => l.id === first.id)!.rotation;
  await drag(page, '[aria-label="Rotate photo"]', 50, 15);
  project = await saved(page);
  expect(
    Math.abs(project.workspace.layers.find((l) => l.id === first.id)!.rotation - beforeRotate),
  ).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Bring to front', exact: true }).click();
  expect((await saved(page)).workspace.layers.at(-1)!.id).toBe(first.id);
  await page.getByRole('button', { name: 'Send to back', exact: true }).click();
  expect((await saved(page)).workspace.layers[0].id).toBe(first.id);
  await page.getByRole('button', { name: 'Bring forward', exact: true }).click();
  expect((await saved(page)).workspace.layers[1].id).toBe(first.id);
  await page.getByRole('button', { name: 'Send backward', exact: true }).click();
  expect((await saved(page)).workspace.layers[0].id).toBe(first.id);
  const beforeCancel = (await saved(page)).workspace.layers;
  const hit = page.locator(selector);
  await hit.scrollIntoViewIfNeeded();
  const box = (await hit.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 20, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await saved(page)).workspace.layers).toEqual(beforeCancel);
  const name = original.assets.find((a) => a.id === first.assetId)!.name;
  await page.getByRole('button', { name: `Select ${name}`, exact: true }).click();
  await expect(page.getByText('Make photo 1 yours')).toBeVisible();
  await page.getByRole('button', { name: 'Delete photo', exact: true }).click();
  project = await saved(page);
  expect(project.workspace.layers).toHaveLength(12);
  expect(project.assets).toHaveLength(13);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).workspace.layers).toHaveLength(13);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: `Add back ${name}`, exact: true }).click();
  expect((await saved(page)).workspace.layers).toHaveLength(13);
  const final = (await saved(page)).workspace;
  await page.reload();
  await expect(page.locator('.photo-hit')).toHaveCount(13);
  expect((await saved(page)).workspace).toEqual(final);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/scrapbook-interactive.png', fullPage: true });
});
test('Bento templates change geometry, mouse swaps preserve slots, and shared borders resize without gaps', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 13);
  const initial = (await saved(page)).workspace;
  await page.getByLabel('Bento template').selectOption('editorial');
  let w = (await saved(page)).workspace;
  expect(w.layers.map((l) => [l.x, l.y, l.width, l.height])).not.toEqual(
    initial.layers.map((l) => [l.x, l.y, l.width, l.height]),
  );
  const [a, b] = w.layers;
  const src = page.locator(`[data-layer-id="${a.id}"]`);
  const dst = page.locator(`[data-layer-id="${b.id}"]`);
  await src.scrollIntoViewIfNeeded();
  const s = (await src.boundingBox())!;
  const t = (await dst.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 15 });
  const ghost = page.locator('.swap-ghost');
  await expect(ghost).toBeVisible();
  await expect(ghost).toContainText('Release to swap');
  await expect(ghost.locator('canvas')).toHaveAttribute('data-asset-id', a.assetId);
  await expect(src).toHaveClass(/drag-source/);
  await expect(dst).toHaveClass(/drop-target/);
  expect(
    await ghost.locator('canvas').evaluate((canvas) => {
      const c = canvas as HTMLCanvasElement;
      return (
        c.width > 0 &&
        c
          .getContext('2d')!
          .getImageData(0, 0, c.width, c.height)
          .data.some((v, i) => i % 4 === 3 && v > 0)
      );
    }),
  ).toBe(true);
  const previewStyle = await ghost.locator('canvas').evaluate((c) => ({
    opacity: getComputedStyle(c).opacity,
    filter: getComputedStyle(c).filter,
  }));
  expect(+previewStyle.opacity).toBeLessThan(1);
  expect(previewStyle.filter).toContain('grayscale');
  await page.screenshot({ path: 'test-results/bento-drag-preview.png' });
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  w = (await saved(page)).workspace;
  expect(w.layers[0].assetId).toBe(b.assetId);
  expect(w.layers[1].assetId).toBe(a.assetId);
  expect(w.layers[0].x).toBe(a.x);
  expect(w.layers[0].width).toBe(a.width);
  const beforeResize = w;
  const root = page.getByRole('button', { name: 'Resize vertical divider root', exact: true });
  await root.scrollIntoViewIfNeeded();
  await drag(page, '[aria-label="Resize vertical divider root"]', 45, 0);
  w = (await saved(page)).workspace;
  expect(w.layers.map((l) => l.width)).not.toEqual(beforeResize.layers.map((l) => l.width));
  for (let i = 0; i < w.layers.length; i++)
    for (let j = i + 1; j < w.layers.length; j++) {
      const x = w.layers[i],
        y = w.layers[j];
      expect(
        Math.min(
          Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x),
          Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y),
        ),
      ).toBeLessThanOrEqual(0.001);
    }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).workspace).toEqual(beforeResize);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const final = (await saved(page)).workspace;
  await page.reload();
  expect((await saved(page)).workspace).toEqual(final);
  const fontSizes = await page
    .locator('.upload strong, .sliders label, .primary, .save-status')
    .evaluateAll((nodes) => nodes.map((n) => parseFloat(getComputedStyle(n).fontSize)));
  expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(14);
  await page.screenshot({ path: 'test-results/bento-interactive.png', fullPage: true });
});

test('transformed Scrapbook per-slide exports match the continuous composition at slide seams', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 3);
  await page.getByRole('button', { name: /Scrapbook/ }).click();
  await saved(page);
  await page.getByLabel('Photo position X', { exact: true }).fill('900');
  await page.getByLabel('Photo position X', { exact: true }).press('Tab');
  await page.getByLabel('Photo rotation', { exact: true }).fill('27');
  await page.getByLabel('Photo rotation', { exact: true }).press('Tab');
  await saved(page);
  const slides = (await exported(page)).map((f) => f.bytes.toString('base64'));
  const results = await page.evaluate(async (encoded) => {
    const storage: typeof import('../apps/web/src/lib/editor/storage') = await import(
      '/src/lib/editor/storage.ts' as string
    );
    const model: typeof import('../apps/web/src/lib/editor/model') = await import(
      '/src/lib/editor/model.ts' as string
    );
    const project = (await storage.loadProject())!;
    const path = '/src/lib/editor/render.ts';
    const renderer = await import(path);
    const wide = document.createElement('canvas');
    await renderer.draw(project, wide, 1);
    // Rotated edges antialias differently under translation; this is the only place a larger difference is allowed.
    const onRotatedEdge = (x: number, y: number) =>
      project.workspace.scrapbook.layers.some((l) => {
        const p = model.localPoint(l, { x: x + 0.5, y: y + 0.5 });
        const outline = (left: number, top: number, right: number, bottom: number) =>
          Math.abs(Math.max(left - p.x, p.x - right, top - p.y, p.y - bottom)) <= 3;
        const [w, h] = [l.width / 2, l.height / 2];
        return outline(-w, -h, w, h) || outline(-w - 12, -h - 12, w + 12, h + 32);
      });
    const result = [];
    for (let i = 0; i < encoded.length; i++) {
      const blob = await (await fetch('data:image/png;base64,' + encoded[i])).blob();
      const image = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1350;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      image.close();
      const actual = ctx.getImageData(0, 0, 1080, 1350).data;
      const expected = wide.getContext('2d')!.getImageData(i * 1080, 0, 1080, 1350).data;
      let mismatch = 0;
      let max = 0;
      let offEdge = 0;
      for (let p = 0; p < actual.length; p++) {
        const d = Math.abs(actual[p] - expected[p]);
        if (d > 1) mismatch++;
        max = Math.max(max, d);
        const n = p >> 2;
        if (d > 16 && !onRotatedEdge((n % 1080) + i * 1080, Math.floor(n / 1080))) offEdge++;
      }
      result.push({ max, offEdge, rare: mismatch < actual.length / 2000 });
    }
    return result;
  }, slides);
  for (const { max, offEdge, rare } of results) {
    expect(offEdge).toBe(0);
    expect(max).toBeLessThanOrEqual(48);
    expect(rare).toBe(true);
  }
});
test('a high-contrast photo crossing the seams lines up in exports and the editor paint', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1440;
    c.height = 600;
    const ctx = c.getContext('2d')!;
    const colors = ['#000000', '#ffffff', '#ff0000', '#0000ff', '#00ff00'];
    for (let x = 0; x < c.width; x += 12)
      for (let y = 0; y < c.height; y += 12) {
        ctx.fillStyle = colors[(x / 12 + (y / 12) * 2) % colors.length];
        ctx.fillRect(x, y, 12, 12);
      }
    // One transparent pixel keeps master and preview lossless PNGs, so they decode identically.
    ctx.clearRect(0, 0, 1, 1);
    return c.toDataURL().split(',')[1];
  });
  await page.getByLabel('Upload photos').setInputFiles({
    name: 'checks.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  await expect(page.locator('.photo-hit')).toHaveCount(1);
  const compare = async () => {
    await saved(page);
    const slides = (await exported(page)).map((f) => f.bytes.toString('base64'));
    return page.evaluate(async (encoded) => {
      const storage: typeof import('../apps/web/src/lib/editor/storage') = await import(
        '/src/lib/editor/storage.ts' as string
      );
      const project = (await storage.loadProject())!;
      const path = '/src/lib/editor/render.ts';
      const renderer = await import(path);
      const canvas = (width: number) =>
        Object.assign(document.createElement('canvas'), { width, height: 1350 });
      const read = (c: HTMLCanvasElement, x = 0, width = c.width) =>
        c.getContext('2d')!.getImageData(x, 0, width, 1350).data;
      const worst = (a: ArrayLike<number>, b: ArrayLike<number>) => {
        let max = 0;
        for (let p = 0; p < a.length; p++) max = Math.max(max, Math.abs(a[p] - b[p]));
        return max;
      };
      const strip = canvas(3240);
      for (let i = 0; i < encoded.length; i++) {
        const blob = await (await fetch('data:image/png;base64,' + encoded[i])).blob();
        const image = await createImageBitmap(blob);
        strip.getContext('2d')!.drawImage(image, i * 1080, 0);
        image.close();
      }
      const wide = document.createElement('canvas');
      await renderer.draw(project, wide, 1);
      // The editor's own decode and paint, 1:1 over the whole strip and over each seam.
      const images = await renderer.syncPreviews(
        renderer.previewCache(),
        project.assets,
        () => 1440,
      );
      const painted = [
        [0, 3240],
        [900, 360],
        [1980, 360],
      ].map(([x, width]) => {
        const view = canvas(width);
        renderer.paint(project, images, view, { x: -x, y: 0, scale: 1 });
        return worst(read(view), read(strip, x, width));
      });
      return {
        draw: worst(read(strip), read(wide)),
        painted,
        // The seam must carry real contrast, or the limits above would prove nothing.
        contrast: [1080, 2160].map((seam) => {
          const band = read(strip, seam - 8, 16).filter((_, p) => p % 4 === 0);
          return Math.max(...band) - Math.min(...band);
        }),
      };
    }, slides);
  };
  const bento = await compare();
  expect(bento.draw).toBeLessThanOrEqual(16);
  for (const d of bento.painted) expect(d).toBeLessThanOrEqual(16);
  for (const c of bento.contrast) expect(c).toBeGreaterThan(200);
  await page.getByRole('button', { name: /Scrapbook/ }).click();
  await saved(page);
  await page.getByLabel('Photo position X', { exact: true }).fill('900');
  await page.getByLabel('Photo position X', { exact: true }).press('Tab');
  await page.getByLabel('Photo rotation', { exact: true }).fill('0');
  await page.getByLabel('Photo rotation', { exact: true }).press('Tab');
  const scrapbook = await compare();
  expect(scrapbook.draw).toBeLessThanOrEqual(16);
  for (const d of scrapbook.painted) expect(d).toBeLessThanOrEqual(16);
  expect(scrapbook.contrast[0]).toBeGreaterThan(200);
});
test('Bento touch dragging shows a photo above the finger and swaps on release', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:5173/');
    await expect(page.getByLabel('Upload photos')).toBeEnabled();
    await upload(page, 3);
    const before = (await saved(page)).workspace;
    const [a, b] = before.layers;
    const source = page.locator(`[data-layer-id="${a.id}"]`);
    const target = page.locator(`[data-layer-id="${b.id}"]`);
    await source.scrollIntoViewIfNeeded();
    const s = (await source.boundingBox())!;
    const t = (await target.boundingBox())!;
    const x = t.x + t.width / 2,
      y = t.y + t.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: s.x + s.width / 2, y: s.y + s.height / 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    const ghost = page.locator('.swap-ghost');
    await expect(ghost).toBeVisible();
    await expect(ghost).toContainText('Release to swap');
    const box = (await ghost.boundingBox())!;
    expect(box.y + box.height).toBeLessThan(y);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(ghost).toHaveCount(0);
    const after = (await saved(page)).workspace;
    expect(after.layers[0].assetId).toBe(b.assetId);
    expect(after.layers[1].assetId).toBe(a.assetId);
  } finally {
    await context.close();
  }
});

async function dispatchFiles(
  page: Page,
  kind: 'drop' | 'paste' | 'dragover' | 'dragleave',
  count: number,
  target = '.intro',
) {
  return page.evaluate(
    async ({ kind, count, target }) => {
      const data = new DataTransfer();
      for (let i = 0; i < count; i++) {
        const c = document.createElement('canvas');
        c.width = c.height = 200 + i * 40;
        c.getContext('2d')!.fillRect(0, 0, 10, 10);
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!)));
        data.items.add(new File([blob], `${kind}-${i}.png`, { type: 'image/png' }));
      }
      const init = { bubbles: true, cancelable: true };
      const event =
        kind === 'paste'
          ? new ClipboardEvent('paste', { ...init, clipboardData: data })
          : new DragEvent(kind, { ...init, dataTransfer: data });
      document.querySelector(target)!.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { kind, count, target },
  );
}
test('photos dropped anywhere on the page or pasted are added without leaving the editor', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  expect(await dispatchFiles(page, 'drop', 2)).toBe(true);
  await expect(page.locator('.count')).toHaveText('2/100');
  expect(await dispatchFiles(page, 'paste', 1)).toBe(true);
  await expect(page.locator('.photo-hit')).toHaveCount(3);
  await expect(page).toHaveURL('/');
  const upload = page.locator('button.upload');
  await dispatchFiles(page, 'dragover', 1);
  await expect(upload).toHaveClass(/drag-over/);
  await dispatchFiles(page, 'drop', 1);
  await expect(upload).not.toHaveClass(/drag-over/);
  await expect(page.locator('.photo-hit')).toHaveCount(4);
  await dispatchFiles(page, 'dragover', 1);
  await expect(upload).toHaveClass(/drag-over/);
  await dispatchFiles(page, 'dragleave', 1);
  await expect(upload).not.toHaveClass(/drag-over/);
  // Pastes into text fields belong to the field, not the photo library.
  await page.evaluate(() => {
    document.body.append(
      Object.assign(document.createElement('textarea'), { id: 'paste-textarea' }),
      Object.assign(document.createElement('input'), { id: 'paste-input' }),
    );
  });
  expect(await dispatchFiles(page, 'paste', 1, '#paste-textarea')).toBe(false);
  expect(await dispatchFiles(page, 'paste', 1, '#paste-input')).toBe(false);
  await expect(page.locator('.count')).toHaveText('4/100');
  await expect(page.locator('.photo-hit')).toHaveCount(4);
});

test('Bento arrow keys swap the selected photo with its neighbours and undo restores the order', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 3);
  const before = (await saved(page)).workspace;
  expect(before.style).toBe('bento');
  const [a, b] = before.layers;
  const first = page.locator(`[data-layer-id="${a.id}"]`);
  await first.click();
  await expect(
    page.getByRole('group', { name: 'Interactive collage canvas' }),
  ).toHaveAccessibleDescription(/arrow keys to swap/);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(`[data-layer-id="${b.id}"]`)).toHaveAttribute('aria-pressed', 'true');
  let w = (await saved(page)).workspace;
  expect(w.layers.map((l) => l.assetId)).toEqual([b.assetId, a.assetId, before.layers[2].assetId]);
  await page.keyboard.press('ArrowLeft');
  w = (await saved(page)).workspace;
  expect(w.layers.map((l) => l.assetId)).toEqual(before.layers.map((l) => l.assetId));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).workspace).toEqual(before);
});

test('large uploads are stored as capped, re-encoded masters with editing previews', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  const files = await page.evaluate(() => {
    const encode = (w: number, h: number, alpha: boolean) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#7495a4');
      g.addColorStop(1, '#e6dfc4');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      if (alpha) ctx.clearRect(0, 0, w / 2, h / 2);
      const type = alpha ? 'image/png' : 'image/jpeg';
      const data = c.toDataURL(type, 0.9).split(',')[1];
      c.width = c.height = 0;
      return { type, data };
    };
    // One barely-transparent pixel that averages away at preview size.
    const subtle = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 3000;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#7495a4';
      ctx.fillRect(0, 0, 3000, 3000);
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray([116, 149, 164, 254]), 1, 1),
        1500,
        1500,
      );
      const data = c.toDataURL('image/png').split(',')[1];
      c.width = c.height = 0;
      return { type: 'image/png', data };
    };
    return [encode(6000, 4000, false), encode(400, 300, true), encode(300, 400, false), subtle()];
  });
  await page.getByLabel('Upload photos').setInputFiles(
    files.map((f, i) => ({
      name: `big-${i}.${f.type === 'image/png' ? 'png' : 'jpg'}`,
      mimeType: f.type,
      buffer: Buffer.from(f.data, 'base64'),
    })),
  );
  await expect(page.locator('.photo-hit')).toHaveCount(4);
  await saved(page);
  const stored = await page.evaluate(async () => {
    const path = '/src/lib/editor/storage.ts';
    const storage: typeof import('../apps/web/src/lib/editor/storage') = await import(path);
    const project = (await storage.loadProject())!;
    const out = [];
    for (const a of project.assets) {
      const master = await createImageBitmap(a.masterBlob);
      const preview = await createImageBitmap(a.previewBlob);
      out.push({
        name: a.name,
        size: [a.width, a.height],
        master: [master.width, master.height, a.masterBlob.type],
        preview: [preview.width, preview.height, a.previewBlob.type],
      });
      master.close();
      preview.close();
    }
    return out;
  });
  expect(stored[0]).toEqual({
    name: 'big-0.jpg',
    size: [4096, 2731],
    master: [4096, 2731, 'image/jpeg'],
    preview: [1440, 960, 'image/jpeg'],
  });
  expect(stored[1].master).toEqual([400, 300, 'image/png']);
  expect(stored[2].master).toEqual([300, 400, 'image/jpeg']);
  expect(stored[3].master).toEqual([3000, 3000, 'image/png']);
  expect(stored[3].preview).toEqual([1440, 1440, 'image/png']);
});
test('touch devices prepare slides first and open the share sheet from a fresh tap', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const media = matchMedia.bind(window);
    window.matchMedia = (q) =>
      q === '(pointer: coarse)' ? ({ matches: true } as MediaQueryList) : media(q);
    const shared: unknown[] = [];
    Object.assign(window, { shared });
    Object.assign(navigator, {
      canShare: () => true,
      share: async ({ files }: { files: File[] }) => {
        shared.push({ active: navigator.userActivation.isActive, names: files.map((f) => f.name) });
      },
    });
  });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 3);
  await page.getByRole('button', { name: /Download images/ }).click();
  const share = page.getByRole('button', { name: 'Share slides' });
  await expect(share).toBeVisible();
  expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(42);
  await share.click();
  await expect(share).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)).toEqual([
    {
      active: true,
      names: ['living-carousel-01.png', 'living-carousel-02.png', 'living-carousel-03.png'],
    },
  ]);
  await page.getByRole('button', { name: /Download images/ }).click();
  await expect(share).toBeVisible();
  await page.getByLabel('Export image format').selectOption('jpeg');
  await expect(share).toBeHidden();
});
test('an unreadable saved collage shows an error and is not overwritten by autosave', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 3);
  await saved(page);
  const record = (change: boolean) =>
    page.evaluate(
      (change) =>
        new Promise<unknown>((resolve, reject) => {
          const open = indexedDB.open('living-carousel-v4');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const store = open.result.transaction('project', 'readwrite').objectStore('project');
            const get = store.get('active');
            get.onsuccess = () => {
              if (change)
                store.put(
                  {
                    ...get.result,
                    workspace: {
                      ...get.result.workspace,
                      bento: { ...get.result.workspace.bento, layers: [null] },
                    },
                  },
                  'active',
                );
              resolve(get.result.workspace.bento.layers);
              open.result.close();
            };
          };
        }),
      change,
    );
  await record(true);
  await page.reload();
  await expect(page.getByText('The collage saved on this device is unreadable.')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(300);
  expect(await record(false)).toEqual([null]);
});

async function exported(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download images/ }).click();
  const stream = await (await pending).createReadStream();
  const chunks = [];
  for await (const c of stream!) chunks.push(c);
  const files = unzipSync(Buffer.concat(chunks));
  return Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, png]) => {
      const bytes = Buffer.from(png);
      return { name, bytes, size: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] };
    });
}
test('ratio and slide count drive layout and export, and each change is one undo step', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 4);
  const before = (await saved(page)).workspace;
  const tall = page.getByRole('button', { name: /^9:16/ });
  await tall.click();
  await expect(tall).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Add a slide' }).click();
  await page.getByRole('button', { name: 'Add a slide' }).click();
  await expect(page.getByText('5\u00a0slides', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your continuous 5-slide collage')).toBeVisible();
  let w = (await saved(page)).workspace;
  expect([w.aspect, w.slides]).toEqual(['9:16', 5]);
  expect(w.layers.map((l) => l.assetId)).toEqual(before.layers.map((l) => l.assetId));
  const files = await exported(page);
  expect(files.map((f) => f.name)).toEqual([1, 2, 3, 4, 5].map((n) => `living-carousel-0${n}.png`));
  for (const f of files) expect(f.size).toEqual([1080, 1920]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const slides of [4, 3]) {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect((await saved(page)).workspace.slides).toBe(slides);
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).workspace).toEqual(before);
  await page.getByRole('button', { name: 'Remove a slide' }).click();
  await page.getByRole('button', { name: 'Remove a slide' }).click();
  await expect(page.getByRole('button', { name: 'Remove a slide' })).toBeDisabled();
  w = (await saved(page)).workspace;
  expect(w.slides).toBe(1);
  for (const l of w.layers) expect(l.x + l.width).toBeLessThanOrEqual(1080);
  await expect(page.getByText('1 slide,')).toBeAttached();
  expect(await exported(page)).toHaveLength(1);
});
test('an empty collage exports blank background slides, up to 20 in 9:16', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  const blank = await exported(page);
  expect(blank).toHaveLength(3);
  for (const f of blank) {
    expect(f.size).toEqual([1080, 1350]);
    expect(f.bytes.equals(blank[0].bytes)).toBe(true);
  }
  await page.getByRole('button', { name: /^9:16/ }).click();
  const add = page.getByRole('button', { name: 'Add a slide' });
  for (let i = 3; i < 20; i++) await add.click();
  await expect(add).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const files = await exported(page);
  expect(files.map((f) => f.name).at(-1)).toBe('living-carousel-20.png');
  for (const f of files) expect(f.size).toEqual([1080, 1920]);
});

test('a format change during a drag cancels the gesture instead of reverting the format', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 3);
  await page.getByRole('button', { name: /Scrapbook/ }).click();
  const before = (await saved(page)).workspace;
  const photo = page.locator(`[data-layer-id="${before.layers[0].id}"]`);
  await photo.scrollIntoViewIfNeeded();
  const b = (await photo.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 20, { steps: 5 });
  // A second input (keyboard or another touch) changes the format mid-drag.
  await page.getByRole('button', { name: /^1:1/ }).evaluate((el) => (el as HTMLElement).click());
  await page.mouse.move(b.x + b.width / 2 + 80, b.y + b.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: /^1:1/ })).toHaveAttribute('aria-pressed', 'true');
  const after = (await saved(page)).workspace;
  expect(after.aspect).toBe('1:1');
  expect(after.layers[0].width).toBeCloseTo((before.layers[0].width * 1080) / 1350);
});

test('canvas zooms at the cursor, pans, centres a slide from the strip and keeps drags exact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 3);
  await page.getByRole('button', { name: /Scrapbook/ }).click();
  const zoom = page.getByLabel('Canvas zoom');
  const percent = async () => parseInt((await zoom.textContent())!) / 100;
  const fitted = await zoom.textContent();
  const canvas = page.getByRole('group', { name: 'Interactive collage canvas' });
  let box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect(zoom).not.toHaveText(fitted!);
  expect(await percent()).toBeGreaterThan(parseInt(fitted!) / 100);

  await page.getByRole('button', { name: 'Show slide 3' }).click();
  await expect(page.getByRole('button', { name: 'Show slide 3' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  // The strip sits below the canvas, so clicking it may scroll the page.
  box = (await canvas.boundingBox())!;
  const stage = (await page.locator('.photo-hit').first().locator('..').boundingBox())!;
  const scale = stage.width / (3 * 1080);
  // Slide 3's centre sits at the viewport's centre.
  expect(stage.x + 2.5 * 1080 * scale).toBeCloseTo(box.x + box.width / 2, 0);
  // A horizontal wheel pans the zoomed view.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(-80, 0);
  await expect
    .poll(async () => (await page.locator('.photo-hit').first().locator('..').boundingBox())!.x)
    .toBeCloseTo(stage.x + 80, 0);

  const before = (await saved(page)).workspace;
  const layer = before.layers.find((l) => l.x >= 2 * 1080)!;
  const photo = page.locator(`[data-layer-id="${layer.id}"]`);
  const b = (await photo.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 60, b.y + b.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await saved(page)).workspace.layers.find((l) => l.id === layer.id)!.x)
    .toBeCloseTo(layer.x - 60 / scale, -1);
  const moved = (await saved(page)).workspace.layers.find((l) => l.id === layer.id)!;
  expect(moved.y - layer.y).toBeCloseTo(30 / scale, -1);

  await page.keyboard.press('0');
  await expect(zoom).toHaveText(fitted!);
  await expect(page.getByRole('button', { name: 'Show slide 2' })).toHaveAttribute(
    'aria-current',
    'true',
  );
});

test('tabbing to a photo or divider outside the zoomed view pans it into view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 6);
  await expect(page.getByLabel('Your continuous 3-slide collage')).toBeVisible();
  await page.getByRole('button', { name: 'Show slide 1' }).click();
  const canvas = page.getByRole('group', { name: 'Interactive collage canvas' });
  let box = (await canvas.boundingBox())!;
  const inside = (b: { x: number; y: number; width: number; height: number }) =>
    b.x >= box.x - 1 &&
    b.y >= box.y - 1 &&
    b.x + b.width <= box.x + box.width + 1 &&
    b.y + b.height <= box.y + box.height + 1;
  const hidden: string[] = [];
  for (const photo of await page.locator('.photo-hit').all())
    if (!inside((await photo.boundingBox())!))
      hidden.push((await photo.getAttribute('data-layer-id'))!);
  expect(hidden.length).toBeGreaterThan(0);
  // Walk backwards from the slide strip through every divider and photo.
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Shift+Tab');
    const focused = page.locator('.photo-hit:focus, .divider-handle:focus');
    if (!(await focused.count())) {
      if (seen.length) break;
      continue;
    }
    const id = await focused.getAttribute('data-layer-id');
    if (id) seen.push(id);
    else seen.push('divider');
    // Focus may scroll the page, so measure both again.
    box = (await canvas.boundingBox())!;
    expect(inside((await focused.boundingBox())!)).toBe(true);
  }
  expect(seen).toEqual(expect.arrayContaining(hidden));
});

// Reads an exported PNG's pixel in the page, since Node has no decoder here.
const pixel = (page: Page, png: Buffer, x: number, y: number) =>
  page.evaluate(
    async ({ data, x, y }) => {
      const blob = await (await fetch('data:image/png;base64,' + data)).blob();
      const image = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    },
    { data: png.toString('base64'), x, y },
  );
test('deleting a Bento cell returns its photo to the tray in one undo step and add back splits a cell', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 4);
  const before = await saved(page);
  const [first, ...others] = before.workspace.layers;
  const name = before.assets.find((a) => a.id === first.assetId)!.name;
  await page.locator(`[data-layer-id="${first.id}"]`).click();
  await page.getByRole('button', { name: 'Delete photo', exact: true }).click();
  await expect(page.locator('.photo-hit')).toHaveCount(3);
  await expect(page.getByRole('button', { name: `Add back ${name}`, exact: true })).toBeVisible();
  let w = (await saved(page)).workspace;
  expect(w.layers.map((l) => l.id)).toEqual(others.map((l) => l.id));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.photo-hit')).toHaveCount(4);
  await expect(page.getByRole('button', { name: `Select ${name}`, exact: true })).toBeVisible();
  expect((await saved(page)).workspace).toEqual(before.workspace);
  // The keyboard deletes too.
  await page.locator(`[data-layer-id="${first.id}"]`).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.photo-hit')).toHaveCount(3);
  w = (await saved(page)).workspace;
  const largest = [...w.layers].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  await page.getByRole('button', { name: `Add back ${name}`, exact: true }).click();
  await expect(page.locator('.photo-hit')).toHaveCount(4);
  const after = (await saved(page)).workspace;
  expect(after.layers.at(-1)!.assetId).toBe(first.assetId);
  const split = after.layers.find((l) => l.id === largest.id)!;
  expect(split.width * split.height).toBeLessThan((largest.width * largest.height) / 1.9);
  for (const l of w.layers)
    if (l.id !== largest.id) expect(after.layers.find((c) => c.id === l.id)).toEqual(l);
  // Delete down to nothing: background only.
  for (const l of after.layers) {
    await page.locator(`[data-layer-id="${l.id}"]`).click();
    await page.getByRole('button', { name: 'Delete photo', exact: true }).click();
  }
  await expect(page.locator('.photo-hit')).toHaveCount(0);
  await expect(page.locator('.count')).toHaveText('4/100');
});
test('uploads fill Bento by splitting, the rest wait in the tray and add back is then blocked', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await page.getByRole('button', { name: /^1:1/ }).click();
  await page.getByRole('button', { name: 'Remove a slide' }).click();
  await page.getByRole('button', { name: 'Remove a slide' }).click();
  await upload(page, 6);
  await dispatchFiles(page, 'drop', 45);
  await expect(page.locator('.count')).toHaveText('51/100');
  await expect(page.getByRole('status').filter({ hasText: 'did not fit' })).toBeVisible();
  const placed = await page.locator('.photo-hit').count();
  expect(placed).toBeGreaterThan(6);
  expect(placed).toBeLessThan(51);
  const w = (await saved(page)).workspace;
  for (const l of w.layers) expect(Math.min(l.width, l.height)).toBeGreaterThanOrEqual(120);
  // Scrapbook has no minimum, so it took every upload.
  expect(w.scrapbook.layers).toHaveLength(51);
  await page
    .getByRole('button', { name: /^Add back / })
    .first()
    .click();
  await expect(page.getByRole('alert')).toContainText('under 120px');
  await expect(page.locator('.photo-hit')).toHaveCount(placed);
});
test('spacing sliders preview live, commit once and export at full width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 4);
  const before = (await saved(page)).workspace;
  const gap = page.getByLabel('Gap', { exact: true });
  await expect(gap).toHaveValue('12');
  await expect(page.getByLabel('Outer margin', { exact: true })).toHaveValue('24');
  await expect(page.getByLabel('Roundness', { exact: true })).toHaveValue('0');
  // Input events alone preview without a history step or a save.
  await gap.evaluate((el: HTMLInputElement) => {
    for (const value of ['20', '30', '40']) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await expect(page.getByText('40px', { exact: true })).toBeVisible();
  expect((await saved(page)).workspace.bento.gap).toBe(12);
  await gap.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
  await expect.poll(async () => (await saved(page)).workspace.bento.gap).toBe(40);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).workspace).toEqual(before);
  await gap.fill('0');
  await expect.poll(async () => (await saved(page)).workspace.bento.gap).toBe(0);
  await page.getByLabel('Roundness', { exact: true }).fill('30');
  await expect.poll(async () => (await saved(page)).workspace.bento.radius).toBe(30);
  const zero = (await saved(page)).workspace;
  // Dividers stay usable with no gap to sit in.
  const handle = page.locator('.divider-handle').first();
  const label = (await handle.getAttribute('aria-label'))!;
  await drag(page, `[aria-label="${label}"]`, 30, 30);
  await expect
    .poll(async () => (await saved(page)).workspace.layers.map((l) => [l.width, l.height]))
    .not.toEqual(zero.layers.map((l) => [l.width, l.height]));
  const files = await exported(page);
  expect(files).toHaveLength(3);
  for (const f of files) expect(f.size).toEqual([1080, 1350]);
  // The editor paints the photos, not only the background.
  await expect
    .poll(() =>
      page.getByLabel('Your continuous 3-slide collage').evaluate((el) => {
        const c = el as HTMLCanvasElement;
        const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
        const colors = new Set<number>();
        for (let i = 0; i < data.length; i += 400)
          colors.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
        return colors.size;
      }),
    )
    .toBeGreaterThan(20);
  await page.screenshot({ path: 'test-results/bento-spacing.png', fullPage: true });
  const w = (await saved(page)).workspace;
  await page.reload();
  await expect(page.getByLabel('Gap', { exact: true })).toHaveValue('0');
  expect((await saved(page)).workspace).toEqual(w);
});
test('a Bento divider dragged to its limit saves, reloads and stays valid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 4);
  const before = (await saved(page)).workspace;
  const label = (await page.locator('.divider-handle').first().getAttribute('aria-label'))!;
  await drag(page, `[aria-label="${label}"]`, -5000, -5000);
  await expect
    .poll(async () => (await saved(page)).workspace.layers.map((l) => [l.width, l.height]))
    .not.toEqual(before.layers.map((l) => [l.width, l.height]));
  const w = (await saved(page)).workspace;
  expect(Math.min(...w.layers.flatMap((l) => [l.width, l.height]))).toBeCloseTo(120, 6);
  await page.reload();
  await expect(page.locator('.photo-hit')).toHaveCount(4);
  await expect(page.getByText('The collage saved on this device is unreadable.')).toHaveCount(0);
  expect((await saved(page)).workspace).toEqual(w);
});
test('the background swatch and picker set exported margin pixels in both styles', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 3);
  expect(await pixel(page, (await exported(page))[0].bytes, 5, 5)).toEqual([0xf3, 0xee, 0xe4]);
  await page.getByRole('button', { name: 'Ink background' }).click();
  await expect.poll(async () => (await saved(page)).workspace.background).toBe('#1c1a17');
  expect(await pixel(page, (await exported(page))[0].bytes, 5, 5)).toEqual([0x1c, 0x1a, 0x17]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page)).workspace.background).toBe('#f3eee4');
  await page.getByLabel('Custom background color').fill('#336699');
  await expect.poll(async () => (await saved(page)).workspace.background).toBe('#336699');
  expect(await pixel(page, (await exported(page))[0].bytes, 5, 5)).toEqual([0x33, 0x66, 0x99]);
  // Shuffle and a style switch keep the color.
  await page.getByRole('button', { name: /Shuffle layout/ }).click();
  await page.getByRole('button', { name: /Scrapbook/ }).click();
  await expect.poll(async () => (await saved(page)).workspace.background).toBe('#336699');
});
test('switching style restores each layout and new photos reach both', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 4);
  await page.getByLabel('Gap', { exact: true }).fill('30');
  await expect.poll(async () => (await saved(page)).workspace.bento.gap).toBe(30);
  await page.getByRole('button', { name: /Scrapbook/ }).click();
  const scrap = (await saved(page)).workspace;
  await drag(page, `[data-layer-id="${scrap.layers[1].id}"]`, 60, 25);
  await expect
    .poll(async () => (await saved(page)).workspace.layers[1].x)
    .not.toBe(scrap.layers[1].x);
  const moved = (await saved(page)).workspace;
  await page.getByRole('button', { name: /Bento/ }).click();
  await expect(page.getByLabel('Gap', { exact: true })).toHaveValue('30');
  const bento = (await saved(page)).workspace;
  expect(bento.bento).toEqual(moved.bento);
  expect(bento.layers).toEqual(moved.bento.layers);
  await page.getByRole('button', { name: /Scrapbook/ }).click();
  await expect.poll(async () => (await saved(page)).workspace.style).toBe('scrapbook');
  expect((await saved(page)).workspace.layers).toEqual(moved.layers);
  // A photo added here is placed in the Bento layout as well.
  await page.getByLabel('Upload photos').setInputFiles({
    name: 'late.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 200;
        return c.toDataURL().split(',')[1];
      }),
      'base64',
    ),
  });
  await expect(page.locator('.photo-hit')).toHaveCount(5);
  const both = await saved(page);
  const late = both.assets.find((a) => a.name === 'late.png')!;
  expect(both.workspace.scrapbook.layers.some((l) => l.assetId === late.id)).toBe(true);
  expect(both.workspace.bento.layers.some((l) => l.assetId === late.id)).toBe(true);
  // Removing it from the library clears both layouts, undo history and the device.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Remove late.png from library' }).click();
  await expect(page.locator('.photo-hit')).toHaveCount(4);
  await expect(page.locator('.count')).toHaveText('4/100');
  const gone = await saved(page);
  expect(gone.assets.some((a) => a.id === late.id)).toBe(false);
  expect(gone.workspace.bento.layers.some((l) => l.assetId === late.id)).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.photo-hit')).toHaveCount(4);
  const stored = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('living-carousel-v4');
        open.onsuccess = () => {
          const count = open.result.transaction('assets').objectStore('assets').count();
          count.onsuccess = () => {
            open.result.close();
            resolve(count.result);
          };
        };
      }),
  );
  expect(stored).toBe(4);
});
