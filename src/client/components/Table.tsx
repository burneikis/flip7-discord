import { useEffect, useState } from 'react';
import { cardLabel, ALL_CARD_KEYS, cardFromKey } from '../../shared/cards';
import type { Prompt } from '../../shared/engine';
import type { ClientMessage, GameView, PlayerView } from '../../shared/protocol';
import type { ScoreBreakdown } from '../../shared/scoring';
import type { StateMessage } from '../useConnection';
import { CardView } from './CardView';

type Send = (m: ClientMessage) => void;

interface Props { state: StateMessage; game: GameView; send: Send }

export function Table({ state, game, send }: Props) {
  const you = state.you;
  const isHost = state.room.hostId === you;
  const me = game.players.find((p) => p.id === you) ?? null;
  const others = game.players.filter((p) => p.id !== you);
  const prompt = game.phase === 'playing' ? game.prompt : null;
  const myPrompt = prompt && prompt.playerId === you ? prompt : null;
  const [swapPick, setSwapPick] = useState<number | null>(null);
  const [hideSummary, setHideSummary] = useState(false);

  useEffect(() => setSwapPick(null), [prompt]);
  useEffect(() => setHideSummary(false), [game.round, game.phase]);

  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?';
  const decide = (decision: Extract<ClientMessage, { type: 'decide' }>['decision']) => send({ type: 'decide', decision });

  // What's clickable right now
  // (for a swap, once one card is picked, the same player's other cards are not)
  const pickable = new Set<number>();
  if (myPrompt && (myPrompt.kind === 'steal' || myPrompt.kind === 'discard' || myPrompt.kind === 'swap')) {
    const pickedOwner = myPrompt.options.find((r) => r.cardId === swapPick)?.ownerId;
    for (const r of myPrompt.options) {
      if (myPrompt.kind === 'swap' && r.ownerId === pickedOwner && r.cardId !== swapPick) continue;
      pickable.add(r.cardId);
    }
  }
  const seatTargets = new Set(myPrompt?.kind === 'give' ? myPrompt.options : []);

  const onCard = (cardId: number) => {
    if (!myPrompt) return;
    if (myPrompt.kind === 'steal') decide({ type: 'steal', cardId });
    else if (myPrompt.kind === 'discard') decide({ type: 'discard', cardId });
    else if (myPrompt.kind === 'swap') {
      if (swapPick === null) setSwapPick(cardId);
      else if (swapPick === cardId) setSwapPick(null);
      else decide({ type: 'swap', cardIds: [swapPick, cardId] });
    }
  };
  const onSeat = (pid: string) => {
    if (seatTargets.has(pid)) decide({ type: 'give', targetId: pid });
  };

  const seat = (p: PlayerView, big = false) => (
    <Seat
      key={p.id}
      p={p}
      big={big}
      isYou={p.id === you}
      isDealer={p.id === game.dealerId}
      isTurn={p.id === game.turnId}
      deciding={prompt?.playerId === p.id}
      target={seatTargets.has(p.id)}
      pickable={pickable}
      picked={swapPick}
      onCard={onCard}
      onSeat={() => onSeat(p.id)}
    />
  );

  return (
    <div className="table">
      <div className="topbar">
        <span className="logo small-logo">FLIP 7</span>
        <span>Round {game.round}</span>
        <span>Deck {game.deckCount}</span>
        <span>Discard {game.discardCount}</span>
        <span>First to {game.options.target}</span>
        {game.options.brutal && <span className="tag brutal">BRUTAL</span>}
        <span className="spacer" />
        {state.devMode && <DevPanel send={send} />}
        {isHost && (
          <button className="btn tiny ghost" onClick={() => confirm('End the game for everyone?') && send({ type: 'endGame' })}>
            End game
          </button>
        )}
      </div>

      <div className="main">
        <div className="board">
          <div className="seats">{(me ? others : game.players).map((p) => seat(p))}</div>
          {me && <div className="my-seat">{seat(me, true)}</div>}
          <ActionBar game={game} prompt={prompt} myPrompt={myPrompt} name={name} decide={decide} swapPick={swapPick} clearSwap={() => setSwapPick(null)} />
        </div>
        <Log game={game} />
      </div>

      {game.phase !== 'playing' && !hideSummary && (
        <Summary game={game} you={you} isHost={isHost} send={send} hide={() => setHideSummary(true)} />
      )}
      {game.phase !== 'playing' && hideSummary && (
        <button className="btn primary floating" onClick={() => setHideSummary(false)}>
          Show scores
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- seat

interface SeatProps {
  p: PlayerView;
  big: boolean;
  isYou: boolean;
  isDealer: boolean;
  isTurn: boolean;
  deciding: boolean;
  target: boolean;
  pickable: Set<number>;
  picked: number | null;
  onCard: (id: number) => void;
  onSeat: () => void;
}

function Seat({ p, big, isYou, isDealer, isTurn, deciding, target, pickable, picked, onCard, onSeat }: SeatProps) {
  const busted = p.status === 'busted';
  const mods = p.line.filter((c) => c.kind === 'modifier');
  const nums = p.line.filter((c) => c.kind === 'number');
  const cls = ['seat', p.status];
  if (big) cls.push('big');
  if (isTurn) cls.push('turn');
  if (deciding) cls.push('deciding');
  if (target) cls.push('target');

  const card = (c: (typeof p.line)[number]) => (
    <CardView key={c.id} card={c} faceDown={busted} selectable={pickable.has(c.id)} selected={picked === c.id} onClick={() => onCard(c.id)} />
  );

  return (
    <div className={cls.join(' ')} onClick={target ? onSeat : undefined}>
      <div className="seat-head">
        <span className="seat-name">{p.name}</span>
        {isYou && <span className="tag you">you</span>}
        {p.isBot && <span className="tag">bot</span>}
        {!p.connected && <span className="tag offline">offline</span>}
        {isDealer && <span className="tag dealer" title="Dealer">D</span>}
        <span className={`status ${p.status}`}>{p.status}</span>
        <span className="spacer" />
        <span className="score" title="Round score so far / total">
          {busted ? (p.live.total ? p.live.total : '-') : `+${p.live.total}`}
          <span className="total">{p.total}</span>
        </span>
      </div>
      <div className="mods">{mods.map(card)}</div>
      <div className="nums">
        {nums.map(card)}
        {!p.line.length && <span className="muted small empty">no cards</span>}
      </div>
      <div className="seat-foot muted small">
        {nums.length}/7 numbers
        {p.live.zeroed && <span className="warn"> - Zero: scores 0 unless Flip 7</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- action bar

interface BarProps {
  game: GameView;
  prompt: Prompt | null;
  myPrompt: Prompt | null;
  name: (id: string) => string;
  decide: (d: Extract<ClientMessage, { type: 'decide' }>['decision']) => void;
  swapPick: number | null;
  clearSwap: () => void;
}

function ActionBar({ game, prompt, myPrompt, name, decide, swapPick, clearSwap }: BarProps) {
  if (game.phase !== 'playing') return <div className="action-bar muted">Round over</div>;
  if (!prompt) return <div className="action-bar muted">...</div>;

  if (!myPrompt) {
    return <div className="action-bar muted">{waitingText(prompt, name)}</div>;
  }

  switch (myPrompt.kind) {
    case 'hitOrStay':
      return (
        <div className="action-bar mine">
          <span>Your turn!</span>
          <button className="btn primary big" onClick={() => decide({ type: 'hit' })}>
            Hit
          </button>
          <button className="btn big" disabled={!myPrompt.canStay} onClick={() => decide({ type: 'stay' })} title={myPrompt.canStay ? '' : 'You hold the Zero: you must keep hitting'}>
            Stay
          </button>
          {!myPrompt.canStay && <span className="warn small">You hold the Zero, you must hit</span>}
        </div>
      );
    case 'give':
      return (
        <div className="action-bar mine">
          <CardView card={myPrompt.card} />
          <span>Play {cardLabel(myPrompt.card)} on:</span>
          {myPrompt.options.map((id) => (
            <button key={id} className="btn" onClick={() => decide({ type: 'give', targetId: id })}>
              {id === myPrompt.playerId ? `${name(id)} (you)` : name(id)}
            </button>
          ))}
        </div>
      );
    case 'steal':
      return <div className="action-bar mine">Steal: click a glowing card to add it to your line.</div>;
    case 'discard':
      return <div className="action-bar mine">Discard: click any glowing card to discard it.</div>;
    case 'swap':
      return (
        <div className="action-bar mine">
          {swapPick === null ? 'Swap: click the first card.' : 'Now click a card from a different player.'}
          {swapPick !== null && (
            <button className="btn tiny" onClick={clearSwap}>
              reset
            </button>
          )}
        </div>
      );
    case 'flip7Bonus':
      return (
        <div className="action-bar mine">
          <span>Flip 7! Take +15, or take 15 from:</span>
          <button className="btn primary" onClick={() => decide({ type: 'flip7Bonus', targetId: null })}>
            +15 for me
          </button>
          {myPrompt.options.map((id) => (
            <button key={id} className="btn danger" onClick={() => decide({ type: 'flip7Bonus', targetId: id })}>
              -15 {name(id)}
            </button>
          ))}
        </div>
      );
  }
}

function waitingText(p: Prompt, name: (id: string) => string): string {
  const who = name(p.playerId);
  switch (p.kind) {
    case 'hitOrStay': return `${who}'s turn: hit or stay?`;
    case 'give': return `${who} is choosing who gets ${cardLabel(p.card)}...`;
    case 'steal': return `${who} is choosing a card to steal...`;
    case 'swap': return `${who} is choosing cards to swap...`;
    case 'discard': return `${who} is choosing a card to discard...`;
    case 'flip7Bonus': return `${who} flipped 7 and is choosing their bonus...`;
  }
}

// ---------------------------------------------------------------- log

function Log({ game }: { game: GameView }) {
  return (
    <div className="log">
      {[...game.log].reverse().map((e) => (
        <div key={e.seq} className={e.text.startsWith('---') ? 'log-round' : /BUST|FLIP|Unlucky|win/.test(e.text) ? 'log-hot' : ''}>
          {e.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- summary

function breakdown(s: ScoreBreakdown): string {
  if (s.busted) return s.minus ? `Busted, -${s.minus}` : 'Busted';
  const parts = [s.zeroed ? `${s.numberSum} (zeroed)` : String(s.numberSum)];
  if (s.halved) parts.push('÷2');
  if (s.minus) parts.push(`-${s.minus}`);
  if (s.flip7Bonus) parts.push(`+${s.flip7Bonus} Flip 7`);
  else if (s.flip7) parts.push('Flip 7');
  if (s.penalty) parts.push(`${s.penalty} penalty`);
  return parts.join(' ');
}

function Summary({ game, you, isHost, send, hide }: { game: GameView; you: string; isHost: boolean; send: Send; hide: () => void }) {
  const over = game.phase === 'gameOver';
  const seated = game.players.some((p) => p.id === you);
  const ranked = [...game.players].sort((a, b) => b.total - a.total);
  const winners = game.winners.map((id) => game.players.find((p) => p.id === id)?.name).join(' & ');
  return (
    <div className="overlay">
      <div className="panel summary">
        <div className="panel-title">{over ? `${winners} win${game.winners.length > 1 ? '' : 's'}!` : `End of round ${game.round}`}</div>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>This round</th>
              <th />
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className={game.winners.includes(p.id) ? 'winner' : p.id === game.flip7By ? 'flip7' : ''}>
                <td>{p.name}</td>
                <td className="muted">{p.lastRound && breakdown(p.lastRound)}</td>
                <td className="num">{p.lastRound && (p.lastRound.total >= 0 ? `+${p.lastRound.total}` : p.lastRound.total)}</td>
                <td className="num strong">{p.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button className="btn ghost" onClick={hide}>
            View table
          </button>
          {!over && seated && (
            <button className="btn primary" onClick={() => send({ type: 'nextRound' })}>
              Next round
            </button>
          )}
          {over && isHost && (
            <button className="btn primary" onClick={() => send({ type: 'endGame' })}>
              Back to lobby
            </button>
          )}
          {over && !isHost && <span className="muted">Waiting for the host...</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dev

function DevPanel({ send }: { send: Send }) {
  const [key, setKey] = useState('n7');
  return (
    <span className="dev">
      DEV next card:
      <select value={key} onChange={(e) => setKey(e.target.value)}>
        {ALL_CARD_KEYS.map((k) => (
          <option key={k} value={k}>
            {cardLabel(cardFromKey(k, 0))}
          </option>
        ))}
      </select>
      <button className="btn tiny" onClick={() => send({ type: 'rig', key })}>
        put on top
      </button>
    </span>
  );
}
