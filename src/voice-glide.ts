import { clamp } from '../shared/state';

export type VoiceGlide = {
  from: number;
  to: number;
  start: number;
  epoch: number;
  duration: number;
};

export function initialGlide(): VoiceGlide {
  return { from: 0, to: 0, start: 0, epoch: -1, duration: 1 };
}

function smoothstep(value: number) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function glidePosition(glide: VoiceGlide, now: number) {
  const t = glide.duration <= 0 ? 1 : (now - glide.start) / glide.duration;
  return glide.from + (glide.to - glide.from) * smoothstep(t);
}

function durationFor(gap: number) {
  return clamp(140 + Math.abs(gap) * 18, 140, 420);
}

/**
 * Ease toward a voice target. Playback on the same epoch never moves backward.
 * Pause, seek, reset, and a new epoch snap, including back to the start.
 */
export function stepVoiceGlide(glide: VoiceGlide, input: { target: number; playing: boolean; epoch: number; now: number }): { glide: VoiceGlide; position: number } {
  if (!input.playing || input.epoch !== glide.epoch) {
    const next = { from: input.target, to: input.target, start: input.now, epoch: input.epoch, duration: 1 };
    return { glide: next, position: input.target };
  }
  const shown = glidePosition(glide, input.now);
  if (input.target <= glide.to + 0.001) {
    return { glide, position: Math.min(shown, input.target) };
  }
  const duration = durationFor(input.target - shown);
  const next = { from: shown, to: input.target, start: input.now, epoch: input.epoch, duration };
  return { glide: next, position: shown };
}
