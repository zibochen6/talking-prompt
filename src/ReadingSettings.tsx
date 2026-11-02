import type { CSSProperties } from 'react';

export function SpeedSetting({ id, speed, online, onChange }: {
  id: string; speed: number; online: boolean; onChange: (speed: number) => void;
}) {
  return <div className="setting speed-setting">
    <div className="setting-title"><label htmlFor={id}>滚动速度</label><output>{speed}<span>字 / 分钟</span></output></div>
    <div className="slider-with-ends"><span>慢</span>
      <input id={id} aria-label="滚动速度" type="range" min="30" max="600" step="10" value={speed} disabled={!online}
        style={{ '--fill': `${(speed - 30) / 570 * 100}%` } as CSSProperties}
        onChange={event => onChange(Number(event.target.value))} />
      <span>快</span>
    </div>
  </div>;
}

export function FontSetting({ id, fontSize, onChange }: {
  id: string; fontSize: number; onChange: (size: number) => void;
}) {
  return <div className="setting font-setting">
    <div className="setting-title"><label htmlFor={id}>字体大小 <span className="local-tag">仅此设备</span></label><output>{fontSize}<span>px</span></output></div>
    <div className="slider-with-ends"><span className="small-a">A</span>
      <input id={id} aria-label="字体大小" type="range" min="24" max="120" step="2" value={fontSize}
        style={{ '--fill': `${(fontSize - 24) / 96 * 100}%` } as CSSProperties}
        onChange={event => onChange(Number(event.target.value))} />
      <span className="large-a">A</span>
    </div>
  </div>;
}
