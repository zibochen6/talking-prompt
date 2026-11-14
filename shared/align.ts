/** Compact characters looked at ahead of the reading cursor. */
const WINDOW = 120;
/** Hypothesis tail used for the match. Streaming ASR repeats the current utterance. */
const SUFFIX = 24;
/** Exact matches may start this many compact characters after the cursor. */
const MAX_LEAD = 8;
const MIN_CHARS = 4;

export type NormalizedScript = {
  compact: string[];
  /** Original Unicode index of each compact character. */
  toOriginal: number[];
  length: number;
};

const KEPT = /^[\p{L}\p{N}]$/u;

/** NFKC, lowercase, letters and digits only. Punctuation and spaces are dropped. */
export function normalizeScript(text: string): NormalizedScript {
  const compact: string[] = [];
  const toOriginal: number[] = [];
  let index = 0;
  for (const character of text) {
    for (const piece of character.normalize('NFKC').toLowerCase()) {
      if (KEPT.test(piece)) {
        compact.push(piece);
        toOriginal.push(index);
      }
    }
    index += 1;
  }
  return { compact, toOriginal, length: index };
}

export function normalizeHypothesis(text: string): string[] {
  const compact: string[] = [];
  for (const character of text.normalize('NFKC').toLowerCase()) {
    if (KEPT.test(character)) compact.push(character);
  }
  return compact;
}

/** First compact character that has not been read yet. */
export function compactCursor(script: NormalizedScript, position: number): number {
  const target = Math.max(0, position);
  let low = 0;
  let high = script.toOriginal.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (script.toOriginal[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function positionAfter(script: NormalizedScript, end: number): number {
  if (end <= 0) return 0;
  if (end >= script.toOriginal.length) return script.length;
  return script.toOriginal[end];
}

function editBudget(length: number) {
  if (length < 8) return 1;
  if (length < 16) return 2;
  return 3;
}

/** Edit distance of consuming all of `hyp`, starting at a fixed script index. */
function matchAt(hyp: string[], script: string[], start: number, budget: number): { distance: number; end: number } | null {
  const slice = script.slice(start, Math.min(script.length, start + hyp.length + budget));
  const n = hyp.length;
  const m = slice.length;
  let previous = new Array<number>(m + 1).fill(budget + 1);
  previous[0] = 0;
  for (let i = 1; i <= n; i++) {
    const next = new Array<number>(m + 1).fill(budget + 1);
    next[0] = i > budget ? budget + 1 : i;
    let rowBest = next[0];
    for (let j = 1; j <= m; j++) {
      const substitute = previous[j - 1] + (hyp[i - 1] === slice[j - 1] ? 0 : 1);
      const removeHypothesis = previous[j] + 1;
      const extraScript = next[j - 1] + 1;
      const value = Math.min(substitute, removeHypothesis, extraScript);
      next[j] = value;
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > budget) return null;
    previous = next;
  }
  let bestEnd = -1;
  let bestDistance = budget + 1;
  for (let j = 1; j <= m; j++) {
    if (previous[j] > budget) continue;
    const gap = Math.abs(j - n);
    const bestGap = bestEnd < 0 ? Number.POSITIVE_INFINITY : Math.abs(bestEnd - n);
    const betterEnd = gap < bestGap || (gap === bestGap && j < bestEnd);
    if (previous[j] < bestDistance || (previous[j] === bestDistance && betterEnd)) {
      bestDistance = previous[j];
      bestEnd = j;
    }
  }
  if (bestEnd < 0 || bestDistance > budget) return null;
  return { distance: bestDistance, end: start + bestEnd };
}

/**
 * Match a streaming hypothesis to the script and return a Unicode offset.
 * The offset only moves forward, stays inside a short window, and tolerates a few edits.
 */
export function alignHypothesis(script: NormalizedScript, position: number, hypothesis: string): { position: number; matched: boolean } {
  const spoken = normalizeHypothesis(hypothesis).slice(-SUFFIX);
  if (spoken.length < MIN_CHARS) return { position, matched: false };
  const cursor = compactCursor(script, position);
  const budget = editBudget(spoken.length);
  const regionEnd = Math.min(script.compact.length, cursor + WINDOW);
  const earliest = Math.max(0, cursor - spoken.length);
  const latestExact = Math.min(cursor + MAX_LEAD, regionEnd - 1);
  let best: { end: number; distance: number } | null = null;
  for (let start = earliest; start <= latestExact; start++) {
    const found = matchAt(spoken, script.compact, start, budget);
    if (!found) continue;
    // A typo may not also skip ahead. Only a clean match may leave a short gap.
    if (found.distance > 0 && start > cursor + 2) continue;
    if (found.end <= cursor) continue;
    if (!best || found.distance < best.distance || (found.distance === best.distance && found.end < best.end)) {
      best = { end: found.end, distance: found.distance };
    }
  }
  if (!best) return { position, matched: false };
  const next = positionAfter(script, best.end);
  if (next <= position) return { position, matched: false };
  return { position: Math.min(script.length, next), matched: true };
}

export function alignScript(text: string, position: number, hypothesis: string) {
  return alignHypothesis(normalizeScript(text), position, hypothesis);
}

export const alignmentLimits = { window: WINDOW, suffix: SUFFIX, minChars: MIN_CHARS, maxLead: MAX_LEAD };
