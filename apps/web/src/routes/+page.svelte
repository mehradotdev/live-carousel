<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import {
    activeLayers,
    addPhotos,
    addToBento,
    layout,
    regenerate,
    removeAsset,
    setSpacing,
    withLayers,
    BACKGROUNDS,
    SPACING_MAX,
    TEMPLATES,
    clamp,
    type Template,
    WIDTH,
    ASPECTS,
    MAX_PHOTOS,
    MAX_SLIDES,
    MIN_TILE,
    resize,
    type Aspect,
    type Asset,
    type Workspace,
    type Project,
    type Spacing,
    type Style,
  } from '#lib/editor/model.ts';
  import { exportSlides, download, backup, zip } from '#lib/editor/render.ts';
  import { ingest, loadProject, saveProject } from '#lib/editor/storage.ts';
  import CanvasEditor from '#lib/editor/CanvasEditor.svelte';
  import AuthPanel from '#lib/AuthPanel.svelte';
  import { PUBLIC_CONVEX_URL } from '$app/env/public';
  let assets = $state<Asset[]>([]);
  const blank = () => layout([], 'bento');
  let workspace = $state<Workspace>(blank());
  // Live slider or color drag; history and autosave only see it on commit.
  let preview = $state.raw<Workspace | null>(null);
  let spacingHint = $state('');
  const shown = $derived(preview ?? workspace);
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
  let shareFiles = $state.raw<File[] | null>(null);
  let unreadable = false;
  let channel: BroadcastChannel | undefined;
  let release: (() => void) | undefined;
  let saveQueue = Promise.resolve();
  let saveTimer: ReturnType<typeof setTimeout>;
  const placed = $derived(activeLayers(workspace));
  const layer = $derived(placed.find((l) => l.id === selected));
  const canUndo = $derived(history.length > 0);
  const canRedo = $derived(future.length > 0);
  const sceneWidth = $derived(WIDTH * workspace.slides);
  const sceneHeight = $derived(ASPECTS[workspace.aspect]);
  const slideCount = $derived(
    `${workspace.slides} slide${workspace.slides === 1 ? '' : 's'}`,
  );
  const RATIOS: [Aspect, string][] = [
    ['4:5', 'Feed posts'],
    ['3:4', 'Profile grid'],
    ['1:1', 'Square posts'],
    ['9:16', 'Stories & TikTok'],
  ];
  const fieldLabel =
    'flex flex-col gap-[7px] text-sm leading-[1.5] text-neutral';
  const fieldInput =
    'input h-auto w-full border-primary/30 px-[9px] py-[7px] text-base leading-[1.45] text-secondary';
  const toolButton =
    'btn leading-[1.45] h-auto min-h-[42px] border-primary/20 bg-base-100 text-sm font-normal text-neutral/90';
  function project(): Project {
    return {
      workspace: $state.snapshot(workspace),
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
    // An unreadable save stays on disk until the user starts a new collage or adds photos.
    if (!ready || !editing || (unreadable && !assets.length)) return saveQueue;
    clearTimeout(saveTimer);
    status = 'Saving…';
    const snapshot = project();
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
      selected = activeLayers(saved.workspace)[0]?.id ?? '';
    } else {
      workspace = blank();
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
          unreadable = true;
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
    for (const a of current) next[a.id] = URL.createObjectURL(a.previewBlob);
    urls = next;
    return () => Object.values(next).forEach(URL.revokeObjectURL);
  });
  function remember() {
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
    if (key === 'width') value = clamp(value, 80, sceneWidth);
    if (key === 'height') value = clamp(value, 80, sceneHeight * 2);
    if (key === 'zoom') value = clamp(value, 1, 3);
    if (key === 'panX' || key === 'panY') value = clamp(value, 0, 1);
    if (key === 'rotation') value = clamp(value, -360, 360);
    if (key === 'x') value = clamp(value, 48 - layer.width, sceneWidth - 48);
    if (key === 'y') value = clamp(value, 48 - layer.height, sceneHeight - 48);
    remember();
    workspace = withLayers(
      workspace,
      placed.map((l) => (l.id === selected ? { ...l, [key]: value } : l)),
    );
    scheduleSave();
  }
  function commit(next: Workspace) {
    preview = null;
    if (!editing || busy) return;
    remember();
    workspace = next;
    scheduleSave();
  }
  function placedAssets() {
    return placed
      .map((l) => assets.find((a) => a.id === l.assetId)!)
      .filter(Boolean);
  }
  function changeStyle(value: Style) {
    if (!editing || busy || value === style) return;
    const assetId = layer?.assetId;
    style = value;
    commit({ ...workspace, style: value });
    selected = placed.find((l) => l.assetId === assetId)?.id ?? '';
  }
  function chooseTemplate(template: Template) {
    if (!editing || busy) return;
    commit(regenerate(workspace, placedAssets(), workspace.seed, template));
  }
  function dragSpacing(
    input: HTMLInputElement,
    key: keyof Spacing,
    label: string,
  ) {
    const value = +input.value;
    preview = setSpacing(workspace, key, value);
    const actual = preview.bento[key];
    input.value = String(actual);
    spacingHint =
      actual < value
        ? `${label} stops at ${actual}px to keep every cell at least ${MIN_TILE}px.`
        : '';
  }
  function commitSpacing(key: keyof Spacing) {
    if (preview && preview.bento[key] !== workspace.bento[key]) commit(preview);
    preview = null;
  }
  function changeSize(aspect: Aspect, slides: number) {
    if (aspect === workspace.aspect && slides === workspace.slides) return;
    const next = resize(workspace, aspect, slides);
    const moved = placed.length - activeLayers(next).length;
    if (moved)
      notice = `${moved} photo${moved === 1 ? '' : 's'} moved to your photo tray to keep Bento cells usable.`;
    commit(next);
  }
  function insertAsset(assetId: string) {
    if (!editing || busy) return;
    const existing = placed.find((l) => l.assetId === assetId);
    if (existing) {
      selected = existing.id;
      return;
    }
    error = '';
    if (style === 'scrapbook') {
      const asset = assets.find((a) => a.id === assetId)!;
      const next = layout(
        [asset],
        'scrapbook',
        workspace.seed + placed.length,
        undefined,
        workspace,
      ).scrapbook.layers[0];
      next.id = crypto.randomUUID();
      next.x = sceneWidth / 2 - next.width / 2;
      next.y = sceneHeight / 2 - next.height / 2;
      commit(withLayers(workspace, [...placed, next]));
      selected = next.id;
    } else {
      const next = addToBento(workspace, assetId, selected);
      if (next === workspace) {
        error = `Splitting ${layer ? 'this cell' : 'the largest cell'} would leave a cell under ${MIN_TILE}px, so the photo stays in your tray. Select a larger cell, reduce the gap or margin, or add a slide.`;
        return;
      }
      commit(next);
      // The next add goes to the largest cell instead of halving this one again.
      selected = '';
    }
  }
  async function add(files: FileList | File[]) {
    if (!editing || busy) return;
    busy = true;
    error = '';
    try {
      const added = await ingest(files, assets.length);
      if (!added.length) return;
      assets = [...assets, ...added];
      remember();
      const before = placed.length;
      workspace = addPhotos(workspace, added, selected);
      // Same photo a reload would select; existing Bento stays unselected so the next add goes to the largest cell.
      selected = style === 'bento' && before ? '' : (placed[before]?.id ?? '');
      const unplaced = added.filter(
        (a) => !placed.some((l) => l.assetId === a.id),
      ).length;
      if (unplaced)
        notice = `${unplaced} photo${unplaced === 1 ? '' : 's'} did not fit the Bento grid and wait in your photo tray.`;
      await persist();
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
      if (input) input.value = '';
    }
  }
  function removeFromLibrary(asset: Asset) {
    if (
      !editing ||
      busy ||
      !confirm(
        `Remove ${asset.name} from this collage? This deletes it from both layouts and cannot be undone.`,
      )
    )
      return;
    workspace = removeAsset(workspace, asset.id);
    assets = assets.filter((a) => a.id !== asset.id);
    // Undo must never bring back a layer whose photo is gone.
    history = history.map((w) => removeAsset(w, asset.id));
    future = future.map((w) => removeAsset(w, asset.id));
    scheduleSave();
  }
  function shuffle() {
    if (!editing) return;
    remember();
    workspace = regenerate(workspace, placedAssets(), workspace.seed + 1);
    scheduleSave();
  }
  function undo() {
    if (!editing || !history.length) return;
    future = [structuredClone($state.snapshot(workspace)), ...future];
    workspace = history[history.length - 1];
    history = history.slice(0, -1);
    style = workspace.style;
    scheduleSave();
  }
  function redo() {
    if (!editing || !future.length) return;
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
    workspace = blank();
    style = workspace.style;
    assets = [];
    history = [];
    future = [];
    selected = '';
    error = '';
    unreadable = false;
    await persist();
  }
  async function exportImages() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const files = await exportSlides(project(), format);
      // Export outlives the tap's user activation, so the share sheet opens from a second tap.
      if (
        matchMedia('(pointer: coarse)').matches &&
        navigator.canShare?.({ files })
      ) {
        shareFiles = files;
        notice = 'Your slides are ready. Tap Share slides to save them.';
        return;
      }
      download(await zip(files), 'living-carousel.zip');
      notice = `Your ${slideCount} ${workspace.slides === 1 ? 'is' : 'are'} ready in the ZIP download.`;
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  $effect(() => {
    void [workspace, assets, format];
    shareFiles = null;
  });
  async function shareSlides() {
    const files = shareFiles;
    if (!files) return;
    error = '';
    try {
      await navigator.share({ files });
      shareFiles = null;
      notice = 'Your slides are ready to save from the share sheet.';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      shareFiles = null;
      fail(e);
      try {
        download(await zip(files), 'living-carousel.zip');
        notice = `Sharing failed, so your ${slideCount} ${workspace.slides === 1 ? 'is' : 'are'} in the ZIP download.`;
      } catch (zipError) {
        fail(zipError);
      }
    }
  }
  async function exportBackup() {
    if (busy) return;
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

<header
  class="flex h-[90px] items-center justify-between border-b border-base-300 px-[4%] max-[640px]:h-[72px] max-[640px]:px-[5%]"
>
  <a
    class="flex items-center text-[23px] font-bold tracking-[-1px] max-[640px]:text-[20px]"
    href={resolve('/')}
    aria-label="Living Carousel home"
    ><span
      class="relative mr-3 grid size-[33px] place-items-center rounded-[9px] border-[1.5px] border-base-content font-serif text-[25px]"
      >lc<span
        class="absolute -top-3 -right-[7px] bg-base-200 font-[sans-serif] text-[20px] font-normal text-primary"
        >✳</span
      ></span
    >living<span class="font-normal">carousel</span></a
  >
  <div class="flex items-center gap-[30px] max-[640px]:gap-0">
    <span
      class="flex items-center gap-[7px] rounded-[20px] bg-base-300/60 px-3 py-2 text-sm"
      ><span class="inline-block size-[5px] shrink-0 rounded-full bg-primary"
      ></span> Private by default</span
    ><a class="text-sm max-[640px]:hidden" href="#how-it-works"
      >How it works ↗</a
    >
  </div>
</header>
<main class="m-auto max-w-[1680px] px-[4%] max-[640px]:px-[5%]">
  <section
    class="intro flex items-center justify-between pt-[52px] pb-10 max-[640px]:pt-[34px] max-[640px]:pb-[25px] min-[1500px]:pt-[65px]"
  >
    <div>
      <p class="mb-[17px] text-sm font-[650] tracking-[2px] text-neutral/85">
        A FEW PHOTOS. ONE GOOD STORY.
      </p>
      <h1
        class="mb-[18px] font-serif text-[clamp(42px,4.6vw,66px)] leading-[1.02] font-normal tracking-[-1.8px] max-[640px]:text-[44px]"
      >
        Some moments deserve<br />a little
        <em class="text-primary">more space.</em>
      </h1>
      <p
        class="my-[1em] text-base leading-[1.7] text-neutral max-[640px]:text-sm"
      >
        Turn your camera roll into a carousel that flows.<br />Make it yours.
        Keep the memories connected.
      </p>
    </div>
    <div
      class="-rotate-7 pt-5 pr-[55px] text-neutral/75 max-[900px]:pr-[10px] max-[640px]:hidden"
    >
      <span class="block font-serif text-[24px] leading-[1.15] italic"
        >{slideCount},<br />one continuous story</span
      ><span class="pl-[25px] text-[44px]">↙</span>
    </div>
  </section>
  {#if error}<div
      class="mb-[15px] flex items-center justify-between gap-[14px] rounded-lg border border-error/30 bg-error/8 px-[18px] py-[14px] text-sm text-error"
      role="alert"
    >
      {error}<button
        class="px-1.5 py-px"
        aria-label="Dismiss error"
        onclick={() => (error = '')}>×</button
      >
    </div>{/if}
  {#if notice}<div
      class="mb-[15px] flex items-center justify-between gap-[14px] rounded-lg border border-accent/35 bg-accent/15 px-[18px] py-[14px] text-sm"
      role="status"
    >
      {notice}<button
        class="px-1.5 py-px"
        aria-label="Dismiss notification"
        onclick={() => (notice = '')}>×</button
      >
    </div>{/if}
  {#if ready && !editing}<div
      class="mb-[15px] flex items-center justify-between gap-[14px] rounded-lg border border-accent/35 bg-accent/15 px-[18px] py-[14px] text-sm"
    >
      This workspace is open in another tab, or editing is unavailable.<button
        class="pt-[10px] pr-[15px] text-sm text-primary"
        onclick={takeover}>Edit here</button
      >
    </div>{/if}
  <div
    class="grid grid-cols-[300px_minmax(0,1fr)] overflow-hidden rounded-box border border-primary/20 bg-base-100 shadow-[0_8px_36px_currentColor] shadow-base-content/6 max-[1100px]:grid-cols-[260px_minmax(0,1fr)] max-[760px]:grid-cols-1"
  >
    <aside
      class="self-start border-r border-base-300 px-[22px] py-[25px] max-[1100px]:px-4 max-[1100px]:py-5 max-[760px]:border-r-0 max-[760px]:border-b"
    >
      <div class="flex items-center gap-[9px]">
        <span
          class="inline-grid size-[21px] shrink-0 place-items-center rounded-full border border-primary/20 text-sm text-neutral/80"
          >01</span
        >
        <h2 class="text-base font-semibold">Set the mood</h2>
      </div>
      <p class="mt-6 mb-[10px] text-sm tracking-[1.4px] text-neutral">
        LAYOUT STYLE
      </p>
      <div class="grid gap-2 max-[760px]:grid-cols-2">
        {#each [{ value: 'bento', icon: '▦', title: 'Bento', note: 'Neat & connected' }, { value: 'scrapbook', icon: '▱', title: 'Scrapbook', note: 'A little beautifully messy' }] as option (option.value)}
          <button
            class={[
              'flex items-center gap-3 rounded-lg border p-[13px] text-left max-[640px]:gap-2 max-[640px]:p-[10px]',
              style === option.value
                ? 'border-primary/60 bg-primary/10'
                : 'border-base-300',
            ]}
            disabled={!editing || busy}
            onclick={() => changeStyle(option.value as Style)}
            ><span
              class={[
                'text-[29px] leading-none text-primary',
                option.value === 'scrapbook' && '-rotate-10',
              ]}>{option.icon}</span
            ><span
              >{option.title}<small
                class="mt-1 block text-sm leading-[1.45] text-neutral"
                >{option.note}</small
              ></span
            >{#if style === option.value}<span
                class="ml-auto text-primary max-[640px]:hidden">✓</span
              >{/if}</button
          >
        {/each}
      </div>
      {#if style === 'bento'}
        <label
          class="mt-5 mb-2 block text-sm font-semibold"
          for="bento-template">Bento template</label
        >
        <select
          id="bento-template"
          class="select h-auto w-full border-primary/30 py-[9px] text-base leading-[1.45] text-secondary"
          aria-label="Bento template"
          value={workspace.bento.template}
          disabled={!editing || busy}
          onchange={(e) => chooseTemplate(e.currentTarget.value as Template)}
        >
          {#each TEMPLATES as template (template)}<option value={template}
              >{template[0].toUpperCase() + template.slice(1)}</option
            >{/each}
        </select>
        <p class="my-[1em] text-sm leading-[1.6] text-neutral">
          Shuffle for a fresh arrangement. Drag the dividers to make it your
          own.
        </p>
        <div class="sliders mt-5 grid gap-3">
          {#each [['gap', 'Gap'], ['margin', 'Outer margin'], ['radius', 'Roundness']] as const as [key, label] (key)}
            <label class={fieldLabel}>
              <span class="flex justify-between"
                >{label}<output>{shown.bento[key]}px</output></span
              ><input
                class="m-0.5 w-full accent-primary"
                aria-label={label}
                type="range"
                min="0"
                max={SPACING_MAX[key]}
                step="1"
                value={shown.bento[key]}
                disabled={!editing || busy}
                oninput={(e) => dragSpacing(e.currentTarget, key, label)}
                onchange={() => commitSpacing(key)}
              /></label
            >
          {/each}
          {#if spacingHint}<p class="text-sm text-neutral" role="status">
              {spacingHint}
            </p>{/if}
        </div>
      {/if}
      <p class="mt-6 mb-[10px] text-sm tracking-[1.4px] text-neutral">
        BACKGROUND
      </p>
      <div class="flex flex-wrap items-center gap-2">
        {#each BACKGROUNDS as [name, color] (color)}
          <button
            class={[
              'size-7 rounded-full border border-base-content/25',
              shown.background === color &&
                'outline-2 outline-offset-2 outline-primary',
            ]}
            style:background-color={color}
            aria-label={`${name} background`}
            aria-pressed={shown.background === color}
            title={name}
            disabled={!editing || busy}
            onclick={() => commit({ ...workspace, background: color })}
          ></button>
        {/each}
        <input
          class="size-7 cursor-pointer rounded-full p-0"
          type="color"
          aria-label="Custom background color"
          value={shown.background}
          disabled={!editing || busy}
          oninput={(e) =>
            (preview = { ...workspace, background: e.currentTarget.value })}
          onchange={(e) =>
            commit({ ...workspace, background: e.currentTarget.value })}
        />
      </div>
      <p class="mt-6 mb-[10px] text-sm tracking-[1.4px] text-neutral">FORMAT</p>
      <div class="join grid w-full grid-cols-4" aria-label="Aspect ratio">
        {#each RATIOS as [value, hint] (value)}
          <button
            class={[
              'btn join-item h-auto min-h-[42px] flex-col gap-0.5 px-1 py-2 text-sm leading-[1.3] font-normal',
              workspace.aspect === value
                ? 'btn-primary'
                : 'border-primary/20 bg-base-100 text-neutral',
            ]}
            aria-pressed={workspace.aspect === value}
            disabled={!editing || busy}
            onclick={() => changeSize(value, workspace.slides)}
            >{value}<small class="text-[12px] leading-[1.25] opacity-80"
              >{hint}</small
            ></button
          >
        {/each}
      </div>
      <div class="mt-4 flex items-center justify-between gap-3">
        <span id="slide-count" class="text-sm text-neutral">Slides</span>
        <div class="join" role="group" aria-labelledby="slide-count">
          <button
            class={[toolButton, 'join-item min-w-[42px] px-0 text-base']}
            aria-label="Remove a slide"
            disabled={!editing || busy || workspace.slides <= 1}
            onclick={() => changeSize(workspace.aspect, workspace.slides - 1)}
            >−</button
          ><output
            class="join-item grid min-w-12 place-items-center border-y border-primary/20 text-base"
            aria-live="polite"
            >{workspace.slides}<span class="sr-only">&nbsp;slides</span></output
          ><button
            class={[toolButton, 'join-item min-w-[42px] px-0 text-base']}
            aria-label="Add a slide"
            disabled={!editing || busy || workspace.slides >= MAX_SLIDES}
            onclick={() => changeSize(workspace.aspect, workspace.slides + 1)}
            >+</button
          >
        </div>
      </div>
      <div
        class="my-[25px] border-t border-base-300 max-[640px]:my-[18px]"
      ></div>
      <div class="flex items-center gap-[9px]">
        <span
          class="inline-grid size-[21px] shrink-0 place-items-center rounded-full border border-primary/20 text-sm text-neutral/80"
          >02</span
        >
        <h2 class="text-base font-semibold">Add your moments</h2>
        <span class="count ml-auto text-sm text-neutral"
          >{assets.length}/{MAX_PHOTOS}</span
        >
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
        class={[
          'upload mt-[18px] flex w-full flex-col items-center gap-[7px] rounded-[9px] border border-dashed border-primary/30 px-2 py-[21px] text-neutral/85 max-[640px]:p-[14px]',
          dragOver ? 'drag-over bg-accent/25' : 'bg-base-200',
        ]}
        disabled={!editing || busy}
        onclick={() => input.click()}
        ><span
          class="size-9 rounded-full bg-primary/10 text-[23px] leading-9 max-[640px]:hidden"
          >＋</span
        ><strong class="text-sm leading-[1.45] font-medium text-secondary"
          >{busy ? 'Working on your collage…' : 'Drop in your photos'}</strong
        ><span class="text-sm leading-[1.45]">or click to browse</span><small
          class="mt-[5px] text-sm leading-[1.45] text-neutral"
          >JPG, PNG, WebP · 20 MB each</small
        ></button
      >
      <p class="my-[1em] text-sm leading-[1.7] text-neutral">
        A mix of shapes works beautifully.
      </p>
      {#if assets.length}
        <div class="my-4 grid grid-cols-4 gap-[6px] max-[760px]:grid-cols-6">
          {#each assets as a (a.id)}
            <div class="relative">
              <button
                class={[
                  'relative aspect-square w-full overflow-hidden rounded-[6px] bg-base-200 p-0',
                  placed.some((l) => l.assetId === a.id)
                    ? 'border border-primary/30'
                    : 'border-2 border-dashed border-primary',
                ]}
                disabled={!editing || busy}
                onclick={() => insertAsset(a.id)}
                aria-label={`${placed.some((l) => l.assetId === a.id) ? 'Select' : 'Add back'} ${a.name}`}
                title={a.name}
              >
                <img
                  class="size-full object-cover"
                  src={urls[a.id]}
                  alt={a.name}
                /><span
                  class="absolute bottom-[2px] left-[2px] rounded-[3px] bg-base-100/80 px-1 py-px text-[12px]"
                  >{placed.some((l) => l.assetId === a.id)
                    ? assets.indexOf(a) + 1
                    : '+'}</span
                >
              </button>
              <button
                class="absolute top-0 right-0 grid size-6 place-items-center rounded-[4px] bg-base-100/85 text-sm leading-none text-secondary"
                disabled={!editing || busy}
                aria-label={`Remove ${a.name} from library`}
                title="Remove from library"
                onclick={() => removeFromLibrary(a)}>×</button
              >
            </div>
          {/each}
        </div>
        <p class="my-[1em] text-sm leading-[1.6] text-neutral">
          Click a photo to select it. Deleted photos stay here so you can add
          them back.
        </p>
      {/if}
      <div
        class="mt-[26px] flex items-center gap-[9px] text-neutral max-[640px]:mt-[10px]"
      >
        <span class="text-[28px]">⌁</span>
        <p class="my-[1em] text-sm leading-[1.6]">
          Your photos stay in your browser.<br />No account. No uploads. Just
          create.
        </p>
      </div>
    </aside>
    <section class="flex min-w-0 flex-col" aria-label="Collage editor">
      <div
        class="flex flex-wrap items-center justify-between gap-4 border-b border-base-300/70 px-[25px] py-[23px] max-[900px]:flex-col max-[900px]:items-start max-[900px]:px-4 max-[900px]:py-5 max-[640px]:flex-row"
      >
        <div class="flex items-center gap-[9px]">
          <span
            class="inline-grid size-[21px] shrink-0 place-items-center rounded-full border border-primary/20 text-sm text-neutral/80"
            >03</span
          >
          <h2 class="text-base font-semibold max-[640px]:text-sm">
            Your story, unfolding
          </h2>
        </div>
        <span
          class="save-status flex items-center gap-[6px] text-sm leading-[1.5] text-neutral max-[900px]:pl-[30px] max-[640px]:p-0"
          role="status"
          ><span
            class="inline-block size-[5px] shrink-0 rounded-full bg-primary"
          ></span>{!ready
            ? 'Opening workspace…'
            : !editing
              ? 'Read only'
              : status}</span
        >
      </div>
      <div
        class="canvas-dots flex flex-1 flex-col px-6 pt-7 pb-2 max-[640px]:px-[14px] max-[640px]:pt-5 max-[640px]:pb-[5px] min-[1500px]:px-[35px] min-[1500px]:pt-[35px]"
      >
        <CanvasEditor
          workspace={shown}
          {assets}
          bind:selected
          enabled={editing && !busy}
          oncommit={commit}
          onerror={fail}
          onundo={undo}
          onredo={redo}
        />
        <p class="mt-[19px] mb-3 text-center text-sm text-neutral">
          {placed.length
            ? `One canvas, ${slideCount}. Photos can cross slide boundaries.`
            : 'A blank canvas. Add your photos to get started.'}
        </p>
      </div>
      <div
        class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 px-[22px] py-[14px]"
      >
        <div class="flex flex-wrap gap-[7px]">
          <button
            class={[toolButton, 'px-[11px] py-2']}
            disabled={!workspace || !editing || busy}
            onclick={shuffle}>⤨ Shuffle layout</button
          ><button
            class={[toolButton, 'min-w-[42px] px-[9px] py-[3px]']}
            disabled={!canUndo || !editing || busy}
            onclick={undo}
            aria-label="Undo"
            ><svg
              class="m-auto"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              ><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg
            ></button
          ><button
            class={[toolButton, 'min-w-[42px] px-[9px] py-[3px]']}
            disabled={!canRedo || !editing || busy}
            onclick={redo}
            aria-label="Redo"
            ><svg
              class="m-auto"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              ><path d="m15 14 5-5-5-5m5 5H9.5a5.5 5.5 0 0 0 0 11H13" /></svg
            ></button
          >
        </div>
        <span class="text-sm text-neutral max-[900px]:hidden"
          >1080 × {sceneHeight} px / slide</span
        >
      </div>
      {#if workspace && layer}
        <div class="border-b border-base-300 px-6 py-4 max-[640px]:p-[15px]">
          <fieldset class="min-w-0 pt-3" disabled={!editing || busy}>
            <legend class="px-0.5 pt-[10px] pb-3 text-sm text-neutral"
              >Make photo {placed.indexOf(layer) + 1} yours</legend
            >
            <div class="sliders grid grid-cols-3 gap-5 max-[760px]:gap-3">
              <label class={fieldLabel}
                >Zoom<input
                  class="m-0.5 w-full accent-primary"
                  aria-label="Photo zoom"
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={layer.zoom}
                  onchange={(e) => update('zoom', +e.currentTarget.value)}
                /></label
              ><label class={fieldLabel}
                >Horizontal crop<input
                  class="m-0.5 w-full accent-primary"
                  aria-label="Horizontal crop"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={layer.panX}
                  onchange={(e) => update('panX', +e.currentTarget.value)}
                /></label
              ><label class={fieldLabel}
                >Vertical crop<input
                  class="m-0.5 w-full accent-primary"
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
              <div
                class="sliders mt-4 grid grid-cols-3 gap-5 max-[760px]:gap-3"
              >
                <label class={fieldLabel}
                  >Rotation <input
                    class={fieldInput}
                    aria-label="Photo rotation"
                    type="number"
                    min="-360"
                    max="360"
                    step="0.1"
                    value={Math.round(layer.rotation * 10) / 10}
                    onchange={(e) => update('rotation', +e.currentTarget.value)}
                  /></label
                >
                <label class={fieldLabel}
                  >Position X <input
                    class={fieldInput}
                    aria-label="Photo position X"
                    type="number"
                    value={Math.round(layer.x)}
                    onchange={(e) => update('x', +e.currentTarget.value)}
                  /></label
                >
                <label class={fieldLabel}
                  >Position Y <input
                    class={fieldInput}
                    aria-label="Photo position Y"
                    type="number"
                    value={Math.round(layer.y)}
                    onchange={(e) => update('y', +e.currentTarget.value)}
                  /></label
                >
              </div>
              <div
                class="sliders mt-4 grid grid-cols-3 gap-5 max-[760px]:gap-3"
              >
                <label class={fieldLabel}
                  >Photo width <input
                    class={fieldInput}
                    aria-label="Photo width"
                    type="number"
                    min="80"
                    max={sceneWidth}
                    value={Math.round(layer.width)}
                    onchange={(e) => update('width', +e.currentTarget.value)}
                  /></label
                >
                <label class={fieldLabel}
                  >Photo height <input
                    class={fieldInput}
                    aria-label="Photo height"
                    type="number"
                    min="80"
                    max={sceneHeight * 2}
                    value={Math.round(layer.height)}
                    onchange={(e) => update('height', +e.currentTarget.value)}
                  /></label
                >
              </div>
            {/if}
          </fieldset>
        </div>
      {/if}
      <div
        class="flex items-center justify-between gap-3 px-6 py-5 max-[900px]:flex-wrap max-[640px]:p-[18px]"
      >
        <div>
          <p class="mb-[5px] text-sm font-medium">Made to be shared.</p>
          <span class="text-sm text-neutral"
            >Free, full-resolution images. Always.</span
          >
        </div>
        <div class="flex gap-[7px] max-[760px]:flex-wrap max-[640px]:ml-auto">
          <select
            class="select h-auto min-h-[42px] w-auto border-primary/20 bg-base-200 text-sm text-neutral/90"
            aria-label="Export image format"
            bind:value={format}
            ><option value="png">PNG</option><option value="jpeg">JPEG</option
            ></select
          ><button
            class="primary btn leading-[1.45] h-auto min-h-[42px] border-0 btn-primary px-[18px] py-3 text-sm font-normal"
            disabled={busy}
            onclick={exportImages}
            >Download images <span class="ml-[10px] text-[17px]">↓</span
            ></button
          >{#if shareFiles}<button
              class="btn leading-[1.45] h-auto min-h-[42px] border-0 btn-primary px-[18px] py-3 text-sm font-normal"
              onclick={shareSlides}>Share slides</button
            >{/if}
        </div>
      </div>
    </section>
  </div>
  <section
    class="mt-6 flex items-center gap-[23px] rounded-[11px] border border-primary/20 bg-accent/12 px-[30px] py-[27px] max-[640px]:flex-wrap max-[640px]:gap-3 max-[640px]:px-[18px] max-[640px]:py-[22px]"
  >
    <span class="text-[50px] text-primary/70 max-[640px]:text-[35px]">✳</span>
    <div>
      <p class="mb-[9px] text-sm font-[650] tracking-[1.6px] text-neutral/85">
        A LITTLE MOVEMENT. A LOT OF FEELING.
      </p>
      <h2
        class="font-serif text-[28px] font-normal tracking-[-0.5px] max-[640px]:text-[24px]"
      >
        Let your moments come to life.
      </h2>
      <p
        class="mt-[1em] text-sm text-neutral max-[640px]:max-w-[230px] max-[640px]:leading-[1.6]"
      >
        Subtle AI motion, right inside your collage. Same story. A new feeling.
      </p>
    </div>
    <button
      class="btn leading-[1.45] ml-auto h-auto min-h-[42px] border-primary/30 bg-base-200 px-[18px] py-3 text-sm font-normal whitespace-nowrap text-primary max-[640px]:mt-2 max-[640px]:mr-0 max-[640px]:mb-0 max-[640px]:ml-[46px]"
      onclick={async () => {
        await persist();
        showMotion = !showMotion;
      }}
      aria-expanded={showMotion}
      >Bring to life <span class="ml-[18px]">↗</span></button
    >
  </section>
  {#if showMotion}<div
      class="mt-3 rounded-lg border border-primary/25 p-5 text-sm leading-[1.7] text-neutral/90 [&_p]:my-[1em]"
      role="status"
    >
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
  <section
    class="grid grid-cols-3 gap-10 border-b border-base-300 py-[45px] max-[760px]:grid-cols-1 max-[760px]:gap-[18px] max-[640px]:py-[30px]"
    id="how-it-works"
  >
    {#each [['01 — COLLECT', 'Your photos, as they are.', 'Add your favourite moments from your camera roll.'], ['02 — CONNECT', 'Find your flow.', 'Choose a layout, shuffle, and adjust each photo’s crop.'], ['03 — SHARE', 'Take your story with you.', `Download ${workspace.slides === 1 ? 'one image' : `${workspace.slides} numbered images`}, ready to post in order.`]] as [step, title, copy] (step)}
      <div>
        <span class="text-sm tracking-[1.5px] text-neutral">{step}</span>
        <h3
          class="mt-3 mb-2 font-serif text-[24px] font-normal max-[760px]:my-[6px] max-[640px]:text-[20px]"
        >
          {title}
        </h3>
        <p class="my-[1em] max-w-[320px] text-sm leading-[1.7] text-neutral">
          {copy}
        </p>
      </div>
    {/each}
  </section>
  <footer
    class="flex flex-wrap justify-between gap-[10px] pt-6 pb-[35px] text-sm leading-[1.6] text-neutral"
  >
    <span class="flex items-center gap-[14px]"
      >livingcarousel <span class="text-[15px] text-primary">✳</span> A little more
      life in every swipe.</span
    >
    <div>
      <button
        class="ml-3 px-1.5 py-px text-neutral/90"
        disabled={!assets.length || busy}
        onclick={exportBackup}>Download project backup</button
      ><button
        class="ml-3 px-1.5 py-px text-neutral/90"
        disabled={!assets.length || !editing || busy}
        onclick={reset}>New collage</button
      >
    </div>
    <p class="my-[1em] w-full">
      Saved in this browser, not backed up forever. Download your work before
      clearing site data.
    </p>
  </footer>
</main>
