import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignScript, normalizeScript } from '../shared/align.ts';
import { applyCommand, initialState, reportVoicePosition, setFollowMode } from '../shared/state.ts';

const SCRIPT = '你好，世界。我们今天出发。';

test('标点和大小写不参与对齐，命中后读过紧随的标点', () => {
  const moved = alignScript(SCRIPT, 0, '你好世界');
  assert.equal(moved.matched, true);
  assert.equal(moved.position, '你好，世界。'.length);
  const english = alignScript('Hello, World!', 0, 'HELLO WORLD');
  assert.equal(english.matched, true);
  assert.equal(english.position, 'Hello, World!'.length);
});

test('识别结果只向前走，已经读过的片段不会把位置拉回去', () => {
  const first = alignScript('一二三四五六七八九十', 0, '一二三四五六');
  assert.equal(first.matched, true);
  assert.equal(first.position, 6);
  const backward = alignScript('一二三四五六七八九十', first.position, '一二三四');
  assert.equal(backward.matched, false);
  assert.equal(backward.position, first.position);
  const forward = alignScript('一二三四五六七八九十', first.position, '七八九十');
  assert.equal(forward.matched, true);
  assert.ok(forward.position > first.position);
});

test('少量错字仍能跟上，太短或隔得太远的匹配不会跳', () => {
  const typo = alignScript('我们今天出发', 0, '我们今天出法');
  assert.equal(typo.matched, true);
  assert.equal(typo.position, '我们今天出发'.length);
  const short = alignScript('我们今天出发', 0, '出发');
  assert.equal(short.matched, false);
  const distant = alignScript(`${'甲'.repeat(40)}我们今天出发`, 0, '我们今天出发');
  assert.equal(distant.matched, false);
  assert.equal(distant.position, 0);
});

test('全角字母按 NFKC 折叠后再对齐', () => {
  const script = normalizeScript('ＡＢＣ你好');
  assert.deepEqual(script.compact, ['a', 'b', 'c', '你', '好']);
  const moved = alignScript('ＡＢＣ，你好。', 0, 'abc你好');
  assert.equal(moved.matched, true);
  assert.equal(moved.position, 'ＡＢＣ，你好。'.length);
});

test('播放、暂停、拖动、重置和更换文稿都会作废当前识别世代', () => {
  let state = setFollowMode(initialState(0), 'voice', 0);
  state = applyCommand(state, { type: 'apply', text: '我们今天出发去看海', docRevision: state.docRevision }, 10);
  const armed = state.voiceEpoch;
  state = applyCommand(state, { type: 'play', docRevision: state.docRevision }, 20);
  assert.ok(state.voiceEpoch > armed);
  assert.equal(state.playing, true);
  const live = state.voiceEpoch;
  const moved = reportVoicePosition(state, live, 4, 30);
  if (!moved) throw new Error('应向前推进');
  assert.equal(moved.position, 4);
  assert.equal(reportVoicePosition(moved, live, 3, 40), null);
  const paused = applyCommand(moved, { type: 'pause', docRevision: moved.docRevision }, 50);
  assert.ok(paused.voiceEpoch > live);
  assert.equal(reportVoicePosition(paused, live, 6, 60), null);
  const sought = applyCommand(moved, { type: 'seek', position: 1, docRevision: moved.docRevision }, 70);
  assert.equal(sought.playing, false);
  assert.equal(reportVoicePosition(sought, live, 5, 80), null);
  const reset = applyCommand(moved, { type: 'reset', docRevision: moved.docRevision }, 90);
  assert.equal(reset.position, 0);
  assert.equal(reportVoicePosition(reset, live, 2, 100), null);
  const replaced = applyCommand(moved, { type: 'apply', text: '另一份文稿', docRevision: moved.docRevision }, 110);
  assert.equal(replaced.position, 0);
  assert.equal(reportVoicePosition(replaced, live, 2, 120), null);
  const replayed = applyCommand(moved, { type: 'play', docRevision: moved.docRevision }, 130);
  assert.ok(replayed.voiceEpoch > live);
  assert.equal(reportVoicePosition(replayed, live, 5, 140), null);
});
