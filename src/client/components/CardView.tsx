import type { Card } from '../../shared/cards';
import { actionName } from '../../shared/cards';

interface Props {
  card: Card;
  faceDown?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

const SPECIAL_TEXT = { zero: 'Score zero unless you Flip 7', unlucky7: 'Discard all other cards', lucky13: 'You may have one other 13' };

export function CardView({ card, faceDown, selectable, selected, onClick }: Props) {
  const cls = ['card', `card-${card.kind}`];
  if (selectable) cls.push('selectable');
  if (selected) cls.push('selected');

  if (faceDown) {
    return <div className="card card-back" />;
  }

  const handle = selectable ? onClick : undefined;

  if (card.kind === 'number') {
    if (card.special) cls.push('special', `special-${card.special}`);
    const style = { '--hue': hue(card.value) } as React.CSSProperties;
    return (
      <div className={cls.join(' ')} style={style} onClick={handle} title={card.special ? SPECIAL_TEXT[card.special] : undefined}>
        <span className="corner">{card.value}</span>
        <span className="big">{card.value}</span>
        {card.special && <span className="label">{card.special === 'zero' ? 'ZERO' : card.special === 'unlucky7' ? 'UNLUCKY' : 'LUCKY'}</span>}
      </div>
    );
  }
  if (card.kind === 'modifier') {
    return (
      <div className={cls.join(' ')} onClick={handle} title="Modifier">
        <span className="big">{card.op === 'half' ? '÷2' : `-${card.amount}`}</span>
      </div>
    );
  }
  cls.push(`action-${card.action}`);
  return (
    <div className={cls.join(' ')} onClick={handle}>
      <span className="label">{actionName(card.action)}</span>
    </div>
  );
}

function hue(value: number) {
  return String((value * 29 + 200) % 360);
}
