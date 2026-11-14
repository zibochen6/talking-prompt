import type { VoiceStatus } from '../shared/state';

export function voiceStatusLabel(status: VoiceStatus, playing: boolean): string {
  if (status === 'denied') return '没有麦克风权限';
  if (status === 'no-mic') return '没有可用的麦克风';
  if (status === 'no-model') return '还没有语音模型';
  if (status === 'error') return '本地识别暂不可用';
  if (status === 'loading') return '正在加载本地语音模型…';
  if (!playing) return '声控跟随已暂停';
  if (status === 'opening') return '正在打开麦克风…';
  if (status === 'unmatched') return '听到了声音，还没对上这段文稿';
  if (status === 'matched') return '正在跟随';
  return '正在聆听';
}
