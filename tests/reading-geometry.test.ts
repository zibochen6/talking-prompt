import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterOffsets, ensureLine, indexForLocalY, nextManualY, prefetchIndex, yForIndex, type LineBox } from '../src/reading-geometry.ts';

function scripted(lineStarts: number[], count: number, lineHeight: number) {
  let calls = 0;
  const topAt = (index: number) => {
    calls += 1;
    assert.ok(index >= 0 && index < count);
    let line = 0;
    for (let i = 0; i < lineStarts.length; i++) if (lineStarts[i] <= index) line = i;
    return line * lineHeight;
  };
  return { topAt, calls: () => calls, reset: () => { calls = 0; } };
}

test('按 Unicode 字符计算偏移，emoji 不拆成两个 UTF-16', () => {
  assert.deepEqual(characterOffsets('你😀好'), [0, 1, 3, 4]);
  assert.equal(characterOffsets('').length, 1);
});

test('进入长段落只测量当前行，而不是整段每一行', () => {
  const count = 8000;
  const lineHeight = 40;
  const starts = Array.from({ length: count / 40 }, (_, i) => i * 40);
  const layout = scripted(starts, count, lineHeight);
  const cache: LineBox[] = [];
  const line = ensureLine(cache, count, 2500, lineHeight, layout.topAt, 8);
  assert.equal(line.start, 2480);
  assert.equal(line.end, 2520);
  assert.ok(layout.calls() < 50, `测量了 ${layout.calls()} 次，整段扫描会是数千次`);
  layout.reset();
  ensureLine(cache, count, 2505, lineHeight, layout.topAt, 8);
  assert.equal(layout.calls(), 0);
});

test('字符位置和行内纵向位置可以往返，包括第一行和最后一行', () => {
  const count = 120;
  const lineHeight = 30;
  const starts = [0, 25, 60, 90];
  const layout = scripted(starts, count, lineHeight);
  const cache: LineBox[] = [];
  for (const sample of [0, 0.2, 24.9, 25, 59.5, 90, 119, 119.8]) {
    const y = yForIndex(sample, count, lineHeight, layout.topAt, 6, cache);
    const back = indexForLocalY(y, count, lineHeight, layout.topAt, 6, cache);
    assert.ok(Math.abs(back - Math.min(sample, 120)) < 0.51, `${sample} -> ${y} -> ${back}`);
  }
  assert.equal(indexForLocalY(0, count, lineHeight, layout.topAt, 6, cache), 0);
  assert.equal(yForIndex(count, count, lineHeight, layout.topAt, 6, cache), 4 * lineHeight);
  const end = indexForLocalY(10_000, count, lineHeight, layout.topAt, 6, cache);
  assert.equal(end, count);
});

test('手指连续拖动累加在本地位置上，不会每步回到服务器坐标', () => {
  let manual: number | null = null;
  manual = nextManualY(manual, 100, 12, 400);
  manual = nextManualY(manual, 100, 12, 400);
  manual = nextManualY(manual, 100, 12, 400);
  assert.equal(manual, 136);
  assert.equal(nextManualY(390, 100, 30, 400), 400);
  assert.equal(nextManualY(0, 0, -20, 400), 0);
});

test('接近行尾时只预取下一行的起点', () => {
  const line = { start: 0, end: 20, y: 0, height: 30 };
  assert.equal(prefetchIndex(line, 10, 100), null);
  assert.equal(prefetchIndex(line, 16, 100), 20);
  assert.equal(prefetchIndex({ ...line, end: 100 }, 90, 100), null);
});
