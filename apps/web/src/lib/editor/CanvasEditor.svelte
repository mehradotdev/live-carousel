<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    WIDTH,
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
  import { paint, previewEdge, sourceRect, syncPreviews } from './render';
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
  let stageWidth = $state(0);
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
  const pixelScale = $derived(
    Math.min(
      1,
      (stageWidth * (globalThis.devicePixelRatio || 1)) / sceneWidth,
    ) || 0.5,
  );
  const toolBase =
    'btn btn-sm leading-[1.45] h-auto min-h-[34px] px-[10px] py-[6px] text-sm font-normal';
  const toolButton = `${toolBase} border-primary/30 bg-base-100 text-secondary`;
  const chosen = $derived(scene.layers.find((l) => l.id === selected));
  const borders = $derived(dividers(scene));
  // Tall formats are capped at 70vh at 100% so a single 9:16 slide never outgrows the screen.
  const stripWidth = $derived(
    `min(${zoom * 100}%, ${(zoom * 70 * sceneWidth) / sceneHeight}vh)`,
  );
  const frame = (l: Layer) =>
    `left:${(l.x / sceneWidth) * 100}%;top:${(l.y / sceneHeight) * 100}%;width:${(l.width / sceneWidth) * 100}%;height:${(l.height / sceneHeight) * 100}%;transform:rotate(${l.rotation}deg)`;
  const previews = new Map<string, Promise<ImageBitmap>>();
  $effect(() => {
    let alive = true;
    void syncPreviews(previews, assets, previewEdge())
      .then((result) => {
        if (alive) images = result;
      })
      .catch(onerror);
    return () => {
      alive = false;
    };
  });
  onMount(() => () => {
    void syncPreviews(previews, [], 0);
  });
  $effect(() => {
    if (!canvas) return;
    const target = canvas;
    const current = scene;
    const sources = images;
    const scale = pixelScale;
    const frame = requestAnimationFrame(() => {
      try {
        paint({ workspace: current, assets }, sources, target, scale);
      } catch (e) {
        onerror(e);
      }
    });
    return () => cancelAnimationFrame(frame);
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
    const observer = new ResizeObserver(() => {
      if (stage) stageWidth = stage.clientWidth;
    });
    if (stage) observer.observe(stage);
    return () => observer.disconnect();
  });
  function point(event: PointerEvent): Point {
    const rect = stage!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * sceneWidth,
      y: ((event.clientY - rect.top) / rect.height) * sceneHeight,
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

<div
  class="mb-3 flex items-center justify-between gap-3 max-[900px]:flex-wrap max-[900px]:items-start"
>
  <p id="canvas-instructions" class="text-sm leading-[1.5] text-neutral">
    {scene.style === 'scrapbook'
      ? 'Drag photos to move · corners to resize · top handle to rotate'
      : 'Drag a photo onto another or use arrow keys to swap · drag a divider to resize cells'}
  </p>
  <div class="flex shrink-0 items-center gap-[5px]">
    <button
      class={[toolButton, 'max-[900px]:min-w-9']}
      aria-label="Zoom canvas out"
      disabled={zoom <= 1}
      onclick={() => (zoom = Math.max(1, zoom - 0.25))}>−</button
    ><span class="min-w-[42px] text-center text-sm"
      >{Math.round(zoom * 100)}%</span
    ><button
      class={[toolButton, 'max-[900px]:min-w-9']}
      aria-label="Zoom canvas in"
      disabled={zoom >= 2.5}
      onclick={() => (zoom = Math.min(2.5, zoom + 0.25))}>+</button
    ><button
      class={[toolButton, 'max-[900px]:min-w-9']}
      onclick={() => (zoom = 1)}>Fit</button
    >
  </div>
</div>
<div
  class="mb-[10px] flex min-h-[42px] flex-wrap items-center gap-[7px] text-sm text-neutral"
  aria-label="Selected photo actions"
>
  {#if chosen}
    <strong class="mr-[5px]">Photo {scene.layers.indexOf(chosen) + 1}</strong>
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
      <button
        class={[
          toolBase,
          'border-error/30 bg-base-100 text-error max-[900px]:min-h-10',
        ]}
        disabled={!enabled}
        onclick={remove}>Delete photo</button
      >
    {/if}
  {:else}<span>Select a photo on the canvas to edit it.</span>{/if}
</div>
{#if cropMode && chosen}<p class="mb-[10px] text-sm text-secondary">
    Drag inside the selected photo to reframe it. Use Photo zoom below to get
    closer.
  </p>{/if}
<div
  class="-mx-[14px] overflow-auto px-[14px] pt-10 pb-5 [scrollbar-width:thin]"
>
  <div
    class="relative mx-auto min-w-0 shadow-[0_3px_20px_currentColor] shadow-base-content/8 outline-none focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-primary"
    bind:this={stage}
    style:width={stripWidth}
    style:aspect-ratio={`${sceneWidth} / ${sceneHeight}`}
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
    <canvas
      class="block size-full"
      bind:this={canvas}
      aria-label={`Your continuous ${scene.slides}-slide collage`}
    ></canvas>
    <div
      class="pointer-events-none absolute inset-0 grid"
      style:grid-template-columns={`repeat(${scene.slides}, minmax(0, 1fr))`}
      aria-hidden="true"
    >
      {#each { length: scene.slides - 1 }, i (i)}<span
          class="border-r border-dashed border-base-100/60"
        ></span>{/each}
    </div>
    <button
      class="absolute inset-0 size-full"
      aria-label="Clear photo selection"
      onclick={() => {
        selected = '';
        cropMode = false;
      }}
      tabindex="-1"
    ></button>
    {#each scene.layers as l, i (l.id)}
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
            'divider-handle absolute z-25 touch-none p-0 before:absolute before:inset-0 before:bg-primary/27 before:opacity-0 hover:before:opacity-100 focus-visible:before:opacity-100',
            d.axis === 'x'
              ? '-translate-x-1/2 cursor-col-resize'
              : '-translate-y-1/2 cursor-row-resize',
          ]}
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
        class="pointer-events-none absolute z-40 border-2 border-secondary"
        style={frame(chosen)}
      >
        <span
          class="absolute top-[2px] left-[2px] rounded-[3px] bg-secondary px-[6px] py-[3px] text-[12px] leading-[1.2] text-secondary-content"
          >{scene.layers.indexOf(chosen) + 1}</span
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
<div
  class="mx-auto mt-3 grid text-center text-sm tracking-[0.5px] text-neutral"
  style:width={stripWidth}
  style:grid-template-columns={`repeat(${scene.slides}, minmax(0, 1fr))`}
>
  {#each { length: scene.slides }, i (i)}<span
      >{scene.slides > 6 ? i + 1 : `Slide ${i + 1}`}</span
    >{/each}
</div>
