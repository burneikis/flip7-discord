import type { Card } from './cards';
import type { CardRef, Decision, Game, Player } from './engine';
import { hasSecondChance, isBustLine, numberCards, scoreLine } from './scoring';

/**
 * A simple heuristic player. Used for bot seats and to auto-play for
 * disconnected humans so the table never stalls.
 */
export function botDecision(game: Game, playerId: string): Decision {
  const pr = game.prompt;
  if (!pr || pr.playerId !== playerId) throw new Error('Bot has nothing to decide');
  const me = game.player(playerId);

  switch (pr.kind) {
    case 'hitOrStay': {
      if (!pr.canStay) return { type: 'hit' };
      // A Second Chance turns the next bust into a lost card.
      const risk = bustChance(me.line, game.deck) * (hasSecondChance(me.line) ? 0.25 : 1);
      const score = game.liveScore(me).total;
      const count = numberCards(me.line).length;
      const hit = risk < 0.2 || (score < 20 && risk < 0.45) || (count === 6 && risk < 0.5);
      return { type: hit ? 'hit' : 'stay' };
    }
    case 'give': {
      const others = pr.options.filter((id) => id !== playerId).map((id) => game.player(id));
      const card = pr.card;
      if (card.kind === 'action' && ['steal', 'swap', 'discard'].includes(card.action) && pr.options.includes(playerId)) {
        return { type: 'give', targetId: playerId };
      }
      if (!others.length) return { type: 'give', targetId: pr.options[0] };
      if (card.kind === 'action' && card.action === 'secondChance') {
        return { type: 'give', targetId: maxBy(others, (p) => -p.total).id };
      }
      if (card.kind === 'action' && card.action === 'freeze') {
        const mine = game.liveScore(me).total;
        if (pr.options.includes(playerId) && mine > 0 && bustChance(me.line, game.deck) >= 0.3) {
          return { type: 'give', targetId: playerId };
        }
        // Freeze whoever banks the least, preferring the leader.
        return { type: 'give', targetId: maxBy(others, (p) => p.total / 100 - game.liveScore(p).total).id };
      }
      if (card.kind === 'modifier') {
        return { type: 'give', targetId: maxBy(others, (p) => p.total + game.liveScore(p).total).id };
      }
      // Just One More / Flip Three / Flip Four: push the most fragile, most valuable line.
      return {
        type: 'give',
        targetId: maxBy(others, (p) => bustChance(p.line, game.deck) * (game.liveScore(p).total + 5) + p.total / 100).id,
      };
    }
    case 'steal': {
      const best = maxBy(pr.options, (ref) => utility(game, playerId, (lines) => moveCard(lines, ref, playerId)));
      return { type: 'steal', cardId: best.cardId };
    }
    case 'discard': {
      const best = maxBy(pr.options, (ref) => utility(game, playerId, (lines) => removeCard(lines, ref)));
      return { type: 'discard', cardId: best.cardId };
    }
    case 'swap': {
      let best: [CardRef, CardRef] | null = null;
      let bestU = -Infinity;
      for (const a of pr.options) {
        for (const b of pr.options) {
          if (a.ownerId >= b.ownerId) continue;
          const u = utility(game, playerId, (lines) => swapCards(lines, a, b));
          if (u > bestU) [bestU, best] = [u, [a, b]];
        }
      }
      return { type: 'swap', cardIds: [best![0].cardId, best![1].cardId] };
    }
    case 'flip7Bonus': {
      const leader = maxBy(pr.options.map((id) => game.player(id)), (p) => p.total);
      return { type: 'flip7Bonus', targetId: leader.total >= me.total - 15 ? leader.id : null };
    }
  }
}

function maxBy<T>(items: T[], f: (x: T) => number): T {
  let best = items[0];
  let bestV = -Infinity;
  for (const x of items) {
    const v = f(x);
    if (v > bestV) [bestV, best] = [v, x];
  }
  return best;
}

export function bustChance(line: Card[], deck: Card[]): number {
  if (!deck.length) return 0;
  const bad = deck.filter((c) => c.kind === 'number' && c.special !== 'unlucky7' && isBustLine([...line, c])).length;
  return bad / deck.length;
}

type Lines = Map<string, Card[]>;

function cloneLines(players: Player[]): Lines {
  return new Map(players.filter((p) => p.status !== 'busted').map((p) => [p.id, [...p.line]]));
}

function take(lines: Lines, ref: CardRef): Card {
  const line = lines.get(ref.ownerId)!;
  return line.splice(line.findIndex((c) => c.id === ref.cardId), 1)[0];
}

function give(lines: Lines, ownerId: string, card: Card) {
  if (card.kind === 'number' && card.special === 'unlucky7') lines.set(ownerId, []);
  lines.get(ownerId)!.push(card);
}

function moveCard(lines: Lines, ref: CardRef, to: string) {
  give(lines, to, take(lines, ref));
}

function removeCard(lines: Lines, ref: CardRef) {
  take(lines, ref);
}

function swapCards(lines: Lines, a: CardRef, b: CardRef) {
  const ca = take(lines, a);
  const cb = take(lines, b);
  give(lines, a.ownerId, cb);
  give(lines, b.ownerId, ca);
}

/** My projected round score minus half of everyone else's, after a hypothetical change. */
function utility(game: Game, me: string, change: (lines: Lines) => void): number {
  const lines = cloneLines(game.players);
  change(lines);
  let u = 0;
  for (const [id, line] of lines) {
    const value = isBustLine(line) ? 0 : scoreLine(line, { brutal: game.options.brutal }).total;
    u += id === me ? value : -0.5 * value;
  }
  return u;
}

/**
 * What happens when a human's turn timer runs out: stay (or hit when staying
 * is not allowed). Other choices (targets, steals...) are made by the bot.
 */
export function timeoutDecision(game: Game, playerId: string): Decision {
  const pr = game.prompt;
  if (pr?.kind === 'hitOrStay') return { type: pr.canStay ? 'stay' : 'hit' };
  return botDecision(game, playerId);
}
