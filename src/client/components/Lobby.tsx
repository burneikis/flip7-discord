import type { ClientMessage } from '../../shared/protocol';
import type { StateMessage } from '../useConnection';
import { isInDiscord } from '../identity';

export function Lobby({ state, send }: { state: StateMessage; send: (m: ClientMessage) => void }) {
  const { room, you } = state;
  const isHost = room.hostId === you;
  const host = room.members.find((m) => m.id === room.hostId);

  return (
    <div className="lobby">
      <h1 className="logo">FLIP 7</h1>
      <div className="subtitle">with a Vengeance</div>
      <div className="panel">
        <div className="panel-title">
          {isInDiscord() ? 'Table' : <>Room <code>{room.id}</code></>} - {room.members.length} player{room.members.length === 1 ? '' : 's'}
        </div>
        <ul className="members">
          {room.members.map((m) => (
            <li key={m.id}>
              <span className={m.connected ? '' : 'muted'}>{m.name}</span>
              {m.id === you && <span className="tag you">you</span>}
              {m.isBot && <span className="tag">bot</span>}
              {m.id === room.hostId && <span className="tag host">host</span>}
              {isHost && m.id !== you && (
                <button className="btn tiny ghost" onClick={() => send({ type: 'kick', playerId: m.id })}>
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="options">
          <label>
            <input
              type="checkbox"
              checked={room.brutal}
              disabled={!isHost}
              onChange={(e) => send({ type: 'setOptions', brutal: e.target.checked })}
            />
            Brutal mode
            <span className="muted small"> (scores can go negative, Modifiers can hit busted players, Flip 7 can take 15 from someone)</span>
          </label>
          <label>
            First to
            <input
              type="number"
              min={25}
              max={1000}
              step={25}
              value={room.target}
              disabled={!isHost}
              onChange={(e) => send({ type: 'setOptions', target: Number(e.target.value) })}
            />
            points
          </label>
        </div>

        {isHost ? (
          <div className="row">
            <button className="btn" onClick={() => send({ type: 'addBot' })}>
              Add bot
            </button>
            <button className="btn primary" disabled={room.members.length < 2} onClick={() => send({ type: 'start' })}>
              Start game
            </button>
          </div>
        ) : (
          <div className="muted">Waiting for {host?.name ?? 'the host'} to start...</div>
        )}
      </div>
      {isInDiscord() ? (
        <div className="muted small">Friends join by launching the activity in this voice channel.</div>
      ) : (
        <div className="muted small">
          Friends join by opening this page with <code>?room={room.id}</code>.
        </div>
      )}
    </div>
  );
}
