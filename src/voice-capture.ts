import { useEffect } from 'react';
import { desktopHost, type TongpinHost } from './desktop-host';

/** Mic audio stays on this Mac. It is handed to the desktop process and never put on the WebSocket. */
export async function startDesktopCapture(host: TongpinHost) {
  if (!navigator.mediaDevices?.getUserMedia) {
    host.reportCapture('no-mic');
    return () => {};
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    host.reportCapture(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-mic');
    return () => {};
  }
  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule('/voice-capture-worklet.js');
  } catch {
    stream.getTracks().forEach(track => track.stop());
    await context.close();
    host.reportCapture('error');
    return () => {};
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'tongpin-capture');
  const mute = context.createGain();
  mute.gain.value = 0;
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (event.data?.length) host.sendAudio(event.data);
  };
  source.connect(node);
  node.connect(mute);
  mute.connect(context.destination);
  if (context.state === 'suspended') void context.resume();
  host.reportCapture('listening');
  return () => {
    node.port.onmessage = null;
    source.disconnect();
    node.disconnect();
    mute.disconnect();
    stream.getTracks().forEach(track => track.stop());
    void context.close();
  };
}

export function useDesktopCapture() {
  useEffect(() => {
    const host = desktopHost();
    if (!host) return;
    let stop = () => {};
    let ticket = 0;
    const unsubscribe = host.onCapture(command => {
      const current = ++ticket;
      stop();
      stop = () => {};
      if (!command.enabled) return;
      void startDesktopCapture(host).then(release => {
        if (current !== ticket) release();
        else stop = release;
      });
    });
    return () => { ticket += 1; unsubscribe(); stop(); };
  }, []);
}
