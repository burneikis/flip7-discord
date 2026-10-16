export type ActionKind = 'justOneMore' | 'swap' | 'steal' | 'discard' | 'flipFour';
export type Special = 'zero' | 'unlucky7' | 'lucky13';

export interface NumberCard { id: number; kind: 'number'; value: number; special?: Special }
export interface ModifierCard { id: number; kind: 'modifier'; op: 'sub' | 'half'; amount: number }
export interface ActionCard { id: number; kind: 'action'; action: ActionKind }
export type Card = NumberCard | ModifierCard | ActionCard;

/**
 * Card keys are short stable names for a card type, used by tests and the
 * dev "rig the deck" panel: n1..n13, zero, unlucky7, lucky13, -2..-10, /2,
 * justOneMore, swap, steal, discard, flipFour.
 */
export type CardKey = string;

/**
 * Deck composition (108 cards). Verified against the physical deck count:
 * thirteen 13s (12 normal + Lucky 13), seven 7s (6 normal + Unlucky 7),
 * N copies of every other N, plus the Zero, one of each Modifier and two of
 * each Action. Edit here if your deck differs.
 */
export const DECK_COUNTS: Record<CardKey, number> = {
  n13: 12, n12: 12, n11: 11, n10: 10, n9: 9, n8: 8, n7: 6,
  n6: 6, n5: 5, n4: 4, n3: 3, n2: 2, n1: 1,
  zero: 1, unlucky7: 1, lucky13: 1,
  '-2': 1, '-4': 1, '-6': 1, '-8': 1, '-10': 1, '/2': 1,
  justOneMore: 2, swap: 2, steal: 2, discard: 2, flipFour: 2,
};

const ACTIONS: ActionKind[] = ['justOneMore', 'swap', 'steal', 'discard', 'flipFour'];

export function cardFromKey(key: CardKey, id: number): Card {
  if (/^n\d+$/.test(key)) return { id, kind: 'number', value: Number(key.slice(1)) };
  if (key === 'zero') return { id, kind: 'number', value: 0, special: 'zero' };
  if (key === 'unlucky7') return { id, kind: 'number', value: 7, special: 'unlucky7' };
  if (key === 'lucky13') return { id, kind: 'number', value: 13, special: 'lucky13' };
  if (key === '/2') return { id, kind: 'modifier', op: 'half', amount: 2 };
  if (/^-\d+$/.test(key)) return { id, kind: 'modifier', op: 'sub', amount: Number(key.slice(1)) };
  if ((ACTIONS as string[]).includes(key)) return { id, kind: 'action', action: key as ActionKind };
  throw new Error(`Unknown card key: ${key}`);
}

export function cardKey(card: Card): CardKey {
  switch (card.kind) {
    case 'number': return card.special ?? `n${card.value}`;
    case 'modifier': return card.op === 'half' ? '/2' : `-${card.amount}`;
    case 'action': return card.action;
  }
}

export const ALL_CARD_KEYS: CardKey[] = Object.keys(DECK_COUNTS);

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  let id = 1;
  for (const [key, count] of Object.entries(DECK_COUNTS)) {
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
  justOneMore: 'Just One More!',
  swap: 'Swap',
  steal: 'Steal',
  discard: 'Discard',
  flipFour: 'Flip Four!',
};

export function actionName(action: ActionKind): string {
  return ACTION_NAMES[action];
}

export function cardLabel(card: Card): string {
  switch (card.kind) {
    case 'number':
      if (card.special === 'zero') return 'the Zero';
      if (card.special === 'unlucky7') return 'Unlucky 7';
      if (card.special === 'lucky13') return 'Lucky 13';
      return String(card.value);
    case 'modifier': return card.op === 'half' ? '÷2' : `-${card.amount}`;
    case 'action': return ACTION_NAMES[card.action];
  }
}
