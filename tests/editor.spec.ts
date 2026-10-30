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
    return {
      workspace: project.workspace,
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
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download images/ }).click();
  const stream = await (await pending).createReadStream();
  const chunks = [];
  for await (const c of stream!) chunks.push(c);
  const files = unzipSync(Buffer.concat(chunks));
  const slides = Object.keys(files)
    .sort()
    .map((name) => Buffer.from(files[name]).toString('base64'));
  const differences = await page.evaluate(async (encoded) => {
    const storage: typeof import('../apps/web/src/lib/editor/storage') = await import(
      '/src/lib/editor/storage.ts' as string
    );
    const project = (await storage.loadProject())!;
    const path = '/src/lib/editor/render.ts';
    const renderer = await import(path);
    const wide = document.createElement('canvas');
    await renderer.draw(project, wide, 1);
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
      // Rotated resampling is not bit-exact under translation, so allow faint isolated noise.
      let mismatch = 0;
      let max = 0;
      for (let p = 0; p < actual.length; p++) {
        const d = Math.abs(actual[p] - expected[p]);
        if (d > 1) mismatch++;
        max = Math.max(max, d);
      }
      result.push(max <= 16 && mismatch < actual.length / 2000);
    }
    return result;
  }, slides);
  expect(differences).toEqual([true, true, true]);
});
test('legacy workspaces retain their photos and transforms until a new Bento template is chosen', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Upload photos')).toBeEnabled();
  await upload(page, 6);
  const original = await saved(page);
  await page.evaluate(async () => {
    const r = indexedDB.open('living-carousel-v3', 1);
    const db = await new Promise<IDBDatabase>((resolve) => (r.onsuccess = () => resolve(r.result)));
    await new Promise<void>((resolve) => {
      const tx = db.transaction('project', 'readwrite');
      const store = tx.objectStore('project');
      const get = store.get('active');
      get.onsuccess = () => {
        const p = get.result;
        delete p.workspace.bento;
        delete p.workspace.template;
        store.put(p, 'active');
      };
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByLabel('Bento template')).toHaveValue('');
  const restored = await saved(page);
  expect(restored.workspace.layers).toEqual(original.workspace.layers);
  expect(restored.assets).toEqual(original.assets);
  await page.getByLabel('Bento template').selectOption('mosaic');
  await expect(page.locator('.divider-handle')).toHaveCount(5);
  expect((await saved(page)).assets).toEqual(original.assets);
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
          const open = indexedDB.open('living-carousel-v3');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const store = open.result.transaction('project', 'readwrite').objectStore('project');
            const get = store.get('active');
            get.onsuccess = () => {
              if (change)
                store.put(
                  { ...get.result, workspace: { ...get.result.workspace, layers: [null] } },
                  'active',
                );
              resolve(get.result.workspace.layers);
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
  await expect(page.locator('output')).toHaveText('5\u00a0slides');
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
