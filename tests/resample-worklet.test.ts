import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function capture(rate: number) {
  const source = readFileSync(new URL('../public/voice-capture-worklet.js', import.meta.url), 'utf8');
  const TongpinCapture = new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', `${source}\nreturn TongpinCapture;`)(class {}, () => {}, rate);
  const posted: Float32Array[] = [];
  const processor = new TongpinCapture();
  processor.port = { postMessage: (frame: Float32Array) => posted.push(frame) };
  return {
    push(samples: Float32Array) { processor.process([[samples]]); },
    samples() {
      const tail = processor.chunk as number[];
      const frames = tail.length ? posted.concat(Float32Array.from(tail)) : posted;
      return frames.reduce((sum, frame) => sum + frame.length, 0);
    },
    average() {
      const tail = processor.chunk as number[];
      const frames = tail.length ? posted.concat(Float32Array.from(tail)) : posted;
      let total = 0;
      let count = 0;
      for (const frame of frames) for (const sample of frame) { total += sample; count += 1; }
      return count ? total / count : 0;
    },
  };
}

function feed(rate: number, seconds: number) {
  const mic = capture(rate);
  const input = new Float32Array(rate * seconds).fill(0.5);
  for (let offset = 0; offset < input.length; offset += 128) mic.push(input.subarray(offset, offset + 128));
  return mic;
}

test('44.1 kHz 麦克风按分数相位降到每秒 16000 个采样', () => {
  const mic = feed(44100, 1);
  const count = mic.samples();
  assert.ok(Math.abs(count - 16000) <= 2, String(count));
  assert.ok(Math.abs(mic.average() - 0.5) < 0.001);
});

test('48 kHz 与 16 kHz 也保持 16 kHz 输出', () => {
  assert.ok(Math.abs(feed(48000, 1).samples() - 16000) <= 2);
  assert.ok(Math.abs(feed(16000, 1).samples() - 16000) <= 2);
});
