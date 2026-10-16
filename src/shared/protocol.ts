import type { Card, CardKey } from './cards';
import type { Decision, LogEntry, Phase, Prompt, Status } from './engine';
import type { ScoreBreakdown } from './scoring';

export interface MemberView { id: string; name: string; isBot: boolean; connected: boolean }

export interface PlayerView {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  line: Card[];
  status: Status;
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
  flip7By: string | null;
  winners: string[];
  options: { brutal: boolean; target: number };
}

export interface RoomView {
  id: string;
  hostId: string | null;
  brutal: boolean;
  target: number;
  members: MemberView[];
}

export type ServerMessage =
  | { type: 'state'; you: string; devMode: boolean; room: RoomView; game: GameView | null }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'join'; roomId: string; playerId: string; name: string; accessToken?: string }
  | { type: 'addBot' }
  | { type: 'kick'; playerId: string }
  | { type: 'setOptions'; brutal?: boolean; target?: number }
  | { type: 'start' }
  | { type: 'decide'; decision: Decision }
  | { type: 'nextRound' }
  | { type: 'endGame' }
  | { type: 'rig'; key: CardKey };
