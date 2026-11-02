import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, initialState, positionAt, settled, restoreState, textLength } from '../shared/state.ts';

test('统一时钟推进；变速不改变当前位置，暂停后不再推进', () => {
  let state = initialState(1000);
  state = applyCommand(state, { type: 'play', docRevision: 0 }, 1000);
  assert.equal(positionAt(state, 11_000), 30);
  state = applyCommand(state, { type: 'speed', speed: 360, docRevision: 0 }, 11_000);
  assert.equal(state.position, 30);
  assert.equal(positionAt(state, 16_000), 60);
  state = applyCommand(state, { type: 'pause', docRevision: 0 }, 16_000);
  assert.equal(positionAt(state, 30_000), 60);
});
test('跨屏同步使用字符位置，emoji 不按 UTF-16 两字处理', () => {
  const state = applyCommand(initialState(0), { type: 'apply', text: '你好😀\n世界', docRevision: 0 }, 0);
  assert.equal(textLength(state.text), 6);
  const sought = applyCommand(state, { type: 'seek', position: 3.5, docRevision: 1 }, 20);
  assert.equal(sought.position, 3.5); assert.equal(sought.playing, false);
});
test('替换文稿暂停、归零；旧文稿的迟到操作不会污染新文稿', () => {
  const state = applyCommand(initialState(), { type: 'apply', text: '新文稿\r\n下一行', docRevision: 0 }, 2000);
  assert.equal(state.text, '新文稿\n下一行'); assert.equal(state.position, 0); assert.equal(state.playing, false);
  assert.throws(() => applyCommand(state, { type: 'seek', position: 3, docRevision: 0 }, 3000), /文稿已更新/);
});
test('末尾自动暂停，重新播放从开头开始，重置总是暂停', () => {
  let state = applyCommand(initialState(0), { type: 'apply', text: '你好', docRevision: 0 }, 0);
  state = applyCommand(state, { type: 'play', docRevision: 1 }, 0);
  state = settled(state, 10_000);
  assert.equal(state.position, 2); assert.equal(state.playing, false);
  state = applyCommand(state, { type: 'play', docRevision: 1 }, 11_000);
  assert.equal(state.position, 0); assert.equal(state.playing, true);
  state = applyCommand(state, { type: 'reset', docRevision: 1 }, 12_000);
  assert.equal(state.position, 0); assert.equal(state.playing, false);
});
test('空文稿、数值异常、越界和过长文稿', () => {
  const state = applyCommand(initialState(0), { type: 'apply', text: '\n ', docRevision: 0 }, 0);
  assert.throws(() => applyCommand(state, { type: 'play', docRevision: 1 }, 0), /先添加/);
  for (const invalid of [NaN, Infinity, '90']) assert.throws(() => applyCommand(state, { type: 'speed', speed: invalid, docRevision: 1 }, 0));
  assert.equal(applyCommand(state, { type: 'speed', speed: 1000, docRevision: 1 }, 0).speed, 600);
  assert.equal(applyCommand(state, { type: 'seek', position: -30, docRevision: 1 }, 0).position, 0);
  assert.throws(() => applyCommand(state, { type: 'apply', text: '字'.repeat(100_001), docRevision: 1 }, 0));
});
test('服务重启恢复位置和速度，但绝不自行播放；错误保存数据被拒绝', () => {
  const restored = restoreState({ text: '恢复内容', position: 2, speed: 240, playing: true }, 1000);
  assert.equal(restored.position, 2); assert.equal(restored.speed, 240); assert.equal(restored.playing, false);
  assert.throws(() => restoreState({ text: '坏数据', position: null, speed: 90 }, 1000));
});
