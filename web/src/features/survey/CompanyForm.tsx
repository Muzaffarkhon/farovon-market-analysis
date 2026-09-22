import { useEffect, useMemo, useState } from 'react';
import type { BenefitGroup, Ref, SurveyDraft } from '../../api/contract';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import { Textarea } from '../../design/Textarea';
import { CURRENCIES, PAY_PERIODS, PAY_PERIOD_OPTIONS } from '../../domain/currency';
import { validateSurveyItem } from '../../domain/validation';
import { BenefitsPicker } from './BenefitsPicker';
import { BonusesEditor } from './BonusesEditor';
import { FormBlock } from './FormBlock';
import s from './Survey.module.css';

export type BlockKey = 'pay' | 'schedule' | 'bonuses' | 'benefits' | 'source' | 'note';

const BLOCKS: { key: BlockKey; title: string }[] = [
  { key: 'pay', title: 'Оклад' },
  { key: 'schedule', title: 'График работы' },
  { key: 'bonuses', title: 'Премии и бонусы' },
  { key: 'benefits', title: 'Льготы и соцпакет' },
  { key: 'source', title: 'Откуда данные' },
  { key: 'note', title: 'Комментарий' }
];

/**
 * Блоки, которые ведут человека по анкете. Льготы и комментарий из цепочки
 * исключены сознательно: они необязательные и «заполненными» не становятся,
 * поэтому автораскрытие застревало бы на них и до обязательного «Откуда
 * данные» человек сам бы не добрался.
 */
const CHAIN: BlockKey[] = ['pay', 'schedule', 'bonuses', 'source'];

/** Поля, которые правит блок, — по ним раскрывается блок с первой ошибкой. */
const BLOCK_FIELDS: Record<BlockKey, string[]> = {
  pay: ['payFrom', 'payTo', 'payPer', 'cur'],
  schedule: ['schedule'],
  bonuses: ['bonHas'],
  benefits: [],
  source: ['source', 'trust'],
  note: []
};

function blockFilled(key: BlockKey, d: SurveyDraft): boolean {
  switch (key) {
    case 'pay': return !!(d.payFrom || d.payTo);
    case 'schedule': return !!d.schedule;
    case 'bonuses': return d.bonHas === 'нет' || d.bonHas === 'не знаю' || d.bonuses.some(b => !!b.size);
    case 'benefits': return d.benefits.length > 0 || !!d.extra;
    case 'source': return !!(d.source && d.trust);
    case 'note': return !!d.note;
  }
}

export function CompanyForm({ draft, refs, benefits, saving, serverFields, onChange, onSave }: {
  draft: SurveyDraft;
  refs: Ref;
  benefits: BenefitGroup[];
  saving: boolean;
  serverFields?: Record<string, string>;
  onChange: (next: SurveyDraft) => void;
  onSave: () => void;
}) {
  const [manuallyClosed, setManuallyClosed] = useState<Set<BlockKey>>(new Set());
  const [open, setOpen] = useState<Set<BlockKey>>(() => {
    const first = CHAIN.find(k => !blockFilled(k, draft));
    return new Set(first ? [first] : []);
  });
  const [localFields, setLocalFields] = useState<Record<string, string>>({});

  const fieldErrors = useMemo(() => ({ ...localFields, ...(serverFields ?? {}) }), [localFields, serverFields]);

  // Ошибка сервера может прийти по полю в свёрнутом блоке — тогда человек
  // видит только тост и не понимает, что править. Раскрываем такой блок.
  useEffect(() => {
    const bad = Object.keys(serverFields ?? {})[0];
    if (!bad) return;
    const block = BLOCKS.find(b => BLOCK_FIELDS[b.key].includes(bad));
    if (block) setOpen(prev => (prev.has(block.key) ? prev : new Set(prev).add(block.key)));
  }, [serverFields]);

  // Следующий блок раскрывается сам, когда заполнен текущий. Ручное закрытие
  // уважается — автораскрытие его не переоткрывает (ТЗ 3.2).
  useEffect(() => {
    const next = CHAIN.find(k => !blockFilled(k, draft) && !manuallyClosed.has(k));
    if (!next) return;
    setOpen(prev => (prev.has(next) ? prev : new Set(prev).add(next)));
  }, [draft, manuallyClosed]);

  function toggle(key: BlockKey) {
    setOpen(prev => {
      const n = new Set(prev);
      if (n.has(key)) {
        n.delete(key);
        setManuallyClosed(c => new Set(c).add(key));
      } else {
        n.add(key);
        setManuallyClosed(c => { const m = new Set(c); m.delete(key); return m; });
      }
      return n;
    });
  }

  const set = (patch: Partial<SurveyDraft>) => onChange({ ...draft, ...patch });

  function submit() {
    const v = validateSurveyItem(draft, { currencies: CURRENCIES, payPeriods: PAY_PERIODS });
    if (!v.ok) {
      setLocalFields(v.fields);
      // Раскрываем блок, где первая ошибка, иначе она остаётся под свёрнутым заголовком.
      const bad = Object.keys(v.fields)[0];
      const block = BLOCKS.find(b => BLOCK_FIELDS[b.key].includes(bad));
      if (block) setOpen(prev => new Set(prev).add(block.key));
      return;
    }
    setLocalFields({});
    onSave();
  }

  return (
    <div className={s.form}>
      {BLOCKS.map(b => (
        <FormBlock key={b.key} title={b.title} open={open.has(b.key)} filled={blockFilled(b.key, draft)} onToggle={() => toggle(b.key)}>
          {b.key === 'pay' && (
            <>
              <div className={s.row}>
                <Input label="Оклад от" inputMode="decimal" value={draft.payFrom} error={fieldErrors.payFrom} onChange={e => set({ payFrom: e.target.value })} />
                <Input label="Оклад до" inputMode="decimal" value={draft.payTo} error={fieldErrors.payTo} onChange={e => set({ payTo: e.target.value })} />
              </div>
              <Select label="Период выплаты" options={PAY_PERIOD_OPTIONS} value={draft.payPer} error={fieldErrors.payPer} onChange={e => set({ payPer: e.target.value })} />
            </>
          )}
          {b.key === 'schedule' && (
            <Select
              label="График работы" placeholder="— выберите —" value={draft.schedule} error={fieldErrors.schedule}
              options={refs.schedules.map(v => ({ value: v, label: v }))}
              onChange={e => set({ schedule: e.target.value })}
            />
          )}
          {b.key === 'bonuses' && (
            <>
              <Select
                label="Есть ли премии" placeholder="— выберите —" value={draft.bonHas} error={fieldErrors.bonHas}
                options={[{ value: 'да', label: 'да' }, { value: 'нет', label: 'нет' }, { value: 'не знаю', label: 'не знаю' }]}
                onChange={e => set({ bonHas: e.target.value, bonuses: e.target.value === 'да' && !draft.bonuses.length ? [{ type: '', size: '', per: '' }] : draft.bonuses })}
              />
              {draft.bonHas === 'да' && <BonusesEditor bonuses={draft.bonuses} refs={refs} onChange={bonuses => set({ bonuses })} />}
            </>
          )}
          {b.key === 'benefits' && (
            <>
              <BenefitsPicker groups={benefits} selected={draft.benefits} onChange={v => set({ benefits: v })} />
              <Input label="Прочие выплаты" value={draft.extra} onChange={e => set({ extra: e.target.value })} />
            </>
          )}
          {b.key === 'source' && (
            <div className={s.row}>
              <Select
                label="Источник" placeholder="— выберите —" value={draft.source} error={fieldErrors.source}
                options={refs.sources.map(v => ({ value: v, label: v }))}
                onChange={e => set({ source: e.target.value })}
              />
              <Select
                label="Надёжность" placeholder="— выберите —" value={draft.trust} error={fieldErrors.trust}
                options={refs.trust.map(v => ({ value: v, label: v }))}
                onChange={e => set({ trust: e.target.value })}
              />
            </div>
          )}
          {b.key === 'note' && (
            <Textarea label="Комментарий" value={draft.note} onChange={e => set({ note: e.target.value })} />
          )}
        </FormBlock>
      ))}
      {/* Счётчик заполненности показан бейджем в списке компаний — второй раз
          рядом с кнопкой его не повторяем (ТЗ 10.1: одна цифра — одно место). */}
      <div className={s.actions}>
        <Button onClick={submit} loading={saving}>Сохранить</Button>
      </div>
    </div>
  );
}
