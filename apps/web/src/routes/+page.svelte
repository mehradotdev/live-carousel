<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import {
    layout,
    TEMPLATES,
    clamp,
    type Template,
    WIDTH,
    HEIGHT,
    type Asset,
    type Workspace,
    type Project,
    type Style,
  } from '#lib/editor/model.ts';
  import { exportSlides, download, backup } from '#lib/editor/render.ts';
  import { ingest, loadProject, saveProject } from '#lib/editor/storage.ts';
  import './editor.css';
  import CanvasEditor from '#lib/editor/CanvasEditor.svelte';
  import AuthPanel from '#lib/AuthPanel.svelte';
  import { PUBLIC_CONVEX_URL } from '$app/env/public';
  let assets = $state<Asset[]>([]);
  let workspace = $state<Workspace | null>(null);
  let style = $state<Style>('bento');
  let selected = $state('');
  let urls = $state<Record<string, string>>({});
  let history = $state<Workspace[]>([]);
  let future = $state<Workspace[]>([]);
  let input: HTMLInputElement;
  let ready = $state(false);
  let editing = $state(false);
  let busy = $state(false);
  let error = $state('');
  let status = $state('Saved on this device');
  let notice = $state('');
  let showMotion = $state(false);
  let dragOver = $state(false);
  let format = $state<'png' | 'jpeg'>('png');
  let channel: BroadcastChannel | undefined;
  let release: (() => void) | undefined;
  let saveQueue = Promise.resolve();
  let saveTimer: ReturnType<typeof setTimeout>;
  const layer = $derived(workspace?.layers.find((l) => l.id === selected));
  const canUndo = $derived(history.length > 0);
  const canRedo = $derived(future.length > 0);
  function project(): Project {
    return {
      workspace: $state.snapshot(workspace!),
      assets: $state.snapshot(assets),
    };
  }
  function fail(e: unknown) {
    error =
      e instanceof Error
        ? e.message
        : 'Something went wrong. Please try again.';
  }
  function persist() {
    if (!ready || !editing) return saveQueue;
    clearTimeout(saveTimer);
    status = 'Saving…';
    const snapshot = workspace ? project() : null;
    saveQueue = saveQueue
      .then(() => saveProject(snapshot))
      .then(() => {
        status = 'Saved on this device';
      })
      .catch(() => {
        status = 'Storage error · download a backup';
        error =
          'Browser storage is unavailable or full. Your current collage still works; download it before closing this tab.';
      });
    return saveQueue;
  }
  function scheduleSave() {
    status = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 350);
  }
  async function restore() {
    const saved = await loadProject();
    if (saved?.workspace.version === 1) {
      workspace = saved.workspace;
      assets = saved.assets;
      style = saved.workspace.style;
      selected = saved.workspace.layers[0]?.id ?? '';
    } else {
      workspace = null;
      assets = [];
    }
    history = [];
    future = [];
  }
  async function acquire() {
    if (!navigator.locks) {
      error =
        'This browser does not support safe workspace locking. Open this app in a current Chrome, Edge or Safari browser to edit.';
      ready = true;
      return;
    }
    await navigator.locks.request(
      'living-carousel-editor',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          ready = true;
          return;
        }
        try {
          await restore();
        } catch (e) {
          fail(e);
        }
        editing = true;
        ready = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        editing = false;
        release = undefined;
      },
    );
  }
  async function takeover() {
    channel?.postMessage('release');
    setTimeout(() => {
      void acquire();
    }, 300);
  }
  onMount(() => {
    channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('living-carousel')
        : undefined;
    if (channel)
      channel.onmessage = async (e) => {
        if (e.data === 'release' && editing) {
          await persist();
          editing = false;
          release?.();
          channel?.postMessage('released');
        } else if (e.data === 'released' && !editing) {
          void acquire();
        }
      };
    void acquire();
    const params = new URLSearchParams(location.search);
    if (params.has('signed_in')) {
      showMotion = true;
      notice = 'Your local collage is still on this device.';
    }
    if (params.has('sign_in_error') || params.has('error')) {
      showMotion = true;
      error =
        'That sign-in link is invalid or expired. Request a new link below.';
    }
    const flush = () => {
      if (document.visibilityState === 'hidden') void persist();
    };
    const pageHide = () => {
      void persist();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', pageHide);
    return () => {
      clearTimeout(saveTimer);
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', pageHide);
      release?.();
      channel?.close();
      Object.values(urls).forEach(URL.revokeObjectURL);
    };
  });
  $effect(() => {
    const current = assets;
    const next: Record<string, string> = {};
    for (const a of current) next[a.id] = URL.createObjectURL(a.blob);
    urls = next;
    return () => Object.values(next).forEach(URL.revokeObjectURL);
  });
  function remember() {
    if (workspace)
      history = [
        ...history.slice(-39),
        structuredClone($state.snapshot(workspace)),
      ];
    future = [];
  }
  function update(
    key: 'zoom' | 'panX' | 'panY' | 'rotation' | 'x' | 'y' | 'width' | 'height',
    value: number,
  ) {
    if (!editing || !layer || !Number.isFinite(value)) return;
    if (key === 'width') value = clamp(value, 80, WIDTH * 3);
    if (key === 'height') value = clamp(value, 80, HEIGHT * 2);
    if (key === 'zoom') value = clamp(value, 1, 3);
    if (key === 'panX' || key === 'panY') value = clamp(value, 0, 1);
    if (key === 'rotation') value = clamp(value, -360, 360);
    if (key === 'x') value = clamp(value, 48 - layer.width, WIDTH * 3 - 48);
    if (key === 'y') value = clamp(value, 48 - layer.height, HEIGHT - 48);
    remember();
    workspace = {
      ...workspace!,
      layers: workspace!.layers.map((l) =>
        l.id === selected ? { ...l, [key]: value } : l,
      ),
    };
    scheduleSave();
  }
  function commit(next: Workspace) {
    if (!editing || busy) return;
    remember();
    workspace = next;
    scheduleSave();
  }
  function placedAssets() {
    return workspace
      ? workspace.layers
          .map((l) => assets.find((a) => a.id === l.assetId)!)
          .filter(Boolean)
      : assets;
  }
  function changeStyle(value: Style) {
    if (!editing || busy || value === style) return;
    style = value;
    if (workspace) {
      const placed = placedAssets();
      if (placed.length) commit(layout(placed, value, workspace.seed));
      else commit({ ...workspace, style: value, bento: undefined });
    }
  }
  function chooseTemplate(template: Template) {
    if (!workspace || !editing || busy) return;
    const placed = placedAssets();
    if (placed.length)
      commit(layout(placed, 'bento', workspace.seed, template));
  }
  function insertAsset(assetId: string) {
    if (!editing || busy) return;
    const existing = workspace?.layers.find((l) => l.assetId === assetId);
    if (existing) {
      selected = existing.id;
      return;
    }
    if (!workspace) return;
    const asset = assets.find((a) => a.id === assetId)!;
    if (style === 'scrapbook') {
      const next = layout(
        [asset],
        'scrapbook',
        workspace.seed + workspace.layers.length,
      ).layers[0];
      next.id = crypto.randomUUID();
      next.x = WIDTH * 1.5 - next.width / 2;
      next.y = HEIGHT / 2 - next.height / 2;
      commit({ ...workspace, layers: [...workspace.layers, next] });
      selected = next.id;
    } else
      commit(
        layout(
          [...placedAssets(), asset],
          style,
          workspace.seed,
          workspace.template,
        ),
      );
  }
  async function add(files: FileList | File[]) {
    if (!editing || busy) return;
    busy = true;
    error = '';
    try {
      const added = await ingest(files, assets.length);
      assets = [...assets, ...added];
      if (workspace && style === 'scrapbook') {
        remember();
        const additions = layout(
          added,
          'scrapbook',
          workspace.seed + assets.length,
        ).layers.map((l) => ({ ...l, id: crypto.randomUUID() }));
        workspace = {
          ...workspace,
          layers: [...workspace.layers, ...additions],
        };
        selected = additions[0]?.id ?? selected;
        await persist();
      } else if (assets.length >= 3) {
        remember();
        workspace = layout(
          workspace ? [...placedAssets(), ...added] : assets,
          style,
          workspace?.seed ?? 0,
          workspace?.template,
        );
        selected = workspace.layers[0].id;
        await persist();
      } else {
        status = `Add ${3 - assets.length} more photos to create and save`;
      }
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }
  function shuffle() {
    if (!workspace || !editing) return;
    remember();
    const placed = placedAssets();
    workspace = placed.length
      ? layout(placed, style, workspace.seed + 1)
      : workspace;
    scheduleSave();
  }
  function undo() {
    if (!editing || !workspace || !history.length) return;
    future = [structuredClone($state.snapshot(workspace)), ...future];
    workspace = history[history.length - 1];
    history = history.slice(0, -1);
    style = workspace.style;
    scheduleSave();
  }
  function redo() {
    if (!editing || !workspace || !future.length) return;
    history = [...history, structuredClone($state.snapshot(workspace))];
    workspace = future[0];
    future = future.slice(1);
    style = workspace.style;
    scheduleSave();
  }
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  const images = (files: FileList) =>
    [...files].filter((f) => f.type.startsWith('image/'));
  function pageDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const allowed = editing && !busy;
    e.dataTransfer!.dropEffect = allowed ? 'copy' : 'none';
    dragOver = allowed;
  }
  function pageDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    // Without this the browser navigates to the dropped file and leaves the editor.
    e.preventDefault();
    dragOver = false;
    const files = images(e.dataTransfer!.files);
    if (files.length) void add(files);
  }
  function pagePaste(e: ClipboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, [contenteditable]')) return;
    const files = e.clipboardData ? images(e.clipboardData.files) : [];
    if (!files.length) return;
    e.preventDefault();
    void add(files);
  }
  async function reset() {
    if (
      !editing ||
      busy ||
      !confirm(
        'Start a new collage? Download your images or project backup first. This replaces the workspace saved on this device.',
      )
    )
      return;
    workspace = null;
    assets = [];
    history = [];
    future = [];
    selected = '';
    error = '';
    await persist();
  }
  async function exportImages() {
    if (!workspace || busy) return;
    busy = true;
    error = '';
    try {
      download(await exportSlides(project(), format), 'living-carousel.zip');
      notice = 'Your three slides are ready in the ZIP download.';
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  async function exportBackup() {
    if (!workspace || busy) return;
    busy = true;
    try {
      download(await backup(project()), 'living-carousel-project.zip');
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window
  ondragover={pageDragOver}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragOver = false;
  }}
  ondrop={pageDrop}
  onpaste={pagePaste}
/>

<svelte:head
  ><title>Living Carousel — Make a little more of your memories</title><meta
    name="description"
    content="Create a continuous photo carousel. Free collage editing, private local saves, and high-resolution image downloads."
  /></svelte:head
>

<header class="topbar">
  <a class="brand" href={resolve('/')} aria-label="Living Carousel home"
    ><span class="brand-mark">lc<span>✳</span></span>living<span
      class="brand-light">carousel</span
    ></a
  >
  <div class="header-right">
    <span class="private-pill"
      ><span class="dot"></span> Private by default</span
    ><a class="about-link" href="#how-it-works">How it works ↗</a>
  </div>
</header>
<main>
  <section class="intro">
    <div>
      <p class="eyebrow">A FEW PHOTOS. ONE GOOD STORY.</p>
      <h1>Some moments deserve<br />a little <em>more space.</em></h1>
      <p class="intro-copy">
        Turn your camera roll into a carousel that flows.<br />Make it yours.
        Keep the memories connected.
      </p>
    </div>
    <div class="intro-note">
      <span class="hand-drawn">3 slides,<br />one continuous story</span><span
        class="note-arrow">↙</span
      >
    </div>
  </section>
  {#if error}<div class="message error" role="alert">
      {error}<button aria-label="Dismiss error" onclick={() => (error = '')}
        >×</button
      >
    </div>{/if}
  {#if notice}<div class="message" role="status">
      {notice}<button
        aria-label="Dismiss notification"
        onclick={() => (notice = '')}>×</button
      >
    </div>{/if}
  {#if ready && !editing}<div class="message">
      This workspace is open in another tab, or editing is unavailable.<button
        class="text-button"
        onclick={takeover}>Edit here</button
      >
    </div>{/if}
  <div class="studio">
    <aside class="sidebar">
      <div class="step-heading">
        <span class="step">01</span>
        <h2>Set the mood</h2>
      </div>
      <p class="control-label">LAYOUT STYLE</p>
      <div class="style-options">
        <button
          class:active={style === 'bento'}
          disabled={!editing || busy}
          onclick={() => changeStyle('bento')}
          ><span class="bento-icon">▦</span><span
            >Bento<small>Neat & connected</small></span
          >{#if style === 'bento'}<span class="check">✓</span>{/if}</button
        >
        <button
          class:active={style === 'scrapbook'}
          disabled={!editing || busy}
          onclick={() => changeStyle('scrapbook')}
          ><span class="scrapbook-icon">▱</span><span
            >Scrapbook<small>A little beautifully messy</small></span
          >{#if style === 'scrapbook'}<span class="check">✓</span>{/if}</button
        >
      </div>
      {#if style === 'bento' && workspace}
        <label class="template-label" for="bento-template">Bento template</label
        >
        <select
          id="bento-template"
          aria-label="Bento template"
          value={workspace.bento ? (workspace.template ?? 'mosaic') : ''}
          disabled={!editing || busy}
          onchange={(e) => chooseTemplate(e.currentTarget.value as Template)}
        >
          {#if !workspace.bento}<option value="" disabled
              >Original saved layout</option
            >{/if}
          {#each TEMPLATES as template (template)}<option value={template}
              >{template[0].toUpperCase() + template.slice(1)}</option
            >{/each}
        </select>
        <p class="library-help">
          Shuffle for a fresh arrangement. Drag the dividers to make it your
          own.
        </p>
      {/if}
      <p class="format-row">Portrait 4:5 · 3 slides</p>
      <div class="sidebar-divider"></div>
      <div class="step-heading">
        <span class="step">02</span>
        <h2>Add your moments</h2>
        <span class="count">{assets.length}/15</span>
      </div>
      <input
        class="sr-only"
        bind:this={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onchange={(e) => {
          if (e.currentTarget.files) void add(e.currentTarget.files);
        }}
        disabled={!editing || busy}
        aria-label="Upload photos"
      />
      <button
        class="upload"
        class:drag-over={dragOver}
        disabled={!editing || busy}
        onclick={() => input.click()}
        ><span class="upload-plus">＋</span><strong
          >{busy ? 'Working on your collage…' : 'Drop in your photos'}</strong
        ><span>or click to browse</span><small
          >JPG, PNG, WebP · 20 MB each</small
        ></button
      >
      <p class="upload-help">
        At least 3 photos. A mix of shapes works beautifully.
      </p>
      {#if assets.length}
        <div class="photo-tray">
          {#each assets as a (a.id)}
            <button
              class:unused={!workspace?.layers.some((l) => l.assetId === a.id)}
              disabled={!editing || busy || !workspace}
              onclick={() => insertAsset(a.id)}
              aria-label={`${workspace?.layers.some((l) => l.assetId === a.id) ? 'Select' : 'Add back'} ${a.name}`}
              title={a.name}
            >
              <img src={urls[a.id]} alt={a.name} /><span
                >{workspace?.layers.some((l) => l.assetId === a.id)
                  ? assets.indexOf(a) + 1
                  : '+'}</span
              >
            </button>
          {/each}
        </div>
        <p class="library-help">
          Click a photo to select it. Deleted photos stay here so you can add
          them back.
        </p>
      {/if}
      <div class="privacy-note">
        <span>⌁</span>
        <p>
          Your photos stay in your browser.<br />No account. No uploads. Just
          create.
        </p>
      </div>
    </aside>
    <section class="workspace" aria-label="Collage editor">
      <div class="workspace-toolbar">
        <div>
          <span class="step">03</span>
          <h2>Your story, unfolding</h2>
        </div>
        <span class="save-status" role="status"
          ><span class="dot"></span>{!ready
            ? 'Opening workspace…'
            : !editing
              ? 'Read only'
              : status}</span
        >
      </div>
      <div class="canvas-area">
        {#if workspace}
          <CanvasEditor
            {workspace}
            {assets}
            bind:selected
            enabled={editing && !busy}
            oncommit={commit}
            onerror={fail}
            onundo={undo}
            onredo={redo}
          />
        {:else}
          <div class="empty-scene">
            <div class="empty-slide">
              <span>01</span>
              <div class="empty-tile tall"></div>
              <div class="empty-tile short"></div>
            </div>
            <div class="empty-slide">
              <span>02</span>
              <div class="empty-tile short"></div>
              <div class="empty-tile tall"></div>
            </div>
            <div class="empty-slide">
              <span>03</span>
              <div class="empty-tile tall"></div>
              <div class="empty-tile short"></div>
            </div>
            <div class="empty-message">
              <span>✳</span>
              <h3>A blank canvas.<br />A story only you can tell.</h3>
              <p>Add your photos to get started.</p>
            </div>
          </div>
        {/if}
        <p class="canvas-caption">
          {workspace
            ? 'One canvas, three connected slides. Photos can cross slide boundaries.'
            : 'Your next favorite carousel starts right here.'}
        </p>
      </div>
      <div class="editor-actions">
        <div>
          <button
            class="secondary"
            disabled={!workspace || !editing || busy}
            onclick={shuffle}>⤨ Shuffle layout</button
          ><button
            class="icon-button"
            disabled={!canUndo || !editing || busy}
            onclick={undo}
            aria-label="Undo"
            ><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
              ><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg
            ></button
          ><button
            class="icon-button"
            disabled={!canRedo || !editing || busy}
            onclick={redo}
            aria-label="Redo"
            ><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
              ><path d="m15 14 5-5-5-5m5 5H9.5a5.5 5.5 0 0 0 0 11H13" /></svg
            ></button
          >
        </div>
        <span class="dimensions">1080 × 1350 px / slide</span>
      </div>
      {#if workspace && layer}
        <div class="customize">
          <fieldset disabled={!editing || busy}>
            <legend
              >Make photo {workspace.layers.indexOf(layer) + 1} yours</legend
            >
            <div class="sliders">
              <label
                >Zoom<input
                  aria-label="Photo zoom"
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={layer.zoom}
                  onchange={(e) => update('zoom', +e.currentTarget.value)}
                /></label
              ><label
                >Horizontal crop<input
                  aria-label="Horizontal crop"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={layer.panX}
                  onchange={(e) => update('panX', +e.currentTarget.value)}
                /></label
              ><label
                >Vertical crop<input
                  aria-label="Vertical crop"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={layer.panY}
                  onchange={(e) => update('panY', +e.currentTarget.value)}
                /></label
              >
            </div>
            {#if style === 'scrapbook'}
              <div class="sliders precise-controls">
                <label
                  >Rotation <input
                    aria-label="Photo rotation"
                    type="number"
                    min="-360"
                    max="360"
                    step="0.1"
                    value={Math.round(layer.rotation * 10) / 10}
                    onchange={(e) => update('rotation', +e.currentTarget.value)}
                  /></label
                >
                <label
                  >Position X <input
                    aria-label="Photo position X"
                    type="number"
                    value={Math.round(layer.x)}
                    onchange={(e) => update('x', +e.currentTarget.value)}
                  /></label
                >
                <label
                  >Position Y <input
                    aria-label="Photo position Y"
                    type="number"
                    value={Math.round(layer.y)}
                    onchange={(e) => update('y', +e.currentTarget.value)}
                  /></label
                >
              </div>
              <div class="sliders precise-controls">
                <label
                  >Photo width <input
                    aria-label="Photo width"
                    type="number"
                    min="80"
                    max={WIDTH * 3}
                    value={Math.round(layer.width)}
                    onchange={(e) => update('width', +e.currentTarget.value)}
                  /></label
                >
                <label
                  >Photo height <input
                    aria-label="Photo height"
                    type="number"
                    min="80"
                    max={HEIGHT * 2}
                    value={Math.round(layer.height)}
                    onchange={(e) => update('height', +e.currentTarget.value)}
                  /></label
                >
              </div>
            {/if}
          </fieldset>
        </div>
      {/if}
      <div class="export-bar">
        <div>
          <p>Made to be shared.</p>
          <span>Free, full-resolution images. Always.</span>
        </div>
        <div>
          <select aria-label="Export image format" bind:value={format}
            ><option value="png">PNG</option><option value="jpeg">JPEG</option
            ></select
          ><button
            class="primary"
            disabled={!workspace?.layers.length || busy}
            onclick={exportImages}>Download images <span>↓</span></button
          >
        </div>
      </div>
    </section>
  </div>
  <section class="motion-strip">
    <span class="motion-symbol">✳</span>
    <div>
      <p class="eyebrow">A LITTLE MOVEMENT. A LOT OF FEELING.</p>
      <h2>Let your moments come to life.</h2>
      <p>
        Subtle AI motion, right inside your collage. Same story. A new feeling.
      </p>
    </div>
    <button
      class="motion-button"
      onclick={async () => {
        await persist();
        showMotion = !showMotion;
      }}
      aria-expanded={showMotion}>Bring to life <span>↗</span></button
    >
  </section>
  {#if showMotion}<div class="motion-details" role="status">
      <strong>Bring your story to life</strong>
      <p>
        Static collages are ready to use. Sign-in is the first step toward paid
        animation. Checkout, AI generation and video export are not enabled yet.
        No photos have been uploaded and no credits will be charged.
      </p>
      <p>
        Instagram does not synchronize playback between slides; moving photos
        will stay away from slide seams.
      </p>
      {#if PUBLIC_CONVEX_URL}<AuthPanel />{:else}<p>
          Email sign-in will be available when the development backend is
          configured.
        </p>{/if}
    </div>{/if}
  <section class="bottom-info" id="how-it-works">
    <div>
      <span>01 — COLLECT</span>
      <h3>Your photos, as they are.</h3>
      <p>Upload at least three moments from your camera roll.</p>
    </div>
    <div>
      <span>02 — CONNECT</span>
      <h3>Find your flow.</h3>
      <p>Choose a layout, shuffle, and adjust each photo’s crop.</p>
    </div>
    <div>
      <span>03 — SHARE</span>
      <h3>Take your story with you.</h3>
      <p>Download three numbered images, ready to post in order.</p>
    </div>
  </section>
  <footer>
    <span
      >livingcarousel <span class="footer-star">✳</span> A little more life in every
      swipe.</span
    >
    <div>
      <button
        disabled={!workspace?.layers.length || busy}
        onclick={exportBackup}>Download project backup</button
      ><button disabled={!assets.length || !editing || busy} onclick={reset}
        >New collage</button
      >
    </div>
    <p>
      Saved in this browser, not backed up forever. Download your work before
      clearing site data.
    </p>
  </footer>
</main>
