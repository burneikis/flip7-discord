/**
 * classic = Flip 7 (ruleset 3.1, 94 cards); vengeance = Flip 7: With a
 * Vengeance (108 cards); custom = host-edited deck and rules (see rules.ts).
 */
export type Variant = 'classic' | 'vengeance' | 'custom';
export type PresetVariant = Exclude<Variant, 'custom'>;
export const VARIANTS: Variant[] = ['classic', 'vengeance', 'custom'];
export const VARIANT_NAMES: Record<Variant, string> = { classic: 'Flip 7', vengeance: 'Flip 7: With a Vengeance', custom: 'Custom rules' };

export type ClassicAction = 'freeze' | 'flipThree' | 'secondChance';
export type VengeanceAction = 'justOneMore' | 'swap' | 'steal' | 'discard' | 'flipFour';
export type ActionKind = ClassicAction | VengeanceAction;
export type Special = 'zero' | 'unlucky7' | 'lucky13';

export interface NumberCard { id: number; kind: 'number'; value: number; special?: Special }
/** sub/half: Vengeance. add/double: classic. */
export interface ModifierCard { id: number; kind: 'modifier'; op: 'sub' | 'half' | 'add' | 'double'; amount: number }
export interface ActionCard { id: number; kind: 'action'; action: ActionKind }
export type Card = NumberCard | ModifierCard | ActionCard;

/**
 * Card keys are short stable names for a card type, used by tests and the
 * dev "rig the deck" panel: n0..n13, zero, unlucky7, lucky13, -2..-10, /2,
 * +2..+10, x2, and the action names.
 */
export type CardKey = string;
export type DeckCounts = Record<CardKey, number>;

/**
 * Deck compositions. Edit here if your deck differs.
 *
 * Classic (94 cards, rulebook ruleset 3.1): N copies of every N from 12 down
 * to 1, one plain 0, +2/+4/+6/+8/+10/x2 Modifiers and three of each Action.
 *
 * Vengeance (108 cards): thirteen 13s (12 normal + Lucky 13), seven 7s
 * (6 normal + Unlucky 7), N copies of every other N, plus the Zero, one of
 * each Modifier and two of each Action.
 */
export const DECK_COUNTS: Record<PresetVariant, DeckCounts> = {
  classic: {
    n12: 12, n11: 11, n10: 10, n9: 9, n8: 8, n7: 7, n6: 6,
    n5: 5, n4: 4, n3: 3, n2: 2, n1: 1, n0: 1,
    '+2': 1, '+4': 1, '+6': 1, '+8': 1, '+10': 1, x2: 1,
    freeze: 3, flipThree: 3, secondChance: 3,
  },
  vengeance: {
    n13: 12, n12: 12, n11: 11, n10: 10, n9: 9, n8: 8, n7: 6,
    n6: 6, n5: 5, n4: 4, n3: 3, n2: 2, n1: 1,
    zero: 1, unlucky7: 1, lucky13: 1,
    '-2': 1, '-4': 1, '-6': 1, '-8': 1, '-10': 1, '/2': 1,
    justOneMore: 2, swap: 2, steal: 2, discard: 2, flipFour: 2,
  },
};

const ACTIONS: ActionKind[] = ['freeze', 'flipThree', 'secondChance', 'justOneMore', 'swap', 'steal', 'discard', 'flipFour'];

export function cardFromKey(key: CardKey, id: number): Card {
  if (/^n\d+$/.test(key)) return { id, kind: 'number', value: Number(key.slice(1)) };
  if (key === 'zero') return { id, kind: 'number', value: 0, special: 'zero' };
  if (key === 'unlucky7') return { id, kind: 'number', value: 7, special: 'unlucky7' };
  if (key === 'lucky13') return { id, kind: 'number', value: 13, special: 'lucky13' };
  if (key === '/2') return { id, kind: 'modifier', op: 'half', amount: 2 };
  if (key === 'x2') return { id, kind: 'modifier', op: 'double', amount: 2 };
  if (/^\+\d+$/.test(key)) return { id, kind: 'modifier', op: 'add', amount: Number(key.slice(1)) };
  if (/^-\d+$/.test(key)) return { id, kind: 'modifier', op: 'sub', amount: Number(key.slice(1)) };
  if ((ACTIONS as string[]).includes(key)) return { id, kind: 'action', action: key as ActionKind };
  throw new Error(`Unknown card key: ${key}`);
}

export function cardKey(card: Card): CardKey {
  switch (card.kind) {
    case 'number': return card.special ?? `n${card.value}`;
    case 'modifier': return modifierText(card, '/2', 'x2');
    case 'action': return card.action;
  }
}

function modifierText(card: ModifierCard, half: string, double: string): string {
  switch (card.op) {
    case 'half': return half;
    case 'double': return double;
    case 'add': return `+${card.amount}`;
    case 'sub': return `-${card.amount}`;
  }
}

export function modifierLabel(card: ModifierCard): string {
  return modifierText(card, '÷2', '×2');
}

const countsOf = (source: PresetVariant | DeckCounts): DeckCounts => (typeof source === 'string' ? DECK_COUNTS[source] : source);

/** Card keys present in a deck (a preset name or explicit counts). */
export function cardKeys(source: PresetVariant | DeckCounts): CardKey[] {
  return Object.entries(countsOf(source)).filter(([, n]) => n > 0).map(([k]) => k);
}

export function buildDeck(source: PresetVariant | DeckCounts = 'classic'): Card[] {
  const deck: Card[] = [];
  let id = 1;
  for (const [key, count] of Object.entries(countsOf(source))) {
    for (let i = 0; i < count; i++) deck.push(cardFromKey(key, id++));
  }
  return deck;
}

export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ACTION_NAMES: Record<ActionKind, string> = {
  freeze: 'Freeze',
  flipThree: 'Flip Three!',
  secondChance: 'Second Chance',
  justOneMore: 'Just One More!',
  swap: 'Swap',
  steal: 'Steal',
  discard: 'Discard',
  flipFour: 'Flip Four!',
};

export function actionName(action: ActionKind): string {
  return ACTION_NAMES[action];
}

/** The card label with an article, for sentences: "a 7", "an 8", "the Zero", "a Freeze". */
export function cardWithArticle(card: Card): string {
  const label = cardLabel(card);
  if (label.startsWith('the ')) return label;
  const an = card.kind === 'number' ? /^(8|11|18)$/.test(String(card.value)) || card.special === 'unlucky7' : false;
  return `${an ? 'an' : 'a'} ${label}`;
}

export function cardLabel(card: Card): string {
  switch (card.kind) {
    case 'number':
      if (card.special === 'zero') return 'the Zero';
      if (card.special === 'unlucky7') return 'Unlucky 7';
      if (card.special === 'lucky13') return 'Lucky 13';
      return String(card.value);
    case 'modifier': return modifierLabel(card);
    case 'action': return ACTION_NAMES[card.action];
  }
}
