import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialGlide, glidePosition, stepVoiceGlide } from '../src/voice-glide.ts';

test('声控播放只向前插值，中途新目标不会跳，也不会超过目标', () => {
  let step = stepVoiceGlide(initialGlide(), { target: 0, playing: true, epoch: 2, now: 0 });
  step = stepVoiceGlide(step.glide, { target: 12, playing: true, epoch: 2, now: 100 });
  const mid = stepVoiceGlide(step.glide, { target: 12, playing: true, epoch: 2, now: 100 + step.glide.duration / 2 });
  assert.ok(mid.position > 0);
  assert.ok(mid.position < 12);
  const later = stepVoiceGlide(mid.glide, { target: 18, playing: true, epoch: 2, now: 100 + step.glide.duration / 2 });
  assert.equal(later.position, mid.position);
  assert.ok(later.glide.to === 18);
  const done = glidePosition(later.glide, later.glide.start + later.glide.duration);
  assert.ok(Math.abs(done - 18) < 1e-6);
  const stale = stepVoiceGlide(later.glide, { target: 10, playing: true, epoch: 2, now: later.glide.start + 30 });
  assert.ok(stale.position <= 18);
  assert.ok(stale.position >= later.position - 0.001);
});

test('暂停、换代和回到开头会立刻落到新位置', () => {
  const playing = stepVoiceGlide(initialGlide(), { target: 20, playing: true, epoch: 1, now: 0 });
  const moving = stepVoiceGlide(playing.glide, { target: 40, playing: true, epoch: 1, now: 50 });
  const paused = stepVoiceGlide(moving.glide, { target: 15, playing: false, epoch: 2, now: 80 });
  assert.equal(paused.position, 15);
  const restarted = stepVoiceGlide(paused.glide, { target: 0, playing: true, epoch: 3, now: 90 });
  assert.equal(restarted.position, 0);
});
