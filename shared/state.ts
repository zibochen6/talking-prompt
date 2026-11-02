export const MIN_SPEED = 30;
export const MAX_SPEED = 600;
export const MAX_TEXT_LENGTH = 100_000;
export const SAMPLE_TEXT = `让表达，跟上你的节奏。\n\n把想说的话放在这里，\n留一点从容给自己。\n\n不必记住每一个字，\n只要专注眼前的这一句。\n\n打开手机，和电脑连上同一个 Wi-Fi。\n扫码加入，阅读进度便会同频。\n\n准备好了，就按下播放。\n接下来的每一句，慢慢说。`;
export interface PromptState {
  text: string;
  position: number;
  speed: number;
  playing: boolean;
  updatedAt: number;
  revision: number;
  docRevision: number;
}
export type Command =
  | { type: 'play' | 'pause' | 'reset'; docRevision: number }
  | { type: 'speed'; speed: number; docRevision: number }
  | { type: 'seek'; position: number; docRevision: number }
  | { type: 'apply'; text: string; docRevision: number };
export const textLength = (text: string) => Array.from(text).length;
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
export function initialState(now = Date.now()): PromptState {
  return { text: SAMPLE_TEXT, position: 0, speed: 180, playing: false, updatedAt: now, revision: 0, docRevision: 0 };
}
export function positionAt(state: PromptState, now: number, length = textLength(state.text)): number {
  return clamp(state.position + (state.playing ? Math.max(0, now - state.updatedAt) * state.speed / 60_000 : 0), 0, length);
}
export function settled(state: PromptState, now: number): PromptState {
  const length = textLength(state.text);
  const position = positionAt(state, now, length);
  return { ...state, position, updatedAt: now, playing: state.playing && position < length };
}
export function applyCommand(previous: PromptState, input: unknown, now: number): PromptState {
  if (!input || typeof input !== 'object') throw new Error('无法识别的操作');
  const command = input as Record<string, unknown>;
  if (command.docRevision !== previous.docRevision) throw new Error('文稿已更新，请等待同步后重试');
  const state = settled(previous, now);
  switch (command.type) {
    case 'play':
      if (!state.text.trim()) throw new Error('先添加一些文稿，再开始播放');
      if (state.position >= textLength(state.text)) state.position = 0;
      state.playing = true;
      break;
    case 'pause': state.playing = false; break;
    case 'reset': state.position = 0; state.playing = false; break;
    case 'speed':
      if (typeof command.speed !== 'number' || !Number.isFinite(command.speed)) throw new Error('速度必须是有效数字');
      state.speed = clamp(command.speed, MIN_SPEED, MAX_SPEED);
      break;
    case 'seek':
      if (typeof command.position !== 'number' || !Number.isFinite(command.position)) throw new Error('阅读位置无效');
      state.position = clamp(command.position, 0, textLength(state.text));
      state.playing = false;
      break;
    case 'apply':
      if (typeof command.text !== 'string' || command.text.length > MAX_TEXT_LENGTH) throw new Error('文稿最多支持 10 万个字符');
      state.text = command.text.replace(/\r\n?/g, '\n');
      state.position = 0; state.playing = false; state.docRevision++;
      break;
    default: throw new Error('无法识别的操作');
  }
  state.revision++;
  return state;
}
export function restoreState(raw: unknown, now: number): PromptState {
  if (!raw || typeof raw !== 'object') throw new Error('保存的文稿格式无效');
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || r.text.length > MAX_TEXT_LENGTH ||
      typeof r.position !== 'number' || !Number.isFinite(r.position) ||
      typeof r.speed !== 'number' || !Number.isFinite(r.speed)) throw new Error('保存的文稿格式无效');
  return { ...initialState(now), text: r.text, position: clamp(r.position, 0, textLength(r.text)),
    speed: clamp(r.speed, MIN_SPEED, MAX_SPEED), playing: false };
}
