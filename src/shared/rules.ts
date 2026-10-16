import { DECK_COUNTS, cardFromKey, type CardKey, type DeckCounts, type PresetVariant } from './cards';
import { FLIP7_BONUS, FLIP7_COUNT } from './scoring';

/**
 * Everything that differs between the two official games, as independent
 * switches. The presets reproduce Flip 7 and Flip 7: With a Vengeance; the
 * "custom" variant lets the host edit every field in the lobby.
 */
export interface Rules {
  /** How many copies of each card are in the deck. */
  deck: DeckCounts;
  /** Drawn Modifiers are given to any player (Vengeance) instead of going to your own line (classic). */
  giveModifiers: boolean;
  /** Actions and Modifiers can be given to players who stayed (Vengeance), not just active ones. */
  targetStayed: boolean;
  /** You need at least one card in front of you to stay (classic). */
  stayNeedsCard: boolean;
  /** Steal, Swap and Discard are always used by whoever drew them (no target to pick). */
  selfPlayed: boolean;
  /** Distinct Number cards needed for a Flip 7. */
  flip7Count: number;
  /** Points for a Flip 7 (and what a Brutal Flip 7 takes from someone). */
  flip7Bonus: number;
}

export const PRESET_RULES: Record<PresetVariant, Rules> = {
  classic: {
    deck: DECK_COUNTS.classic,
    giveModifiers: false,
    targetStayed: false,
    stayNeedsCard: true,
    selfPlayed: true,
    flip7Count: FLIP7_COUNT,
    flip7Bonus: FLIP7_BONUS,
  },
  vengeance: {
    deck: DECK_COUNTS.vengeance,
    giveModifiers: true,
    targetStayed: true,
    stayNeedsCard: false,
    selfPlayed: true,
    flip7Count: FLIP7_COUNT,
    flip7Bonus: FLIP7_BONUS,
  },
};

/** Every card the custom deck editor offers, in display order. */
export const ALL_CARD_KEYS: CardKey[] = [
  ...Array.from({ length: 14 }, (_, i) => `n${i}`),
  'zero', 'unlucky7', 'lucky13',
  '+2', '+4', '+6', '+8', '+10', 'x2',
  '-2', '-4', '-6', '-8', '-10', '/2',
  'freeze', 'flipThree', 'secondChance',
  'justOneMore', 'swap', 'steal', 'discard', 'flipFour',
];

export const RULE_LIMITS = {
  maxPerCard: 30,
  minNumberCards: 10,
  flip7Count: { min: 3, max: 15 },
  flip7Bonus: { min: 0, max: 100 },
};

export const RULE_TOGGLES: { key: 'giveModifiers' | 'targetStayed' | 'stayNeedsCard' | 'selfPlayed'; label: string; hint: string }[] = [
  { key: 'giveModifiers', label: 'Give Modifiers', hint: 'Drawn Modifiers are given to any player instead of kept (Vengeance).' },
  { key: 'targetStayed', label: 'Target stayed players', hint: 'Actions and Modifiers can go to players who already stayed (Vengeance).' },
  { key: 'stayNeedsCard', label: 'Need a card to stay', hint: 'You can only stay with at least one card in front of you (Flip 7).' },
  { key: 'selfPlayed', label: 'Self-played Steal/Swap/Discard', hint: 'Whoever draws them uses them, instead of picking a player to use them.' },
];

export function copyRules(r: Rules): Rules {
  return { ...r, deck: { ...r.deck } };
}

const clampInt = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null;

/** Validate rules sent by a client, keeping `fallback` for anything missing or invalid. */
export function sanitizeRules(input: unknown, fallback: Rules): Rules {
  const out = copyRules(fallback);
  if (!input || typeof input !== 'object') return out;
  const r = input as Partial<Record<keyof Rules, unknown>>;
  if (r.deck && typeof r.deck === 'object') {
    const deck: DeckCounts = {};
    for (const key of ALL_CARD_KEYS) {
      const n = clampInt((r.deck as Record<string, unknown>)[key], 0, RULE_LIMITS.maxPerCard);
      if (n) deck[key] = n;
    }
    out.deck = deck;
  }
  for (const { key } of RULE_TOGGLES) if (typeof r[key] === 'boolean') out[key] = r[key] as boolean;
  const { flip7Count: fc, flip7Bonus: fb } = RULE_LIMITS;
  out.flip7Count = clampInt(r.flip7Count, fc.min, fc.max) ?? out.flip7Count;
  out.flip7Bonus = clampInt(r.flip7Bonus, fb.min, fb.max) ?? out.flip7Bonus;
  return out;
}

export function numberCardCount(deck: DeckCounts): number {
  return Object.entries(deck).reduce((n, [k, c]) => n + (cardFromKey(k, 0).kind === 'number' ? c : 0), 0);
}

/** Why a rule set can't be played, or null if it can. */
export function rulesProblem(r: Rules): string | null {
  const numbers = numberCardCount(r.deck);
  if (numbers < RULE_LIMITS.minNumberCards) return `The deck needs at least ${RULE_LIMITS.minNumberCards} Number cards (has ${numbers})`;
  return null;
}
