import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { ipcMain, systemPreferences, utilityProcess, type BrowserWindow, type IpcMainEvent, type UtilityProcess } from 'electron';
import { alignHypothesis, normalizeHypothesis, normalizeScript, type NormalizedScript } from '../shared/align.ts';
import { resolveVoiceModel, type VoiceModelFiles } from '../shared/voice-model.ts';
import type { FollowMode, VoiceStatus } from '../shared/state.ts';
import type { createPromptServer } from '../server/app.ts';

type PromptServer = ReturnType<typeof createPromptServer>;
type WorkerMessage = { type: string; epoch?: number; text?: string; message?: string };

function libraryDir() {
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  const folder = `sherpa-onnx-${platform}-${process.arch}`;
  const candidates = [
    process.resourcesPath && join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', folder),
    join(process.cwd(), 'node_modules', folder),
    join(__dirname, '..', 'node_modules', folder),
  ].filter((path): path is string => !!path);
  return candidates.find(path => existsSync(path)) ?? '';
}

function workerFile() {
  const bundled = join(__dirname, 'speech-worker.cjs');
  const unpacked = bundled.includes(`${sep}app.asar${sep}`)
    ? bundled.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
    : '';
  if (unpacked && existsSync(unpacked)) return unpacked;
  return bundled;
}

export function voiceModelSearchPaths(appPath: string) {
  return [process.env.PROMPT_VOICE_MODEL_DIR, process.resourcesPath, appPath, process.cwd()];
}

/**
 * Mac-only speech follow. Audio frames come from the desktop window over IPC.
 * Positions are applied in-process; socket clients cannot submit them.
 */
export function startVoiceHost(server: PromptServer, appPath: string) {
  let window: BrowserWindow | undefined;
  let child: UtilityProcess | undefined;
  let loaded: VoiceModelFiles | null = null;
  let loading = false;
  let failed = false;
  let captureWanted = false;
  let sessionEpoch = -1;
  let captureTicket = 0;
  let closing = false;
  let unmatchedSince = 0;
  let script: { revision: number; text: string; norm: NormalizedScript } | null = null;

  const model = () => resolveVoiceModel(voiceModelSearchPaths(appPath));

  function post(message: unknown) {
    child?.postMessage(message);
  }

  function stopCapture() {
    captureWanted = false;
    captureTicket += 1;
    sessionEpoch = -1;
    unmatchedSince = 0;
    post({ type: 'stop' });
    if (!window || window.isDestroyed()) return;
    window.webContents.send('voice-capture', { enabled: false });
  }

  async function beginCapture(epoch: number) {
    const ticket = ++captureTicket;
    sessionEpoch = epoch;
    server.setVoiceStatus('opening');
    if (process.platform === 'darwin') {
      try {
        const access = systemPreferences.getMediaAccessStatus('microphone');
        if (access === 'denied' || access === 'restricted') {
          if (ticket === captureTicket) server.setVoiceStatus('denied');
          return;
        }
        if (access !== 'granted') {
          const allowed = await systemPreferences.askForMediaAccess('microphone');
          if (ticket !== captureTicket) return;
          if (!allowed) { server.setVoiceStatus('denied'); return; }
        }
      } catch { /* The renderer prompt is the fallback. */ }
    }
    if (ticket !== captureTicket) return;
    captureWanted = true;
    post({ type: 'start', epoch });
    if (window && !window.isDestroyed()) window.webContents.send('voice-capture', { enabled: true });
  }

  function ensureWorker(files: VoiceModelFiles) {
    if (child || loading || failed) return;
    loading = true;
    server.setVoiceStatus('loading');
    const lib = libraryDir();
    const env = { ...process.env };
    if (lib) {
      env.DYLD_LIBRARY_PATH = `${lib}${env.DYLD_LIBRARY_PATH ? `:${env.DYLD_LIBRARY_PATH}` : ''}`;
      env.LD_LIBRARY_PATH = `${lib}${env.LD_LIBRARY_PATH ? `:${env.LD_LIBRARY_PATH}` : ''}`;
    }
    const next = utilityProcess.fork(workerFile(), [], { serviceName: 'Tongpin Voice', env, stdio: 'inherit' });
    child = next;
    next.on('message', (message: WorkerMessage) => onWorker(message));
    next.on('exit', () => {
      if (child !== next) return;
      child = undefined;
      loading = false;
      loaded = null;
      if (!closing && !failed) { failed = true; server.setVoiceStatus('error'); }
    });
    post({ type: 'load', model: files });
  }

  function onWorker(message: WorkerMessage) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') {
      loading = false;
      loaded = model();
      failed = false;
      sync();
      return;
    }
    if (message.type === 'error') {
      failed = true;
      loading = false;
      server.setVoiceStatus('error');
      return;
    }
    const state = server.getState();
    if (message.epoch !== state.voiceEpoch || state.mode !== 'voice' || !state.playing) return;
    if (message.type === 'endpoint') {
      unmatchedSince = 0;
      if (state.voiceStatus === 'matched' || state.voiceStatus === 'unmatched') server.setVoiceStatus('listening');
      return;
    }
    if (message.type !== 'partial' || !message.text) return;
    if (!script || script.revision !== state.docRevision || script.text !== state.text) {
      script = { revision: state.docRevision, text: state.text, norm: normalizeScript(state.text) };
    }
    const aligned = alignHypothesis(script.norm, state.position, message.text);
    if (aligned.matched) {
      unmatchedSince = 0;
      server.submitVoicePosition(state.voiceEpoch, aligned.position);
      return;
    }
    if (normalizeHypothesis(message.text).length < 4) return;
    const now = Date.now();
    if (!unmatchedSince) unmatchedSince = now;
    if (now - unmatchedSince > 700 && server.getState().voiceStatus !== 'unmatched') server.setVoiceStatus('unmatched');
  }

  function sync() {
    const state = server.getState();
    if (state.mode !== 'voice') {
      if (captureWanted || sessionEpoch !== -1) stopCapture();
      if (state.voiceStatus !== 'idle') server.setVoiceStatus('idle');
      return;
    }
    const files = model();
    if (!files) {
      if (captureWanted) stopCapture();
      server.setVoiceStatus('no-model');
      return;
    }
    if (!state.playing) {
      if (captureWanted || sessionEpoch !== -1) stopCapture();
      const quiet: VoiceStatus[] = ['listening', 'matched', 'unmatched', 'opening', 'loading'];
      if (!loading && quiet.includes(state.voiceStatus)) server.setVoiceStatus('idle');
      return;
    }
    if (!loaded) {
      if (loading) return;
      if (failed) { server.setVoiceStatus('error'); return; }
      ensureWorker(files);
      return;
    }
    if (sessionEpoch === state.voiceEpoch) return;
    void beginCapture(state.voiceEpoch);
  }

  server.setModeHost((mode: FollowMode) => { server.setFollowMode(mode); });
  const unsubscribe = server.onState(() => sync());

  ipcMain.on('voice-audio', (event: IpcMainEvent, samples: Float32Array) => {
    if (!captureWanted || sessionEpoch < 0) return;
    if (window && event.sender.id !== window.webContents.id) return;
    const audio = samples instanceof Float32Array ? samples : new Float32Array(samples);
    post({ type: 'audio', epoch: sessionEpoch, samples: audio });
  });
  ipcMain.on('voice-capture-report', (event: IpcMainEvent, status: VoiceStatus) => {
    if (window && event.sender.id !== window.webContents.id) return;
    if (status !== 'listening' && status !== 'denied' && status !== 'no-mic' && status !== 'error') return;
    const state = server.getState();
    if (state.mode !== 'voice' || !state.playing) return;
    if (status === 'listening' && (state.voiceStatus === 'matched' || state.voiceStatus === 'unmatched')) return;
    server.setVoiceStatus(status);
  });

  return {
    attachWindow(next: BrowserWindow) {
      window = next;
      next.webContents.on('did-finish-load', () => {
        if (captureWanted && window && !window.isDestroyed()) window.webContents.send('voice-capture', { enabled: true });
      });
      next.on('closed', () => {
        window = undefined;
        const current = server.getState();
        stopCapture();
        if (current.mode === 'voice' && current.playing) {
          server.localCommand({ type: 'pause', docRevision: current.docRevision });
        }
      });
    },
    close() {
      closing = true;
      unsubscribe();
      stopCapture();
      child?.kill();
      child = undefined;
    },
  };
}
