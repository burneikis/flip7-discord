import { VARIANTS, VARIANT_NAMES } from '../../shared/cards';
import { TURN_TIMER_CHOICES, type ClientMessage } from '../../shared/protocol';
import type { WinRule } from '../../shared/engine';
import type { StateMessage } from '../useConnection';
import { isInDiscord } from '../identity';

export function Lobby({ state, send }: { state: StateMessage; send: (m: ClientMessage) => void }) {
  const { room, you } = state;
  const isHost = room.hostId === you;
  const host = room.members.find((m) => m.id === room.hostId);
  const seated = room.members.some((m) => m.id === you);

  return (
    <div className="lobby">
      <h1 className="logo">FLIP 7</h1>
      {room.variant === 'vengeance' && <div className="subtitle">with a Vengeance</div>}
      <div className="panel">
        <div className="panel-title">
          {isInDiscord() ? 'Table' : <>Room <code>{room.id}</code></>} - {room.members.length} player{room.members.length === 1 ? '' : 's'}
        </div>
        <ul className="members">
          {room.members.map((m) => (
            <li key={m.id}>
              <span className={m.connected ? '' : 'muted'}>{m.name}</span>
              {!m.connected && <span className="tag offline">reconnecting</span>}
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
            Rules
            <select value={room.variant} disabled={!isHost} onChange={(e) => send({ type: 'setOptions', variant: e.target.value as (typeof VARIANTS)[number] })}>
              {VARIANTS.map((v) => (
                <option key={v} value={v}>
                  {VARIANT_NAMES[v]}
                </option>
              ))}
            </select>
          </label>
          {room.variant === 'vengeance' && (
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
          )}
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
          <label>
            Winner
            <select value={room.winRule} disabled={!isHost} onChange={(e) => send({ type: 'setOptions', winRule: e.target.value as WinRule })}>
              <option value="roundEnd">Finish the round, highest score wins</option>
              <option value="instant">First to bank {room.target} wins instantly</option>
            </select>
          </label>
          <label>
            Turn timer
            <select value={room.turnSeconds} disabled={!isHost} onChange={(e) => send({ type: 'setOptions', turnSeconds: Number(e.target.value) })}>
              {TURN_TIMER_CHOICES.map((s) => (
                <option key={s} value={s}>
                  {s ? `${s} seconds` : 'Off'}
                </option>
              ))}
            </select>
            {room.turnSeconds > 0 && <span className="muted small">(out of time: you stay)</span>}
          </label>
        </div>

        {!seated && (
          <div className="row notice">
            <span>You are not seated at this table.</span>
            <button className="btn primary" onClick={() => send({ type: 'sit' })}>
              Sit down
            </button>
          </div>
        )}

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
