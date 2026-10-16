import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import type { Identity } from './identity';

export type StateMessage = Extract<ServerMessage, { type: 'state' }>;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function useConnection(identity: Identity | null) {
  const [state, setState] = useState<StateMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!identity) return;
    let stopped = false;
    let retry: number | undefined;
    const connect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: 'join', ...identity } satisfies ClientMessage));
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as ServerMessage;
        if (msg.type === 'state') setState(msg);
        else setError(msg.message);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = window.setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [identity]);

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 3500);
    return () => window.clearTimeout(t);
  }, [error]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { state, error, connected, send };
}
