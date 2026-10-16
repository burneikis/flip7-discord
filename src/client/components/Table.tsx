import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { cardLabel, cardWithArticle, cardKeys, cardFromKey, VARIANT_NAMES, type Card, type Variant } from '../../shared/cards';
import type { GameEvent, Prompt } from '../../shared/engine';
import { REVEAL_MS, STATUS_MS, type ClientMessage, type GameView, type PlayerView } from '../../shared/protocol';
import { scoreLine, type ScoreBreakdown } from '../../shared/scoring';
import type { StateMessage } from '../useConnection';
import { CardView, Snowflake } from './CardView';

type Send = (m: ClientMessage) => void;
type Decide = (d: Extract<ClientMessage, { type: 'decide' }>['decision']) => void;

interface Props { state: StateMessage; game: GameView; send: Send }

/** Unscaled seat and centre sizes; the layout scales them to fit. */
const SEAT_W = 264;
const SEAT_H = 158;
const CENTER_W = 300;
const CENTER_H = 176;
const CARD_W = 58;
const CARD_H = 82;
const CARD_GAP = 5;
/** Seat border + padding, and where the card row starts inside a seat. */
const SEAT_PAD_X = 12;
const CARDS_TOP = 46;
const ROW_W = SEAT_W - 2 * SEAT_PAD_X;
/** Modifier/Action cards sit in their own stack at the right of the row. */
const EXTRA_MIN_STEP = 28;
const ZONE_GAP = 14;
/** The revealed card in the centre: offset from the board centre and size relative to a hand card. */
const REVEAL_DY = -10;
const REVEAL_SCALE = 74 / CARD_W;

export function Table({ state, game, send }: Props) {
  const you = state.you;
  const isHost = state.room.hostId === you;
  const me = game.players.find((p) => p.id === you) ?? null;
  const prompt = game.phase === 'playing' ? game.prompt : null;
  const myPrompt = prompt && prompt.playerId === you ? prompt : null;
  const [swapPick, setSwapPick] = useState<number | null>(null);
  const [hideSummary, setHideSummary] = useState(false);
  const [showLog, setShowLog] = useState(() => window.innerWidth >= 1200);
  /** Hit/Stay chosen in advance, sent as soon as it is your turn. */
  const [queued, setQueued] = useState<'hit' | 'stay' | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const size = useSize(boardRef);
  const fx = useEventEffects(game);
  const timeLeft = useCountdown(game.timeLeftMs, game);
  const ended = game.phase !== 'playing';
  const summaryReady = useDelayedFlag(ended && fx.idle, game.flip7By ? 3600 : 1400, game.round);
  const canQueue = game.phase === 'playing' && me?.status === 'active' && !myPrompt;

  useEffect(() => setSwapPick(null), [prompt]);
  useEffect(() => setHideSummary(false), [game.round, game.phase]);
  useEffect(() => setQueued(null), [game.round]);
  useEffect(() => {
    if (me?.status !== 'active') setQueued(null);
  }, [me?.status]);
  useEffect(() => {
    if (!queued || myPrompt?.kind !== 'hitOrStay') return;
    setQueued(null);
    if (queued === 'hit' || myPrompt.canStay) send({ type: 'decide', decision: { type: queued } });
  }, [myPrompt, queued, send]);

  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?';
  const decide: Decide = (decision) => send({ type: 'decide', decision });
  const shown = (p: PlayerView) => displayPlayer(p, fx.hiddenCards, fx.heldPlayers, game.options.brutal);

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

  // You sit at the bottom; everyone else follows in turn order around the table.
  const myIdx = me ? game.players.indexOf(me) : 0;
  const ordered = game.players.map((_, i) => game.players[(myIdx + i) % game.players.length]);
  const layout = layoutTable(size.w, size.h, ordered.length);
  const timerFrac = timeLeft !== null && state.room.turnSeconds ? Math.min(1, timeLeft / (state.room.turnSeconds * 1000)) : null;

  return (
    <div className="table">
      <div className="topbar">
        <span className="logo small-logo">FLIP 7</span>
        <span className="chip">Round {game.round}</span>
        <span className="chip">{VARIANT_NAMES[game.options.variant]}</span>
        <span className="chip">First to {game.options.target}</span>
        {state.room.turnSeconds > 0 && <span className="chip">{state.room.turnSeconds}s turns</span>}
        {game.options.brutal && <span className="tag brutal">BRUTAL</span>}
        <span className="spacer" />
        {state.devMode && <DevPanel send={send} variant={game.options.variant} />}
        <button className={`btn tiny ghost${showLog ? ' on' : ''}`} onClick={() => setShowLog((v) => !v)}>
          Log
        </button>
        {isHost && (
          <button className="btn tiny ghost" onClick={() => confirm('End the game for everyone?') && send({ type: 'endGame' })}>
            End game
          </button>
        )}
      </div>

      <div className="main">
        <div className="play-area">
          <div className="board" ref={boardRef}>
            {layout && (
              <>
                <div className="felt" style={{ width: layout.rx * 2, height: layout.ry * 2 }} />
                <Center game={game} reveal={fx.reveal} spent={fx.spent} name={name} scale={layout.scale} />
                {ordered.map((p, i) => (
                  <Seat
                    key={p.id}
                    p={shown(p)}
                    x={size.w / 2 + layout.points[i].x}
                    y={size.h / 2 + layout.points[i].y}
                    toCenter={{ x: -layout.points[i].x / layout.scale, y: -layout.points[i].y / layout.scale + REVEAL_DY }}
                    scale={layout.scale}
                    goal={game.options.target}
                    roundOver={ended}
                    isYou={p.id === you}
                    isDealer={p.id === game.dealerId}
                    isTurn={p.id === game.turnId}
                    deciding={prompt?.playerId === p.id}
                    timerFrac={prompt?.playerId === p.id ? timerFrac : null}
                    target={seatTargets.has(p.id)}
                    pickable={pickable}
                    picked={swapPick}
                    callout={fx.callouts[p.id]}
                    onCard={onCard}
                    onSeat={() => seatTargets.has(p.id) && decide({ type: 'give', targetId: p.id })}
                  />
                ))}
              </>
            )}
          </div>
          <ActionBar
            game={game}
            me={me}
            prompt={prompt}
            myPrompt={myPrompt}
            name={name}
            decide={decide}
            swapPick={swapPick}
            clearSwap={() => setSwapPick(null)}
            timeLeft={timeLeft}
            timerFrac={timerFrac}
            queued={canQueue ? queued : null}
            canQueue={canQueue}
            setQueued={setQueued}
          />
        </div>
        {showLog && <Log game={game} />}
      </div>

      {fx.celebrate && <Flip7Celebration name={fx.celebrate} />}
      {ended && summaryReady && !fx.celebrate && !hideSummary && (
        <Summary game={game} isHost={isHost} hostId={state.room.hostId} send={send} hide={() => setHideSummary(true)} />
      )}
      {ended && summaryReady && hideSummary && (
        <button className="btn primary floating" onClick={() => setHideSummary(false)}>
          Show scores
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- layout

function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

interface Layout { scale: number; rx: number; ry: number; points: { x: number; y: number }[] }

/**
 * Seats sit on an ellipse, evenly spaced by arc length, starting at the
 * bottom (you). The largest scale where no seat overlaps another seat or the
 * centre wins.
 */
function layoutTable(w: number, h: number, n: number): Layout | null {
  if (!w || !h || !n) return null;
  let fallback: Layout | null = null;
  for (let scale = 1; scale >= 0.34; scale -= 0.02) {
    const sw = SEAT_W * scale;
    const sh = SEAT_H * scale;
    const rx = w / 2 - sw / 2 - 6;
    const ry = h / 2 - sh / 2 - 6;
    if (rx <= 0 || ry <= 0) continue;
    const points = ellipsePoints(rx, ry, n);
    fallback = { scale, rx, ry, points };
    const cw = CENTER_W * scale;
    const ch = CENTER_H * scale;
    const clearOfCenter = points.every((p) => Math.abs(p.x) >= (sw + cw) / 2 || Math.abs(p.y) >= (sh + ch) / 2);
    let clear = clearOfCenter;
    for (let i = 0; clear && i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(points[i].x - points[j].x) < sw + 6 && Math.abs(points[i].y - points[j].y) < sh + 6) {
          clear = false;
          break;
        }
      }
    }
    if (clear) return fallback;
  }
  return fallback;
}

function ellipsePoints(rx: number, ry: number, n: number) {
  const STEPS = 720;
  const pts: { x: number; y: number }[] = [];
  const cum = [0];
  for (let i = 0; i <= STEPS; i++) {
    const a = Math.PI / 2 + (i / STEPS) * Math.PI * 2;
    pts.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) });
    if (i) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[STEPS];
  const out: { x: number; y: number }[] = [];
  let idx = 0;
  for (let k = 0; k < n; k++) {
    const goal = (k / n) * total;
    while (cum[idx] < goal) idx++;
    out.push(pts[idx]);
  }
  return out;
}

// ---------------------------------------------------------------- effects

interface Callout { id: number; kind: string; text: string }

const isCardEvent = (e: GameEvent): e is Extract<GameEvent, { kind: 'flip' | 'play' }> => e.kind === 'flip' || e.kind === 'play';
const isStatusEvent = (e: GameEvent): e is Extract<GameEvent, { kind: 'bust' | 'freeze' | 'stay' }> =>
  e.kind === 'bust' || e.kind === 'freeze' || e.kind === 'stay';
/** When a revealed card leaves the centre and flies to its hand. */
const FLY_AT_MS = 450;
/** Beyond this backlog (tab in background, slow device) old events are skipped. */
const MAX_BACKLOG = 24;

/**
 * Turns new game events into a paced sequence: each flipped/played card is
 * revealed in the centre, then flies to its hand; seats get short callouts
 * (BUST, FROZEN...). Cards and status changes whose event has not been played
 * yet are reported as `hiddenCards` / `heldPlayers` so the table can hold them
 * back until their turn.
 */
function useEventEffects(game: GameView) {
  const [reveal, setReveal] = useState<GameEvent | null>(null);
  const [spent, setSpent] = useState(false);
  const [callouts, setCallouts] = useState<Record<string, Callout>>({});
  const [celebrate, setCelebrate] = useState<string | null>(null);
  /** Events received but not played yet. */
  const [pending, setPending] = useState<GameEvent[]>([]);
  const [running, setRunning] = useState(false);
  const lastSeq = useRef<number | null>(null);
  const queue = useRef<GameEvent[]>([]);
  const busy = useRef(false);
  const timers = useRef<number[]>([]);
  const gameRef = useRef(game);
  gameRef.current = game;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));
    const name = (id: string) => gameRef.current.players.find((p) => p.id === id)?.name ?? '?';
    const release = (...seqs: number[]) => setPending((list) => list.filter((e) => !seqs.includes(e.seq)));
    const callout = (pid: string, kind: string, text: string) => {
      const id = Math.random();
      setCallouts((c) => ({ ...c, [pid]: { id, kind, text } }));
      later(2200, () => setCallouts((c) => (c[pid]?.id === id ? (({ [pid]: _, ...rest }) => rest)(c) : c)));
    };
    const pump = () => {
      const e = queue.current.shift();
      if (!e) {
        busy.current = false;
        setRunning(false);
        return;
      }
      busy.current = true;
      // Catch up faster when events pile up.
      const fast = queue.current.length > 6;
      let wait = 0;
      switch (e.kind) {
        case 'round':
          setReveal(null);
          setCallouts({});
          break;
        case 'flip':
        case 'play':
          setReveal(e);
          setSpent(false);
          later(fast ? 150 : FLY_AT_MS, () => {
            setSpent(true);
            release(e.seq);
          });
          wait = fast ? 250 : REVEAL_MS;
          break;
        case 'bust':
          callout(e.playerId, 'bust', 'BUST!');
          wait = STATUS_MS;
          break;
        case 'freeze':
          callout(e.playerId, 'freeze', 'FROZEN');
          wait = STATUS_MS;
          break;
        case 'saved':
          callout(e.playerId, 'saved', 'SAVED!');
          wait = STATUS_MS;
          break;
        case 'stay':
          callout(e.playerId, 'stay', 'STAY');
          break;
        case 'flip7':
          setCelebrate(name(e.playerId));
          later(3300, () => setCelebrate(null));
          break;
      }
      if (!isCardEvent(e)) release(e.seq);
      later(wait, pump);
    };

    const events = game.events;
    const newest = events.length ? events[events.length - 1].seq : 0;
    if (lastSeq.current === null || newest < lastSeq.current) {
      // First render (or a new game): show the latest card without replaying history.
      lastSeq.current = newest;
      setReveal([...events].reverse().find(isCardEvent) ?? null);
      setSpent(true);
      return;
    }
    const fresh = events.filter((e) => e.seq > lastSeq.current!);
    if (!fresh.length) return;
    lastSeq.current = newest;
    queue.current.push(...fresh);
    setPending((list) => [...list, ...fresh.filter((e) => isCardEvent(e) || isStatusEvent(e))]);
    if (queue.current.length > MAX_BACKLOG) {
      const dropped = queue.current.splice(0, queue.current.length - MAX_BACKLOG).map((e) => e.seq);
      setPending((list) => list.filter((e) => !dropped.includes(e.seq)));
    }
    if (!busy.current) {
      setRunning(true);
      pump();
    }
  }, [game.events]);

  // Events that arrived with this render have not reached the effect (and `pending`) yet.
  const seen = lastSeq.current;
  const unseen = seen === null ? [] : game.events.filter((e) => e.seq > seen);
  const waiting = [...pending, ...unseen];
  const hiddenCards = new Set(waiting.filter(isCardEvent).map((e) => e.card.id));
  const heldPlayers = new Set(waiting.filter(isStatusEvent).map((e) => e.playerId));
  const idle = waiting.length === 0 && !running;
  return { reveal, spent, callouts, celebrate, hiddenCards, heldPlayers, idle };
}

/** A player as the table should show them right now: cards and status changes still waiting for their animation are held back. */
function displayPlayer(p: PlayerView, hiddenCards: Set<number>, heldPlayers: Set<string>, brutal: boolean): PlayerView {
  const line = p.line.filter((c) => !hiddenCards.has(c.id));
  const held = heldPlayers.has(p.id);
  if (line.length === p.line.length && !held) return p;
  const status = held ? 'active' : p.status;
  return {
    ...p,
    line,
    status,
    frozen: held ? false : p.frozen,
    bustCardId: held ? null : p.bustCardId,
    live: scoreLine(line, { busted: status === 'busted', brutal }),
  };
}

function useCountdown(ms: number | null, key: unknown): number | null {
  const [left, setLeft] = useState(ms);
  useEffect(() => {
    if (ms === null) return setLeft(null);
    const end = Date.now() + ms;
    const tick = () => setLeft(Math.max(0, end - Date.now()));
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [ms, key]);
  return left;
}

/** True `delay` ms after `on` became true (immediately if it was already true on mount). */
function useDelayedFlag(on: boolean, delay: number, key: unknown) {
  const [flag, setFlag] = useState(on);
  useEffect(() => {
    if (!on) return setFlag(false);
    const t = window.setTimeout(() => setFlag(true), delay);
    return () => window.clearTimeout(t);
  }, [on, delay, key]);
  return flag;
}

// ---------------------------------------------------------------- centre

interface CenterProps { game: GameView; reveal: GameEvent | null; spent: boolean; name: (id: string) => string; scale: number }

function Center({ game, reveal, spent, name, scale }: CenterProps) {
  let caption: string | null = null;
  let card: Card | null = null;
  if (reveal?.kind === 'flip') {
    card = reveal.card;
    caption = `${name(reveal.playerId)} flips ${cardWithArticle(reveal.card)}`;
    if (reveal.step) caption += ` (${reveal.step.n} of ${reveal.step.of})`;
  } else if (reveal?.kind === 'play') {
    card = reveal.card;
    caption = reveal.playerId === reveal.targetId ? `${name(reveal.playerId)} keeps it` : `${name(reveal.playerId)} -> ${name(reveal.targetId)}`;
  }
  const turn = game.turnId ? name(game.turnId) : null;
  return (
    <div className="center-stage" style={{ width: CENTER_W, height: CENTER_H, transform: `translate(-50%, -50%) scale(${scale})` }}>
      <div className="pile">
        <div className="deck-stack">
          <div className="card card-back" />
          <div className="card card-back" />
          <div className="card card-back" />
        </div>
        <span className="muted small">Deck {game.deckCount}</span>
      </div>
      <div className="reveal">
        {card ? (
          <>
            <CardView key={reveal!.seq} card={card} className={`revealed${spent ? ' spent' : ''}`} />
            <span className={`caption${reveal?.kind === 'flip' && reveal.step ? ' step' : ''}`}>{caption}</span>
          </>
        ) : (
          <span className="muted small">{game.phase === 'playing' ? 'Waiting for the first flip' : ''}</span>
        )}
      </div>
      <div className="pile">
        <span className="discard-count">{game.discardCount}</span>
        <span className="muted small">Discard</span>
      </div>
      <div className="center-foot">{game.phase === 'playing' ? (turn ? `${turn}'s turn` : '') : 'Round over'}</div>
    </div>
  );
}

// ---------------------------------------------------------------- seat

interface SeatProps {
  p: PlayerView;
  x: number;
  y: number;
  /** The centre reveal spot, relative to the seat centre in unscaled seat pixels. */
  toCenter: { x: number; y: number };
  scale: number;
  goal: number;
  /** Totals already include this round's score. */
  roundOver: boolean;
  isYou: boolean;
  isDealer: boolean;
  isTurn: boolean;
  deciding: boolean;
  timerFrac: number | null;
  target: boolean;
  pickable: Set<number>;
  picked: number | null;
  callout: Callout | undefined;
  onCard: (id: number) => void;
  onSeat: () => void;
}

function Seat(props: SeatProps) {
  const { p, x, y, toCenter, scale, goal, roundOver, isYou, isDealer, isTurn, deciding, timerFrac, target, pickable, picked, callout, onCard, onSeat } = props;
  const busted = p.status === 'busted';
  const nums = p.line.filter((c) => c.kind === 'number');
  const extras = p.line.filter((c) => c.kind !== 'number');
  const cards = [...nums, ...extras];

  // The bust card and the card it duplicated.
  const bustCard = busted ? p.line.find((c) => c.id === p.bustCardId) : undefined;
  const bustValue = bustCard?.kind === 'number' ? bustCard.value : null;

  const pending = busted || roundOver ? 0 : p.live.total;
  const canWin = pending > 0 && p.total + pending >= goal;

  const cls = ['seat', p.status];
  if (isYou) cls.push('you');
  if (isTurn) cls.push('turn');
  if (deciding) cls.push('deciding');
  if (target) cls.push('target');
  if (p.frozen) cls.push('frozen');
  if (canWin) cls.push('can-win');

  // Number cards fan out from the left; Modifiers/Actions stack on the right,
  // in their own zone. Overlap them when the row gets long.
  const n = cards.length;
  const extrasW = extrasWidth(nums.length, extras.length);
  const numsW = extras.length ? ROW_W - extrasW - ZONE_GAP : ROW_W;
  const step = nums.length > 1 ? Math.min(CARD_W + CARD_GAP, (numsW - CARD_W) / (nums.length - 1)) : 0;
  const extraStep = extras.length > 1 ? (extrasW - CARD_W) / (extras.length - 1) : 0;
  const cardLeft = (i: number) => (i < nums.length ? i * step : ROW_W - extrasW + (i - nums.length) * extraStep);

  return (
    <div
      className={cls.join(' ')}
      style={{ left: x, top: y, width: SEAT_W, height: SEAT_H, transform: `translate(-50%, -50%) scale(${scale})` }}
      onClick={target ? onSeat : undefined}
    >
      <div className="seat-head">
        {isDealer && <span className="tag dealer" title="Dealer">D</span>}
        <span className="seat-name">{p.name}</span>
        {isYou && <span className="tag you">you</span>}
        {p.isBot && <span className="tag">bot</span>}
        {!p.connected && <span className="tag offline">offline</span>}
        <span className="spacer" />
        <span className="score" title="Banked total">
          {p.total}
        </span>
      </div>
      <GoalBar total={p.total} live={pending} goal={goal} />
      <div className="cards">
        {cards.map((c, i) => {
          const bustCls =
            c.id === p.bustCardId ? 'bust-card' : bustValue !== null && c.kind === 'number' && c.value === bustValue ? 'bust-dup' : busted ? 'dim' : '';
          const left = cardLeft(i);
          // Where the card flies in from: the revealed card in the centre.
          const flyX = toCenter.x - (SEAT_PAD_X + left + CARD_W / 2 - SEAT_W / 2);
          const flyY = toCenter.y - (CARDS_TOP + CARD_H / 2 - SEAT_H / 2);
          const style = { left, zIndex: i, '--fly-x': `${flyX}px`, '--fly-y': `${flyY}px`, '--fly-s': REVEAL_SCALE } as CSSProperties;
          return (
            <CardView
              key={c.id}
              card={c}
              className={`fly ${bustCls}`}
              style={style}
              selectable={pickable.has(c.id)}
              selected={picked === c.id}
              onClick={() => onCard(c.id)}
            />
          );
        })}
        {nums.length > 0 && extras.length > 0 && <div className="zone-divider" style={{ left: ROW_W - extrasW - ZONE_GAP / 2 }} />}
        {!n && <span className="muted small empty">no cards yet</span>}
      </div>
      <div className="seat-foot small">
        <span className={`status ${p.frozen ? 'frozen' : p.status}`}>
          {p.frozen ? (
            <>
              <Snowflake className="icon" /> frozen
            </>
          ) : (
            p.status
          )}
        </span>
        <span className="muted">{nums.length}/7</span>
        {p.live.zeroed && <span className="warn">Zero</span>}
        <span className="spacer" />
        <span className={`live${busted ? ' bad' : ''}`} title="This round">
          {busted ? (p.live.total ? p.live.total : 'bust') : `+${p.live.total}`}
        </span>
      </div>
      {timerFrac !== null && <div className="seat-timer" style={{ transform: `scaleX(${timerFrac})` }} />}
      {busted && <div className="stamp bust">BUST</div>}
      {p.frozen && (
        <div className="frost">
          <Snowflake className="frost-flake" />
        </div>
      )}
      {canWin && <div className="win-flag">reaches {goal}!</div>}
      {callout && (
        <div key={callout.id} className={`callout ${callout.kind}`}>
          {callout.text}
        </div>
      )}
    </div>
  );
}

const rowWidth = (count: number) => (count ? CARD_W + (count - 1) * (CARD_W + CARD_GAP) : 0);

/** Width of the Modifier/Action stack: spread out when the Number cards leave room, otherwise overlapped. */
function extrasWidth(numCount: number, extraCount: number): number {
  if (!extraCount) return 0;
  const natural = rowWidth(extraCount);
  if (!numCount) return Math.min(natural, ROW_W);
  const free = ROW_W - ZONE_GAP - rowWidth(numCount);
  const compact = Math.min(CARD_W + (extraCount - 1) * EXTRA_MIN_STEP, ROW_W * 0.45);
  return Math.min(natural, Math.max(free, compact));
}

function GoalBar({ total, live, goal }: { total: number; live: number; goal: number }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / goal) * 100))}%`;
  return (
    <div className="goal-bar" title={`${total} banked${live ? ` + ${live} this round` : ''} / ${goal}`}>
      <div className="goal-live" style={{ width: pct(total + Math.max(0, live)) }} />
      <div className="goal-banked" style={{ width: pct(total) }} />
    </div>
  );
}

// ---------------------------------------------------------------- action bar

interface BarProps {
  game: GameView;
  me: PlayerView | null;
  prompt: Prompt | null;
  myPrompt: Prompt | null;
  name: (id: string) => string;
  decide: Decide;
  swapPick: number | null;
  clearSwap: () => void;
  timeLeft: number | null;
  timerFrac: number | null;
  queued: 'hit' | 'stay' | null;
  canQueue: boolean;
  setQueued: (q: 'hit' | 'stay' | null) => void;
}

function ActionBar(props: BarProps) {
  const { myPrompt, timeLeft, timerFrac } = props;
  const timer =
    timeLeft !== null && timerFrac !== null ? (
      <div className={`turn-timer${timeLeft < 5000 ? ' low' : ''}`}>
        <div className="fill" style={{ transform: `scaleX(${timerFrac})` }} />
        <span>{Math.ceil(timeLeft / 1000)}s</span>
      </div>
    ) : null;
  return (
    <div className={`action-bar${myPrompt ? ' mine' : ''}`}>
      <div className="action-body">
        <ActionContent {...props} />
      </div>
      {timer}
    </div>
  );
}

function ActionContent({ game, me, prompt, myPrompt, name, decide, swapPick, clearSwap, queued, canQueue, setQueued }: BarProps) {
  const noStay = game.options.variant === 'classic' ? 'You need a card in front of you to stay' : 'You hold the Zero, you must hit';
  if (game.phase !== 'playing') return <span className="muted">Round over</span>;
  if (!myPrompt) {
    return (
      <>
        <span className="muted">{prompt ? waitingText(prompt, name) : '...'}</span>
        {canQueue && <QueueButtons queued={queued} setQueued={setQueued} />}
      </>
    );
  }

  switch (myPrompt.kind) {
    case 'hitOrStay': {
      const projected = me ? me.total + me.live.total : 0;
      const reaches = !!me && myPrompt.canStay && projected >= game.options.target;
      return (
        <>
          <button className="btn primary big" onClick={() => decide({ type: 'hit' })}>
            Hit
          </button>
          <button className={`btn big${reaches ? ' win' : ''}`} disabled={!myPrompt.canStay} onClick={() => decide({ type: 'stay' })} title={myPrompt.canStay ? '' : noStay}>
            Stay
          </button>
          {me && myPrompt.canStay && (
            <span className="stay-info">
              Staying banks <b>{me.live.total >= 0 ? `+${me.live.total}` : me.live.total}</b> for <b>{projected}</b>
              {reaches && <span className="win-hint"> - that reaches {game.options.target}!</span>}
            </span>
          )}
          {!myPrompt.canStay && <span className="warn small">{noStay}</span>}
        </>
      );
    }
    case 'give':
      return (
        <>
          <CardView card={myPrompt.card} />
          <span>Play {cardLabel(myPrompt.card)} on:</span>
          {myPrompt.options.map((id) => (
            <button key={id} className="btn" onClick={() => decide({ type: 'give', targetId: id })}>
              {id === myPrompt.playerId ? `${name(id)} (you)` : name(id)}
            </button>
          ))}
          <span className="muted small">or click a glowing seat</span>
        </>
      );
    case 'steal':
      return <span>Steal: click a glowing card to add it to your line.</span>;
    case 'discard':
      return <span>Discard: click any glowing card to discard it.</span>;
    case 'swap':
      return (
        <>
          <span>{swapPick === null ? 'Swap: click the first card.' : 'Now click a card from a different player.'}</span>
          {swapPick !== null && (
            <button className="btn tiny" onClick={clearSwap}>
              reset
            </button>
          )}
        </>
      );
    case 'flip7Bonus':
      return (
        <>
          <span>Flip 7! Take +15, or take 15 from:</span>
          <button className="btn primary" onClick={() => decide({ type: 'flip7Bonus', targetId: null })}>
            +15 for me
          </button>
          {myPrompt.options.map((id) => (
            <button key={id} className="btn danger" onClick={() => decide({ type: 'flip7Bonus', targetId: id })}>
              -15 {name(id)}
            </button>
          ))}
        </>
      );
  }
}

/** Pick Hit or Stay before your turn; it is played as soon as your turn comes. */
function QueueButtons({ queued, setQueued }: Pick<BarProps, 'queued' | 'setQueued'>) {
  const toggle = (q: 'hit' | 'stay') => setQueued(queued === q ? null : q);
  return (
    <span className="queue">
      <span className="small muted">{queued ? 'Queued:' : 'Queue:'}</span>
      <button className={`btn tiny${queued === 'hit' ? ' primary' : ''}`} onClick={() => toggle('hit')} title="Hit as soon as it is your turn">
        Hit
      </button>
      <button className={`btn tiny${queued === 'stay' ? ' primary' : ''}`} onClick={() => toggle('stay')} title="Stay as soon as it is your turn">
        Stay
      </button>
    </span>
  );
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

// ---------------------------------------------------------------- flip 7

const CONFETTI_COLORS = ['#ff5a5f', '#ffcc33', '#3ddc84', '#33b5ff', '#b05cff', '#ffffff'];

function Flip7Celebration({ name }: { name: string }) {
  const [pieces] = useState(() =>
    Array.from({ length: 70 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 1.8 + Math.random() * 1.4,
      drift: (Math.random() - 0.5) * 240,
      spin: (Math.random() - 0.5) * 1440,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      w: 6 + Math.random() * 8,
    })),
  );
  return (
    <div className="flip7-fx" aria-live="polite">
      <div className="flip7-rays" />
      <div className="flip7-cards">
        {[1, 2, 3, 4, 5, 6, 7].map((v, i) => (
          <div key={v} className="flip7-card" style={{ '--i': i, '--hue': String((v * 29 + 200) % 360) } as CSSProperties}>
            {v}
          </div>
        ))}
      </div>
      <div className="flip7-title">FLIP 7!</div>
      <div className="flip7-name">{name} ends the round with +15</div>
      {pieces.map((c, i) => (
        <span
          key={i}
          className="confetti"
          style={
            {
              left: `${c.left}%`,
              width: c.w,
              height: c.w * 0.45,
              background: c.color,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.dur}s`,
              '--drift': `${c.drift}px`,
              '--spin': `${c.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- log

function Log({ game }: { game: GameView }) {
  return (
    <div className="log">
      {[...game.log].reverse().map((e) => (
        <div key={e.seq} className={e.text.startsWith('---') ? 'log-round' : /BUST|FLIP|Unlucky|win|frozen/.test(e.text) ? 'log-hot' : ''}>
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
  if (s.doubled) parts.push('×2');
  if (s.minus) parts.push(`-${s.minus}`);
  if (s.plus) parts.push(`+${s.plus}`);
  if (s.flip7Bonus) parts.push(`+${s.flip7Bonus} Flip 7`);
  else if (s.flip7) parts.push('Flip 7');
  if (s.penalty) parts.push(`${s.penalty} penalty`);
  return parts.join(' ');
}

interface SummaryProps { game: GameView; isHost: boolean; hostId: string | null; send: Send; hide: () => void }

function Summary({ game, isHost, hostId, send, hide }: SummaryProps) {
  const over = game.phase === 'gameOver';
  const host = game.players.find((p) => p.id === hostId);
  const ranked = [...game.players].sort((a, b) => b.total - a.total);
  const winners = game.winners.map((id) => game.players.find((p) => p.id === id)?.name).join(' & ');
  return (
    <div className="overlay">
      <div className={`panel summary${over ? ' game-over' : ''}`}>
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
            {ranked.map((p, i) => (
              <tr key={p.id} className={game.winners.includes(p.id) ? 'winner' : p.id === game.flip7By ? 'flip7' : ''} style={{ animationDelay: `${i * 70}ms` }}>
                <td>
                  {p.name}
                  {p.frozen && <span className="muted small"> (frozen)</span>}
                </td>
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
          {isHost ? (
            <button className="btn primary" onClick={() => send({ type: over ? 'endGame' : 'nextRound' })}>
              {over ? 'Back to lobby' : 'Next round'}
            </button>
          ) : (
            <span className="muted">Waiting for {host?.name ?? 'the host'}...</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dev

function DevPanel({ send, variant }: { send: Send; variant: Variant }) {
  const [key, setKey] = useState('n7');
  return (
    <span className="dev">
      DEV next card:
      <select value={key} onChange={(e) => setKey(e.target.value)}>
        {cardKeys(variant).map((k) => (
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
