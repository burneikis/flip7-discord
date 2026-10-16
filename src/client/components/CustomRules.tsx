import { cardFromKey, cardLabel, type CardKey } from '../../shared/cards';
import { PRESET_RULES, RULE_LIMITS, RULE_TOGGLES, copyRules, numberCardCount, rulesProblem, type Rules } from '../../shared/rules';

const GROUPS: { title: string; keys: CardKey[]; wide?: boolean }[] = [
  { title: 'Numbers', keys: Array.from({ length: 14 }, (_, i) => `n${i}`) },
  { title: 'Special Numbers', keys: ['zero', 'unlucky7', 'lucky13'], wide: true },
  { title: 'Modifiers', keys: ['+2', '+4', '+6', '+8', '+10', 'x2', '-2', '-4', '-6', '-8', '-10', '/2'] },
  { title: 'Actions', keys: ['freeze', 'flipThree', 'secondChance', 'justOneMore', 'swap', 'steal', 'discard', 'flipFour'], wide: true },
];

/** '/2' rather than '÷2', which is hard to tell from '+2' at this size. */
const label = (key: CardKey) => (key === '/2' ? '/2' : cardLabel(cardFromKey(key, 0)).replace(/^the /, ''));

/** Lobby editor for the custom variant: card counts and rule switches. */
export function CustomRules({ rules, editable, onChange }: { rules: Rules; editable: boolean; onChange: (r: Rules) => void }) {
  const update = (change: (r: Rules) => void) => {
    const next = copyRules(rules);
    change(next);
    onChange(next);
  };
  const setCount = (key: CardKey, value: number) =>
    update((r) => {
      r.deck[key] = Math.min(RULE_LIMITS.maxPerCard, Math.max(0, Math.round(value) || 0));
    });
  const total = Object.values(rules.deck).reduce((a, b) => a + b, 0);
  const problem = rulesProblem(rules);
  const { flip7Count, flip7Bonus } = RULE_LIMITS;

  return (
    <div className="custom-rules">
      {editable && (
        <div className="row small">
          <span className="muted">Start from:</span>
          <button className="btn tiny" onClick={() => onChange(copyRules(PRESET_RULES.classic))}>
            Flip 7
          </button>
          <button className="btn tiny" onClick={() => onChange(copyRules(PRESET_RULES.vengeance))}>
            With a Vengeance
          </button>
        </div>
      )}

      {GROUPS.map((g) => (
        <fieldset key={g.title} className={`card-counts${g.wide ? ' wide' : ''}`}>
          <legend>{g.title}</legend>
          {g.keys.map((key) => (
            <label key={key} className={rules.deck[key] ? '' : 'muted'}>
              <span className="count-label">{label(key)}</span>
              <input
                type="number"
                min={0}
                max={RULE_LIMITS.maxPerCard}
                value={rules.deck[key] ?? 0}
                disabled={!editable}
                onChange={(e) => setCount(key, Number(e.target.value))}
              />
            </label>
          ))}
        </fieldset>
      ))}
      <div className={`small ${problem ? 'warn' : 'muted'}`}>
        {total} cards, {numberCardCount(rules.deck)} Numbers{problem ? ` - ${problem}` : ''}
      </div>

      {RULE_TOGGLES.map((t) => (
        <label key={t.key} className="check">
          <input
            type="checkbox"
            checked={rules[t.key]}
            disabled={!editable}
            onChange={(e) => update((r) => void (r[t.key] = e.target.checked))}
          />
          <span>
            {t.label}
            <span className="hint muted small">{t.hint}</span>
          </span>
        </label>
      ))}
      <label>
        Flip 7 needs
        <select value={rules.flip7Count} disabled={!editable} onChange={(e) => update((r) => void (r.flip7Count = Number(e.target.value)))}>
          {Array.from({ length: flip7Count.max - flip7Count.min + 1 }, (_, i) => flip7Count.min + i).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        unique Numbers, worth
        <input
          type="number"
          min={flip7Bonus.min}
          max={flip7Bonus.max}
          value={rules.flip7Bonus}
          disabled={!editable}
          onChange={(e) => update((r) => void (r.flip7Bonus = clamp(Number(e.target.value), flip7Bonus)))}
        />
        points
      </label>
    </div>
  );
}

function clamp(v: number, { min, max }: { min: number; max: number }) {
  return Math.min(max, Math.max(min, Math.round(v) || min));
}
