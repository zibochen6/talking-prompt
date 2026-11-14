import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type CaptureCommand = { enabled: boolean };
type CaptureReport = 'listening' | 'denied' | 'no-mic' | 'error';

const listeners = new Set<(command: CaptureCommand) => void>();
ipcRenderer.on('voice-capture', (_event: IpcRendererEvent, command: CaptureCommand) => {
  for (const listener of listeners) listener(command);
});

contextBridge.exposeInMainWorld('tongpinHost', {
  kind: 'desktop' as const,
  onCapture(listener: (command: CaptureCommand) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  sendAudio(samples: Float32Array) {
    const copy = new Float32Array(samples);
    ipcRenderer.send('voice-audio', copy);
  },
  reportCapture(status: CaptureReport) {
    ipcRenderer.send('voice-capture-report', status);
  },
});
