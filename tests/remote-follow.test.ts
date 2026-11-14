import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type PromptState } from '../shared/state.ts';
import { foldRemote, type ScrubHold } from '../src/remote-follow.ts';

function state(patch: Partial<PromptState>): PromptState {
  return { ...initialState(0), text: '甲'.repeat(400), docRevision: 1, revision: 10, position: 0, playing: false, speed: 180, updatedAt: 0, ...patch };
}

test('拖动过程中，更早的定位回声不能把阅读位置拉回去', () => {
  const local = state({ position: 80, playing: false, updatedAt: 500 });
  const hold: ScrubHold = { position: 80, revision: 10, active: true };
  const stale = state({ position: 40, playing: false, revision: 11, updatedAt: 400 });
  const during = foldRemote(local, stale, hold, 500);
  assert.equal(during.next.position, 80);
  assert.equal(during.next.playing, false);
  assert.equal(during.hold?.active, true);

  const playingEcho = state({ position: 42, playing: true, revision: 12, updatedAt: 500 });
  const fought = foldRemote(during.next, playingEcho, during.hold, 520);
  assert.equal(fought.next.playing, false);
  assert.equal(fought.next.position, 80);

  const released: ScrubHold = { ...hold, position: 80, active: false };
  const older = foldRemote(local, state({ position: 56, playing: false, revision: 13, updatedAt: 600 }), released, 600);
  assert.equal(older.next.position, 80);
  assert.ok(older.hold);
  const ack = foldRemote(older.next, state({ position: 80, playing: false, revision: 14, updatedAt: 640 }), older.hold, 640);
  assert.equal(ack.hold, null);
  assert.equal(ack.next.position, 80);
  assert.equal(ack.next.playing, false);
});

test('另一台设备更换文稿时，本地拖动让位给新文稿', () => {
  const local = state({ position: 30, playing: false });
  const hold: ScrubHold = { position: 30, revision: 10, active: true };
  const replaced = state({ text: '新文稿', docRevision: 2, revision: 11, position: 0 });
  const folded = foldRemote(local, replaced, hold, 100);
  assert.equal(folded.hold, null);
  assert.equal(folded.next.text, '新文稿');
  assert.equal(folded.next.position, 0);
});

test('稳定播放时，一秒一次的微小时钟校正不改变本地插值', () => {
  const local = state({ position: 0, playing: true, speed: 180, updatedAt: 0 });
  const now = 10_000;
  const remote = state({ position: 30.4, playing: true, speed: 180, updatedAt: now, revision: 10 });
  const folded = foldRemote(local, remote, null, now);
  assert.equal(folded.next.position, 0);
  assert.equal(folded.next.updatedAt, 0);
  assert.equal(folded.next.playing, true);
});

test('其他设备的大幅定位会立即跟上，附近的暂停不回跳', () => {
  const local = state({ position: 20, playing: true, updatedAt: 0 });
  const jumped = foldRemote(local, state({ position: 200, playing: false, revision: 12, updatedAt: 1000 }), null, 1000);
  assert.equal(jumped.next.position, 200);
  assert.equal(jumped.next.playing, false);

  const playing = state({ position: 0, playing: true, updatedAt: 0 });
  const paused = foldRemote(playing, state({ position: 30.2, playing: false, revision: 12, updatedAt: 10_000 }), null, 10_000);
  assert.equal(paused.next.playing, false);
  assert.ok(Math.abs(paused.next.position - 30) < 0.01);
});

test('声控播放接受向前的新位置，旧时钟不能把位置拉回去', () => {
  const local = state({ mode: 'voice', voiceEpoch: 4, position: 20, playing: true, updatedAt: 500, revision: 12 });
  const forward = foldRemote(local, state({ mode: 'voice', voiceEpoch: 4, position: 24, playing: true, updatedAt: 800, revision: 13, voiceStatus: 'matched' }), null, 800);
  assert.equal(forward.next.position, 24);
  assert.equal(forward.next.voiceStatus, 'matched');
  const stale = foldRemote(forward.next, state({ mode: 'voice', voiceEpoch: 4, position: 21, playing: true, updatedAt: 900, revision: 12 }), null, 900);
  assert.equal(stale.next.position, 24);
  const reset = foldRemote(forward.next, state({ mode: 'voice', voiceEpoch: 5, position: 0, playing: true, updatedAt: 1000, revision: 14 }), null, 1000);
  assert.equal(reset.next.position, 0);
  assert.equal(reset.next.voiceEpoch, 5);
});

test('拖动时声控回声也不能改写本地位置', () => {
  const local = state({ mode: 'voice', voiceEpoch: 3, position: 50, playing: false, updatedAt: 400 });
  const hold: ScrubHold = { position: 50, revision: 10, active: true };
  const echo = foldRemote(local, state({ mode: 'voice', voiceEpoch: 4, position: 18, playing: true, revision: 11, voiceStatus: 'matched' }), hold, 400);
  assert.equal(echo.next.position, 50);
  assert.equal(echo.next.playing, false);
  assert.equal(echo.hold?.active, true);
});

test('松手后若最终回声丢失，超时后跟随服务器', () => {
  const local = state({ position: 70, playing: false, updatedAt: 800 });
  const hold: ScrubHold = { position: 70, revision: 10, active: false };
  const remote = state({ position: 12, playing: true, revision: 11, updatedAt: 2000 });
  const waiting = foldRemote(local, remote, hold, 2000, 500);
  assert.equal(waiting.next.position, 70);
  const givenUp = foldRemote(local, remote, hold, 2000, 1201);
  assert.equal(givenUp.hold, null);
  assert.equal(givenUp.next.position, 12);
  assert.equal(givenUp.next.playing, true);
});
