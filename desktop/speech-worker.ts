import { createRequire } from 'node:module';
import type { VoiceModelFiles } from '../shared/voice-model.ts';

type ParentPort = {
  on(channel: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
};

type Inbound =
  | { type: 'load'; model: VoiceModelFiles }
  | { type: 'start'; epoch: number }
  | { type: 'audio'; epoch: number; samples: Float32Array }
  | { type: 'stop' };

type Recognizer = {
  createStream: () => Stream;
  isReady: (stream: Stream) => boolean;
  decode: (stream: Stream) => void;
  isEndpoint: (stream: Stream) => boolean;
  reset: (stream: Stream) => void;
  getResult: (stream: Stream) => { text?: string };
};
type Stream = { acceptWaveform: (waveform: { samples: Float32Array; sampleRate: number }) => void };

const parent = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parent) throw new Error('语音进程只能由 Mac 应用启动');

let recognizer: Recognizer | null = null;
let stream: Stream | null = null;
let epoch = -1;
let lastText = '';

function post(message: unknown) {
  parent!.postMessage(message);
}

function loadRecognizer(model: VoiceModelFiles) {
  const require = createRequire(__filename);
  const sherpa = require('sherpa-onnx-node') as { OnlineRecognizer: new (config: unknown) => Recognizer };
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: model.encoder, decoder: model.decoder, joiner: model.joiner },
      tokens: model.tokens,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.0,
    rule3MinUtteranceLength: 15,
  });
  post({ type: 'ready' });
}

function openStream(nextEpoch: number) {
  if (!recognizer) return;
  epoch = nextEpoch;
  lastText = '';
  stream = recognizer.createStream();
}

function accept(nextEpoch: number, samples: Float32Array) {
  if (!recognizer || !stream || nextEpoch !== epoch || samples.length === 0) return;
  stream.acceptWaveform({ sampleRate: 16000, samples });
  let steps = 0;
  while (recognizer.isReady(stream) && steps < 16) {
    recognizer.decode(stream);
    steps += 1;
  }
  const text = `${recognizer.getResult(stream).text ?? ''}`.trim();
  if (text && text !== lastText) {
    lastText = text;
    post({ type: 'partial', epoch, text });
  }
  if (recognizer.isEndpoint(stream)) {
    post({ type: 'endpoint', epoch, text });
    recognizer.reset(stream);
    lastText = '';
  }
}

parent.on('message', event => {
  const message = event.data as Inbound;
  try {
    if (message?.type === 'load') loadRecognizer(message.model);
    else if (message?.type === 'start') openStream(message.epoch);
    else if (message?.type === 'audio') accept(message.epoch, message.samples);
    else if (message?.type === 'stop') { stream = null; epoch = -1; lastText = ''; }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : '本地识别启动失败' });
  }
});
