import { memo, useLayoutEffect, useRef } from 'react';
import { clamp } from '../shared/state';
import { characterOffsets, ensureLine, indexForLocalY, nextManualY, prefetchIndex, yForIndex, type LineBox } from './reading-geometry';

type Paragraph = {
  start: number;
  count: number;
  offsets: number[];
  element: HTMLParagraphElement;
  top: number;
  lines: LineBox[];
};

export const Reader = memo(function Reader({ text, fontSize, online, currentPosition, beginScrub, updateScrub, endScrub, immersive, reveal, compactLandscape, readingFirst }: {
  text: string;
  fontSize: number;
  online: boolean;
  currentPosition: () => number;
  beginScrub: () => boolean;
  updateScrub: (position: number) => boolean;
  endScrub: (position: number) => boolean;
  immersive: boolean;
  reveal: () => void;
  compactLandscape: boolean;
  readingFirst: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const behavior = useRef({ online, beginScrub, updateScrub, endScrub, immersive, reveal });
  behavior.current = { online, beginScrub, updateScrub, endScrub, immersive, reveal };
  useLayoutEffect(() => {
    const container = viewport.current!;
    const body = content.current!;
    let globalStart = 0;
    const paragraphTexts = text.split('\n');
    const paragraphs: Paragraph[] = Array.from(body.querySelectorAll<HTMLParagraphElement>(':scope > p')).map((element, index) => {
      const source = paragraphTexts[index] ?? '';
      const offsets = characterOffsets(source);
      const count = offsets.length - 1;
      const paragraph = { start: globalStart, count, offsets, element, top: 0, lines: [] as LineBox[] };
      globalStart += count + 1;
      return paragraph;
    });
    const total = Math.max(0, globalStart - 1);
    const marker = container.querySelector<HTMLElement>('.reading-marker')!;
    const range = document.createRange();
    let lineHeight = parseFloat(getComputedStyle(body).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) lineHeight = fontSize * 1.65;
    const tolerance = Math.max(1, fontSize / 2);
    let markerTop = marker.offsetTop;
    let contentWidth = body.clientWidth;
    const refreshAnchors = () => {
      for (const paragraph of paragraphs) paragraph.top = paragraph.element.offsetTop;
      markerTop = marker.offsetTop;
    };
    refreshAnchors();
    const topAt = (paragraph: Paragraph, index: number) => {
      const node = paragraph.element.firstChild;
      if (!node || paragraph.count <= 0) return 0;
      const safe = clamp(index, 0, paragraph.count - 1);
      const pTop = paragraph.element.getBoundingClientRect().top;
      range.setStart(node, paragraph.offsets[safe]);
      range.setEnd(node, paragraph.offsets[safe + 1]);
      return range.getBoundingClientRect().top - pTop;
    };
    const paragraphAt = (position: number) => {
      let low = 0;
      let high = paragraphs.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (paragraphs[middle].start <= position) low = middle;
        else high = middle - 1;
      }
      return paragraphs[low];
    };
    function yAt(position: number, prefetch = false) {
      const paragraph = paragraphAt(position);
      if (!paragraph) return 0;
      const local = position - paragraph.start;
      const y = paragraph.top + yForIndex(local, paragraph.count, lineHeight, index => topAt(paragraph, index), tolerance, paragraph.lines);
      if (prefetch && paragraph.count > 0 && local < paragraph.count) {
        const line = ensureLine(paragraph.lines, paragraph.count, local, lineHeight, index => topAt(paragraph, index), tolerance);
        const next = prefetchIndex(line, local, paragraph.count);
        if (next !== null) ensureLine(paragraph.lines, paragraph.count, next, lineHeight, index => topAt(paragraph, index), tolerance);
        else if (local >= paragraph.count - 1) {
          const following = paragraphs[paragraphs.indexOf(paragraph) + 1];
          if (following?.count) ensureLine(following.lines, following.count, 0, lineHeight, index => topAt(following, index), tolerance);
        }
      }
      return y;
    }
    function positionAtY(y: number) {
      let low = 0;
      let high = paragraphs.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (paragraphs[middle].top <= y) low = middle;
        else high = middle - 1;
      }
      const paragraph = paragraphs[low];
      if (!paragraph) return 0;
      const local = indexForLocalY(y - paragraph.top, paragraph.count, lineHeight, index => topAt(paragraph, index), tolerance, paragraph.lines);
      return clamp(paragraph.start + local, 0, total);
    }
    const apply = (y: number) => { body.style.transform = `translate3d(0, ${markerTop - y}px, 0)`; };
    let manualY: number | null = null;
    let maxY = 0;
    let maxYValid = false;
    let frame = 0;
    let stopped = false;
    function draw() {
      if (stopped) return;
      apply(manualY ?? yAt(currentPosition(), manualY === null));
      frame = requestAnimationFrame(draw);
    }
    apply(yAt(currentPosition()));
    frame = requestAnimationFrame(draw);
    const observer = new ResizeObserver(entries => {
      let widthChanged = false;
      for (const entry of entries) {
        if (entry.target === body && Math.abs(entry.contentRect.width - contentWidth) > 0.5) {
          contentWidth = entry.contentRect.width;
          widthChanged = true;
        }
      }
      const nextHeight = parseFloat(getComputedStyle(body).lineHeight);
      if (Number.isFinite(nextHeight) && nextHeight > 0) lineHeight = nextHeight;
      if (widthChanged) {
        for (const paragraph of paragraphs) paragraph.lines = [];
        maxYValid = false;
      }
      refreshAnchors();
    });
    observer.observe(body);
    observer.observe(container);
    let idle = 0;
    const finish = () => {
      window.clearTimeout(idle);
      if (manualY === null || !behavior.current.online) { manualY = null; return; }
      const y = manualY;
      manualY = null;
      behavior.current.endScrub(positionAtY(y));
      apply(y);
    };
    const move = (delta: number) => {
      if (!behavior.current.online) return;
      if (manualY === null) {
        if (!behavior.current.beginScrub()) return;
        manualY = yAt(currentPosition());
      }
      if (!maxYValid) { maxY = yAt(total); maxYValid = true; }
      manualY = nextManualY(manualY, manualY, delta, maxY);
      apply(manualY);
      behavior.current.updateScrub(positionAtY(manualY));
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      move(event.deltaY * (event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? container.clientHeight : 1));
      window.clearTimeout(idle);
      idle = window.setTimeout(finish, 140);
    };
    let pointer: { y: number; moved: boolean } | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointer = { y: event.clientY, moved: false };
      try { container.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no capture. */ }
    };
    const drag = (event: PointerEvent) => {
      if (!pointer || !behavior.current.online) return;
      const delta = pointer.y - event.clientY;
      if (Math.abs(delta) <= 3 && !pointer.moved) return;
      pointer.moved = true;
      move(delta);
      pointer.y = event.clientY;
    };
    const up = () => {
      const moved = pointer?.moved ?? false;
      if (pointer && !moved && behavior.current.immersive) behavior.current.reveal();
      pointer = null;
      if (moved) finish();
    };
    container.addEventListener('wheel', wheel, { passive: false });
    container.addEventListener('pointerdown', down);
    container.addEventListener('pointermove', drag);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(idle);
      observer.disconnect();
      range.detach?.();
      container.removeEventListener('wheel', wheel);
      container.removeEventListener('pointerdown', down);
      container.removeEventListener('pointermove', drag);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [text, fontSize, currentPosition, compactLandscape]);
  return <div ref={viewport} className="reader-viewport" aria-label="提词阅读区" data-testid="reader" style={{ fontSize }}>
    <div className="reading-marker" aria-hidden="true"><span /></div>
    <div ref={content} className="reader-content" data-testid="reader-content">
      {text ? text.split('\n').map((paragraph, index) => <p key={index}>{paragraph || '\u200b'}</p>) : <div className="empty-state"><h1>把想说的话，放在这里。</h1><p>{readingFirst ? '在阅读设置中打开「编辑文稿」，开始你的下一次表达。' : '点击「编辑文稿」，开始你的下一次表达。'}</p></div>}
    </div>
  </div>;
});
