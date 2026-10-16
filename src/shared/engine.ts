import { buildDeck, cardLabel, actionName, shuffle, type ActionCard, type Card, type NumberCard, type Variant } from './cards';
import { hasFlip7, hasSecondChance, hasZero, isBustLine, scoreLine, FLIP7_BONUS, type ScoreBreakdown } from './scoring';

export type Status = 'active' | 'stayed' | 'busted';
export type Phase = 'playing' | 'roundEnd' | 'gameOver';

export interface PlayerInit { id: string; name: string; isBot: boolean }

export interface Player extends PlayerInit {
  /** Number cards and Modifier cards in front of the player. */
  line: Card[];
  status: Status;
  /** Stayed because of a Freeze card (this round). */
  frozen: boolean;
  /** The card that busted this player (this round). */
  bustCardId: number | null;
  total: number;
  lastRound: ScoreBreakdown | null;
}

export interface CardRef { ownerId: string; cardId: number }

export type Prompt =
  | { kind: 'hitOrStay'; playerId: string; canStay: boolean }
  /** Choose who receives a Modifier or Action card. */
  | { kind: 'give'; playerId: string; card: Card; options: string[] }
  | { kind: 'steal'; playerId: string; card: ActionCard; options: CardRef[] }
  | { kind: 'swap'; playerId: string; card: ActionCard; options: CardRef[] }
  | { kind: 'discard'; playerId: string; card: ActionCard; options: CardRef[] }
  /** Brutal mode: take +15, or give -15 to targetId. */
  | { kind: 'flip7Bonus'; playerId: string; options: string[] };

export type Decision =
  | { type: 'hit' }
  | { type: 'stay' }
  | { type: 'give'; targetId: string }
  | { type: 'steal'; cardId: number }
  | { type: 'swap'; cardIds: [number, number] }
  | { type: 'discard'; cardId: number }
  | { type: 'flip7Bonus'; targetId: string | null };

export interface GameOptions {
  variant: Variant;
  /** Vengeance only. */
  brutal: boolean;
  target: number;
}
export const DEFAULT_OPTIONS: GameOptions = { variant: 'classic', brutal: false, target: 200 };
export interface LogEntry { seq: number; text: string }

/** Structured happenings, so clients can animate what the log describes. */
export type GameEvent =
  | { seq: number; kind: 'round'; round: number }
  /** A card turned over from the deck. `step` is set during Flip Three / Flip Four. */
  | { seq: number; kind: 'flip'; playerId: string; card: Card; step?: { n: number; of: number } }
  /** An Action or Modifier given to (or kept by) a player. */
  | { seq: number; kind: 'play'; playerId: string; targetId: string; card: Card }
  | { seq: number; kind: 'bust'; playerId: string; cardId: number }
  | { seq: number; kind: 'freeze'; playerId: string }
  | { seq: number; kind: 'saved'; playerId: string }
  | { seq: number; kind: 'stay'; playerId: string }
  | { seq: number; kind: 'flip7'; playerId: string };
type EventInput = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, 'seq'> : never) : never;

type Task =
  | { t: 'deal'; order: string[] }
  | { t: 'draw'; playerId: string }
  | { t: 'give'; holderId: string; card: Card }
  | { t: 'resolve'; playerId: string; card: ActionCard }
  /** Flip Three (classic) / Flip Four (Vengeance). */
  | { t: 'flip'; playerId: string; count: number; remaining: number; setAside: Card[] }
  | { t: 'forceStay'; playerId: string }
  | { t: 'turn' }
  | { t: 'nextTurn' }
  | { t: 'endRound' };

const MAX_LOG = 200;
const MAX_EVENTS = 100;

/**
 * Server-authoritative Flip 7 rules engine, for both the classic game and
 * Flip 7: With a Vengeance (`options.variant`).
 *
 * Work is modelled as a task queue so that nested effects (Flip Four revealing
 * a Just One More revealing a Steal...) resolve in rulebook order. The engine
 * runs until it needs a player decision, exposed as `prompt`, then waits for
 * `decide()`.
 */
export class Game {
  phase: Phase = 'playing';
  players: Player[];
  deck: Card[];
  discardPile: Card[] = [];
  dealer: number;
  turn = 0;
  round = 0;
  prompt: Prompt | null = null;
  flip7By: string | null = null;
  winners: string[] = [];
  log: LogEntry[] = [];
  events: GameEvent[] = [];

  private queue: Task[] = [];
  /** Brutal Flip 7 choice: undefined = not chosen, null = took +15, string = penalised player. */
  private bonusChoice: string | null | undefined;
  private logSeq = 0;
  private eventSeq = 0;

  constructor(
    players: PlayerInit[],
    readonly options: GameOptions = DEFAULT_OPTIONS,
    private readonly rng: () => number = Math.random,
    deck?: Card[],
  ) {
    if (players.length < 1) throw new Error('Need at least one player');
    this.players = players.map((p) => ({ ...p, line: [], status: 'active', frozen: false, bustCardId: null, total: 0, lastRound: null }));
    if (options.variant === 'classic') this.options = { ...options, brutal: false };
    this.deck = deck ? [...deck] : shuffle(buildDeck(options.variant), rng);
    // Last seat deals first so the first card goes to seat 0.
    this.dealer = this.players.length - 1;
    this.startRound();
  }

  // ---------------------------------------------------------------- queries

  player(id: string): Player {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new Error(`No player ${id}`);
    return p;
  }

  get currentTurnId(): string | null {
    return this.phase === 'playing' ? this.players[this.turn]?.id ?? null : null;
  }

  get classic(): boolean {
    return this.options.variant === 'classic';
  }

  liveScore(p: Player): ScoreBreakdown {
    return scoreLine(p.line, { busted: p.status === 'busted', brutal: this.options.brutal });
  }

  // ---------------------------------------------------------------- commands

  decide(playerId: string, d: Decision): string | null {
    const pr = this.prompt;
    if (this.phase !== 'playing' || !pr) return 'Nothing to decide right now';
    if (pr.playerId !== playerId) return 'It is not your decision';

    switch (pr.kind) {
      case 'hitOrStay': {
        const p = this.player(playerId);
        if (d.type === 'hit') {
          this.say(`${p.name} hits`);
          this.prompt = null;
          this.queue.unshift({ t: 'draw', playerId }, { t: 'nextTurn' });
        } else if (d.type === 'stay') {
          if (!pr.canStay) return this.classic ? 'You need a card in front of you to stay' : 'You hold the Zero and must keep hitting';
          this.prompt = null;
          p.status = 'stayed';
          this.say(`${p.name} stays`);
          this.emit({ kind: 'stay', playerId });
          this.queue.unshift({ t: 'nextTurn' });
        } else return 'Choose hit or stay';
        break;
      }
      case 'give': {
        if (d.type !== 'give' || !pr.options.includes(d.targetId)) return 'Invalid target';
        this.prompt = null;
        this.applyGive(pr.playerId, pr.card, d.targetId);
        break;
      }
      case 'steal': {
        if (d.type !== 'steal') return 'Pick a card to steal';
        const ref = pr.options.find((r) => r.cardId === d.cardId);
        if (!ref) return 'You cannot steal that card';
        this.prompt = null;
        this.applySteal(playerId, ref, pr.card);
        break;
      }
      case 'swap': {
        if (d.type !== 'swap') return 'Pick two cards to swap';
        const a = pr.options.find((r) => r.cardId === d.cardIds[0]);
        const b = pr.options.find((r) => r.cardId === d.cardIds[1]);
        if (!a || !b) return 'You cannot swap those cards';
        if (a.ownerId === b.ownerId) return 'Swapped cards must belong to different players';
        this.prompt = null;
        this.applySwap(playerId, a, b, pr.card);
        break;
      }
      case 'discard': {
        if (d.type !== 'discard') return 'Pick a card to discard';
        const ref = pr.options.find((r) => r.cardId === d.cardId);
        if (!ref) return 'You cannot discard that card';
        this.prompt = null;
        this.applyDiscard(playerId, ref, pr.card);
        break;
      }
      case 'flip7Bonus': {
        if (d.type !== 'flip7Bonus') return 'Choose your Flip 7 bonus';
        if (d.targetId !== null && !pr.options.includes(d.targetId)) return 'Invalid target';
        this.prompt = null;
        this.bonusChoice = d.targetId;
        break;
      }
    }
    this.run();
    return null;
  }

  nextRound(): string | null {
    if (this.phase !== 'roundEnd') return 'The round is not over';
    this.dealer = (this.dealer + 1) % this.players.length;
    this.startRound();
    return null;
  }

  /** Dev/test helper: move a matching card to the top of the deck. */
  rigTopCard(match: (c: Card) => boolean): boolean {
    let idx = this.deck.findIndex(match);
    if (idx >= 0) {
      const [c] = this.deck.splice(idx, 1);
      this.deck.unshift(c);
      return true;
    }
    idx = this.discardPile.findIndex(match);
    if (idx >= 0) {
      const [c] = this.discardPile.splice(idx, 1);
      this.deck.unshift(c);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- flow

  private startRound() {
    this.round++;
    for (const p of this.players) {
      p.line = [];
      p.status = 'active';
      p.frozen = false;
      p.bustCardId = null;
      p.lastRound = null;
    }
    this.flip7By = null;
    this.bonusChoice = undefined;
    this.prompt = null;
    this.phase = 'playing';
    this.turn = (this.dealer + 1) % this.players.length;
    this.say(`--- Round ${this.round}: ${this.players[this.dealer].name} deals ---`);
    this.emit({ kind: 'round', round: this.round });
    this.queue = [{ t: 'deal', order: this.seatOrderFrom(this.turn) }];
    this.run();
  }

  private run() {
    let guard = 0;
    while (this.phase === 'playing' && !this.prompt) {
      if (++guard > 100_000) throw new Error('Engine loop did not settle');
      const task = this.queue.shift() ?? ({ t: 'turn' } as Task);
      this.exec(task);
    }
  }

  private exec(task: Task) {
    switch (task.t) {
      case 'deal': {
        const [first, ...rest] = task.order;
        if (first === undefined) return; // falls through to 'turn' via run()
        if (rest.length) this.queue.unshift({ t: 'deal', order: rest });
        if (this.player(first).status === 'active') this.queue.unshift({ t: 'draw', playerId: first });
        return;
      }
      case 'draw': {
        const p = this.player(task.playerId);
        if (p.status === 'busted') return;
        const card = this.drawCard();
        if (!card) return;
        this.say(`${p.name} flips ${cardLabel(card)}`);
        this.emit({ kind: 'flip', playerId: p.id, card });
        if (card.kind === 'number') this.gainNumber(p, card);
        else if (card.kind === 'modifier' && this.classic) p.line.push(card);
        else this.queue.unshift({ t: 'give', holderId: p.id, card });
        return;
      }
      case 'give':
        return this.startGive(task.holderId, task.card);
      case 'resolve':
        return this.resolveAction(task.playerId, task.card);
      case 'flip':
        return this.stepFlip(task);
      case 'forceStay': {
        const p = this.player(task.playerId);
        if (p.status === 'active') {
          p.status = 'stayed';
          this.say(`${p.name} must stay`);
          this.emit({ kind: 'stay', playerId: p.id });
        }
        return;
      }
      case 'turn': {
        const n = this.players.length;
        for (let i = 0; i < n; i++) {
          const idx = (this.turn + i) % n;
          const p = this.players[idx];
          if (p.status === 'active') {
            this.turn = idx;
            this.prompt = { kind: 'hitOrStay', playerId: p.id, canStay: this.canStay(p) };
            return;
          }
        }
        this.queue.unshift({ t: 'endRound' });
        return;
      }
      case 'nextTurn':
        this.turn = (this.turn + 1) % this.players.length;
        this.queue.unshift({ t: 'turn' });
        return;
      case 'endRound': {
        if (this.flip7By && this.options.brutal && this.bonusChoice === undefined) {
          const options = this.players.filter((p) => p.id !== this.flip7By).map((p) => p.id);
          if (options.length) {
            this.prompt = { kind: 'flip7Bonus', playerId: this.flip7By, options };
            this.queue.unshift(task);
            return;
          }
        }
        this.scoreRound();
        return;
      }
    }
  }

  // ---------------------------------------------------------------- cards

  private drawCard(): Card | null {
    if (!this.deck.length) {
      if (!this.discardPile.length) {
        this.say('No cards left anywhere!');
        return null;
      }
      this.deck = shuffle(this.discardPile, this.rng);
      this.discardPile = [];
      this.say('Deck empty: discard pile reshuffled');
    }
    return this.deck.shift()!;
  }

  /** Classic: you need a card in front of you. Vengeance: holding the Zero forces you to hit. */
  private canStay(p: Player): boolean {
    return this.classic ? p.line.length > 0 : !hasZero(p.line);
  }

  private gainNumber(p: Player, card: NumberCard) {
    if (card.special === 'unlucky7') this.applyUnlucky7(p);
    if (this.classic && isBustLine([...p.line, card]) && hasSecondChance(p.line)) {
      const idx = p.line.findIndex((c) => c.kind === 'action' && c.action === 'secondChance');
      this.discardPile.push(...p.line.splice(idx, 1), card);
      this.say(`Second Chance saves ${p.name}! The duplicate ${cardLabel(card)} is discarded`);
      this.emit({ kind: 'saved', playerId: p.id });
      return;
    }
    p.line.push(card);
    this.checkLine(p);
  }

  /** Unlucky 7: discard all Number and Modifier cards, keeping only the 7. */
  private applyUnlucky7(p: Player) {
    if (!p.line.length) return;
    this.discardPile.push(...p.line);
    p.line = [];
    this.say(`Unlucky 7! ${p.name} discards all their other cards`);
  }

  private checkLine(p: Player) {
    if (this.flip7By || p.status === 'busted') return;
    if (isBustLine(p.line)) {
      p.status = 'busted';
      // The card just added is the one that caused the duplicate.
      p.bustCardId = p.line[p.line.length - 1].id;
      this.say(`${p.name} BUSTS!`);
      this.emit({ kind: 'bust', playerId: p.id, cardId: p.bustCardId });
    } else if (hasFlip7(p.line)) {
      this.flip7By = p.id;
      this.say(`${p.name} FLIPS 7! The round ends.`);
      this.emit({ kind: 'flip7', playerId: p.id });
      this.prompt = null;
      this.dropQueue();
      this.queue = [{ t: 'endRound' }];
    }
  }

  /** Abandon pending work, discarding any cards that were waiting to be resolved. */
  private dropQueue() {
    for (const task of this.queue) {
      if (task.t === 'give' || task.t === 'resolve') this.discardPile.push(task.card);
      if (task.t === 'flip') this.discardPile.push(...task.setAside);
    }
    this.queue = [];
  }

  private nonBusted(): Player[] {
    return this.players.filter((p) => p.status !== 'busted');
  }

  /** Who may receive a drawn Action (or, in Vengeance, Modifier) card. */
  private giveOptions(holderId: string, card: Card): string[] {
    if (!this.classic) {
      const pool = card.kind === 'modifier' && this.options.brutal ? this.players : this.nonBusted();
      return pool.map((p) => p.id);
    }
    const active = this.players.filter((p) => p.status === 'active');
    if (card.kind === 'action' && card.action === 'secondChance') {
      // Keep it; if you already have one, give it to another active player without one.
      const holder = this.player(holderId);
      if (holder.status === 'active' && !hasSecondChance(holder.line)) return [holderId];
      return active.filter((p) => p.id !== holderId && !hasSecondChance(p.line)).map((p) => p.id);
    }
    return active.map((p) => p.id);
  }

  private startGive(holderId: string, card: Card) {
    const options = this.giveOptions(holderId, card);
    if (!options.length) {
      this.discardPile.push(card);
      this.say(`Nobody can receive ${cardLabel(card)}; discarded`);
      return;
    }
    if (options.length === 1) return this.applyGive(holderId, card, options[0]);
    this.prompt = { kind: 'give', playerId: holderId, card, options };
  }

  private applyGive(holderId: string, card: Card, targetId: string) {
    const holder = this.player(holderId);
    const target = this.player(targetId);
    const who = holderId === targetId ? 'themself' : target.name;
    if (card.kind === 'action' && card.action === 'secondChance') {
      this.say(holderId === targetId ? `${holder.name} keeps ${cardLabel(card)}` : `${holder.name} gives ${cardLabel(card)} to ${who}`);
    } else {
      this.say(`${holder.name} plays ${cardLabel(card)} on ${who}`);
    }
    this.emit({ kind: 'play', playerId: holderId, targetId, card });
    if (card.kind === 'modifier') target.line.push(card);
    else if (card.kind === 'action') this.queue.unshift({ t: 'resolve', playerId: targetId, card });
    else target.line.push(card);
  }

  private cardRefs(owners: Player[]): CardRef[] {
    return owners.flatMap((p) => p.line.map((c) => ({ ownerId: p.id, cardId: c.id })));
  }

  private resolveAction(playerId: string, card: ActionCard) {
    const p = this.player(playerId);
    const nobody = () => {
      this.discardPile.push(card);
      this.say(`${actionName(card.action)} has no valid cards to target; discarded`);
    };
    switch (card.action) {
      case 'freeze':
        this.discardPile.push(card);
        if (p.status === 'active') {
          p.status = 'stayed';
          p.frozen = true;
          this.say(`${p.name} is frozen and banks their points`);
          this.emit({ kind: 'freeze', playerId: p.id });
        }
        return;
      case 'secondChance':
        p.line.push(card);
        return;
      case 'flipThree':
        this.discardPile.push(card);
        this.say(`${p.name} must flip three cards`);
        this.queue.unshift({ t: 'flip', playerId, count: 3, remaining: 3, setAside: [] });
        return;
      case 'justOneMore':
        this.discardPile.push(card);
        this.queue.unshift({ t: 'draw', playerId }, { t: 'forceStay', playerId });
        return;
      case 'flipFour':
        this.discardPile.push(card);
        this.say(`${p.name} must flip four cards`);
        this.queue.unshift({ t: 'flip', playerId, count: 4, remaining: 4, setAside: [] });
        return;
      case 'steal': {
        const options = this.cardRefs(this.nonBusted().filter((x) => x.id !== playerId));
        if (!options.length) return nobody();
        this.prompt = { kind: 'steal', playerId, card, options };
        return;
      }
      case 'swap': {
        const options = this.cardRefs(this.nonBusted());
        if (new Set(options.map((r) => r.ownerId)).size < 2) return nobody();
        this.prompt = { kind: 'swap', playerId, card, options };
        return;
      }
      case 'discard': {
        const options = this.cardRefs(this.nonBusted());
        if (!options.length) return nobody();
        this.prompt = { kind: 'discard', playerId, card, options };
        return;
      }
    }
  }

  /**
   * Flip Three / Flip Four: stop on a bust or Flip 7. Other Actions (and in
   * Vengeance, Modifiers) are set aside and resolved after all flips. Classic
   * Modifiers go straight to the line and a Second Chance is taken at once.
   */
  private stepFlip(task: Extract<Task, { t: 'flip' }>) {
    const p = this.player(task.playerId);
    const discardSetAside = () => this.discardPile.push(...task.setAside);
    if (p.status === 'busted') return discardSetAside();
    const card = task.remaining > 0 ? this.drawCard() : null;
    if (!card) {
      // All flipped (or deck exhausted): resolve set-aside cards in order.
      this.queue.unshift(...task.setAside.map((c): Task => ({ t: 'give', holderId: p.id, card: c })));
      return;
    }
    const step = { n: task.count - task.remaining + 1, of: task.count };
    this.say(`${p.name} flips ${cardLabel(card)} (${step.n}/${step.of})`);
    this.emit({ kind: 'flip', playerId: p.id, card, step });
    const next: Task = { ...task, remaining: task.remaining - 1 };
    if (card.kind === 'number') {
      this.gainNumber(p, card);
      // gainNumber may have busted the player or ended the round
      if (this.flip7By || (p.status as Status) === 'busted') return discardSetAside();
    } else if (this.classic && card.kind === 'modifier') {
      p.line.push(card);
    } else if (this.classic && card.kind === 'action' && card.action === 'secondChance') {
      this.queue.unshift(next);
      this.queue.unshift({ t: 'give', holderId: p.id, card });
      return;
    } else {
      next.setAside = [...task.setAside, card];
    }
    this.queue.unshift(next);
  }

  private takeFromLine(ref: CardRef): Card {
    const owner = this.player(ref.ownerId);
    const idx = owner.line.findIndex((c) => c.id === ref.cardId);
    if (idx < 0) throw new Error('Card not found');
    return owner.line.splice(idx, 1)[0];
  }

  /** A player gaining a card from another line: Unlucky 7 triggers, duplicates bust. */
  private receiveFromTable(p: Player, card: Card) {
    if (card.kind === 'number' && card.special === 'unlucky7') this.applyUnlucky7(p);
    p.line.push(card);
  }

  private applySteal(playerId: string, ref: CardRef, action: ActionCard) {
    const p = this.player(playerId);
    const victim = this.player(ref.ownerId);
    const card = this.takeFromLine(ref);
    this.discardPile.push(action);
    this.say(`${p.name} steals ${cardLabel(card)} from ${victim.name}`);
    this.receiveFromTable(p, card);
    this.checkLine(p);
  }

  private applySwap(playerId: string, a: CardRef, b: CardRef, action: ActionCard) {
    const p = this.player(playerId);
    const pa = this.player(a.ownerId);
    const pb = this.player(b.ownerId);
    const ia = pa.line.findIndex((c) => c.id === a.cardId);
    const ib = pb.line.findIndex((c) => c.id === b.cardId);
    const ca = pa.line[ia];
    const cb = pb.line[ib];
    this.discardPile.push(action);
    this.say(`${p.name} swaps ${pa.name}'s ${cardLabel(ca)} with ${pb.name}'s ${cardLabel(cb)}`);
    pa.line.splice(ia, 1);
    pb.line.splice(ib, 1);
    this.receiveFromTable(pa, cb);
    this.receiveFromTable(pb, ca);
    this.checkLine(pa);
    this.checkLine(pb);
  }

  private applyDiscard(playerId: string, ref: CardRef, action: ActionCard) {
    const p = this.player(playerId);
    const owner = this.player(ref.ownerId);
    const card = this.takeFromLine(ref);
    this.discardPile.push(action, card);
    const whose = owner.id === playerId ? 'their own' : `${owner.name}'s`;
    this.say(`${p.name} discards ${whose} ${cardLabel(card)}`);
  }

  // ---------------------------------------------------------------- scoring

  private scoreRound() {
    const brutal = this.options.brutal;
    for (const p of this.players) {
      const flip7 = p.id === this.flip7By;
      const takeBonus = !(flip7 && brutal && typeof this.bonusChoice === 'string');
      p.lastRound = scoreLine(p.line, { busted: p.status === 'busted', flip7, takeBonus, brutal });
    }
    if (typeof this.bonusChoice === 'string' && this.flip7By) {
      const victim = this.player(this.bonusChoice);
      victim.lastRound!.penalty = -FLIP7_BONUS;
      victim.lastRound!.total -= FLIP7_BONUS;
      this.say(`${this.player(this.flip7By).name} uses their Flip 7 to take 15 from ${victim.name}`);
    }
    for (const p of this.players) {
      p.total += p.lastRound!.total;
      this.discardPile.push(...p.line);
      // Cards stay visible for the summary; they're already in the discard pile.
    }
    this.say(
      'Round scores: ' +
        this.players.map((p) => `${p.name} ${p.lastRound!.total >= 0 ? '+' : ''}${p.lastRound!.total}`).join(', '),
    );
    this.prompt = null;
    this.queue = [];

    const top = Math.max(...this.players.map((p) => p.total));
    if (top >= this.options.target) {
      this.winners = this.players.filter((p) => p.total === top).map((p) => p.id);
      this.phase = 'gameOver';
      this.say(`${this.winners.map((id) => this.player(id).name).join(' & ')} win${this.winners.length > 1 ? '' : 's'} with ${top}!`);
    } else {
      this.phase = 'roundEnd';
    }
  }

  // ---------------------------------------------------------------- utils

  private seatOrderFrom(start: number): string[] {
    const n = this.players.length;
    return Array.from({ length: n }, (_, i) => this.players[(start + i) % n].id);
  }

  private emit(e: EventInput) {
    this.events.push({ ...e, seq: ++this.eventSeq } as GameEvent);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  private say(text: string) {
    this.log.push({ seq: ++this.logSeq, text });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }
}
