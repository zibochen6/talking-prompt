import { useCallback, useEffect, useRef, useState } from 'react';
import { initialState, positionAt, textLength, type Command, type PromptState } from '../shared/state';
type WithoutRevision<T> = T extends unknown ? Omit<T, 'docRevision'> : never;
export type InputCommand = WithoutRevision<Command>;
export function usePrompt(notify: (message: string) => void) {
  const [state, setState] = useState<PromptState>(() => ({ ...initialState(), text: '' }));
  const [online, setOnline] = useState(false);
  const [clients, setClients] = useState(0);
  const [warning, setWarning] = useState('');
  const [position, setPosition] = useState(0);
  const snapshot = useRef(state);
  const socket = useRef<WebSocket | null>(null);
  const connected = useRef(false);
  const length = useRef(0);
  const offset = useRef(Date.now() - performance.now());
  const lastMessage = useRef(0);
  const frozen = useRef(0);
  const currentPosition = useCallback(() => connected.current ? positionAt(snapshot.current, performance.now() + offset.current, length.current) : frozen.current, []);
  useEffect(() => {
    let disposed = false;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let bestRtt = Infinity;
    function freeze() {
      if (connected.current) frozen.current = currentPosition();
      connected.current = false; setOnline(false); setPosition(frozen.current);
    }
    function connect() {
      if (disposed || document.hidden) return;
      clearTimeout(reconnect);
      if (socket.current && socket.current.readyState < WebSocket.CLOSING) return;
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`);
      socket.current = ws;
      bestRtt = Infinity;
      ws.onopen = () => { attempts = 0; offset.current = Date.now() - performance.now(); ws.send(JSON.stringify({ type: 'ping', clientTime: performance.now() })); };
      ws.onmessage = event => {
        if (disposed || socket.current !== ws) return;
        lastMessage.current = performance.now();
        let message: any;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'pong') {
          const rtt = performance.now() - message.clientTime;
          if (rtt < bestRtt) { bestRtt = rtt; offset.current = message.serverTime - (message.clientTime + performance.now()) / 2; }
        } else if (message.type === 'state' || message.type === 'clock') {
          if (message.type === 'clock' && (!connected.current || message.docRevision !== snapshot.current.docRevision)) {
            ws.send(JSON.stringify({ type: 'sync' })); return;
          }
          const next: PromptState = message.type === 'state' ? message.state : {
            ...snapshot.current, position: message.position, playing: message.playing, speed: message.speed,
            updatedAt: message.updatedAt, revision: message.revision, docRevision: message.docRevision
          };
          snapshot.current = next; length.current = textLength(next.text);
          setState(next); setClients(message.clients); setWarning(message.warning ?? '');
          if (!document.hidden) { connected.current = true; setOnline(true); setPosition(currentPosition()); }
        } else if (message.type === 'error') notify(message.message);
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (disposed || socket.current !== ws) return;
        freeze();
        if (!document.hidden) reconnect = setTimeout(connect, Math.min(4000, 500 * 2 ** attempts++));
      };
    }
    connect();
    const heartbeat = setInterval(() => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) {
        if (performance.now() - lastMessage.current > 4500) { freeze(); ws.close(); }
        else ws.send(JSON.stringify({ type: 'ping', clientTime: performance.now() }));
      }
    }, 1500);
    const paint = setInterval(() => setPosition(currentPosition()), 100);
    const visibility = () => {
      if (document.hidden) freeze();
      else if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'sync' }));
      else connect();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', connect);
    return () => {
      disposed = true; clearTimeout(reconnect); clearInterval(heartbeat); clearInterval(paint);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', connect);
      socket.current?.close(); connected.current = false;
    };
  }, [currentPosition, notify]);
  const send = useCallback((command: InputCommand, docRevision = snapshot.current.docRevision) => {
    if (!connected.current || socket.current?.readyState !== WebSocket.OPEN) { notify('连接恢复后即可操作'); return false; }
    if (command.type === 'seek') {
      snapshot.current = { ...snapshot.current, position: command.position, playing: false, updatedAt: performance.now() + offset.current };
      setPosition(command.position);
    }
    socket.current.send(JSON.stringify({ ...command, docRevision }));
    return true;
  }, [notify]);
  return { state, online, clients, warning, position, currentPosition, send };
}
