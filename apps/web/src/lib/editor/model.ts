export const WIDTH = 1080;
export const MAX_SLIDES = 20;
// Slide height per aspect; every slide is WIDTH wide.
export const ASPECTS = { '4:5': 1350, '3:4': 1440, '1:1': 1080, '9:16': 1920 } as const;
export type Aspect = keyof typeof ASPECTS;
export const slideSize = (aspect: Aspect) => ({ width: WIDTH, height: ASPECTS[aspect] });
export const MIN_TILE = 120;
export const SPACING_MAX = { gap: 60, margin: 120, radius: 60 } as const;
export type Spacing = Record<keyof typeof SPACING_MAX, number>;
export const BACKGROUNDS = [
  ['Cream', '#f3eee4'],
  ['White', '#ffffff'],
  ['Blush', '#f4dfd6'],
  ['Sage', '#dfe5d6'],
  ['Mist', '#d6e0e6'],
  ['Ink', '#1c1a17'],
] as const;
export const BENTO_PER_SLIDE = 6;
// Scrapbook layers always keep this much of their rotated bounds on the canvas.
export const GRAB = 48;
export const MAX_PHOTOS = 100;
export const MAX_TEXT = 2000;
export const TEXT_SIZE = { min: 12, max: 400 } as const;
export const TEXT_MIN_WIDTH = 80;
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export const TEXT_COLORS = [
  ['Ink', '#1c1a17'],
  ['White', '#ffffff'],
  ['Cream', '#f3eee4'],
  ['Coral', '#e4572e'],
  ['Moss', '#55702f'],
  ['Sky', '#2f6f9f'],
] as const;
export const DEFAULT_HIGHLIGHT = '#ffe27a';
// Faces in static/fonts. A toggle a font has no face for stays off, so the browser never synthesises one.
export const FONTS = [
  { family: 'Instrument Serif', kind: 'serif', bold: false, italic: true },
  { family: 'Playfair Display', kind: 'serif', bold: true, italic: true },
  { family: 'DM Sans', kind: 'sans', bold: true, italic: true },
  { family: 'Space Grotesk', kind: 'sans', bold: true, italic: false },
  { family: 'Caveat', kind: 'handwritten', bold: true, italic: false },
  { family: 'Anton', kind: 'display', bold: false, italic: false },
] as const;
export type Style = 'bento' | 'scrapbook';
export const TEMPLATES = ['mosaic', 'editorial', 'balanced', 'panorama'] as const;
export type Template = (typeof TEMPLATES)[number];
export interface Asset {
  id: string;
  name: string;
  masterBlob: Blob; // ≤4096px, metadata stripped, immutable
  previewBlob: Blob; // ≤1440px, editor only
  width: number; // master pixels; crops are computed in this space
  height: number;
}
export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
export interface Layer extends Box {
  type: 'photo';
  assetId: string;
  zoom: number;
  panX: number;
  panY: number;
}
// `height` always follows the wrapped text; see fitTextBox.
export interface TextLayer extends Box {
  type: 'text';
  text: string;
  fontFamily: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: (typeof TEXT_ALIGNS)[number];
  highlight?: string;
}
export type AnyLayer = Layer | TextLayer;
export type BentoNode =
  | { layerId: string }
  | { axis: 'x' | 'y'; ratio: number; first: BentoNode; second: BentoNode };
export interface BentoLayout extends Spacing {
  tree?: BentoNode;
  layers: Layer[];
  template: Template;
}
export interface Workspace {
  version: 1;
  aspect: Aspect;
  slides: number;
  style: Style;
  seed: number;
  background: string;
  bento: BentoLayout;
  // `layers` stays photos only, since layout, resize and crop all read it that way. `order` lists photo and
  // text ids bottom to top; anything unlisted stacks above it, so adding a photo or text needs no bookkeeping.
  scrapbook: { layers: Layer[]; order: string[] };
  // Text is stored once and shared by both styles. Bento floats it above the grid in this order.
  overlays: TextLayer[];
}
export interface Project {
  workspace: Workspace;
  assets: Asset[];
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface Divider extends Rect {
  path: string;
  axis: 'x' | 'y';
  position: number;
  min: number;
  max: number;
}
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function random(seed: number) {
  let n = seed + 1;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
export const activeLayers = (workspace: Workspace) => workspace[workspace.style].layers;
// All layers bottom to top, in the order they paint.
export function stack(workspace: Workspace): AnyLayer[] {
  const { bento, scrapbook, overlays, style } = workspace;
  if (style === 'bento') return [...bento.layers, ...overlays];
  const all = [...scrapbook.layers, ...overlays];
  const ids = new Set(scrapbook.order);
  return [
    ...scrapbook.order.flatMap((id) => all.find((l) => l.id === id) ?? []),
    ...all.filter((l) => !ids.has(l.id)),
  ];
}
export const updateLayer = (workspace: Workspace, layer: AnyLayer): Workspace =>
  layer.type === 'text'
    ? {
        ...workspace,
        overlays: workspace.overlays.map((l) => (l.id === layer.id ? layer : l)),
      }
    : withLayers(
        workspace,
        activeLayers(workspace).map((l) => (l.id === layer.id ? layer : l)),
      );
export const withLayers = (workspace: Workspace, layers: Layer[]): Workspace => ({
  ...workspace,
  [workspace.style]: { ...workspace[workspace.style], layers },
});
type Size = Pick<Workspace, 'aspect' | 'slides'>;
type Frame = Size & { bento: Spacing };
const rootRect = ({ aspect, slides, bento: { margin } }: Frame) => ({
  x: margin,
  y: margin,
  width: WIDTH * slides - margin * 2,
  height: ASPECTS[aspect] - margin * 2,
});
function split(rect: Rect, axis: 'x' | 'y', ratio: number, gap: number): [Rect, Rect] {
  if (axis === 'x') {
    const w = (rect.width - gap) * ratio;
    return [
      { ...rect, width: w },
      { ...rect, x: rect.x + w + gap, width: rect.width - w - gap },
    ];
  }
  const h = (rect.height - gap) * ratio;
  return [
    { ...rect, height: h },
    { ...rect, y: rect.y + h + gap, height: rect.height - h - gap },
  ];
}
function buildTree(
  ids: string[],
  rect: Rect,
  template: Template,
  rng: () => number,
  gap: number,
  depth = 0,
): BentoNode {
  if (ids.length === 1) return { layerId: ids[0] };
  const aspect = rect.width / rect.height;
  const axis =
    depth === 0 && template === 'panorama'
      ? 'y'
      : aspect > (template === 'editorial' ? 1.1 : 1.5)
        ? 'x'
        : 'y';
  const count =
    template === 'balanced'
      ? Math.ceil(ids.length / 2)
      : clamp(Math.round(ids.length * (0.35 + rng() * 0.3)), 1, ids.length - 1);
  const ratio = clamp(
    count / ids.length + (rng() - 0.5) * (template === 'balanced' ? 0 : 0.18),
    0.25,
    0.75,
  );
  const [a, b] = split(rect, axis, ratio, gap);
  return {
    axis,
    ratio,
    first: buildTree(ids.slice(0, count), a, template, rng, gap, depth + 1),
    second: buildTree(ids.slice(count), b, template, rng, gap, depth + 1),
  };
}
// Automatic Bento places photos in `order` (at most BENTO_PER_SLIDE per slide), dropping the
// last ones until every cell is at least MIN_TILE; `ids` is the tree order.
function fitBento(
  ids: string[],
  order: string[],
  frame: Frame,
  template: Template,
  rng: () => number,
): BentoNode | undefined {
  const { gap } = frame.bento;
  for (let n = Math.min(order.length, BENTO_PER_SLIDE * frame.slides); n > 0; n--) {
    const keep = new Set(order.slice(0, n));
    const tree = buildTree(
      ids.filter((id) => keep.has(id)),
      rootRect(frame),
      template,
      rng,
      gap,
    );
    let fits = true;
    visit(tree, rootRect(frame), gap, (node, rect) => {
      if ('layerId' in node && (rect.width < MIN_TILE || rect.height < MIN_TILE)) fits = false;
    });
    if (fits) return tree;
  }
}
function minimum(node: BentoNode, gap: number): { width: number; height: number } {
  if ('layerId' in node) return { width: MIN_TILE, height: MIN_TILE };
  const a = minimum(node.first, gap);
  const b = minimum(node.second, gap);
  return node.axis === 'x'
    ? {
        width: Math.max(a.width / node.ratio, b.width / (1 - node.ratio)) + gap,
        height: Math.max(a.height, b.height),
      }
    : {
        width: Math.max(a.width, b.width),
        height: Math.max(a.height / node.ratio, b.height / (1 - node.ratio)) + gap,
      };
}
function visit(
  node: BentoNode,
  rect: Rect,
  gap: number,
  fn: (node: BentoNode, rect: Rect, path: string) => void,
  path = '',
) {
  fn(node, rect, path);
  if ('layerId' in node) return;
  const [a, b] = split(rect, node.axis, node.ratio, gap);
  visit(node.first, a, gap, fn, path + '0');
  visit(node.second, b, gap, fn, path + '1');
}
export function applyBento(workspace: Workspace): Workspace {
  const { bento } = workspace;
  const rectangles = new Map<string, Rect>();
  if (bento.tree)
    visit(bento.tree, rootRect(workspace), bento.gap, (node, rect) => {
      if ('layerId' in node) rectangles.set(node.layerId, rect);
    });
  return {
    ...workspace,
    bento: {
      ...bento,
      // Layers outside the tree are unplaced and go back to the photo tray.
      layers: bento.layers
        .filter((l) => rectangles.has(l.id))
        .map((l) => ({ ...l, ...rectangles.get(l.id), rotation: 0 })),
    },
  };
}
export function dividers(workspace: Workspace): Divider[] {
  const { tree, gap } = workspace.bento;
  if (!tree || workspace.style !== 'bento') return [];
  const result: Divider[] = [];
  visit(tree, rootRect(workspace), gap, (node, rect, path) => {
    if ('layerId' in node) return;
    const a = minimum(node.first, gap);
    const b = minimum(node.second, gap);
    const axis = node.axis;
    const origin = rect[axis];
    const size = axis === 'x' ? rect.width : rect.height;
    result.push({
      ...rect,
      path,
      axis,
      position: origin + (size - gap) * node.ratio + gap / 2,
      min: origin + (axis === 'x' ? a.width : a.height) + gap / 2,
      max: origin + size - (axis === 'x' ? b.width : b.height) - gap / 2,
    });
  });
  return result;
}
function withRatio(node: BentoNode, path: string, ratio: number): BentoNode {
  if ('layerId' in node) return node;
  if (!path) return { ...node, ratio };
  return path[0] === '0'
    ? { ...node, first: withRatio(node.first, path.slice(1), ratio) }
    : { ...node, second: withRatio(node.second, path.slice(1), ratio) };
}
export function resizeDivider(workspace: Workspace, path: string, position: number): Workspace {
  const divider = dividers(workspace).find((d) => d.path === path);
  if (!divider || divider.min > divider.max) return workspace;
  const { tree, gap } = workspace.bento;
  const ratio =
    (clamp(position, divider.min, divider.max) - divider[divider.axis] - gap / 2) /
    ((divider.axis === 'x' ? divider.width : divider.height) - gap);
  return applyBento({
    ...workspace,
    bento: { ...workspace.bento, tree: withRatio(tree!, path, ratio) },
  });
}
// Swaps leaf `id` for `next`; without a replacement its sibling takes over the parent's rect.
function replaceLeaf(node: BentoNode, id: string, next?: BentoNode): BentoNode | undefined {
  if ('layerId' in node) return node.layerId === id ? next : node;
  const first = replaceLeaf(node.first, id, next);
  const second = replaceLeaf(node.second, id, next);
  return first && second ? { ...node, first, second } : (first ?? second);
}
// Removes a photo from the active layout only; it stays in the library, so the tray offers it again.
export function removeLayer(workspace: Workspace, id: string): Workspace {
  const { scrapbook } = workspace;
  const unlisted = { ...scrapbook, order: scrapbook.order.filter((o) => o !== id) };
  if (workspace.overlays.some((l) => l.id === id))
    return {
      ...workspace,
      scrapbook: unlisted,
      overlays: workspace.overlays.filter((l) => l.id !== id),
    };
  if (workspace.style === 'scrapbook')
    return {
      ...workspace,
      scrapbook: { ...unlisted, layers: scrapbook.layers.filter((l) => l.id !== id) },
    };
  const { bento } = workspace;
  return applyBento({
    ...workspace,
    bento: { ...bento, tree: bento.tree && replaceLeaf(bento.tree, id) },
  });
}
export function removeAsset(workspace: Workspace, assetId: string): Workspace {
  let { tree } = workspace.bento;
  for (const l of workspace.bento.layers)
    if (l.assetId === assetId) tree = tree && replaceLeaf(tree, l.id);
  const { scrapbook } = workspace;
  const layers = scrapbook.layers.filter((l) => l.assetId !== assetId);
  const gone = scrapbook.layers.filter((l) => l.assetId === assetId).map((l) => l.id);
  return applyBento({
    ...workspace,
    bento: { ...workspace.bento, tree },
    scrapbook: { layers, order: scrapbook.order.filter((id) => !gone.includes(id)) },
  });
}
// Splits `target` (or the largest cell) 50/50 along its longer side; returns `workspace` itself when that would leave a cell below MIN_TILE.
export function addToBento(workspace: Workspace, assetId: string, target?: string): Workspace {
  const { bento } = workspace;
  const layer: Layer = {
    type: 'photo',
    id: crypto.randomUUID(),
    assetId,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    zoom: 1,
    panX: 0.5,
    panY: 0.5,
  };
  const layers = [...bento.layers, layer];
  if (!bento.tree)
    return applyBento({ ...workspace, bento: { ...bento, layers, tree: { layerId: layer.id } } });
  const cell =
    bento.layers.find((l) => l.id === target) ??
    bento.layers.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  const axis = cell.width >= cell.height ? 'x' : 'y';
  if (((axis === 'x' ? cell.width : cell.height) - bento.gap) / 2 < MIN_TILE) return workspace;
  const tree = replaceLeaf(bento.tree, cell.id, {
    axis,
    ratio: 0.5,
    first: { layerId: cell.id },
    second: { layerId: layer.id },
  });
  return applyBento({ ...workspace, bento: { ...bento, layers, tree } });
}
// New uploads reach both layouts. An empty Bento gets an automatic layout; `target` applies to a single photo.
export function addPhotos(workspace: Workspace, assets: Asset[], target?: string): Workspace {
  const { scrapbook, bento } = workspace;
  const seed = workspace.seed + scrapbook.layers.length;
  const placed = layout(assets, 'scrapbook', seed, undefined, workspace).scrapbook.layers;
  const next = {
    ...workspace,
    scrapbook: {
      ...scrapbook,
      layers: [...scrapbook.layers, ...placed.map((l) => ({ ...l, id: crypto.randomUUID() }))],
    },
  };
  if (!bento.tree)
    return {
      ...next,
      bento: layout(assets, 'bento', workspace.seed, bento.template, workspace).bento,
    };
  return assets.reduce(
    (w, a) => addToBento(w, a.id, assets.length === 1 ? target : undefined),
    next as Workspace,
  );
}
// Largest value up to `value` that keeps every cell at least MIN_TILE.
export function setSpacing(workspace: Workspace, key: keyof Spacing, value: number): Workspace {
  for (let v = value; v >= 0; v--) {
    const next = applyBento({ ...workspace, bento: { ...workspace.bento, [key]: v } });
    if (next.bento.layers.every((l) => Math.min(l.width, l.height) >= MIN_TILE - 0.001))
      return next;
  }
  return workspace;
}
export function layout(
  assets: Asset[],
  style: Style,
  seed = 0,
  template: Template = TEMPLATES[seed % TEMPLATES.length],
  base: Size & Partial<Pick<Workspace, 'background' | 'overlays'>> & { bento?: Spacing } = {
    aspect: '4:5',
    slides: 3,
  },
): Workspace {
  const { aspect, slides } = base;
  if (assets.length > MAX_PHOTOS)
    throw new Error(`Keep your collage to ${MAX_PHOTOS} photos or fewer.`);
  const slideHeight = ASPECTS[aspect];
  const rng = random(seed * 37 + TEMPLATES.indexOf(template) * 103);
  const ordered = [...assets];
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  const layers = ordered.map((asset, i): Layer => {
    const slide = Math.floor((i * slides) / assets.length);
    const first = Math.ceil((slide * assets.length) / slides);
    const local = i - first;
    const count = Math.ceil(((slide + 1) * assets.length) / slides) - first;
    const cols = count > 2 ? 2 : 1;
    const rows = Math.ceil(count / cols);
    const maxW = WIDTH / (cols === 1 ? 1.35 : 1.85);
    const maxH = slideHeight / (rows + 0.25);
    const aspect = asset.width && asset.height ? asset.width / asset.height : 0.8;
    const width = Math.min(maxW, maxH * aspect) * (0.92 + rng() * 0.15);
    const height = width / aspect;
    return {
      type: 'photo',
      id: `layer-${i}`,
      assetId: asset.id,
      x: slide * WIDTH + (((local % cols) + 0.5) * WIDTH) / cols - width / 2 + (rng() - 0.5) * 100,
      y: ((Math.floor(local / cols) + 0.5) * slideHeight) / rows - height / 2 + (rng() - 0.5) * 100,
      width,
      height,
      rotation: (rng() - 0.5) * 18,
      zoom: 1,
      panX: 0.5,
      panY: 0.5,
    };
  });
  const { gap = 12, margin = 24, radius = 0 } = base.bento ?? {};
  const workspace: Workspace = {
    version: 1,
    aspect,
    slides,
    style,
    seed,
    background: base.background ?? BACKGROUNDS[0][1],
    bento: { layers, template, gap, margin, radius },
    scrapbook: { layers, order: [] },
    overlays: base.overlays ?? [],
  };
  if (!layers.length) return workspace;
  // Layer ids are in shuffled order; placement priority follows the incoming photo order.
  const rank = new Map(assets.map((a, i) => [a.id, i]));
  workspace.bento.tree = fitBento(
    layers.map((l) => l.id),
    [...layers].sort((a, b) => rank.get(a.assetId)! - rank.get(b.assetId)!).map((l) => l.id),
    workspace,
    template,
    rng,
  );
  return applyBento(workspace);
}
// Shuffle and templates rebuild the active layout only; the other style keeps what was left.
export function regenerate(
  workspace: Workspace,
  assets: Asset[],
  seed: number,
  template?: Template,
): Workspace {
  const fresh = layout(assets, workspace.style, seed, template, workspace);
  return workspace.style === 'bento'
    ? { ...fresh, scrapbook: workspace.scrapbook }
    : { ...fresh, bento: workspace.bento };
}
// Bento rebuilds the tree in the same layer order (crops kept, dividers reset). Scrapbook keeps
// photo proportions: size and centre y scale by the height ratio, centre x stays (width is fixed).
// Layers centred past a removed slide move onto the last slide. Every Scrapbook layer stays grabbable.
// Text does the same in both styles, its font scaling with its box.
export function resize(workspace: Workspace, aspect: Aspect, slides: number): Workspace {
  const next = { ...workspace, aspect, slides };
  const { template } = workspace.bento;
  const rng = random(workspace.seed * 37 + TEMPLATES.indexOf(template) * 103);
  const ids = workspace.bento.layers.map((l) => l.id);
  const tree = fitBento(ids, ids, next, template, rng);
  const k = ASPECTS[aspect] / ASPECTS[workspace.aspect];
  const end = WIDTH * slides;
  const rescale = <T extends Box>(l: T, width = l.width * k): T => {
    const height = l.height * k;
    const cx = l.x + l.width / 2;
    const x =
      cx > end
        ? clamp(
            end - WIDTH + (cx % WIDTH) - width / 2,
            end - WIDTH,
            Math.max(end - WIDTH, end - width),
          )
        : cx - width / 2;
    const y = (l.y + l.height / 2) * k - height / 2;
    return keepOnCanvas({ ...l, width, height, x, y }, end, ASPECTS[aspect]);
  };
  return {
    ...applyBento({ ...next, bento: { ...workspace.bento, tree } }),
    scrapbook: {
      ...workspace.scrapbook,
      layers: workspace.scrapbook.layers.map((l) => rescale(l)),
    },
    overlays: workspace.overlays.map((l) => ({
      ...rescale(l, Math.max(TEXT_MIN_WIDTH, l.width * k)),
      size: clamp(l.size * k, TEXT_SIZE.min, TEXT_SIZE.max),
    })),
  };
}
// Moves a layer until at least GRAB px of its rotated bounding box (or all of it, if smaller)
// overlaps a canvas of the given size on each axis.
export function keepOnCanvas<T extends Box>(layer: T, width: number, height: number): T {
  const angle = (layer.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const along = (box: number, canvas: number, centre: number) => {
    const g = Math.min(GRAB, box, canvas);
    // g ≤ box and g ≤ canvas, so the lower limit never exceeds the upper one.
    return clamp(centre, g - box / 2, canvas - g + box / 2) - centre;
  };
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  return {
    ...layer,
    x: layer.x + along(layer.width * cos + layer.height * sin, width, cx),
    y: layer.y + along(layer.width * sin + layer.height * cos, height, cy),
  };
}
export function coverCrop(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  zoom: number,
  px: number,
  py: number,
) {
  const scale = Math.max(dw / sw, dh / sh) * Math.max(1, zoom);
  const width = dw / scale;
  const height = dh / scale;
  return { x: (sw - width) * clamp(px, 0, 1), y: (sh - height) * clamp(py, 0, 1), width, height };
}
// Distance from a layer's centre that its rotated frame, Scrapbook border and shadow, or glyph overhang stay within.
export const layerReach = (l: AnyLayer) =>
  Math.hypot(l.width + 24, l.height + 64) / 2 + 60 + (l.type === 'text' ? l.size / 2 : 0);
// Layers that can reach slide `slide`.
export function slideLayers(workspace: Workspace, slide: number) {
  return stack(workspace).filter((l) => {
    const reach = layerReach(l);
    const cx = l.x + l.width / 2;
    return cx + reach > slide * WIDTH && cx - reach < (slide + 1) * WIDTH;
  });
}
export function localPoint(layer: Box, point: Point): Point {
  const angle = (-layer.rotation * Math.PI) / 180;
  const dx = point.x - layer.x - layer.width / 2;
  const dy = point.y - layer.y - layer.height / 2;
  return {
    x: dx * Math.cos(angle) - dy * Math.sin(angle),
    y: dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}
// The topmost of `layers` (bottom to top) under `point`.
export function hitLayer<T extends Box>(layers: T[], point: Point): T | undefined {
  return [...layers].reverse().find((l) => {
    const p = localPoint(l, point);
    return Math.abs(p.x) <= l.width / 2 && Math.abs(p.y) <= l.height / 2;
  });
}
export function swapPhotos(workspace: Workspace, source: string, target: string): Workspace {
  const layers = activeLayers(workspace);
  const a = layers.find((l) => l.id === source);
  const b = layers.find((l) => l.id === target);
  if (!a || !b || a === b) return workspace;
  return withLayers(
    workspace,
    layers.map((l) => {
      const source = l.id === a.id ? b : l.id === b.id ? a : undefined;
      return source
        ? { ...l, assetId: source.assetId, zoom: source.zoom, panX: source.panX, panY: source.panY }
        : l;
    }),
  );
}
export function resizeLayer(
  layer: Layer,
  pointer: Point,
  corner: string,
  stage: { width: number; height: number },
): Layer {
  const sx = corner.includes('e') ? 1 : -1;
  const sy = corner.includes('s') ? 1 : -1;
  const angle = (layer.rotation * Math.PI) / 180;
  const ux = { x: Math.cos(angle), y: Math.sin(angle) };
  const uy = { x: -Math.sin(angle), y: Math.cos(angle) };
  const anchor = {
    x:
      layer.x +
      layer.width / 2 -
      ((sx * layer.width) / 2) * ux.x -
      ((sy * layer.height) / 2) * uy.x,
    y:
      layer.y +
      layer.height / 2 -
      ((sx * layer.width) / 2) * ux.y -
      ((sy * layer.height) / 2) * uy.y,
  };
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  const w = sx * (dx * ux.x + dy * ux.y);
  const h = sy * (dx * uy.x + dy * uy.y);
  const scale = clamp(
    (w * layer.width + h * layer.height) / (layer.width ** 2 + layer.height ** 2),
    Math.max(80 / layer.width, 80 / layer.height),
    Math.min(stage.width / layer.width, (stage.height * 2) / layer.height),
  );
  const width = layer.width * scale;
  const height = layer.height * scale;
  return {
    ...layer,
    width,
    height,
    x: anchor.x + ((sx * width) / 2) * ux.x + ((sy * height) / 2) * uy.x - width / 2,
    y: anchor.y + ((sx * width) / 2) * ux.y + ((sy * height) / 2) * uy.y - height / 2,
  };
}
// Scrapbook moves a layer through the shared stack. Bento's grid has no z-order, so only floating text moves.
export function reorderLayer(
  workspace: Workspace,
  id: string,
  direction: 'front' | 'back' | 'forward' | 'backward',
): Workspace {
  const bento = workspace.style === 'bento';
  const layers: AnyLayer[] = bento ? [...workspace.overlays] : stack(workspace);
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0) return workspace;
  const j =
    direction === 'front'
      ? layers.length - 1
      : direction === 'back'
        ? 0
        : clamp(i + (direction === 'forward' ? 1 : -1), 0, layers.length - 1);
  if (i === j) return workspace;
  const [layer] = layers.splice(i, 1);
  layers.splice(j, 0, layer);
  if (bento) return { ...workspace, overlays: layers as TextLayer[] };
  return {
    ...workspace,
    scrapbook: {
      layers: layers.filter((l) => l.type === 'photo'),
      order: layers.map((l) => l.id),
    },
  };
}
export const fontOf = ({ fontFamily, bold, italic, size }: TextLayer) => {
  const face = FONTS.find((f) => f.family === fontFamily);
  const b = bold && (face?.bold ?? true);
  const i = italic && (face?.italic ?? true);
  return `${i ? 'italic' : 'normal'} ${b ? 700 : 400} ${size}px "${fontFamily}"`;
};
const LINE_HEIGHT = 1.25;
export const lineHeight = (l: TextLayer) => l.size * LINE_HEIGHT;
// Text sits this far inside the box on both sides, so turning the highlight pill on never rewraps it.
export const textPad = (l: TextLayer) => l.size * 0.3;
// Greedy word wrap; a word wider than `width` breaks between graphemes, so a line always takes at least one.
export function wrapText(text: string, width: number, measure: (s: string) => number) {
  const graphemes = new Intl.Segmenter();
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const joined = line ? `${line} ${word}` : word;
      if (measure(joined) <= width) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      if (measure(word) <= width) {
        line = word;
        continue;
      }
      for (const { segment } of graphemes.segment(word)) {
        if (line && measure(line + segment) > width) {
          lines.push(line);
          line = '';
        }
        line += segment;
      }
    }
    lines.push(line);
  }
  return lines;
}
export const textLines = (l: TextLayer, measure: (s: string) => number) =>
  wrapText(l.text, Math.max(1, l.width - 2 * textPad(l)), measure);
// Height follows the text, growing downwards along the layer's own rotated axis so its top edge stays put.
export function fitTextBox(l: TextLayer, measure: (s: string) => number): TextLayer {
  const height = textLines(l, measure).length * lineHeight(l);
  const angle = (l.rotation * Math.PI) / 180;
  const grow = (height - l.height) / 2;
  return {
    ...l,
    height,
    x: l.x - grow * Math.sin(angle),
    y: l.y - grow + grow * Math.cos(angle),
  };
}
// Drags one side along the layer's own axis, keeping the opposite side fixed; the caller refits the height.
export function resizeTextWidth(l: TextLayer, pointer: Point, side: string, max: number) {
  const sign = side === 'e' ? 1 : -1;
  const angle = (l.rotation * Math.PI) / 180;
  const ux = { x: Math.cos(angle), y: Math.sin(angle) };
  const cx = l.x + l.width / 2;
  const cy = l.y + l.height / 2;
  const anchor = { x: cx - ((sign * l.width) / 2) * ux.x, y: cy - ((sign * l.width) / 2) * ux.y };
  const reach = sign * ((pointer.x - anchor.x) * ux.x + (pointer.y - anchor.y) * ux.y);
  const width = clamp(reach, TEXT_MIN_WIDTH, max);
  return {
    ...l,
    width,
    x: anchor.x + ((sign * width) / 2) * ux.x - width / 2,
    y: anchor.y + ((sign * width) / 2) * ux.y - l.height / 2,
  };
}
// Fixed values, not theme tokens: text colors and fonts are project data.
export const newText = (slide: number, slideHeight: number): TextLayer => {
  const width = 720;
  const size = 72;
  return {
    type: 'text',
    id: crypto.randomUUID(),
    text: 'Your text',
    fontFamily: 'DM Sans',
    size,
    color: TEXT_COLORS[0][1],
    bold: false,
    italic: false,
    align: 'center',
    x: slide * WIDTH + (WIDTH - width) / 2,
    y: (slideHeight - size * LINE_HEIGHT) / 2,
    width,
    height: size * LINE_HEIGHT,
    rotation: 0,
  };
};
