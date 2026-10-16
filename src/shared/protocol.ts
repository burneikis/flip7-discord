import type { Card, CardKey, Variant } from './cards';
import type { Decision, GameEvent, GameOptions, LogEntry, Phase, Prompt, Status } from './engine';
import type { ScoreBreakdown } from './scoring';

export interface MemberView { id: string; name: string; isBot: boolean; connected: boolean }

export interface PlayerView {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  line: Card[];
  status: Status;
  frozen: boolean;
  bustCardId: number | null;
  total: number;
  live: ScoreBreakdown;
  lastRound: ScoreBreakdown | null;
}

export interface GameView {
  phase: Phase;
  round: number;
  dealerId: string;
  turnId: string | null;
  players: PlayerView[];
  deckCount: number;
  discardCount: number;
  prompt: Prompt | null;
  log: LogEntry[];
  events: GameEvent[];
  /** Milliseconds left on the current prompt's turn timer (null = no timer). */
  timeLeftMs: number | null;
  flip7By: string | null;
  winners: string[];
  options: GameOptions;
}

export interface RoomView {
  id: string;
  hostId: string | null;
  variant: Variant;
  brutal: boolean;
  target: number;
  /** Turn timer in seconds, 0 = off. */
  turnSeconds: number;
  members: MemberView[];
}

export type ServerMessage =
  | { type: 'state'; you: string; devMode: boolean; room: RoomView; game: GameView | null }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export type ClientMessage =
  | { type: 'join'; roomId: string; playerId: string; name: string; accessToken?: string }
  | { type: 'addBot' }
  | { type: 'kick'; playerId: string }
  /** Take a seat again (e.g. after being removed from the lobby). */
  | { type: 'sit' }
  | { type: 'ping' }
  | { type: 'setOptions'; variant?: Variant; brutal?: boolean; target?: number; turnSeconds?: number }
  | { type: 'start' }
  | { type: 'decide'; decision: Decision }
  | { type: 'nextRound' }
  | { type: 'endGame' }
  | { type: 'rig'; key: CardKey };

export const TURN_TIMER_CHOICES = [0, 15, 30, 45, 60, 90];
