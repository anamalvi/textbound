import {
  prepareWithSegments,
  layoutNextLineRange,
  materializeLineRange,
} from "@chenglou/pretext";

/** Block-level carriers — use full textContent (includes nested inline tags). */
const BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, dd, blockquote, td, th, figcaption, label";

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "PATH",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "CODE",
  "PRE",
]);

const FLOAT_PROBE_SELECTOR = "img, figure, table, aside, div, span, picture";
const MAX_BLOCKS = 80;
const CELL = 10;
const FLOAT_GAP = 6;

/**
 * Build a canvas font string from computed styles.
 * Avoid system-ui — Pretext documents inaccurate measurement with it on macOS.
 */
export function canvasFontFromStyle(style) {
  const size = style.fontSize || "16px";
  const weight = style.fontWeight && style.fontWeight !== "normal" ? style.fontWeight : "";
  const italic = style.fontStyle === "italic" || style.fontStyle === "oblique" ? style.fontStyle : "";
  let family = (style.fontFamily || "Georgia")
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .find((f) => f && f !== "system-ui" && f !== "-apple-system" && f !== "BlinkMacSystemFont") || "Georgia";
  if (/\s/.test(family) && !/^["']/.test(family)) family = `"${family}"`;
  return [italic, weight, size, family].filter(Boolean).join(" ");
}

function parseLineHeight(style, fontSizePx) {
  const lh = style.lineHeight;
  if (!lh || lh === "normal") return fontSizePx * 1.2;
  if (lh.endsWith("px")) return parseFloat(lh);
  const num = parseFloat(lh);
  if (!Number.isFinite(num)) return fontSizePx * 1.2;
  if (!/[a-z%]/i.test(lh)) return num * fontSizePx;
  return num;
}

function isVisible(el, viewport) {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  if (rect.bottom < 0 || rect.top > viewport.height) return false;
  if (rect.right < 0 || rect.left > viewport.width) return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
    return false;
  }
  return true;
}

function isInsideFloat(el) {
  let node = el;
  while (node) {
    const f = getComputedStyle(node).float;
    if (f === "left" || f === "right") return true;
    node = node.parentElement;
  }
  return false;
}

function getLayoutScope(el) {
  return (
    el.closest(".mw-parser-output") ||
    el.closest("article") ||
    el.closest("main") ||
    el.closest("#content") ||
    el.parentElement
  );
}

/** Floated siblings/ancestors (e.g. Wikipedia infobox) that steal horizontal space. */
function collectFloatObstacles(el, textRect) {
  const scope = getLayoutScope(el);
  if (!scope) return [];

  const obstacles = [];
  for (const node of scope.querySelectorAll(FLOAT_PROBE_SELECTOR)) {
    if (node === el || el.contains(node)) continue;
    const style = getComputedStyle(node);
    if (style.float !== "left" && style.float !== "right") continue;

    const r = node.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.bottom <= textRect.top || r.top >= textRect.bottom) continue;

    obstacles.push({ rect: r, side: style.float });
  }
  return obstacles;
}

function lineFlow(originX, baseMaxWidth, y, lineHeight, obstacles) {
  let lineX = originX;
  let maxW = baseMaxWidth;

  for (const { rect, side } of obstacles) {
    if (y + lineHeight <= rect.top || y >= rect.bottom) continue;

    if (side === "right") {
      const available = rect.left - originX - FLOAT_GAP;
      if (available > 24) maxW = Math.min(maxW, available);
    } else {
      const push = rect.right - originX + FLOAT_GAP;
      if (push > 0 && push < baseMaxWidth - 24) {
        lineX = Math.max(lineX, rect.right + FLOAT_GAP);
        maxW = Math.min(maxW, originX + baseMaxWidth - lineX);
      }
    }
  }

  return { lineX, maxW: Math.max(20, maxW) };
}

function alignLineX(lineX, maxW, lineWidth, textAlign) {
  if (textAlign === "center") return lineX + (maxW - lineWidth) / 2;
  if (textAlign === "right" || textAlign === "end") return lineX + maxW - lineWidth;
  return lineX;
}

function inkBoxesForLine(prepared, line, originX, originY, lineHeight, lineIndex) {
  const boxes = [];
  let x = originX;
  const y = originY + lineIndex * lineHeight;
  const inkH = Math.max(lineHeight * 0.72, 8);
  const inkY = y + (lineHeight - inkH) * 0.35;

  for (let seg = line.start.segmentIndex; seg < line.end.segmentIndex; seg++) {
    const w = prepared.widths[seg];
    const kind = prepared.kinds[seg];
    if (kind === "text" && w > 0.5) {
      boxes.push({ x, y: inkY, w, h: inkH });
    }
    x += w;
  }

  if (
    line.end.graphemeIndex > 0 &&
    line.end.segmentIndex < prepared.segments.length
  ) {
    const seg = line.end.segmentIndex;
    const kind = prepared.kinds[seg];
    const fullW = prepared.widths[seg];
    if (kind === "text" && fullW > 0.5) {
      const text = prepared.segments[seg] || "";
      const ratio =
        text.length > 0 ? Math.min(1, line.end.graphemeIndex / [...text].length) : 1;
      boxes.push({
        x,
        y: inkY,
        w: fullW * ratio,
        h: inkH,
      });
    }
  }

  return boxes;
}

function boxIsPlausible(box, textRect, obstacles, lineHeight) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (cx < textRect.left - 4 || cx > textRect.right + 4) return false;
  if (cy < textRect.top - 4 || cy > textRect.bottom + 4) return false;

  for (const { rect, side } of obstacles) {
    if (cy < rect.top - 2 || cy > rect.bottom + lineHeight) continue;
    if (side === "right" && cx > rect.left - FLOAT_GAP) return false;
    if (side === "left" && cx < rect.right + FLOAT_GAP) return false;
  }
  return true;
}

/**
 * Collect visible block text. Nested lists (li inside li) prefer the deeper node.
 */
function collectTextBlocks(root, hostId) {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const candidates = [];

  for (const el of root.querySelectorAll(BLOCK_SELECTOR)) {
    if (el.closest(`#${hostId}`)) continue;
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (el.closest("svg")) continue;
    if (isInsideFloat(el)) continue;
    if (!isVisible(el, viewport)) continue;

    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < 2) continue;

    candidates.push({ el, text, rect: el.getBoundingClientRect() });
    if (candidates.length >= MAX_BLOCKS * 4) break;
  }

  const kept = [];
  for (const c of candidates) {
    let dominated = false;
    for (let i = kept.length - 1; i >= 0; i--) {
      const k = kept[i];
      if (c.el.contains(k.el)) {
        dominated = true;
        break;
      }
      if (k.el.contains(c.el)) kept.splice(i, 1);
    }
    if (!dominated) kept.push(c);
  }

  kept.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  return kept.slice(0, MAX_BLOCKS);
}

function layoutBlock(el, text) {
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const padT = parseFloat(style.paddingTop) || 0;
  const fontSizePx = parseFloat(style.fontSize) || 16;
  const lineHeight = parseLineHeight(style, fontSizePx);
  const baseMaxWidth = Math.max(20, rect.width - padL - padR);
  const font = canvasFontFromStyle(style);
  const textAlign = style.textAlign || "left";
  const originX = rect.left + padL;
  const originY = rect.top + padT;
  const obstacles = collectFloatObstacles(el, rect);

  let prepared;
  try {
    prepared = prepareWithSegments(text, font);
  } catch {
    return [];
  }

  const boxes = [];
  let cursor = { segmentIndex: 0, graphemeIndex: 0 };
  let lineIndex = 0;

  while (true) {
    const y = originY + lineIndex * lineHeight;
    const { lineX, maxW } = lineFlow(originX, baseMaxWidth, y, lineHeight, obstacles);
    const range = layoutNextLineRange(prepared, cursor, maxW);
    if (range === null) break;

    const line = materializeLineRange(prepared, range);
    const x = alignLineX(lineX, maxW, line.width, textAlign);
    const lineBoxes = inkBoxesForLine(prepared, line, x, originY, lineHeight, lineIndex);

    for (const b of lineBoxes) {
      if (boxIsPlausible(b, rect, obstacles, lineHeight)) boxes.push(b);
    }

    cursor = range.end;
    lineIndex++;
  }

  return boxes;
}

// ---------------------------------------------------------------------------
// Element obstacles (optional) — imgs / controls as solid walls.
// Toggle off or delete this whole section + the single call in
// buildTextOccupancy() if this feels bad in playtesting.
// ---------------------------------------------------------------------------
/** Kill switch: set false to disable without deleting the helper. */
export const INCLUDE_ELEMENT_OBSTACLES = true;

const ELEMENT_OBSTACLE_SELECTOR = "img, video, button, input, a";

/**
 * Easy-win solid obstacles from media & controls (DOM boxes, not Pretext).
 * Separate from word-ink so it can be removed cleanly.
 * @returns {{x:number,y:number,w:number,h:number}[]}
 */
export function collectElementObstacleBoxes(hostId = "any-page-snake-host") {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const boxes = [];
  const root = document.body || document.documentElement;
  if (!root) return boxes;

  for (const el of root.querySelectorAll(ELEMENT_OBSTACLE_SELECTOR)) {
    if (el.closest(`#${hostId}`)) continue;
    if (el.closest("svg")) continue;

    // Text-heavy anchors block whole paragraphs; keep button-like / media links only.
    if (el.tagName === "A") {
      if (el.querySelector("p, h1, h2, h3, h4, h5, h6, li, blockquote")) continue;
      const linkText = (el.textContent || "").replace(/\s+/g, " ").trim();
      const rProbe = el.getBoundingClientRect();
      if (linkText.length > 60 && rProbe.height > 48 && !el.querySelector("img, video, svg")) {
        continue;
      }
    }

    if (!isVisible(el, viewport)) continue;

    const r = el.getBoundingClientRect();
    boxes.push({ x: r.left, y: r.top, w: r.width, h: r.height });
  }

  return boxes;
}
// ---------------------------------------------------------------------------

/**
 * @returns {{
 *   cell: number,
 *   cols: number,
 *   rows: number,
 *   blocked: Uint8Array,
 *   boxes: {x:number,y:number,w:number,h:number}[],
 *   elementBoxes: {x:number,y:number,w:number,h:number}[],
 *   openCells: {x:number,y:number}[],
 * }}
 */
export function buildTextOccupancy(hostId = "any-page-snake-host") {
  const cols = Math.max(8, Math.floor(window.innerWidth / CELL));
  const rows = Math.max(8, Math.floor(window.innerHeight / CELL));
  const blocked = new Uint8Array(cols * rows);
  const boxes = [];

  const blocks = collectTextBlocks(document.body || document.documentElement, hostId);
  for (const { el, text } of blocks) {
    const blockBoxes = layoutBlock(el, text);
    for (const b of blockBoxes) boxes.push(b);
  }

  // Optional solid obstacles — flip INCLUDE_ELEMENT_OBSTACLES or remove this block.
  const elementBoxes = INCLUDE_ELEMENT_OBSTACLES
    ? collectElementObstacleBoxes(hostId)
    : [];

  const allBoxes = boxes.concat(elementBoxes);
  for (const b of allBoxes) {
    const x0 = Math.max(0, Math.floor(b.x / CELL));
    const y0 = Math.max(0, Math.floor(b.y / CELL));
    const x1 = Math.min(cols - 1, Math.floor((b.x + b.w) / CELL));
    const y1 = Math.min(rows - 1, Math.floor((b.y + b.h) / CELL));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        blocked[gy * cols + gx] = 1;
      }
    }
  }

  const openCells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!blocked[y * cols + x]) openCells.push({ x, y });
    }
  }

  return { cell: CELL, cols, rows, blocked, boxes, elementBoxes, openCells };
}

export function isBlocked(map, x, y) {
  if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return true;
  return map.blocked[y * map.cols + x] === 1;
}
