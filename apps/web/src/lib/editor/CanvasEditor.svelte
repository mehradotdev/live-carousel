<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    WIDTH,
    activeLayers,
    removeLayer,
    withLayers,
    slideSize,
    coverCrop,
    clamp,
    dividers,
    resizeDivider,
    resizeLayer,
    reorderLayer,
    hitLayer,
    localPoint,
    swapPhotos,
    type Workspace,
    type Asset,
    type Layer,
    type Point,
  } from './model';
  import {
    MIN_EDGE,
    paint,
    previewCache,
    previewEdges,
    sourceRect,
    syncPreviews,
  } from './render';
  import {
    centredSlide,
    clampView,
    fitRect,
    reveal,
    scaleBounds,
    zoomAt,
    type Rect,
    type View,
  } from './view';
  let {
    workspace,
    assets,
    selected = $bindable(''),
    enabled,
    oncommit,
    onerror,
    onundo,
    onredo,
  }: {
    workspace: Workspace;
    assets: Asset[];
    selected?: string;
    enabled: boolean;
    oncommit: (next: Workspace) => void;
    onerror: (error: unknown) => void;
    onundo: () => void;
    onredo: () => void;
  } = $props();
  type Gesture = {
    kind: 'move' | 'resize' | 'rotate' | 'swap' | 'divider' | 'crop';
    base: Workspace;
    start: Point;
    pointerId: number;
    id: string;
    corner: string;
  };
  let viewport = $state<HTMLDivElement>();
  let stage = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let draft = $state.raw<Workspace | null>(null);
  let gesture = $state.raw<Gesture | null>(null);
  let images = $state.raw(new Map<string, ImageBitmap>());
  let size = $state.raw({ width: 0, height: 0 });
  let view = $state.raw<View>({ x: 0, y: 0, scale: 0 });
  // Previews are re-sized for the view once zooming pauses, not on every frame.
  let settled = $state.raw<View>({ x: 0, y: 0, scale: 0 });
  let pan = $state.raw<{
    pointerId: number;
    x: number;
    y: number;
    view: View;
    moved: boolean;
  } | null>(null);
  let pinch: { distance: number; centre: Point; view: View } | null = null;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- pointer bookkeeping never drives rendering
  const touches = new Map<number, Point>();
  let spaceHeld = $state(false);
  let cropMode = $state(false);
  let dropTarget = $state('');
  let dragPoint = $state<Point | null>(null);
  let dragClient = $state<{ x: number; y: number; touch: boolean } | null>(
    null,
  );
  let ghostCanvas = $state<HTMLCanvasElement>();
  const draggedLayer = $derived.by(() => {
    const g = gesture;
    return g?.kind === 'swap'
      ? activeLayers(g.base).find((l) => l.id === g.id)
      : undefined;
  });
  const swapping = $derived(
    gesture?.kind === 'swap' &&
      dragPoint &&
      Math.hypot(dragPoint.x - gesture.start.x, dragPoint.y - gesture.start.y) >
        20,
  );
  function ghostPosition() {
    if (!dragClient) return '';
    const x = clamp(
      dragClient.x + (dragClient.touch ? -72 : 16),
      8,
      window.innerWidth - 152,
    );
    const y = clamp(
      dragClient.y + (dragClient.touch ? -155 : 20),
      8,
      window.innerHeight - 150,
    );
    return `left:${x}px;top:${y}px`;
  }
  $effect(() => {
    if (!ghostCanvas || !draggedLayer) return;
    const image = images.get(draggedLayer.assetId);
    if (!image) return;
    const l = draggedLayer;
    const scale = Math.min(128 / l.width, 96 / l.height);
    const width = Math.max(1, Math.round(l.width * scale));
    const height = Math.max(1, Math.round(l.height * scale));
    const dpr = window.devicePixelRatio || 1;
    ghostCanvas.width = width * dpr;
    ghostCanvas.height = height * dpr;
    ghostCanvas.style.width = `${width}px`;
    ghostCanvas.style.height = `${height}px`;
    const ctx = ghostCanvas.getContext('2d');
    if (!ctx) return;
    const asset = assets.find((a) => a.id === l.assetId);
    if (!asset) return;
    const crop = sourceRect(asset, image, l);
    ctx.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      ghostCanvas.width,
      ghostCanvas.height,
    );
  });
  const scene = $derived(draft ?? workspace);
  const sceneWidth = $derived(WIDTH * scene.slides);
  const sceneHeight = $derived(slideSize(scene.aspect).height);
  const world = $derived({ width: sceneWidth, height: sceneHeight });
  const bounds = $derived(scaleBounds(world, slideSize(scene.aspect), size));
  const current = $derived(
    view.scale ? centredSlide(view, size, scene.slides) : 0,
  );
  const toolBase =
    'btn btn-sm leading-[1.45] h-auto min-h-[34px] px-[10px] py-[6px] text-sm font-normal';
  const toolButton = `${toolBase} border-primary/30 bg-base-100 text-secondary`;
  const layers = $derived(activeLayers(scene));
  const chosen = $derived(layers.find((l) => l.id === selected));
  const borders = $derived(dividers(scene));
  const frame = (l: Layer) =>
    `left:${(l.x / sceneWidth) * 100}%;top:${(l.y / sceneHeight) * 100}%;width:${(l.width / sceneWidth) * 100}%;height:${(l.height / sceneHeight) * 100}%;transform:rotate(${l.rotation}deg)`;
  const dpr = () => globalThis.devicePixelRatio || 1;
  const device = (v: View) => ({
    x: v.x * dpr(),
    y: v.y * dpr(),
    scale: v.scale * dpr(),
  });
  const previews = previewCache();
  $effect(() => {
    const v = view;
    const timer = setTimeout(() => (settled = v), 150);
    return () => clearTimeout(timer);
  });
  const edges = $derived(
    previewEdges({ workspace, assets }, device(settled), {
      width: size.width * dpr(),
      height: size.height * dpr(),
    }),
  );
  $effect(() => {
    if (!settled.scale) return;
    let alive = true;
    const wanted = edges;
    // Photos that leave the view keep their decoded tier so panning back is instant and never re-decodes.
    // shortcut: memory grows to every photo seen at its sharpest tier (≤100 × 1440px), evict off-screen ones if phones run out.
    const kept = assets.filter(
      (a) => wanted.has(a.id) || previews.entries.has(a.id),
    );
    void syncPreviews(
      previews,
      kept,
      (a) => wanted.get(a.id) ?? previews.entries.get(a.id)?.edge ?? MIN_EDGE,
    )
      .then((result) => {
        if (alive && result) images = result;
      })
      .catch(onerror);
    return () => {
      alive = false;
    };
  });
  onMount(() => () => {
    void syncPreviews(previews, [], () => 0);
  });
  // One paint per frame, of the viewport only.
  $effect(() => {
    if (!canvas || !view.scale) return;
    const target = canvas;
    const workspace = scene;
    const sources = images;
    const at = device(view);
    const width = Math.round(size.width * dpr());
    const height = Math.round(size.height * dpr());
    const frame = requestAnimationFrame(() => {
      try {
        if (target.width !== width || target.height !== height) {
          target.width = width;
          target.height = height;
        }
        paint({ workspace, assets }, sources, target, at);
      } catch (e) {
        onerror(e);
      }
    });
    return () => cancelAnimationFrame(frame);
  });
  const slideRect = (i: number) => ({
    x: i * WIDTH,
    y: 0,
    width: WIDTH,
    height: sceneHeight,
  });
  const settle = (v: View) => (view = clampView(v, world, size, bounds));
  // Gestures hold a start point in world or screen space, so navigation waits until they end.
  const busy = () => !!(gesture || pan || pinch);
  const fit = () => busy() || settle(fitRect({ x: 0, y: 0, ...world }, size));
  const showSlide = (i: number) =>
    busy() || settle(fitRect(slideRect(i), size));
  function zoomTo(
    scale: number,
    at = { x: size.width / 2, y: size.height / 2 },
  ) {
    if (!busy()) settle(zoomAt(view, at, clamp(scale, bounds.min, bounds.max)));
  }
  // overflow-clip never scrolls, so keyboard focus pans the view to what it lands on.
  function show(event: FocusEvent, rect: Rect) {
    if (!busy() && (event.currentTarget as Element).matches(':focus-visible'))
      settle(reveal(view, rect, size));
  }
  // First measure picks the default view (one readable slide on phones, the whole strip otherwise); later size or format changes only re-clamp.
  $effect(() => {
    void world;
    if (!size.width) return;
    untrack(() => {
      if (view.scale) settle(view);
      else if (size.width < 640) showSlide(0);
      else fit();
    });
  });
  $effect(() => {
    if (!enabled) cancel();
  });
  // An outside change (format, slide count, sidebar edit) makes the gesture's base stale.
  $effect(() => {
    void workspace;
    untrack(cancel);
  });
  onMount(() => {
    const el = viewport!;
    const observer = new ResizeObserver(() => {
      size = { width: el.clientWidth, height: el.clientHeight };
    });
    observer.observe(el);
    // Non-passive so zoom and pan can claim the wheel; see wheel() for when it falls through to the page.
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  });
  function local(event: { clientX: number; clientY: number }): Point {
    const rect = viewport!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  // The single screen → world conversion used by every gesture.
  function point(event: PointerEvent): Point {
    const p = local(event);
    return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
  }
  // Ctrl/cmd + wheel (and trackpad pinch) zooms at the cursor. Plain wheel pans only while its dominant axis can still move,
  // so page scroll is never trapped at the strip's edge or when nothing overflows.
  function wheel(event: WheelEvent) {
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    let dx = event.deltaX * unit;
    let dy = event.deltaY * unit;
    if (busy()) {
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomTo(view.scale * Math.exp(-clamp(dy, -25, 25) / 100), local(event));
      return;
    }
    if (event.shiftKey && !dx) [dx, dy] = [dy, 0];
    const next = clampView(
      { ...view, x: view.x - dx, y: view.y - dy },
      world,
      size,
      bounds,
    );
    if (Math.abs(dy) > Math.abs(dx) ? next.y === view.y : next.x === view.x)
      return;
    event.preventDefault();
    view = next;
  }
  // Capture phase: sees every touch, so a second finger turns any gesture into a pinch.
  function track(event: PointerEvent) {
    if (event.pointerType !== 'touch') return;
    touches.set(event.pointerId, local(event));
    if (touches.size !== 2) return;
    cancel();
    pan = null;
    // Both fingers report to the viewport even if they leave it, so neither lingers in `touches`.
    for (const id of touches.keys()) viewport!.setPointerCapture(id);
    const [a, b] = [...touches.values()];
    pinch = {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view,
    };
  }
  // Bubble phase: only reached when no photo, divider or handle took the pointer (or space is held).
  function grab(event: PointerEvent) {
    if (pinch || gesture || pan || event.button > 1) return;
    event.preventDefault();
    viewport!.focus({ preventScroll: true });
    viewport!.setPointerCapture(event.pointerId);
    pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      view,
      moved: false,
    };
  }
  function drag(event: PointerEvent) {
    if (touches.has(event.pointerId))
      touches.set(event.pointerId, local(event));
    if (pinch && touches.has(event.pointerId)) {
      const [a, b] = [...touches.values()];
      const p = pinch;
      const scale = clamp(
        (p.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / p.distance,
        bounds.min,
        bounds.max,
      );
      const f = scale / p.view.scale;
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      settle({
        scale,
        x: x - (p.centre.x - p.view.x) * f,
        y: y - (p.centre.y - p.view.y) * f,
      });
      return;
    }
    if (pan?.pointerId === event.pointerId) {
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      if (Math.hypot(dx, dy) > 3) pan = { ...pan, moved: true };
      settle({ ...pan.view, x: pan.view.x + dx, y: pan.view.y + dy });
      return;
    }
    move(event);
  }
  function release(event: PointerEvent) {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = null;
    if (pan?.pointerId === event.pointerId) {
      // A tap on empty space clears the selection.
      if (!pan.moved && event.type === 'pointerup') {
        selected = '';
        cropMode = false;
      }
      pan = null;
      return;
    }
    if (event.type === 'pointerup') finish(event);
    else cancel();
  }
  function start(
    event: PointerEvent,
    kind: Gesture['kind'],
    id: string,
    corner = '',
  ) {
    if (!enabled || event.button !== 0 || gesture || pinch || spaceHeld) return;
    event.preventDefault();
    event.stopPropagation();
    if (kind !== 'divider') selected = id;
    viewport!.focus({ preventScroll: true });
    stage!.setPointerCapture(event.pointerId);
    gesture = {
      kind,
      id,
      corner,
      pointerId: event.pointerId,
      base: structuredClone($state.snapshot(workspace)),
      start: point(event),
    };
    dragPoint = point(event);
    dragClient = {
      x: event.clientX,
      y: event.clientY,
      touch: event.pointerType === 'touch',
    };
    dropTarget = '';
  }
  function move(event: PointerEvent) {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId || !enabled) return;
    const p = point(event);
    dragPoint = p;
    dragClient = {
      x: event.clientX,
      y: event.clientY,
      touch: event.pointerType === 'touch',
    };
    if (g.kind === 'divider') {
      const d = dividers(g.base).find((d) => d.path === g.id)!;
      draft = resizeDivider(g.base, g.id, p[d.axis]);
      return;
    }
    const l = activeLayers(g.base).find((l) => l.id === g.id)!;
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (g.kind === 'swap') {
      dropTarget = hitLayer(g.base, p)?.id ?? '';
      return;
    }
    let changed = { ...l };
    if (g.kind === 'move') {
      changed.x = clamp(l.x + dx, 48 - l.width, sceneWidth - 48);
      changed.y = clamp(l.y + dy, 48 - l.height, sceneHeight - 48);
    }
    if (g.kind === 'resize')
      changed = resizeLayer(l, p, g.corner, {
        width: sceneWidth,
        height: sceneHeight,
      });
    if (g.kind === 'rotate') {
      const center = { x: l.x + l.width / 2, y: l.y + l.height / 2 };
      const angle =
        Math.atan2(p.y - center.y, p.x - center.x) -
        Math.atan2(g.start.y - center.y, g.start.x - center.x);
      const degrees = l.rotation + (angle * 180) / Math.PI;
      changed.rotation = event.shiftKey
        ? Math.round(degrees / 15) * 15
        : Math.round(degrees);
    }
    if (g.kind === 'crop') {
      const asset = assets.find((a) => a.id === l.assetId);
      if (!asset) return;
      const crop = coverCrop(
        asset.width,
        asset.height,
        l.width,
        l.height,
        l.zoom,
        l.panX,
        l.panY,
      );
      const from = localPoint(l, g.start);
      const to = localPoint(l, p);
      changed.panX = clamp(
        l.panX -
          ((to.x - from.x) * crop.width) /
            l.width /
            (asset.width - crop.width || Infinity),
        0,
        1,
      );
      changed.panY = clamp(
        l.panY -
          ((to.y - from.y) * crop.height) /
            l.height /
            (asset.height - crop.height || Infinity),
        0,
        1,
      );
    }
    draft = withLayers(
      g.base,
      activeLayers(g.base).map((layer) =>
        layer.id === l.id ? changed : layer,
      ),
    );
  }
  function finish(event: PointerEvent) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    let next = draft;
    if (g.kind === 'swap' && dropTarget && dropTarget !== g.id)
      next = swapPhotos(g.base, g.id, dropTarget);
    if (enabled && next && JSON.stringify(next) !== JSON.stringify(g.base))
      oncommit(next);
    cancel();
  }
  function cancel() {
    if (gesture && stage?.hasPointerCapture(gesture.pointerId))
      stage.releasePointerCapture(gesture.pointerId);
    gesture = null;
    draft = null;
    dropTarget = '';
    dragPoint = null;
    dragClient = null;
  }
  function remove() {
    if (!enabled || !chosen) return;
    const next = removeLayer(workspace, selected);
    selected = '';
    cropMode = false;
    oncommit(next);
    // The focused photo or button is gone; keep the keyboard on the canvas.
    viewport?.focus({ preventScroll: true });
  }
  function reorder(direction: 'front' | 'back' | 'forward' | 'backward') {
    if (enabled && chosen)
      oncommit(reorderLayer(workspace, selected, direction));
  }
  function keys(event: KeyboardEvent) {
    if (event.key === ' ' && event.target === viewport) {
      event.preventDefault();
      spaceHeld = true;
      return;
    }
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !(event.target instanceof HTMLInputElement) &&
      ['+', '=', '-', '0'].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key === '0') fit();
      else zoomTo(view.scale * (event.key === '-' ? 0.8 : 1.25));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      cropMode = false;
      return;
    }
    if (!enabled || event.target instanceof HTMLInputElement) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (!gesture) (event.shiftKey ? onredo : onundo)();
      return;
    }
    if (gesture || !chosen) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove();
    }
    if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      scene.style === 'bento'
    ) {
      event.preventDefault();
      const cells = activeLayers(workspace);
      const n = cells.length;
      const i = cells.findIndex((l) => l.id === selected);
      const target =
        cells[(i + (event.key === 'ArrowRight' ? 1 : n - 1)) % n].id;
      // Swaps move photos between fixed slots, so follow the photo into its new slot.
      oncommit(swapPhotos(workspace, selected, target));
      selected = target;
      return;
    }
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
      scene.style === 'scrapbook'
    ) {
      event.preventDefault();
      const delta = event.shiftKey ? 10 : 1;
      const next = {
        ...chosen,
        x: clamp(
          chosen.x +
            (event.key === 'ArrowLeft'
              ? -delta
              : event.key === 'ArrowRight'
                ? delta
                : 0),
          48 - chosen.width,
          sceneWidth - 48,
        ),
        y: clamp(
          chosen.y +
            (event.key === 'ArrowUp'
              ? -delta
              : event.key === 'ArrowDown'
                ? delta
                : 0),
          48 - chosen.height,
          sceneHeight - 48,
        ),
      };
      oncommit(
        withLayers(
          workspace,
          activeLayers(workspace).map((l) => (l.id === selected ? next : l)),
        ),
      );
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (viewport?.contains(document.activeElement)) keys(e);
  }}
  onkeyup={(e) => {
    if (e.key === ' ') spaceHeld = false;
  }}
  onblur={() => (spaceHeld = false)}
/>

<div
  class="mb-3 flex items-center justify-between gap-3 max-[900px]:flex-wrap max-[900px]:items-start"
>
  <p id="canvas-instructions" class="text-sm leading-[1.5] text-neutral">
    {scene.style === 'scrapbook'
      ? 'Drag photos to move · corners to resize · top handle to rotate'
      : 'Drag a photo onto another or use arrow keys to swap · drag a divider to resize cells'}
    · Pinch or ctrl + scroll to zoom, drag empty space to pan.
  </p>
  <div class="flex shrink-0 items-center gap-[5px]">
    <button
      class={[toolButton, 'max-[900px]:min-w-9']}
      aria-label="Zoom canvas out"
      disabled={view.scale <= bounds.min * 1.001}
      onclick={() => zoomTo(view.scale * 0.8)}>−</button
    ><output class="min-w-[42px] text-center text-sm" aria-label="Canvas zoom"
      >{Math.round(view.scale * 100)}%</output
    ><button
      class={[toolButton, 'max-[900px]:min-w-9']}
      aria-label="Zoom canvas in"
      disabled={view.scale >= bounds.max * 0.999}
      onclick={() => zoomTo(view.scale * 1.25)}>+</button
    ><button class={[toolButton, 'max-[900px]:min-w-9']} onclick={fit}
      >Fit</button
    >
  </div>
</div>
<div
  class="mb-[10px] flex min-h-[42px] flex-wrap items-center gap-[7px] text-sm text-neutral"
  aria-label="Selected photo actions"
>
  {#if chosen}
    <strong class="mr-[5px]">Photo {layers.indexOf(chosen) + 1}</strong>
    <button
      class={[
        'max-[900px]:min-h-10',
        cropMode
          ? `${toolBase} border-primary/30 bg-primary text-primary-content`
          : toolButton,
      ]}
      disabled={!enabled}
      aria-pressed={cropMode}
      onclick={() => (cropMode = !cropMode)}
      >{cropMode ? 'Done cropping' : 'Crop photo'}</button
    >
    {#if scene.style === 'scrapbook'}
      <button
        class={[toolButton, 'max-[900px]:min-h-10']}
        disabled={!enabled}
        onclick={() => reorder('forward')}>Bring forward</button
      ><button
        class={[toolButton, 'max-[900px]:min-h-10']}
        disabled={!enabled}
        onclick={() => reorder('backward')}>Send backward</button
      >
      <button
        class={[toolButton, 'max-[900px]:min-h-10']}
        disabled={!enabled}
        onclick={() => reorder('front')}>Bring to front</button
      ><button
        class={[toolButton, 'max-[900px]:min-h-10']}
        disabled={!enabled}
        onclick={() => reorder('back')}>Send to back</button
      >
    {/if}
    <button
      class={[
        toolBase,
        'border-error/30 bg-base-100 text-error max-[900px]:min-h-10',
      ]}
      disabled={!enabled}
      onclick={remove}>Delete photo</button
    >
  {:else}<span>Select a photo on the canvas to edit it.</span>{/if}
</div>
{#if cropMode && chosen}<p class="mb-[10px] text-sm text-secondary">
    Drag inside the selected photo to reframe it. Use Photo zoom below to get
    closer.
  </p>{/if}
<div
  class={[
    'relative max-h-[70svh] min-h-[280px] w-full touch-none overflow-clip rounded-[6px] bg-base-content/12 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
    pan?.moved ? 'cursor-grabbing' : spaceHeld && 'cursor-grab',
  ]}
  bind:this={viewport}
  style:aspect-ratio={`${WIDTH} / ${sceneHeight}`}
  role="group"
  tabindex="-1"
  aria-label="Interactive collage canvas"
  aria-describedby="canvas-instructions"
  onpointerdowncapture={track}
  onpointerdown={grab}
  onpointermove={drag}
  onpointerup={release}
  onpointercancel={release}
  onlostpointercapture={(e) => {
    if (e.target !== viewport) return;
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (pan?.pointerId === e.pointerId) pan = null;
  }}
>
  <canvas
    class="absolute inset-0 block size-full"
    bind:this={canvas}
    aria-label={`Your continuous ${scene.slides}-slide collage`}
  ></canvas>
  <div
    class="absolute top-0 left-0 shadow-[0_3px_20px_currentColor] shadow-base-content/8"
    bind:this={stage}
    style:left={`${view.x}px`}
    style:top={`${view.y}px`}
    style:width={`${sceneWidth * view.scale}px`}
    style:height={`${sceneHeight * view.scale}px`}
    onlostpointercapture={() => {
      if (gesture) cancel();
    }}
  >
    <div
      class="pointer-events-none absolute inset-0 grid"
      style:grid-template-columns={`repeat(${scene.slides}, minmax(0, 1fr))`}
      aria-hidden="true"
    >
      {#each { length: scene.slides - 1 }, i (i)}<span
          class="border-r border-dashed border-base-100/60"
        ></span>{/each}
    </div>
    {#each layers as l, i (l.id)}
      <button
        class={[
          'photo-hit absolute touch-none rounded-[2px] p-0 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-secondary',
          cropMode && selected === l.id
            ? 'cursor-move'
            : 'cursor-grab active:cursor-grabbing',
          swapping && gesture?.id === l.id && 'drag-source bg-base-300/67',
          dropTarget === l.id &&
            gesture?.id !== l.id &&
            'drop-target bg-accent/33 outline-4 -outline-offset-4 outline-accent',
        ]}
        data-layer-id={l.id}
        style={frame(l)}
        style:z-index={i + 1}
        aria-label={`Select photo ${i + 1} on canvas`}
        aria-pressed={selected === l.id}
        onfocus={(e) => show(e, l)}
        onpointerdown={(e) =>
          start(
            e,
            cropMode && selected === l.id
              ? 'crop'
              : scene.style === 'scrapbook'
                ? 'move'
                : 'swap',
            l.id,
          )}
        onclick={() => (selected = l.id)}
        ondblclick={() => {
          selected = l.id;
          cropMode = true;
        }}
      ></button>
    {/each}
    {#if enabled && scene.style === 'bento'}
      {#each borders as d (d.path)}
        <button
          class={[
            'divider-handle absolute touch-none p-0 before:absolute before:inset-0 before:bg-primary/27 before:opacity-0 hover:before:opacity-100 focus-visible:before:opacity-100',
            d.axis === 'x'
              ? '-translate-x-1/2 cursor-col-resize'
              : '-translate-y-1/2 cursor-row-resize',
          ]}
          style:z-index={layers.length + 1}
          style:left={`${((d.axis === 'x' ? d.position : d.x) / sceneWidth) * 100}%`}
          style:top={`${((d.axis === 'y' ? d.position : d.y) / sceneHeight) * 100}%`}
          style:width={d.axis === 'x'
            ? '12px'
            : `${(d.width / sceneWidth) * 100}%`}
          style:height={d.axis === 'y'
            ? '12px'
            : `${(d.height / sceneHeight) * 100}%`}
          aria-label={`Resize ${d.axis === 'x' ? 'vertical' : 'horizontal'} divider ${d.path || 'root'}`}
          onpointerdown={(e) => start(e, 'divider', d.path)}
          onfocus={(e) =>
            show(
              e,
              d.axis === 'x'
                ? { x: d.position, y: d.y, width: 0, height: d.height }
                : { x: d.x, y: d.position, width: d.width, height: 0 },
            )}
          onkeydown={(e) => {
            if (
              ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              e.stopPropagation();
              oncommit(
                resizeDivider(
                  workspace,
                  d.path,
                  d.position +
                    (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -20 : 20),
                ),
              );
            }
          }}
          ><span
            class={[
              'absolute top-1/2 left-1/2 grid h-7 w-4 -translate-1/2 place-items-center rounded-[4px] border border-primary/50 bg-base-100 text-[20px] leading-none text-secondary shadow-[0_1px_3px_currentColor] shadow-base-content/15',
              d.axis === 'y' && 'rotate-90',
            ]}>⋮</span
          ></button
        >
      {/each}
    {/if}
    {#if chosen && enabled}
      <div
        class="pointer-events-none absolute border-2 border-secondary"
        style={frame(chosen)}
        style:z-index={layers.length + 2}
      >
        <span
          class="absolute top-[2px] left-[2px] rounded-[3px] bg-secondary px-[6px] py-[3px] text-[12px] leading-[1.2] text-secondary-content"
          >{layers.indexOf(chosen) + 1}</span
        >
        {#if scene.style === 'scrapbook' && !cropMode}
          {#each ['nw', 'ne', 'sw', 'se'] as corner (corner)}<button
              class={[
                'pointer-events-auto absolute size-[14px] touch-none rounded-[3px] border-2 border-secondary bg-base-100 p-0',
                {
                  nw: '-top-2 -left-2 cursor-nwse-resize',
                  ne: '-top-2 -right-2 cursor-nesw-resize',
                  sw: '-bottom-2 -left-2 cursor-nesw-resize',
                  se: '-right-2 -bottom-2 cursor-nwse-resize',
                }[corner],
              ]}
              aria-label={`Resize photo ${corner}`}
              onpointerdown={(e) => start(e, 'resize', chosen.id, corner)}
            ></button>{/each}
          <span
            class="absolute -top-[25px] left-1/2 h-[23px] border-l-2 border-secondary"
          ></span><button
            class="pointer-events-auto absolute -top-12 left-1/2 size-7 -translate-x-1/2 cursor-grab touch-none rounded-full border border-secondary bg-base-100 p-0 text-[20px] text-secondary"
            aria-label="Rotate photo"
            onpointerdown={(e) => start(e, 'rotate', chosen.id)}>↻</button
          >
        {/if}
      </div>
    {/if}
    {#if swapping && draggedLayer && dragClient}
      <div
        class={[
          'swap-ghost pointer-events-none fixed z-1000 w-36 -rotate-4 rounded-[9px] border bg-base-100 p-[7px] text-secondary shadow-[0_8px_24px_currentColor] shadow-base-content/20',
          dropTarget && dropTarget !== gesture?.id
            ? 'border-success'
            : 'border-base-content/30',
        ]}
        style={ghostPosition()}
        aria-hidden="true"
      >
        <div
          class="flex h-24 items-center justify-center overflow-hidden rounded-[4px] bg-base-300"
        >
          <canvas
            class="block opacity-72 grayscale-50"
            bind:this={ghostCanvas}
            data-asset-id={draggedLayer.assetId}
          ></canvas>
        </div>
        <span class="mt-[6px] block text-center text-[13px] leading-[1.4]"
          >{dropTarget && dropTarget !== gesture?.id
            ? 'Release to swap'
            : 'Drop on a photo'}</span
        >
      </div>
    {/if}
  </div>
</div>
<nav
  class="mx-auto mt-3 flex w-fit max-w-full gap-[5px] overflow-x-auto pb-1 [scrollbar-width:thin]"
  aria-label="Slides"
>
  {#each { length: scene.slides }, i (i)}<button
      class={[
        toolBase,
        'min-w-10 shrink-0',
        current === i
          ? 'border-primary bg-primary text-primary-content'
          : 'border-primary/30 bg-base-100 text-secondary',
      ]}
      aria-label={`Show slide ${i + 1}`}
      aria-current={current === i ? 'true' : undefined}
      onclick={() => showSlide(i)}>{i + 1}</button
    >{/each}
</nav>
