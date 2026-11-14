import { positionAt, type PromptState } from '../shared/state';

export type ScrubHold = {
  /** Latest character position this device asked for. */
  position: number;
  /** Server revision observed before this gesture's commands. */
  revision: number;
  /** True while the finger or wheel is still moving. */
  active: boolean;
};

const ACK_EPSILON = 0.51;

/** Ignore sub-line clock corrections. About 350ms of motion, and at least one character. */
export function playbackTolerance(speed: number): number {
  return Math.max(1, speed * 0.35 / 60);
}

/**
 * Decide which snapshot to follow after a server message.
 * A scrub hold drops stale seek echoes. Steady playback keeps its local clock
 * when the server tick is only a fraction of a line away.
 */
export function foldRemote(
  local: PromptState,
  remote: PromptState,
  hold: ScrubHold | null,
  now: number,
  holdAgeMs: number | null = null,
): { next: PromptState; hold: ScrubHold | null } {
  if (hold && remote.docRevision !== local.docRevision) return { next: remote, hold: null };
  if (hold && !hold.active && holdAgeMs !== null && holdAgeMs > 1200) return { next: remote, hold: null };
  if (hold) {
    const acked = !hold.active
      && remote.revision > hold.revision
      && !remote.playing
      && Math.abs(remote.position - hold.position) <= ACK_EPSILON;
    if (acked) return { next: remote, hold: null };
    return { next: { ...local, speed: remote.speed, playing: false }, hold };
  }
  if (remote.docRevision !== local.docRevision || remote.text !== local.text) return { next: remote, hold: null };
  const localPos = positionAt(local, now);
  const remotePos = positionAt(remote, now);
  const delta = Math.abs(localPos - remotePos);
  const tolerance = playbackTolerance(remote.speed);
  if (local.playing && remote.playing && local.speed === remote.speed && delta <= tolerance) {
    return { next: { ...remote, position: local.position, updatedAt: local.updatedAt, playing: true }, hold: null };
  }
  if (delta <= tolerance && (local.playing !== remote.playing || local.speed !== remote.speed)) {
    return { next: { ...remote, position: localPos, updatedAt: now, playing: remote.playing }, hold: null };
  }
  return { next: remote, hold: null };
}
