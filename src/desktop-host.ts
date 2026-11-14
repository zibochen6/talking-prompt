export type CaptureReport = 'listening' | 'denied' | 'no-mic' | 'error';

export type TongpinHost = {
  kind: 'desktop';
  onCapture: (listener: (command: { enabled: boolean }) => void) => () => void;
  sendAudio: (samples: Float32Array) => void;
  reportCapture: (status: CaptureReport) => void;
};

declare global {
  interface Window {
    tongpinHost?: TongpinHost;
  }
}

export function desktopHost(): TongpinHost | null {
  const host = typeof window === 'undefined' ? undefined : window.tongpinHost;
  return host?.kind === 'desktop' ? host : null;
}
