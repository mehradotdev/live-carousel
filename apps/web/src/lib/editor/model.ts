export const WIDTH = 1080;
export const MAX_SLIDES = 20;
// Slide height per aspect; every slide is WIDTH wide.
export const ASPECTS = { '4:5': 1350, '3:4': 1440, '1:1': 1080, '9:16': 1920 } as const;
export type Aspect = keyof typeof ASPECTS;
export const slideSize = (aspect: Aspect) => ({ width: WIDTH, height: ASPECTS[aspect] });
export const GAP = 12;
export const INSET = 24;
export const MIN_TILE = 120;
export const BENTO_PER_SLIDE = 6;
// Scrapbook layers always keep this much of their rotated bounds on the canvas.
export const GRAB = 48;
export const MAX_PHOTOS = 100;
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
export interface Layer {
  id: string;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zoom: number;
  panX: number;
  panY: number;
}
export type BentoNode =
  | { layerId: string }
  | { axis: 'x' | 'y'; ratio: number; first: BentoNode; second: BentoNode };
export interface Workspace {
  version: 1;
  aspect: Aspect;
  slides: number;
  style: Style;
  seed: number;
  background: string;
  layers: Layer[];
  template?: Template;
  bento?: BentoNode;
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
type Size = Pick<Workspace, 'aspect' | 'slides'>;
const rootRect = ({ aspect, slides }: Size) => ({
  x: INSET,
  y: INSET,
  width: WIDTH * slides - INSET * 2,
  height: ASPECTS[aspect] - INSET * 2,
});
function split(rect: Rect, axis: 'x' | 'y', ratio: number): [Rect, Rect] {
  if (axis === 'x') {
    const w = (rect.width - GAP) * ratio;
    return [
      { ...rect, width: w },
      { ...rect, x: rect.x + w + GAP, width: rect.width - w - GAP },
    ];
  }
  const h = (rect.height - GAP) * ratio;
  return [
    { ...rect, height: h },
    { ...rect, y: rect.y + h + GAP, height: rect.height - h - GAP },
  ];
}
function buildTree(
  ids: string[],
  rect: Rect,
  template: Template,
  rng: () => number,
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
  const [a, b] = split(rect, axis, ratio);
  return {
    axis,
    ratio,
    first: buildTree(ids.slice(0, count), a, template, rng, depth + 1),
    second: buildTree(ids.slice(count), b, template, rng, depth + 1),
  };
}
// Automatic Bento places photos in `order` (at most BENTO_PER_SLIDE per slide), dropping the
// last ones until every cell is at least MIN_TILE; `ids` is the tree order.
function fitBento(
  ids: string[],
  order: string[],
  size: Size,
  template: Template,
  rng: () => number,
): BentoNode | undefined {
  for (let n = Math.min(order.length, BENTO_PER_SLIDE * size.slides); n > 0; n--) {
    const keep = new Set(order.slice(0, n));
    const tree = buildTree(
      ids.filter((id) => keep.has(id)),
      rootRect(size),
      template,
      rng,
    );
    let fits = true;
    visit(tree, rootRect(size), (node, rect) => {
      if ('layerId' in node && (rect.width < MIN_TILE || rect.height < MIN_TILE)) fits = false;
    });
    if (fits) return tree;
  }
}
function minimum(node: BentoNode): { width: number; height: number } {
  if ('layerId' in node) return { width: MIN_TILE, height: MIN_TILE };
  const a = minimum(node.first);
  const b = minimum(node.second);
  return node.axis === 'x'
    ? {
        width: Math.max(a.width / node.ratio, b.width / (1 - node.ratio)) + GAP,
        height: Math.max(a.height, b.height),
      }
    : {
        width: Math.max(a.width, b.width),
        height: Math.max(a.height / node.ratio, b.height / (1 - node.ratio)) + GAP,
      };
}
function visit(
  node: BentoNode,
  rect: Rect,
  fn: (node: BentoNode, rect: Rect, path: string) => void,
  path = '',
) {
  fn(node, rect, path);
  if ('layerId' in node) return;
  const [a, b] = split(rect, node.axis, node.ratio);
  visit(node.first, a, fn, path + '0');
  visit(node.second, b, fn, path + '1');
}
export function applyBento(workspace: Workspace): Workspace {
  if (!workspace.bento) return workspace;
  const rectangles = new Map<string, Rect>();
  visit(workspace.bento, rootRect(workspace), (node, rect) => {
    if ('layerId' in node) rectangles.set(node.layerId, rect);
  });
  return {
    ...workspace,
    // Layers outside the tree are unplaced and go back to the photo tray.
    layers: workspace.layers
      .filter((l) => rectangles.has(l.id))
      .map((l) => ({ ...l, ...rectangles.get(l.id), rotation: 0 })),
  };
}
export function dividers(workspace: Workspace): Divider[] {
  if (!workspace.bento || workspace.style !== 'bento') return [];
  const result: Divider[] = [];
  visit(workspace.bento, rootRect(workspace), (node, rect, path) => {
    if ('layerId' in node) return;
    const a = minimum(node.first);
    const b = minimum(node.second);
    const axis = node.axis;
    const origin = rect[axis];
    const size = axis === 'x' ? rect.width : rect.height;
    result.push({
      ...rect,
      path,
      axis,
      position: origin + (size - GAP) * node.ratio + GAP / 2,
      min: origin + (axis === 'x' ? a.width : a.height) + GAP / 2,
      max: origin + size - (axis === 'x' ? b.width : b.height) - GAP / 2,
    });
  });
  return result;
}
export function resizeDivider(workspace: Workspace, path: string, position: number): Workspace {
  const divider = dividers(workspace).find((d) => d.path === path);
  if (!divider || divider.min > divider.max) return workspace;
  const tree = structuredClone(workspace.bento!);
  let node = tree;
  for (const char of path) {
    if ('layerId' in node) return workspace;
    node = char === '0' ? node.first : node.second;
  }
  if ('layerId' in node) return workspace;
  node.ratio =
    (clamp(position, divider.min, divider.max) - divider[node.axis] - GAP / 2) /
    ((node.axis === 'x' ? divider.width : divider.height) - GAP);
  return applyBento({ ...workspace, bento: tree });
}
export function layout(
  assets: Asset[],
  style: Style,
  seed = 0,
  template: Template = TEMPLATES[seed % TEMPLATES.length],
  { aspect, slides }: Size = { aspect: '4:5', slides: 3 },
): Workspace {
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
  const workspace: Workspace = {
    version: 1,
    aspect,
    slides,
    style,
    seed,
    background: '#f3eee4',
    layers,
    template,
  };
  if (style === 'scrapbook' || !layers.length) return workspace;
  // Layer ids are in shuffled order; placement priority follows the incoming photo order.
  const rank = new Map(assets.map((a, i) => [a.id, i]));
  workspace.bento = fitBento(
    layers.map((l) => l.id),
    [...layers].sort((a, b) => rank.get(a.assetId)! - rank.get(b.assetId)!).map((l) => l.id),
    workspace,
    template,
    rng,
  );
  return applyBento(workspace);
}
// Bento rebuilds the tree in the same layer order (crops kept, dividers reset). Scrapbook keeps
// photo proportions: size and centre y scale by the height ratio, centre x stays (width is fixed).
// Layers centred past a removed slide move onto the last slide. Every Scrapbook layer stays grabbable.
export function resize(workspace: Workspace, aspect: Aspect, slides: number): Workspace {
  const next = { ...workspace, aspect, slides };
  if (workspace.style === 'bento') {
    const template = workspace.template ?? TEMPLATES[workspace.seed % TEMPLATES.length];
    const rng = random(workspace.seed * 37 + TEMPLATES.indexOf(template) * 103);
    const ids = workspace.layers.map((l) => l.id);
    const bento = fitBento(ids, ids, next, template, rng);
    return applyBento({ ...next, template, bento });
  }
  const k = ASPECTS[aspect] / ASPECTS[workspace.aspect];
  const end = WIDTH * slides;
  return {
    ...next,
    layers: workspace.layers.map((l) => {
      const width = l.width * k;
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
    }),
  };
}
// Moves a layer until at least GRAB px of its rotated bounding box (or all of it, if smaller)
// overlaps a canvas of the given size on each axis.
export function keepOnCanvas(layer: Layer, width: number, height: number): Layer {
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
// Layers whose rotated frame, Scrapbook border or shadow can reach slide `slide`.
export function slideLayers(workspace: Workspace, slide: number) {
  return workspace.layers.filter((l) => {
    const reach = Math.hypot(l.width + 24, l.height + 64) / 2 + 60;
    const cx = l.x + l.width / 2;
    return cx + reach > slide * WIDTH && cx - reach < (slide + 1) * WIDTH;
  });
}
export function localPoint(layer: Layer, point: Point): Point {
  const angle = (-layer.rotation * Math.PI) / 180;
  const dx = point.x - layer.x - layer.width / 2;
  const dy = point.y - layer.y - layer.height / 2;
  return {
    x: dx * Math.cos(angle) - dy * Math.sin(angle),
    y: dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}
export function hitLayer(workspace: Workspace, point: Point): Layer | undefined {
  return [...workspace.layers].reverse().find((l) => {
    const p = localPoint(l, point);
    return Math.abs(p.x) <= l.width / 2 && Math.abs(p.y) <= l.height / 2;
  });
}
export function swapPhotos(workspace: Workspace, source: string, target: string): Workspace {
  const a = workspace.layers.find((l) => l.id === source);
  const b = workspace.layers.find((l) => l.id === target);
  if (!a || !b || a === b) return workspace;
  return {
    ...workspace,
    layers: workspace.layers.map((l) => {
      const source = l.id === a.id ? b : l.id === b.id ? a : undefined;
      return source
        ? { ...l, assetId: source.assetId, zoom: source.zoom, panX: source.panX, panY: source.panY }
        : l;
    }),
  };
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
export function reorderLayer(
  workspace: Workspace,
  id: string,
  direction: 'front' | 'back' | 'forward' | 'backward',
): Workspace {
  const layers = [...workspace.layers];
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0) return workspace;
  const j =
    direction === 'front'
      ? layers.length - 1
      : direction === 'back'
        ? 0
        : clamp(i + (direction === 'forward' ? 1 : -1), 0, layers.length - 1);
  const [layer] = layers.splice(i, 1);
  layers.splice(j, 0, layer);
  return { ...workspace, layers };
}
