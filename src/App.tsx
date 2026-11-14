import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown, Copy, Expand, FileText, Maximize2, Monitor, Pause, Play, QrCode, RotateCcw, SlidersHorizontal, Smartphone, Wifi, X } from 'lucide-react';
import QRCode from 'qrcode';
import { clamp, MAX_TEXT_LENGTH, textLength } from '../shared/state';
import { usePrompt } from './usePrompt';
import { Reader } from './Reader';
import { FollowSwitch, FontSetting, SpeedSetting } from './ReadingSettings';
import { useDesktopCapture } from './voice-capture';
import { voiceStatusLabel } from './voice-status';
const COMPACT_LANDSCAPE = '(max-height: 600px) and (orientation: landscape)';
const NARROW = '(max-width: 700px)';
function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
function useVisualViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const viewport = window.visualViewport;
      if (!viewport) return;
      root.style.setProperty('--vv-height', `${viewport.height}px`);
      root.style.setProperty('--vv-offset', `${viewport.offsetTop}px`);
    };
    apply();
    window.visualViewport?.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.visualViewport?.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, []);
}
function readStorage(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function Dialog({ title, subtitle, onClose, children, className = '' }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label={title} className={`dialog ${className}`} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="关闭面板" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}
function Connection({ onClose, notify }: { onClose: () => void; notify: (message: string) => void }) {
  const [addresses, setAddresses] = useState<{ name: string; url: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/connection', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(info => { setAddresses(info.addresses); setSelected(info.addresses[0]?.url ?? ''); })
      .catch(error => { if (error.name !== 'AbortError') setError('无法获取连接地址，请关闭面板后重试。'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let cancelled = false; setQr('');
    if (selected) QRCode.toDataURL(selected, { margin: 2, width: 256, color: { dark: '#000000', light: '#ffffff' }, errorCorrectionLevel: 'M' })
      .then(url => { if (!cancelled) setQr(url); }).catch(() => setError('二维码生成失败，请手动输入下方地址。'));
    return () => { cancelled = true; };
  }, [selected]);
  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(selected);
      else {
        const input = document.createElement('textarea'); input.value = selected; document.body.appendChild(input); input.select();
        const success = document.execCommand('copy'); input.remove(); if (!success) throw new Error();
      }
      notify('连接地址已复制');
    } catch { notify('请长按或选中地址，手动复制'); }
  }
  return <Dialog title="让设备，同频。" subtitle="同一个 Wi-Fi，一份同步的文稿。" onClose={onClose} className="connection-dialog">
    <div className="device-pair"><Monitor size={26} /><span>······</span><Wifi size={20} /><span>······</span><Smartphone size={26} /></div>
    <div className="qr-box">{qr ? <img src={qr} alt="用 iPhone 相机扫描此二维码，打开局域网提词器" width="208" height="208" /> : <span>{error || (selected ? '正在生成二维码…' : '正在查找局域网地址…')}</span>}</div>
    <h3>用 iPhone 相机扫码打开</h3><p className="muted centered">确保手机与 Mac 连接同一网络</p>
    {selected && <div className="address-box"><code>{selected}</code><button className="icon-button" aria-label="复制连接地址" onClick={copy}><Copy size={16} /></button></div>}
    {addresses.length > 1 && <label className="network-select">其他网络地址<select value={selected} onChange={event => setSelected(event.target.value)}>{addresses.map(address => <option key={address.url} value={address.url}>{address.name} · {address.url}</option>)}</select><ChevronDown size={14} /></label>}
    {!selected && <p className="panel-warning">{error || '若未显示二维码，请确认 Mac 已连接 Wi-Fi，再重新打开此面板。'}</p>}
    <div className="connection-note"><span className="status-dot" />仅在局域网内连接，文稿保存在你的 Mac 上。</div>
  </Dialog>;
}
function Editor({ text, docRevision, online, apply, onClose, notify }: {
  text: string; docRevision: number; online: boolean; apply: (text: string, revision: number) => boolean; onClose: () => void; notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => readStorage('tongpin-draft') ?? text);
  const [base, setBase] = useState(docRevision);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const stale = base !== docRevision;
  useEffect(() => {
    if (pending && stale) { if (text === draft.replace(/\r\n?/g, '\n')) { notify('文稿已同步到所有设备'); onClose(); } else setPending(false); }
  }, [pending, stale, text, draft, notify, onClose]);
  useEffect(() => { if (!online) setPending(false); }, [online]);
  function update(value: string) {
    setDraft(value);
    try { localStorage.setItem('tongpin-draft', value); setSaveError(false); } catch { setSaveError(true); }
  }
  return <Dialog title="给表达，一份底稿。" subtitle="在这里写下或粘贴你想说的话。" onClose={onClose} className="editor-dialog">
    {stale && !pending && <div className="panel-warning">另一台设备已更新文稿。<button className="text-button" onClick={() => { update(text); setBase(docRevision); }}>载入最新文稿</button></div>}
    <textarea aria-label="文稿内容" autoFocus value={draft} maxLength={MAX_TEXT_LENGTH} placeholder="从第一句话开始…" onChange={event => update(event.target.value)} />
    <div className="editor-meta"><span>{saveError ? '当前浏览器无法保存草稿，请及时应用' : '草稿已保存在此设备'} </span><span>{textLength(draft).toLocaleString()} 字</span></div>
    <div className="editor-footer"><p>应用后，所有设备将暂停并回到开头。</p><button className="primary-button" disabled={!online || stale || pending} onClick={() => { if (apply(draft, base)) setPending(true); }}>{pending ? '正在同步…' : '应用文稿'}<ArrowRight size={17} /></button></div>
  </Dialog>;
}
function formatTime(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
export function App() {
  const [toast, setToast] = useState('');
  const notify = useCallback((message: string) => setToast(message), []);
  const prompt = usePrompt(notify);
  useDesktopCapture();
  const { state, online, position, clients } = prompt;
  const [panel, setPanel] = useState<'editor' | 'connection' | 'settings' | null>(null);
  const closePanel = useCallback(() => setPanel(null), []);
  const [immersive, setImmersive] = useState(false);
  const compactLandscape = useMedia(COMPACT_LANDSCAPE);
  const narrow = useMedia(NARROW);
  const readingFirst = compactLandscape || narrow;
  useVisualViewport();
  const scrubbing = useRef(false);
  const scrubPosition = useRef<number | null>(null);
  const [fontSize, setFontSize] = useState(() => {
    const saved = Number(readStorage('tongpin-font'));
    return saved >= 24 && saved <= 120 ? saved : matchMedia('(max-width: 700px)').matches || compactLandscape ? 36 : 64;
  });
  const length = useMemo(() => textLength(state.text), [state.text]);
  const progress = length ? clamp(position / length * 100, 0, 100) : 0;
  const playing = online && state.playing && position < length;
  const voiceLabel = state.mode === 'voice' ? voiceStatusLabel(state.voiceStatus, state.playing) : '';
  const chooseMode = (mode: 'timed' | 'voice') => { prompt.send({ type: 'preferMode', mode }); };
  const startProgress = () => { if (!online || !length) return; scrubbing.current = true; scrubPosition.current = prompt.currentPosition(); prompt.beginScrub(); };
  const moveProgress = (value: number) => {
    const next = value / 100 * length;
    scrubPosition.current = next;
    if (scrubbing.current) prompt.updateScrub(next);
    else prompt.endScrub(next);
  };
  const finishProgress = () => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    prompt.endScrub(scrubPosition.current ?? prompt.currentPosition());
    scrubPosition.current = null;
  };
  const reveal = useCallback(() => setImmersive(false), []);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { try { localStorage.setItem('tongpin-font', String(fontSize)); } catch { /* Local font is optional. */ } }, [fontSize]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (panel || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) return;
      if (event.code === 'Space') { event.preventDefault(); prompt.send({ type: playing ? 'pause' : 'play' }); }
      if (event.key === 'Escape') setImmersive(false);
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [playing, panel, prompt.send]);
  return <main className={`app ${immersive ? 'immersive' : ''}`} data-compact-landscape={compactLandscape || undefined} data-reading-first={readingFirst || undefined}>
    <header className="topbar chrome"><a href="/" className="brand" aria-label="同频提词器首页"><span className="brand-mark"><i /><i /><i /></span><strong>同频<span>局域网提词器</span></strong></a>
      <nav aria-label="工具"><div className={`connection-status ${online ? '' : 'offline'}`} role="status"><span className="status-dot" />{online ? `${clients} 台设备在线` : '连接中…'}</div><span className="nav-divider" /><button className="secondary-button" aria-label="编辑文稿" onClick={() => setPanel('editor')}><FileText size={16} /><span>编辑文稿</span></button><button className="secondary-button" aria-label="连接设备" onClick={() => setPanel('connection')}><QrCode size={17} /><span>连接设备</span></button></nav>
    </header>
    <section className="stage" aria-label="提词器">
      <div className="stage-meta chrome"><div><span className={`live-dot ${playing ? 'active' : ''}`} />{voiceLabel || (playing ? '正在提词' : progress >= 100 && length ? '本次提词已结束' : '准备就绪')}<span className="meta-divider">/</span><span className="meta-hint">{length ? `${length.toLocaleString()} 字文稿` : '等待你的第一句话'}</span></div><div className="remaining">{state.mode === 'voice' ? <span>跟随朗读</span> : <><span>剩余</span><time>{formatTime((length - position) / state.speed * 60)}</time></>}</div></div>
      <Reader text={state.text} fontSize={fontSize} online={online} currentPosition={prompt.currentPosition} beginScrub={prompt.beginScrub} updateScrub={prompt.updateScrub} endScrub={prompt.endScrub} immersive={immersive} reveal={reveal} compactLandscape={compactLandscape} readingFirst={readingFirst} />
      <div className="stage-bottom chrome"><span>专注表达，其他交给同频。</span><button className="text-button" onClick={() => setImmersive(true)}><Expand size={15} />沉浸阅读</button></div>
    </section>
    <footer className="control-dock chrome">
      <div className="progress-row"><label htmlFor="progress">阅读进度</label><input id="progress" aria-label="阅读进度" type="range" min="0" max="100" step="0.1" value={progress} disabled={!online || !length} style={{ '--fill': `${progress}%` } as React.CSSProperties} onPointerDown={startProgress} onChange={event => moveProgress(Number(event.target.value))} onPointerUp={finishProgress} onPointerCancel={finishProgress} /><output>{Math.floor(progress)}<span>%</span></output></div>
      <div className="controls-row"><div className="transport"><button className="icon-button reset-button" aria-label="回到开头" title="回到开头" disabled={!online} onClick={() => prompt.send({ type: 'reset' })}><RotateCcw size={20} /></button><button className="play-button" aria-label={playing ? '暂停提词' : '开始提词'} disabled={!online || !state.text.trim()} onClick={() => prompt.send({ type: playing ? 'pause' : 'play' })}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}<span>{playing ? '暂停提词' : '开始提词'}</span><kbd>空格</kbd></button></div>
        <FollowSwitch id="dock-follow" mode={state.mode} online={online} onChange={chooseMode} />
        <SpeedSetting id="speed" speed={state.speed} online={online} onChange={speed => prompt.send({ type: 'speed', speed })} />
        <FontSetting id="font" fontSize={fontSize} onChange={setFontSize} />
      </div>
    </footer>
    <div className="page-note chrome"><span><Wifi size={12} />{online ? '本地连接 · 实时同步' : '连接已断开 · 阅读已暂停，正在重连'}</span><span>{state.mode === 'voice' ? '声音只在 Mac 上识别，手机只同步文字位置。' : '你的文字，只留在你的设备里。'}</span></div>
    {readingFirst && <nav className="landscape-toolbar chrome" aria-label={compactLandscape ? '横屏提词控制' : '提词控制'}>
      <span className={`toolbar-status ${online ? '' : 'offline'}`} role="status"><span className="status-dot" />{online ? '' : '重连'}</span>
      <button className="landscape-icon-button" aria-label="回到开头" disabled={!online} onClick={() => prompt.send({ type: 'reset' })}><RotateCcw size={19} /></button>
      <button className="landscape-play" aria-label={playing ? '暂停提词' : '开始提词'} disabled={!online || !state.text.trim()} onClick={() => prompt.send({ type: playing ? 'pause' : 'play' })}>
        {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}<span>{playing ? '暂停' : '播放'}</span>
      </button>
      <div className="landscape-progress"><input id="landscape-progress" aria-label="阅读进度" type="range" min="0" max="100" step="0.1" value={progress} disabled={!online || !length}
        style={{ '--fill': `${progress}%` } as React.CSSProperties} onPointerDown={startProgress} onChange={event => moveProgress(Number(event.target.value))} onPointerUp={finishProgress} onPointerCancel={finishProgress} /><output>{Math.floor(progress)}%</output></div>
      <button className="landscape-settings-button" aria-label="阅读设置" aria-haspopup="dialog" onClick={() => setPanel('settings')}><SlidersHorizontal size={19} /><span className="settings-speed">{state.mode === 'voice' ? '声控' : `${state.speed} 字/分`}</span><span className="settings-label">设置</span></button>
      <button className="landscape-icon-button" aria-label="沉浸阅读" onClick={() => setImmersive(true)}><Expand size={19} /></button>
    </nav>}
    {immersive && <button className="immersive-exit" onClick={reveal} aria-label="退出沉浸阅读"><Maximize2 size={16} /><span>退出沉浸</span></button>}
    {(!online || prompt.warning) && <div className="connection-banner" role="status">{prompt.warning || '正在连接 Mac…连接恢复后将自动同步阅读位置。'}</div>}
    {panel === 'connection' && <Connection onClose={closePanel} notify={notify} />}
    {panel === 'settings' && <Dialog title="阅读设置" subtitle="速度多端同步，字号仅调整此设备。声控跟随使用 Mac 麦克风。" onClose={closePanel} className="reading-settings-dialog">
      <FollowSwitch id="reading-follow" mode={state.mode} online={online} onChange={chooseMode} />
      <p className="follow-note" role="status">{voiceLabel || '匀速滚动按设定的速度前进。'} 声音只在 Mac 上识别，手机不采集麦克风。</p>
      <div className="reading-settings-grid">
        <SpeedSetting id="reading-speed" speed={state.speed} online={online} onChange={speed => prompt.send({ type: 'speed', speed })} />
        <FontSetting id="reading-font" fontSize={fontSize} onChange={setFontSize} />
      </div>
      <div className="reading-settings-actions"><span className={`connection-status ${online ? '' : 'offline'}`}><span className="status-dot" />{online ? `${clients} 台设备在线` : '正在重连…'}</span>
        <button className="secondary-button" onClick={() => setPanel('editor')} aria-label="编辑文稿"><FileText size={16} /><span>编辑文稿</span></button>
        <button className="secondary-button" onClick={() => setPanel('connection')} aria-label="连接设备"><QrCode size={16} /><span>连接设备</span></button>
      </div>
    </Dialog>}
    {panel === 'editor' && <Editor text={state.text} docRevision={state.docRevision} online={online} apply={(text, revision) => prompt.send({ type: 'apply', text }, revision)} onClose={closePanel} notify={notify} />}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
  </main>;
}
