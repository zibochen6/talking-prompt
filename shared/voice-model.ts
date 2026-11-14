import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

export const VOICE_MODEL_DIR_NAME = 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20';

const ENCODER = ['encoder-epoch-99-avg-1.int8.onnx', 'encoder-epoch-99-avg-1.onnx'];
const DECODER = ['decoder-epoch-99-avg-1.int8.onnx', 'decoder-epoch-99-avg-1.onnx'];
const JOINER = ['joiner-epoch-99-avg-1.int8.onnx', 'joiner-epoch-99-avg-1.onnx'];

export type VoiceModelFiles = {
  directory: string;
  encoder: string;
  decoder: string;
  joiner: string;
  tokens: string;
};

function firstFile(directory: string, names: string[]) {
  for (const name of names) {
    const path = join(directory, name);
    if (existsSync(path)) return path;
  }
  return '';
}

function modelDirectories(candidate: string) {
  if (basename(candidate) === VOICE_MODEL_DIR_NAME) return [candidate];
  return [join(candidate, VOICE_MODEL_DIR_NAME), join(candidate, 'models', VOICE_MODEL_DIR_NAME), join(candidate, '.qa', 'model', VOICE_MODEL_DIR_NAME)];
}

/** Prefer the int8 Zipformer files. A directory may be the model folder or its parent. */
export function resolveVoiceModel(candidates: Array<string | undefined>): VoiceModelFiles | null {
  const seenCandidates = new Set<string>();
  const seenDirectories = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seenCandidates.has(candidate)) continue;
    seenCandidates.add(candidate);
    for (const directory of modelDirectories(candidate)) {
      if (seenDirectories.has(directory)) continue;
      seenDirectories.add(directory);
      const encoder = firstFile(directory, ENCODER);
      const decoder = firstFile(directory, DECODER);
      const joiner = firstFile(directory, JOINER);
      const tokens = firstFile(directory, ['tokens.txt']);
      if (encoder && decoder && joiner && tokens) return { directory, encoder, decoder, joiner, tokens };
    }
  }
  return null;
}
