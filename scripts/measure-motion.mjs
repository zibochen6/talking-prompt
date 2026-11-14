// Reproducible motion probe for the teleprompter. Not part of npm test.
// Requires a running server and playwright-core (system Chrome):
//   npm install --no-save playwright-core
//   PROMPT_DATA_DIR=/tmp/tongpin-measure PORT=3210 npm start
//   BASE_URL=http://127.0.0.1:3210 THROTTLE=4 node scripts/measure-motion.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:3210';
const throttle = Number(process.env.THROTTLE ?? 4);
const out = process.env.OUT ?? 'motion-measure.json';
const long = '今天我们把一段很长的单段讲稿放在阅读线上，用来观察进入段落时的测量和随后的匀速推进。'.repeat(80);
const text = [long, '第一段短句。', '第二段也保持很短。', '边界之后又是一段很长的文字，播放应当继续平滑地走过这些字符。'.repeat(40)].join('\n');

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const session = await page.context().newCDPSession(page);
await session.send('Emulation.setCPUThrottlingRate', { rate: throttle });
await page.addInitScript(() => {
  const orig = Range.prototype.getBoundingClientRect;
  let calls = 0;
  let ms = 0;
  window.__bursts = [];
  Range.prototype.getBoundingClientRect = function () {
    const t0 = performance.now();
    const rect = orig.call(this);
    calls += 1;
    ms += performance.now() - t0;
    return rect;
  };
  const loop = () => {
    if (calls) window.__bursts.push({ calls, ms: +ms.toFixed(2) });
    calls = 0;
    ms = 0;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.body.innerText.includes('在线'));
await page.getByRole('button', { name: '编辑文稿' }).click();
await page.getByRole('textbox', { name: '文稿内容' }).fill(text);
await page.getByRole('button', { name: '应用文稿' }).click();
await page.waitForFunction(() => !document.querySelector('dialog[open]'));
await page.waitForTimeout(400);
const before = await page.evaluate(() => window.__bursts.length);
await page.evaluate(() => { document.querySelector('[data-testid="reader-content"]').style.width = '68%'; });
await page.waitForTimeout(600);
const remeasure = await page.evaluate(start => window.__bursts.slice(start), before);

await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
const scrub = await page.evaluate(async () => {
  const node = document.querySelector('[data-testid="reader-content"]');
  const reader = document.querySelector('[data-testid="reader"]');
  const yOf = () => Number((getComputedStyle(node).transform.match(/matrix\(([^)]+)\)/)?.[1] ?? '0,0,0,0,0,0').split(',')[5]);
  const deltas = [];
  let previous = yOf();
  for (let i = 0; i < 12; i++) {
    reader.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 16));
    const y = yOf();
    deltas.push(Math.round(y - previous));
    previous = y;
  }
  return deltas;
});
const report = {
  throttle,
  chars: [...text].length,
  remeasureBursts: remeasure,
  maxRects: Math.max(0, ...remeasure.map(b => b.calls)),
  maxRectMs: Math.max(0, ...remeasure.map(b => b.ms)),
  scrubDeltas: scrub,
  scrubBackward: scrub.filter(d => d > 2).length,
};
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
