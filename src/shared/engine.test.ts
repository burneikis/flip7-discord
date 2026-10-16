import { describe, expect, it } from 'vitest';
import { buildDeck, cardFromKey, cardKey, type Card } from './cards';
import { Game, type GameOptions } from './engine';
import { scoreLine } from './scoring';
import { botDecision } from './bot';

let nextId = 10_000;
const cards = (...keys: string[]): Card[] => keys.map((k) => cardFromKey(k, nextId++));
const PLAYERS = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), isBot: false }));

/** Seat 0 is dealt first and takes the first turn. Deck is drawn top-first in the given order. */
function setup(n: number, deck: string[], opts: Partial<GameOptions> = {}) {
  return new Game(PLAYERS.slice(0, n), { brutal: false, target: 200, ...opts }, () => 0.5, cards(...deck));
}
const keys = (g: Game, id: string) => g.player(id).line.map(cardKey);
const cardId = (g: Game, owner: string, key: string) => g.player(owner).line.find((c) => cardKey(c) === key)!.id;
function ok(err: string | null) {
  expect(err).toBeNull();
}

describe('deck', () => {
  it('has 108 cards with the right composition', () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter((c) => c.kind === 'number' && c.value === 13)).toHaveLength(13);
    expect(deck.filter((c) => c.kind === 'number' && c.value === 7)).toHaveLength(7);
    expect(deck.filter((c) => c.kind === 'action')).toHaveLength(10);
    expect(deck.filter((c) => c.kind === 'modifier')).toHaveLength(6);
  });
});

describe('scoring', () => {
  it('follows the rulebook example: 48, ÷2, -4, Flip 7 = 35', () => {
    const line = cards('n13', 'n12', 'n9', 'n6', 'n5', 'n2', 'n1', '/2', '-4');
    expect(scoreLine(line, { flip7: true }).total).toBe(35);
  });
  it('never drops below zero outside brutal mode', () => {
    expect(scoreLine(cards('n3', '-10')).total).toBe(0);
    expect(scoreLine(cards('n3', '-10'), { brutal: true }).total).toBe(-7);
  });
  it('Zero scores nothing unless Flip 7', () => {
    expect(scoreLine(cards('zero', 'n12', 'n11')).total).toBe(0);
    expect(scoreLine(cards('zero', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'), { flip7: true }).total).toBe(21 + 15);
  });
});

describe('basic flow', () => {
  it('deals one card each then takes turns from seat 0', () => {
    const g = setup(3, ['n5', 'n6', 'n8', 'n9']);
    expect(keys(g, 'a')).toEqual(['n5']);
    expect(keys(g, 'c')).toEqual(['n8']);
    expect(g.prompt).toMatchObject({ kind: 'hitOrStay', playerId: 'a' });
    ok(g.decide('a', { type: 'hit' }));
    expect(keys(g, 'a')).toEqual(['n5', 'n9']);
    expect(g.prompt).toMatchObject({ kind: 'hitOrStay', playerId: 'b' });
  });

  it('rejects decisions from the wrong player', () => {
    const g = setup(2, ['n5', 'n6']);
    expect(g.decide('b', { type: 'hit' })).toMatch(/not your/);
  });

  it('busts on a duplicate and skips busted players', () => {
    const g = setup(3, ['n5', 'n6', 'n8', 'n5']);
    ok(g.decide('a', { type: 'hit' }));
    expect(g.player('a').status).toBe('busted');
    ok(g.decide('b', { type: 'stay' }));
    ok(g.decide('c', { type: 'stay' }));
    expect(g.phase).toBe('roundEnd');
    expect(g.players.map((p) => p.total)).toEqual([0, 6, 8]);
  });

  it('Flip 7 ends the round immediately with +15', () => {
    const g = setup(2, ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n8', 'n9']);
    ok(g.decide('a', { type: 'hit' })); // 3
    ok(g.decide('b', { type: 'stay' }));
    for (let i = 0; i < 5; i++) ok(g.decide('a', { type: 'hit' }));
    expect(g.flip7By).toBe('a');
    expect(g.phase).toBe('roundEnd');
    expect(g.player('a').total).toBe(1 + 3 + 4 + 5 + 6 + 8 + 9 + 15);
  });

  it('rotates the dealer and keeps the deck between rounds', () => {
    const g = setup(2, ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    ok(g.decide('a', { type: 'stay' }));
    ok(g.decide('b', { type: 'stay' }));
    ok(g.nextRound());
    expect(g.dealer).toBe(0);
    expect(keys(g, 'b')).toEqual(['n3']); // left of dealer gets the first card
    expect(keys(g, 'a')).toEqual(['n4']);
    expect(g.prompt).toMatchObject({ playerId: 'b' });
  });

  it('ends the game when someone reaches the target', () => {
    const g = setup(2, ['n12', 'n2', 'n13'], { target: 25 });
    ok(g.decide('a', { type: 'hit' }));
    ok(g.decide('b', { type: 'stay' }));
    ok(g.decide('a', { type: 'stay' }));
    expect(g.phase).toBe('gameOver');
    expect(g.winners).toEqual(['a']);
  });

  it('reshuffles the discard pile when the deck runs out', () => {
    const g = setup(2, ['n1', 'n2']);
    ok(g.decide('a', { type: 'stay' }));
    ok(g.decide('b', { type: 'stay' }));
    ok(g.nextRound());
    expect(g.log.some((e) => e.text.includes('reshuffled'))).toBe(true);
    expect(g.players.every((p) => p.line.length === 1)).toBe(true);
  });
});

describe('special number cards', () => {
  it('Unlucky 7 discards all other number and modifier cards, even a 7', () => {
    const g = setup(2, ['n7', 'n2', '-4', 'unlucky7']);
    ok(g.decide('a', { type: 'hit' })); // -4
    ok(g.decide('a', { type: 'give', targetId: 'b' }));
    expect(keys(g, 'b')).toEqual(['n2', '-4']);
    ok(g.decide('b', { type: 'hit' })); // Unlucky 7
    expect(keys(g, 'b')).toEqual(['unlucky7']);
    expect(g.player('b').status).toBe('active');
  });

  it('Unlucky 7 does not bust when you already hold a 7', () => {
    const g = setup(2, ['n7', 'n2', 'unlucky7']);
    ok(g.decide('a', { type: 'hit' }));
    expect(keys(g, 'a')).toEqual(['unlucky7']);
    expect(g.player('a').status).toBe('active');
  });

  it('Lucky 13 allows exactly one other 13', () => {
    const g = setup(2, ['n13', 'n2', 'lucky13', 'n3', 'n13']);
    ok(g.decide('a', { type: 'hit' }));
    expect(g.player('a').status).toBe('active');
    ok(g.decide('b', { type: 'hit' }));
    ok(g.decide('a', { type: 'hit' }));
    expect(g.player('a').status).toBe('busted');
  });

  it('the Zero prevents staying', () => {
    const g = setup(2, ['zero', 'n2']);
    expect(g.prompt).toMatchObject({ kind: 'hitOrStay', canStay: false });
    expect(g.decide('a', { type: 'stay' })).toMatch(/Zero/);
  });
});

describe('modifiers', () => {
  it('can be played on any non-busted player', () => {
    const g = setup(3, ['-6', 'n2', 'n3']);
    expect(g.prompt).toMatchObject({ kind: 'give', playerId: 'a', options: ['a', 'b', 'c'] });
    ok(g.decide('a', { type: 'give', targetId: 'c' }));
    expect(keys(g, 'a')).toEqual([]);
    expect(keys(g, 'b')).toEqual(['n2']);
    expect(keys(g, 'c')).toEqual(['-6', 'n3']);
  });

  it('is kept if you are the only non-busted player', () => {
    const g = setup(2, ['n5', 'n6', 'n5', '-2']);
    ok(g.decide('a', { type: 'hit' })); // a busts
    ok(g.decide('b', { type: 'hit' })); // b draws -2, only b is not busted
    expect(keys(g, 'b')).toEqual(['n6', '-2']);
  });
});

describe('action cards', () => {
  it('Just One More: target takes one card, then must stay', () => {
    const g = setup(3, ['justOneMore', 'n2', 'n3', 'n9', 'n4']);
    ok(g.decide('a', { type: 'give', targetId: 'c' }));
    expect(keys(g, 'c')).toEqual(['n2']);
    expect(g.player('c').status).toBe('stayed');
    // deal continues: b gets n3, c already stayed so gets no dealt card
    expect(keys(g, 'b')).toEqual(['n3']);
  });

  it('Flip Four: four flips, set-aside actions resolve after', () => {
    const g = setup(2, ['n1', 'n2', 'flipFour', 'n3', 'steal', 'n4', 'n5']);
    ok(g.decide('a', { type: 'hit' }));
    ok(g.decide('a', { type: 'give', targetId: 'b' }));
    expect(keys(g, 'b')).toEqual(['n2', 'n3', 'n4', 'n5']);
    // the Steal flipped during Flip Four is now played by b
    expect(g.prompt).toMatchObject({ kind: 'give', playerId: 'b', card: { action: 'steal' } });
    ok(g.decide('b', { type: 'give', targetId: 'b' }));
    expect(g.prompt).toMatchObject({ kind: 'steal', playerId: 'b' });
    ok(g.decide('b', { type: 'steal', cardId: cardId(g, 'a', 'n1') }));
    expect(keys(g, 'b')).toEqual(['n2', 'n3', 'n4', 'n5', 'n1']);
  });

  it('Flip Four stops on a bust and discards set-aside actions', () => {
    const g = setup(2, ['n1', 'n2', 'flipFour', 'swap', 'n2', 'n9']);
    ok(g.decide('a', { type: 'hit' }));
    ok(g.decide('a', { type: 'give', targetId: 'b' }));
    expect(g.player('b').status).toBe('busted');
    expect(g.deck.map(cardKey)).toEqual(['n9']);
    expect(g.prompt).toMatchObject({ kind: 'hitOrStay', playerId: 'a' });
  });

  it('Swap can bust two players at once (FAQ)', () => {
    const g = setup(3, ['n10', 'n10', 'n2', 'n11', 'n11', 'swap']);
    ok(g.decide('a', { type: 'hit' }));
    ok(g.decide('b', { type: 'hit' }));
    ok(g.decide('c', { type: 'hit' }));
    ok(g.decide('c', { type: 'give', targetId: 'c' }));
    ok(g.decide('c', { type: 'swap', cardIds: [cardId(g, 'a', 'n10'), cardId(g, 'b', 'n11')] }));
    expect(g.player('a').status).toBe('busted');
    expect(g.player('b').status).toBe('busted');
  });

  it('Swap cannot exchange two cards from the same player', () => {
    const g = setup(2, ['n10', 'n4', 'n11', 'swap']);
    ok(g.decide('a', { type: 'hit' }));
    ok(g.decide('b', { type: 'hit' }));
    ok(g.decide('b', { type: 'give', targetId: 'b' }));
    expect(g.decide('b', { type: 'swap', cardIds: [cardId(g, 'a', 'n10'), cardId(g, 'a', 'n11')] })).toMatch(/different/);
  });

  it('Steal must be used even if it busts you (FAQ)', () => {
    const g = setup(3, ['n13', 'n13', 'steal']);
    ok(g.decide('c', { type: 'give', targetId: 'a' }));
    expect(g.prompt).toMatchObject({ kind: 'steal', playerId: 'a' });
    ok(g.decide('a', { type: 'steal', cardId: cardId(g, 'b', 'n13') }));
    expect(g.player('a').status).toBe('busted');
    expect(keys(g, 'b')).toEqual([]);
  });

  it('Stealing the Unlucky 7 triggers its discard', () => {
    const g = setup(2, ['unlucky7', 'n5', 'n3', 'steal']);
    ok(g.decide('a', { type: 'hit' }));
    ok(g.decide('b', { type: 'hit' }));
    ok(g.decide('b', { type: 'give', targetId: 'b' }));
    ok(g.decide('b', { type: 'steal', cardId: cardId(g, 'a', 'unlucky7') }));
    expect(keys(g, 'b')).toEqual(['unlucky7']);
  });

  it('Discard removes any card you choose', () => {
    const g = setup(2, ['n9', 'n4', 'discard']);
    ok(g.decide('a', { type: 'hit' }));
    ok(g.decide('a', { type: 'give', targetId: 'a' }));
    ok(g.decide('a', { type: 'discard', cardId: cardId(g, 'b', 'n4') }));
    expect(keys(g, 'b')).toEqual([]);
  });

  it('is discarded when there is nothing to target at the start of a round', () => {
    const g = setup(2, ['swap', 'n4', 'n5']);
    ok(g.decide('a', { type: 'give', targetId: 'b' }));
    expect(g.log.some((e) => e.text.includes('no valid cards'))).toBe(true);
    expect(g.prompt).toMatchObject({ kind: 'hitOrStay', playerId: 'a' });
  });

  it('can target a player who stayed, who then stays inactive', () => {
    const g = setup(2, ['n5', 'n6', 'justOneMore', 'n9']);
    ok(g.decide('a', { type: 'stay' }));
    ok(g.decide('b', { type: 'hit' }));
    ok(g.decide('b', { type: 'give', targetId: 'a' }));
    expect(keys(g, 'a')).toEqual(['n5', 'n9']);
    expect(g.player('a').status).toBe('stayed');
  });
});

describe('brutal mode', () => {
  it('busted players keep negative modifiers', () => {
    const g = setup(2, ['n5', 'n6', 'n5', '-10'], { brutal: true });
    ok(g.decide('a', { type: 'hit' }));
    ok(g.decide('b', { type: 'hit' }));
    expect(g.prompt).toMatchObject({ kind: 'give', options: ['a', 'b'] });
    ok(g.decide('b', { type: 'give', targetId: 'a' }));
    ok(g.decide('b', { type: 'stay' }));
    expect(g.player('a').total).toBe(-10);
  });

  it('Flip 7 can take 15 from another player instead', () => {
    const g = setup(2, ['n1', 'n9', 'n2', 'n3', 'n4', 'n5', 'n6', 'n8'], { brutal: true });
    ok(g.decide('a', { type: 'hit' }));
    ok(g.decide('b', { type: 'stay' }));
    for (let i = 0; i < 5; i++) ok(g.decide('a', { type: 'hit' }));
    expect(g.prompt).toMatchObject({ kind: 'flip7Bonus', playerId: 'a' });
    ok(g.decide('a', { type: 'flip7Bonus', targetId: 'b' }));
    expect(g.player('a').total).toBe(29);
    expect(g.player('b').total).toBe(9 - 15);
  });
});

describe('bots', () => {
  it('can play many full games without getting stuck', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = seed;
      const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const g = new Game(PLAYERS.slice(0, 2 + (seed % 3)), { brutal: seed % 2 === 0, target: 200 }, rng);
      let steps = 0;
      while (g.phase !== 'gameOver') {
        if (g.phase === 'roundEnd') g.nextRound();
        else ok(g.decide(g.prompt!.playerId, botDecision(g, g.prompt!.playerId)));
        if (++steps > 20_000) throw new Error('game did not finish');
      }
      const total = g.deck.length + g.discardPile.length;
      expect(total).toBe(108);
    }
  });
});
