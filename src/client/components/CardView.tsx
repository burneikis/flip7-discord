import type { CSSProperties } from 'react';
import type { ActionKind, Card } from '../../shared/cards';
import { actionName, modifierLabel } from '../../shared/cards';

interface Props {
  card: Card;
  faceDown?: boolean;
  selectable?: boolean;
  selected?: boolean;
  /** Extra classes (e.g. bust highlighting). */
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

const SPECIAL_TEXT = { zero: 'Score zero unless you Flip 7', unlucky7: 'Discard all other cards', lucky13: 'You may have one other 13' };

const ACTION_HELP: Record<ActionKind, string> = {
  freeze: 'Freeze: the target banks their points and is out of the round',
  flipThree: 'Flip Three: the target flips three cards (any kind)',
  secondChance: 'Second Chance: cancels one bust',
  justOneMore: 'Just One More: take one card, then stay',
  swap: 'Swap two cards between players',
  steal: 'Steal a card from another player',
  discard: 'Discard any card on the table',
  flipFour: 'Flip Four: the target flips four cards (any kind)',
};

export function CardView({ card, faceDown, selectable, selected, className, style, onClick }: Props) {
  const cls = ['card', `card-${card.kind}`];
  if (selectable) cls.push('selectable');
  if (selected) cls.push('selected');
  if (className) cls.push(className);

  if (faceDown) {
    return <div className={['card', 'card-back', className].filter(Boolean).join(' ')} style={style} />;
  }

  const handle = selectable ? onClick : undefined;

  if (card.kind === 'number') {
    if (card.special) cls.push('special', `special-${card.special}`);
    const st = { ...style, '--hue': hue(card.value) } as CSSProperties;
    return (
      <div className={cls.join(' ')} style={st} onClick={handle} title={card.special ? SPECIAL_TEXT[card.special] : undefined}>
        <span className="corner">{card.value}</span>
        <span className="big">{card.value}</span>
        {card.special && <span className="label">{card.special === 'zero' ? 'ZERO' : card.special === 'unlucky7' ? 'UNLUCKY' : 'LUCKY'}</span>}
      </div>
    );
  }
  if (card.kind === 'modifier') {
    return (
      <div className={cls.join(' ')} style={style} onClick={handle} title="Modifier">
        <span className="corner">{modifierLabel(card)}</span>
        <span className="big">{modifierLabel(card)}</span>
      </div>
    );
  }
  cls.push(`action-${card.action}`);
  return (
    <div className={cls.join(' ')} style={style} onClick={handle} title={ACTION_HELP[card.action]}>
      <span className="corner">{ACTION_GLYPH[card.action]}</span>
      <ActionArt action={card.action} />
      <span className="label">{actionName(card.action)}</span>
    </div>
  );
}

const ACTION_GLYPH: Record<ActionKind, string> = {
  freeze: '*',
  flipThree: '3',
  secondChance: '2',
  justOneMore: '+1',
  swap: '<>',
  steal: '!',
  discard: 'x',
  flipFour: '4',
};

function ActionArt({ action }: { action: ActionKind }) {
  if (action === 'freeze') return <Snowflake className="art" />;
  if (action === 'flipThree') return <span className="art big">3</span>;
  if (action === 'flipFour') return <span className="art big">4</span>;
  if (action === 'secondChance') return <span className="art big">2nd</span>;
  if (action === 'justOneMore') return <span className="art big">+1</span>;
  return null;
}

export function Snowflake({ className }: { className?: string }) {
  const arm = 'M0 0 V-10 M0 -6 L-3 -9 M0 -6 L3 -9';
  return (
    <svg className={className} viewBox="-12 -12 24 24" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none">
        {[0, 60, 120, 180, 240, 300].map((r) => (
          <path key={r} d={arm} transform={`rotate(${r})`} />
        ))}
      </g>
    </svg>
  );
}

function hue(value: number) {
  return String((value * 29 + 200) % 360);
}
