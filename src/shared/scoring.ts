import type { Card, NumberCard } from './cards';

export const FLIP7_COUNT = 7;
export const FLIP7_BONUS = 15;

export interface ScoreBreakdown {
  busted: boolean;
  numberSum: number;
  /** Holding the Zero without a Flip 7 makes the number total 0. */
  zeroed: boolean;
  halved: boolean;
  /** Classic x2: doubles the Number card sum. */
  doubled: boolean;
  minus: number;
  /** Classic +2..+10 Modifiers. */
  plus: number;
  flip7: boolean;
  flip7Bonus: number;
  /** Brutal mode: -15 given by another player's Flip 7. */
  penalty: number;
  total: number;
}

export interface ScoreOptions {
  busted?: boolean;
  flip7?: boolean;
  /** False when a Brutal Flip 7 player chose to hit someone else instead. */
  takeBonus?: boolean;
  brutal?: boolean;
  /** Points for a Flip 7 (custom rules can change it). */
  bonus?: number;
}

export function numberCards(line: Card[]): NumberCard[] {
  return line.filter((c): c is NumberCard => c.kind === 'number');
}

export function isBustLine(line: Card[]): boolean {
  const nums = numberCards(line);
  const hasLucky = nums.some((c) => c.special === 'lucky13');
  const counts = new Map<number, number>();
  for (const c of nums) counts.set(c.value, (counts.get(c.value) ?? 0) + 1);
  for (const [value, n] of counts) {
    if (n <= 1) continue;
    if (value === 13 && n === 2 && hasLucky) continue;
    return true;
  }
  return false;
}

export function hasFlip7(line: Card[], count = FLIP7_COUNT): boolean {
  return numberCards(line).length >= count;
}

export function hasZero(line: Card[]): boolean {
  return line.some((c) => c.kind === 'number' && c.special === 'zero');
}

export function hasSecondChance(line: Card[]): boolean {
  return line.some((c) => c.kind === 'action' && c.action === 'secondChance');
}

/**
 * Order per the rulebooks: sum numbers, halve (round down) or double, subtract
 * or add Modifiers, floor at 0, +15. Each deck only has one family of Modifiers.
 */
export function scoreLine(line: Card[], opts: ScoreOptions = {}): ScoreBreakdown {
  const { busted = false, flip7 = false, takeBonus = true, brutal = false, bonus = FLIP7_BONUS } = opts;
  const mods = (op: string) => line.filter((c) => c.kind === 'modifier' && c.op === op);
  const total = (op: string) => mods(op).reduce((s, c) => s + (c.kind === 'modifier' ? c.amount : 0), 0);
  const minus = total('sub');
  const plus = total('add');
  const halves = mods('half').length;
  const doubles = mods('double').length;
  const numberSum = numberCards(line).reduce((s, c) => s + c.value, 0);
  const base = { numberSum, minus, plus, halved: halves > 0, doubled: doubles > 0, flip7, penalty: 0 };

  if (busted) {
    // Brutal: modifiers can be given to busted players and scores go negative.
    return { ...base, busted, zeroed: false, flip7: false, flip7Bonus: 0, plus: 0, minus: brutal ? minus : 0, total: brutal ? -minus : 0 };
  }

  const zeroed = hasZero(line) && !flip7;
  let score = zeroed ? 0 : numberSum;
  for (let i = 0; i < halves; i++) score = Math.floor(score / 2);
  for (let i = 0; i < doubles; i++) score *= 2;
  score += plus - minus;
  if (!brutal) score = Math.max(0, score);
  const flip7Bonus = flip7 && takeBonus ? bonus : 0;
  return { ...base, busted, zeroed, flip7Bonus, total: score + flip7Bonus };
}
