<script lang="ts">
  import { onMount } from 'svelte';
  import {
    WIDTH,
    HEIGHT,
    SLIDES,
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
  import { decodeImages, paint } from './render';
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
  let stage = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let draft = $state.raw<Workspace | null>(null);
  let gesture = $state.raw<Gesture | null>(null);
  let images = $state.raw(new Map<string, ImageBitmap>());
  let zoom = $state(1);
  let pixelScale = $state(0.5);
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
      ? g.base.layers.find((l) => l.id === g.id)
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
    const crop = coverCrop(
      image.width,
      image.height,
      l.width,
      l.height,
      l.zoom,
      l.panX,
      l.panY,
    );
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
  const chosen = $derived(scene.layers.find((l) => l.id === selected));
  const borders = $derived(dividers(scene));
  const frame = (l: Layer) =>
    `left:${(l.x / (WIDTH * SLIDES)) * 100}%;top:${(l.y / HEIGHT) * 100}%;width:${(l.width / (WIDTH * SLIDES)) * 100}%;height:${(l.height / HEIGHT) * 100}%;transform:rotate(${l.rotation}deg)`;
  $effect(() => {
    let alive = true;
    let decoded = new Map<string, ImageBitmap>();
    images = new Map();
    void decodeImages({
      workspace: {
        version: 1,
        style: 'bento',
        seed: 0,
        background: '#fff',
        layers: [],
      },
      assets,
    })
      .then((result) => {
        decoded = result;
        if (alive) images = result;
        else result.forEach((image) => image.close());
      })
      .catch(onerror);
    return () => {
      alive = false;
      decoded.forEach((image) => image.close());
    };
  });
  $effect(() => {
    if (!canvas) return;
    const target = canvas;
    const current = scene;
    const sources = images;
    const scale = pixelScale;
    const frame = requestAnimationFrame(() => {
      try {
        paint(current, sources, target, scale);
      } catch (e) {
        onerror(e);
      }
    });
    return () => cancelAnimationFrame(frame);
  });
  $effect(() => {
    if (!enabled) cancel();
  });
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (stage)
        pixelScale = Math.min(
          1,
          (stage.clientWidth * devicePixelRatio) / (WIDTH * SLIDES),
        );
    });
    if (stage) observer.observe(stage);
    return () => observer.disconnect();
  });
  function point(event: PointerEvent): Point {
    const rect = stage!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH * SLIDES,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }
  function start(
    event: PointerEvent,
    kind: Gesture['kind'],
    id: string,
    corner = '',
  ) {
    if (!enabled || event.button !== 0 || gesture) return;
    event.preventDefault();
    event.stopPropagation();
    if (kind !== 'divider') selected = id;
    stage!.focus({ preventScroll: true });
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
    const l = g.base.layers.find((l) => l.id === g.id)!;
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (g.kind === 'swap') {
      dropTarget = hitLayer(g.base, p)?.id ?? '';
      return;
    }
    let changed = { ...l };
    if (g.kind === 'move') {
      changed.x = clamp(l.x + dx, 48 - l.width, WIDTH * SLIDES - 48);
      changed.y = clamp(l.y + dy, 48 - l.height, HEIGHT - 48);
    }
    if (g.kind === 'resize') changed = resizeLayer(l, p, g.corner);
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
      const image = images.get(l.assetId);
      if (!image) return;
      const crop = coverCrop(
        image.width,
        image.height,
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
            (image.width - crop.width || Infinity),
        0,
        1,
      );
      changed.panY = clamp(
        l.panY -
          ((to.y - from.y) * crop.height) /
            l.height /
            (image.height - crop.height || Infinity),
        0,
        1,
      );
    }
    draft = {
      ...g.base,
      layers: g.base.layers.map((layer) =>
        layer.id === l.id ? changed : layer,
      ),
    };
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
    if (!enabled || !chosen || scene.style !== 'scrapbook') return;
    const next = {
      ...workspace,
      layers: workspace.layers.filter((l) => l.id !== selected),
    };
    selected = '';
    cropMode = false;
    oncommit(next);
  }
  function reorder(direction: 'front' | 'back' | 'forward' | 'backward') {
    if (enabled && chosen)
      oncommit(reorderLayer(workspace, selected, direction));
  }
  function keys(event: KeyboardEvent) {
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
      const n = workspace.layers.length;
      const i = workspace.layers.findIndex((l) => l.id === selected);
      const target =
        workspace.layers[(i + (event.key === 'ArrowRight' ? 1 : n - 1)) % n].id;
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
          WIDTH * SLIDES - 48,
        ),
        y: clamp(
          chosen.y +
            (event.key === 'ArrowUp'
              ? -delta
              : event.key === 'ArrowDown'
                ? delta
                : 0),
          48 - chosen.height,
          HEIGHT - 48,
        ),
      };
      oncommit({
        ...workspace,
        layers: workspace.layers.map((l) => (l.id === selected ? next : l)),
      });
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (stage?.contains(document.activeElement)) keys(e);
  }}
/>

<div class="canvas-controls">
  <p id="canvas-instructions">
    {scene.style === 'scrapbook'
      ? 'Drag photos to move · corners to resize · top handle to rotate'
      : 'Drag a photo onto another or use arrow keys to swap · drag a divider to resize cells'}
  </p>
  <div class="view-zoom">
    <button
      aria-label="Zoom canvas out"
      disabled={zoom <= 1}
      onclick={() => (zoom = Math.max(1, zoom - 0.25))}>−</button
    ><span>{Math.round(zoom * 100)}%</span><button
      aria-label="Zoom canvas in"
      disabled={zoom >= 2.5}
      onclick={() => (zoom = Math.min(2.5, zoom + 0.25))}>+</button
    ><button onclick={() => (zoom = 1)}>Fit</button>
  </div>
</div>
<div class="selection-tools" aria-label="Selected photo actions">
  {#if chosen}
    <strong>Photo {scene.layers.indexOf(chosen) + 1}</strong>
    <button
      class:tool-active={cropMode}
      disabled={!enabled}
      aria-pressed={cropMode}
      onclick={() => (cropMode = !cropMode)}
      >{cropMode ? 'Done cropping' : 'Crop photo'}</button
    >
    {#if scene.style === 'scrapbook'}
      <button disabled={!enabled} onclick={() => reorder('forward')}
        >Bring forward</button
      ><button disabled={!enabled} onclick={() => reorder('backward')}
        >Send backward</button
      >
      <button disabled={!enabled} onclick={() => reorder('front')}
        >Bring to front</button
      ><button disabled={!enabled} onclick={() => reorder('back')}
        >Send to back</button
      >
      <button class="delete-photo" disabled={!enabled} onclick={remove}
        >Delete photo</button
      >
    {/if}
  {:else}<span>Select a photo on the canvas to edit it.</span>{/if}
</div>
{#if cropMode && chosen}<p class="crop-hint">
    Drag inside the selected photo to reframe it. Use Photo zoom below to get
    closer.
  </p>{/if}
<div class="canvas-scroller">
  <div
    class="scene-wrap interactive-scene"
    bind:this={stage}
    style:width={`${zoom * 100}%`}
    role="group"
    tabindex="-1"
    aria-label="Interactive collage canvas"
    aria-describedby="canvas-instructions"
    onpointermove={move}
    onpointerup={finish}
    onpointercancel={cancel}
    onlostpointercapture={() => {
      if (gesture) cancel();
    }}
  >
    <canvas bind:this={canvas} aria-label="Your continuous three-slide collage"
    ></canvas>
    <div class="guides" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
    <button
      class="canvas-background"
      aria-label="Clear photo selection"
      onclick={() => {
        selected = '';
        cropMode = false;
      }}
      tabindex="-1"
    ></button>
    {#each scene.layers as l, i (l.id)}
      <button
        class="photo-hit"
        class:selected={selected === l.id}
        class:drag-source={swapping && gesture?.id === l.id}
        class:drop-target={dropTarget === l.id && gesture?.id !== l.id}
        class:crop-mode={cropMode && selected === l.id}
        data-layer-id={l.id}
        style={frame(l)}
        style:z-index={i + 1}
        aria-label={`Select photo ${i + 1} on canvas`}
        aria-pressed={selected === l.id}
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
          class="divider-handle"
          class:vertical={d.axis === 'x'}
          class:horizontal={d.axis === 'y'}
          style:left={`${((d.axis === 'x' ? d.position : d.x) / (WIDTH * SLIDES)) * 100}%`}
          style:top={`${((d.axis === 'y' ? d.position : d.y) / HEIGHT) * 100}%`}
          style:width={d.axis === 'x'
            ? '12px'
            : `${(d.width / (WIDTH * SLIDES)) * 100}%`}
          style:height={d.axis === 'y'
            ? '12px'
            : `${(d.height / HEIGHT) * 100}%`}
          aria-label={`Resize ${d.axis === 'x' ? 'vertical' : 'horizontal'} divider ${d.path || 'root'}`}
          onpointerdown={(e) => start(e, 'divider', d.path)}
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
          }}><span>⋮</span></button
        >
      {/each}
    {/if}
    {#if chosen && enabled}
      <div class="selection-box" style={frame(chosen)}>
        <span class="photo-number">{scene.layers.indexOf(chosen) + 1}</span>
        {#if scene.style === 'scrapbook' && !cropMode}
          {#each ['nw', 'ne', 'sw', 'se'] as corner (corner)}<button
              class={`resize-handle ${corner}`}
              aria-label={`Resize photo ${corner}`}
              onpointerdown={(e) => start(e, 'resize', chosen.id, corner)}
            ></button>{/each}
          <span class="rotation-stem"></span><button
            class="rotation-handle"
            aria-label="Rotate photo"
            onpointerdown={(e) => start(e, 'rotate', chosen.id)}>↻</button
          >
        {/if}
      </div>
    {/if}
    {#if swapping && draggedLayer && dragClient}
      <div
        class="swap-ghost"
        class:over-target={dropTarget && dropTarget !== gesture?.id}
        style={ghostPosition()}
        aria-hidden="true"
      >
        <div class="ghost-photo">
          <canvas bind:this={ghostCanvas} data-asset-id={draggedLayer.assetId}
          ></canvas>
        </div>
        <span
          >{dropTarget && dropTarget !== gesture?.id
            ? 'Release to swap'
            : 'Drop on a photo'}</span
        >
      </div>
    {/if}
  </div>
</div>
<div class="slide-labels">
  <span>Slide 1</span><span>Slide 2</span><span>Slide 3</span>
</div>

<style>
  .canvas-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .canvas-controls p {
    font-size: 14px;
    color: #626c52;
    margin: 0;
    line-height: 1.5;
  }
  .view-zoom {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }
  .view-zoom button,
  .selection-tools button {
    border: 1px solid #cdd3bd;
    border-radius: 6px;
    background: #fffefa;
    color: #485735;
    font-size: 14px;
    min-height: 34px;
    padding: 6px 10px;
  }
  .view-zoom span {
    font-size: 14px;
    min-width: 42px;
    text-align: center;
  }
  .selection-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
    min-height: 42px;
    margin: 0 0 10px;
    font-size: 14px;
    color: #626c52;
  }
  .selection-tools strong {
    margin-right: 5px;
  }
  .selection-tools .tool-active {
    background: #727f46;
    color: white;
  }
  .selection-tools .delete-photo {
    color: #9d3828;
    border-color: #dfbcac;
  }
  .crop-hint {
    font-size: 14px;
    margin: 0 0 10px;
    color: #59663b;
  }
  .canvas-scroller {
    overflow: auto;
    padding: 40px 14px 20px;
    margin: 0 -14px;
    scrollbar-width: thin;
  }
  .interactive-scene {
    min-width: 0;
    aspect-ratio: 3240/1350;
    outline: none;
  }
  .interactive-scene:focus-visible {
    outline: 2px solid #727f46;
    outline-offset: 8px;
  }
  .interactive-scene canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .canvas-background {
    position: absolute;
    inset: 0;
    border: 0;
    background: none;
    width: 100%;
    height: 100%;
  }
  .photo-hit {
    position: absolute;
    border: 0;
    background: transparent;
    padding: 0;
    touch-action: none;
    cursor: grab;
    border-radius: 2px;
  }
  .photo-hit:active {
    cursor: grabbing;
  }
  .photo-hit:focus-visible {
    outline: 3px solid #526e2c;
    outline-offset: 2px;
  }
  .photo-hit.drop-target {
    outline: 4px solid #a8c65b;
    outline-offset: -4px;
    background: #bad67e55;
  }
  .photo-hit.crop-mode {
    cursor: move;
  }
  .selection-box {
    position: absolute;
    border: 2px solid #5f7c35;
    pointer-events: none;
    z-index: 40;
  }
  .photo-number {
    position: absolute;
    left: 2px;
    top: 2px;
    background: #506a2c;
    color: white;
    font-size: 12px;
    padding: 3px 6px;
    border-radius: 3px;
    line-height: 1.2;
  }
  .resize-handle {
    position: absolute;
    width: 14px;
    height: 14px;
    border: 2px solid #506a2c;
    border-radius: 3px;
    background: #fffefa;
    pointer-events: auto;
    touch-action: none;
    padding: 0;
  }
  .nw {
    left: -8px;
    top: -8px;
    cursor: nwse-resize;
  }
  .ne {
    right: -8px;
    top: -8px;
    cursor: nesw-resize;
  }
  .sw {
    left: -8px;
    bottom: -8px;
    cursor: nesw-resize;
  }
  .se {
    right: -8px;
    bottom: -8px;
    cursor: nwse-resize;
  }
  .rotation-stem {
    position: absolute;
    height: 23px;
    left: 50%;
    top: -25px;
    border-left: 2px solid #506a2c;
  }
  .rotation-handle {
    position: absolute;
    left: 50%;
    top: -48px;
    transform: translateX(-50%);
    width: 28px;
    height: 28px;
    border: 1px solid #506a2c;
    border-radius: 50%;
    background: #fffefa;
    color: #425b25;
    pointer-events: auto;
    touch-action: none;
    padding: 0;
    cursor: grab;
    font-size: 20px;
  }
  .divider-handle {
    position: absolute;
    z-index: 25;
    background: transparent;
    border: 0;
    padding: 0;
    touch-action: none;
  }
  .divider-handle.vertical {
    transform: translateX(-50%);
    cursor: col-resize;
  }
  .divider-handle.horizontal {
    transform: translateY(-50%);
    cursor: row-resize;
  }
  .divider-handle:before {
    content: '';
    position: absolute;
    inset: 0;
    background: #758b4244;
    opacity: 0;
  }
  .divider-handle:hover:before,
  .divider-handle:focus-visible:before {
    opacity: 1;
  }
  .divider-handle span {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: grid;
    place-items: center;
    line-height: 1;
    font-size: 20px;
    color: #425b25;
    background: #fffefa;
    border: 1px solid #abb890;
    border-radius: 4px;
    width: 16px;
    height: 28px;
    box-shadow: 0 1px 3px #0002;
  }
  .divider-handle.horizontal span {
    transform: translate(-50%, -50%) rotate(90deg);
  }
  .photo-hit.drag-source {
    background: #e5e7e4aa;
  }
  .swap-ghost {
    position: fixed;
    pointer-events: none;
    z-index: 1000;
    width: 144px;
    padding: 7px;
    border: 1px solid #adb5a5;
    background: #fafbf8;
    color: #45533a;
    border-radius: 9px;
    box-shadow: 0 8px 24px #20282035;
    transform: rotate(-4deg);
  }
  .swap-ghost.over-target {
    border-color: #6d8c3b;
  }
  .ghost-photo {
    height: 96px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #e8eae5;
    border-radius: 4px;
    overflow: hidden;
  }
  .ghost-photo canvas {
    display: block;
    opacity: 0.72;
    filter: grayscale(0.5);
  }
  .swap-ghost span {
    display: block;
    font-size: 13px;
    line-height: 1.4;
    text-align: center;
    margin-top: 6px;
  }
  @media (max-width: 900px) {
    .canvas-controls {
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .canvas-controls p {
      font-size: 14px;
    }
    .selection-tools button {
      min-height: 40px;
    }
    .view-zoom button {
      min-width: 36px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
    }
  }
</style>
