import { useMemo, useState } from 'react';
import { initialIdentity, rememberName, type Identity } from './identity';
import { useConnection } from './useConnection';
import { Lobby } from './components/Lobby';
import { Table } from './components/Table';

export function App() {
  const initial = useMemo(initialIdentity, []);
  const [name, setName] = useState(initial.name);
  const identity = useMemo<Identity | null>(
    () => (name ? { playerId: initial.playerId, roomId: initial.roomId, name } : null),
    [initial, name],
  );
  const { state, error, connected, send } = useConnection(identity);

  if (!identity) return <NameScreen onSubmit={(n) => (rememberName(n), setName(n))} />;

  return (
    <div className="app">
      {!connected && <div className="banner">Connecting to server...</div>}
      {error && <div className="toast">{error}</div>}
      {!state ? (
        <div className="center muted">Joining room "{identity.roomId}"...</div>
      ) : state.game ? (
        <Table state={state} game={state.game} send={send} />
      ) : (
        <Lobby state={state} send={send} />
      )}
    </div>
  );
}

function NameScreen({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="center name-screen"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <h1 className="logo">FLIP 7</h1>
      <div className="subtitle">with a Vengeance</div>
      <input autoFocus placeholder="Your name" maxLength={24} value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn primary" disabled={!value.trim()}>
        Join
      </button>
    </form>
  );
}
