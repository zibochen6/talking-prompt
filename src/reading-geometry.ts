import { clamp } from '../shared/state';

export type LineBox = { start: number; end: number; y: number; height: number };
export type TopAt = (index: number) => number;

/** UTF-16 offsets for each Unicode character, plus the end offset. Emoji stays one character. */
export function characterOffsets(text: string): number[] {
  const offsets = [0];
  for (const character of text) offsets.push(offsets.at(-1)! + character.length);
  return offsets;
}

function remember(cache: LineBox[], line: LineBox) {
  const kept = cache.filter(existing => existing.end <= line.start || existing.start >= line.end);
  kept.push(line);
  kept.sort((a, b) => a.start - b.start);
  cache.splice(0, cache.length, ...kept);
}

/** Measure only the visual line that contains `index`. Later calls for that line do not measure again. */
export function ensureLine(cache: LineBox[], count: number, index: number, lineHeight: number, topAt: TopAt, tolerance: number): LineBox {
  if (count <= 0) {
    const blank = { start: 0, end: 1, y: 0, height: lineHeight };
    if (!cache.length) cache.push(blank);
    return cache[0];
  }
  const clamped = clamp(Math.floor(index), 0, count - 1);
  const hit = cache.find(line => clamped >= line.start && clamped < line.end);
  if (hit) return hit;
  const y = topAt(clamped);
  let low = 0;
  let high = clamped;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (topAt(mid) < y - tolerance) low = mid + 1;
    else high = mid;
  }
  const start = low;
  low = clamped + 1;
  high = count;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (Math.abs(topAt(mid) - y) <= tolerance) low = mid + 1;
    else high = mid;
  }
  const line = { start, end: Math.max(start + 1, low), y, height: lineHeight };
  remember(cache, line);
  return line;
}

export function yForIndex(local: number, count: number, lineHeight: number, topAt: TopAt, tolerance: number, cache: LineBox[]): number {
  if (count <= 0) return 0;
  if (local >= count) {
    const line = ensureLine(cache, count, count - 1, lineHeight, topAt, tolerance);
    return line.y + line.height;
  }
  const line = ensureLine(cache, count, local, lineHeight, topAt, tolerance);
  const span = line.end - line.start;
  const fraction = span > 0 ? clamp((local - line.start) / span, 0, 1) : 0;
  return line.y + fraction * line.height;
}

export function indexForLocalY(localY: number, count: number, lineHeight: number, topAt: TopAt, tolerance: number, cache: LineBox[]): number {
  if (count <= 0 || localY <= 0) return 0;
  const cached = cache.find(line => localY >= line.y && localY < line.y + line.height);
  if (cached) {
    const span = cached.end - cached.start;
    return cached.start + clamp((localY - cached.y) / cached.height, 0, 1) * span;
  }
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (topAt(mid) <= localY) low = mid;
    else high = mid - 1;
  }
  const line = ensureLine(cache, count, low, lineHeight, topAt, tolerance);
  if (line.end >= count && localY >= line.y + line.height) return count;
  const span = line.end - line.start;
  return line.start + clamp((localY - line.y) / line.height, 0, 1) * span;
}

/** Keep a drag in local coordinates. A later server position must not replace the base mid-gesture. */
export function nextManualY(manualY: number | null, anchoredY: number, delta: number, maxY: number): number {
  return clamp((manualY ?? anchoredY) + delta, 0, Math.max(0, maxY));
}

/** The next character index that still needs a line, when playback is near the end of `line`. */
export function prefetchIndex(line: LineBox, local: number, count: number): number | null {
  const span = line.end - line.start;
  const nearEnd = local >= line.start + span * 0.55;
  if (nearEnd && line.end < count) return line.end;
  return null;
}
