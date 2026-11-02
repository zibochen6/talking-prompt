import { memo, useLayoutEffect, useRef } from 'react';
import { clamp } from '../shared/state';
type Line = { start: number; end: number; y: number; height: number };
type Paragraph = { start: number; count: number; offsets: number[]; element: HTMLParagraphElement; lines?: Line[] };

export const Reader = memo(function Reader({ text, fontSize, online, currentPosition, seek, immersive, reveal, compactLandscape } : {
  text: string; fontSize: number; online: boolean; currentPosition: () => number;
  seek: (position: number) => void; immersive: boolean; reveal: () => void;
  compactLandscape: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const behavior = useRef({ online, seek, immersive, reveal });
  behavior.current = { online, seek, immersive, reveal };
  useLayoutEffect(() => {
    const container = viewport.current!;
    const body = content.current!;
    let globalStart = 0;
    const paragraphTexts = text.split('\n');
    const paragraphs: Paragraph[] = Array.from(body.querySelectorAll<HTMLParagraphElement>(':scope > p')).map((element, index) => {
      const characters = Array.from(paragraphTexts[index] ?? '');
      const offsets = [0];
      for (const character of characters) offsets.push(offsets.at(-1)! + character.length);
      const paragraph = { start: globalStart, count: characters.length, offsets, element };
      globalStart += characters.length + 1;
      return paragraph;
    });
    const total = Math.max(0, globalStart - 1);
    let lineHeight = parseFloat(getComputedStyle(body).lineHeight);
    const marker = container.querySelector<HTMLElement>('.reading-marker')!;
    // Range measurements are cached per paragraph, only as it enters the reading line.
    // The rendered text remains normal text nodes, including for long scripts.
    function lines(paragraph: Paragraph): Line[] {
      if (paragraph.lines) return paragraph.lines;
      const p = paragraph.element;
      const result: Line[] = [];
      const node = p.firstChild;
      if (node && paragraph.count) {
        const range = document.createRange();
        const pTop = p.getBoundingClientRect().top;
        const topAt = (index: number) => {
          range.setStart(node, paragraph.offsets[index]); range.setEnd(node, paragraph.offsets[index + 1]);
          return range.getBoundingClientRect().top - pTop;
        };
        let start = 0;
        while (start < paragraph.count) {
          const y = topAt(start);
          let low = start + 1;
          let high = paragraph.count;
          // Visual line tops are monotonic, so binary search avoids one DOM read per character.
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (Math.abs(topAt(middle) - y) < fontSize / 2) low = middle + 1;
            else high = middle;
          }
          result.push({ start, end: low, y, height: lineHeight });
          start = low;
        }
      }
      if (!result.length) result.push({ start: 0, end: 1, y: 0, height: lineHeight });
      paragraph.lines = result;
      return result;
    }
    function yAt(position: number) {
      let low = 0, high = paragraphs.length - 1;
      while (low < high) { const middle = Math.ceil((low + high) / 2); if (paragraphs[middle].start <= position) low = middle; else high = middle - 1; }
      const p = paragraphs[low];
      if (!p) return 0;
      const local = position - p.start;
      const allLines = lines(p);
      const line = allLines.find(line => local < line.end) ?? allLines.at(-1)!;
      return p.element.offsetTop + line.y + clamp((local - line.start) / (line.end - line.start), 0, 1) * line.height;
    }
    function positionAtY(y: number) {
      let low = 0, high = paragraphs.length - 1;
      while (low < high) { const middle = Math.ceil((low + high) / 2); if (paragraphs[middle].element.offsetTop <= y) low = middle; else high = middle - 1; }
      const p = paragraphs[low];
      if (!p) return 0;
      const localY = y - p.element.offsetTop;
      const allLines = lines(p);
      const line = allLines.find(line => localY < line.y + line.height) ?? allLines.at(-1)!;
      return clamp(p.start + line.start + clamp((localY - line.y) / line.height, 0, 1) * (line.end - line.start), 0, total);
    }
    let frame = 0;
    let stopped = false;
    function draw() {
      if (stopped) return;
      const y = yAt(currentPosition());
      const guide = marker.offsetTop;
      body.style.transform = `translate3d(0, ${guide - y}px, 0)`;
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    const observer = new ResizeObserver(() => {
      lineHeight = parseFloat(getComputedStyle(body).lineHeight);
      for (const p of paragraphs) p.lines = undefined;
      manualY = null;
    });
    observer.observe(body);
    let manualY: number | null = null;
    let lastInput = 0;
    let pendingY: number | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const commit = () => {
      clearTimeout(flushTimer); flushTimer = undefined;
      if (pendingY !== null && behavior.current.online) behavior.current.seek(positionAtY(pendingY));
      pendingY = null;
    };
    const move = (delta: number) => {
      if (!behavior.current.online) return;
      const now = performance.now();
      if (manualY === null || now - lastInput > 250) manualY = yAt(currentPosition());
      const maxY = yAt(total);
      manualY = clamp(manualY + delta, 0, maxY); lastInput = now;
      pendingY = manualY;
      if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = undefined; commit(); }, 50);
    };
    const wheel = (event: WheelEvent) => { event.preventDefault(); move(event.deltaY * (event.deltaMode === 1 ? lineHeight : 1)); };
    let pointer: { y: number; x: number; moved: boolean } | null = null;
    const down = (event: PointerEvent) => { pointer = { y: event.clientY, x: event.clientX, moved: false }; };
    const drag = (event: PointerEvent) => {
      if (!pointer || !behavior.current.online) return;
      const delta = pointer.y - event.clientY;
      if (Math.abs(delta) > 3) { pointer.moved = true; move(delta); pointer.y = event.clientY; }
    };
    const up = () => {
      if (pointer && !pointer.moved && behavior.current.immersive) behavior.current.reveal();
      pointer = null; commit();
    };
    container.addEventListener('wheel', wheel, { passive: false });
    container.addEventListener('pointerdown', down); container.addEventListener('pointermove', drag);
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => {
      stopped = true; cancelAnimationFrame(frame); clearTimeout(flushTimer); observer.disconnect();
      container.removeEventListener('wheel', wheel); container.removeEventListener('pointerdown', down); container.removeEventListener('pointermove', drag);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    };
  }, [text, fontSize, currentPosition, compactLandscape]);
  return <div ref={viewport} className="reader-viewport" aria-label="提词阅读区" data-testid="reader" style={{ fontSize }}>
    <div className="reading-marker" aria-hidden="true"><span /></div>
    <div ref={content} className="reader-content" data-testid="reader-content">
      {text ? text.split('\n').map((paragraph, index) => <p key={index}>{paragraph || '\u200b'}</p>) : <div className="empty-state"><h1>把想说的话，放在这里。</h1><p>{compactLandscape ? '在阅读设置中打开「编辑文稿」，开始你的下一次表达。' : '点击「编辑文稿」，开始你的下一次表达。'}</p></div>}
    </div>
  </div>;
});
