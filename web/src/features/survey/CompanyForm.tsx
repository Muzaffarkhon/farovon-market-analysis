import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { BenefitGroup, Ref, SurveyDraft } from '../../api/contract';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import { Textarea } from '../../design/Textarea';
import { CURRENCIES, PAY_PERIODS, PAY_PERIOD_OPTIONS } from '../../domain/currency';
import { bonusesComplete, validateSurveyItem } from '../../domain/validation';
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
 * Блоки, которые ведут человека по анкете при автораскрытии. Льготы и
 * комментарий из цепочки исключены сознательно: они необязательные и
 * «заполненными» не становятся, поэтому автораскрытие застревало бы на них и
 * до обязательного «Откуда данные» человек сам бы не добрался. По Enter
 * пройти можно по всем блокам подряд — см. BLOCKS.
 */
const CHAIN: BlockKey[] = ['pay', 'schedule', 'bonuses', 'source'];

/** Поля, которые правит блок, — по ним ищем, куда прокрутить при ошибке. */
const BLOCK_FIELDS: Record<BlockKey, string[]> = {
  pay: ['payFrom', 'payTo', 'payPer', 'cur'],
  schedule: ['schedule'],
  bonuses: ['bonHas', 'bonuses'],
  benefits: [],
  source: ['source', 'trust'],
  note: []
};

function blockFilled(key: BlockKey, d: SurveyDraft): boolean {
  switch (key) {
    case 'pay': return !!(d.payFrom || d.payTo);
    case 'schedule': return !!d.schedule;
    case 'bonuses': return !!d.bonHas && bonusesComplete(d.bonHas, d.bonuses);
    case 'benefits': return d.benefits.length > 0 || !!d.extra;
    case 'source': return !!(d.source && d.trust);
    case 'note': return !!d.note;
  }
}

function blockOf(field: string): BlockKey | undefined {
  return BLOCKS.find(b => BLOCK_FIELDS[b.key].includes(field))?.key;
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Куда увести человека после перерисовки: к блоку с ошибкой или к следующему.
  const [goTo, setGoTo] = useState<{ key: BlockKey; field?: string } | null>(null);

  const sections = useRef<Partial<Record<BlockKey, HTMLElement | null>>>({});
  // Значения полей на момент показа ошибки: как только человек правит поле,
  // ошибка по нему снимается, а не висит до следующего сохранения.
  const errorBasis = useRef<Record<string, string>>({});

  // Списки (виды премии, льготы) сравниваем по содержимому: String() свёл бы
  // их к «[object Object]», и правка строки премии не снимала бы ошибку.
  const valueOf = useCallback((field: string) => {
    const v = (draft as unknown as Record<string, unknown>)[field];
    if (v == null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }, [draft]);

  const showErrors = useCallback((fields: Record<string, string>) => {
    setFieldErrors(prev => {
      const merged = { ...prev, ...fields };
      const basis: Record<string, string> = {};
      for (const k of Object.keys(merged)) basis[k] = valueOf(k);
      errorBasis.current = basis;
      return merged;
    });
  }, [valueOf]);

  useEffect(() => {
    setFieldErrors(prev => {
      const keys = Object.keys(prev);
      if (!keys.length) return prev;
      const kept: Record<string, string> = {};
      for (const k of keys) if (valueOf(k) === errorBasis.current[k]) kept[k] = prev[k];
      return Object.keys(kept).length === keys.length ? prev : kept;
    });
  }, [valueOf]);

  const set = (patch: Partial<SurveyDraft>) => onChange({ ...draft, ...patch });

  /** Показать блок целиком и поставить курсор в нужное (или первое) поле. */
  useEffect(() => {
    if (!goTo) return;
    const el = sections.current[goTo.key];
    setGoTo(null);
    if (!el) return;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    const target = goTo.field
      ? el.querySelector<HTMLElement>(`[aria-invalid="true"], #${CSS.escape(goTo.field)}`)
      : null;
    const first = target ?? el.querySelector<HTMLElement>('input:not([type="checkbox"]), select, textarea');
    first?.focus({ preventScroll: true });
  }, [goTo]);

  // Ошибка сервера может прийти по полю в свёрнутом блоке — тогда человек
  // видит только тост и не понимает, что править. Раскрываем и прокручиваем.
  useEffect(() => {
    if (!serverFields || !Object.keys(serverFields).length) return;
    showErrors(serverFields);
    const bad = Object.keys(serverFields)[0];
    const key = blockOf(bad);
    if (!key) return;
    setOpen(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
    setGoTo({ key, field: bad });
    // showErrors намеренно не в зависимостях: он меняется на каждую правку
    // черновика, и ошибки сервера показывались бы заново после их снятия.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /** Ошибки только по полям этого блока. */
  const errorsIn = useCallback((key: BlockKey): Record<string, string> => {
    const v = validateSurveyItem(draft, { currencies: CURRENCIES, payPeriods: PAY_PERIODS });
    if (v.ok) return {};
    const own: Record<string, string> = {};
    for (const f of BLOCK_FIELDS[key]) if (v.fields[f]) own[f] = v.fields[f];
    return own;
  }, [draft]);

  /**
   * Enter внутри блока = «с этим закончил»: блок проверяется, сворачивается,
   * и мы спускаемся к следующему. Так ошибка видна сразу, а не всплывает
   * наверху после сохранения, когда до неё уже надо прокручивать.
   */
  const advance = useCallback((from: BlockKey) => {
    const own = errorsIn(from);
    if (Object.keys(own).length) {
      showErrors(own);
      setGoTo({ key: from, field: Object.keys(own)[0] });
      return;
    }
    setFieldErrors(prev => {
      const next = { ...prev };
      for (const f of BLOCK_FIELDS[from]) delete next[f];
      return next;
    });

    const idx = BLOCKS.findIndex(b => b.key === from);
    const next = BLOCKS[idx + 1];
    setOpen(prev => {
      const n = new Set(prev);
      n.delete(from);
      if (next) n.add(next.key);
      return n;
    });
    // Пройденный блок помечаем закрытым вручную, иначе автораскрытие тут же
    // вернёт его обратно, если он необязательный и остался пустым.
    setManuallyClosed(c => {
      const m = new Set(c).add(from);
      if (next) m.delete(next.key);
      return m;
    });
    if (next) setGoTo({ key: next.key });
  }, [errorsIn, showErrors]);

  function onBlockKeyDown(e: KeyboardEvent<HTMLDivElement>, key: BlockKey) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = e.target as HTMLElement;
    const tag = el.tagName;
    // В многострочном поле Enter — перенос строки; на кнопке и чипе — нажатие.
    if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (tag === 'INPUT' && (el as HTMLInputElement).type === 'checkbox') return;
    e.preventDefault();
    advance(key);
  }

  function submit() {
    const v = validateSurveyItem(draft, { currencies: CURRENCIES, payPeriods: PAY_PERIODS });
    if (!v.ok) {
      showErrors(v.fields);
      const bad = Object.keys(v.fields)[0];
      const key = blockOf(bad);
      if (key) {
        setOpen(prev => new Set(prev).add(key));
        setManuallyClosed(c => { const m = new Set(c); m.delete(key); return m; });
        // Прокручиваем к ошибке: раньше она оставалась выше экрана и человек
        // не понимал, почему не сохраняется.
        setGoTo({ key, field: bad });
      }
      return;
    }
    setFieldErrors({});
    onSave();
  }

  return (
    <div className={s.form}>
      {BLOCKS.map(b => (
        <FormBlock
          key={b.key}
          title={b.title}
          open={open.has(b.key)}
          filled={blockFilled(b.key, draft)}
          hasError={BLOCK_FIELDS[b.key].some(f => fieldErrors[f])}
          onToggle={() => toggle(b.key)}
          onKeyDown={e => onBlockKeyDown(e, b.key)}
          innerRef={el => { sections.current[b.key] = el; }}
        >
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
              {draft.bonHas === 'да' && (
                <BonusesEditor
                  bonuses={draft.bonuses} refs={refs}
                  error={fieldErrors.bonuses}
                  onChange={bonuses => set({ bonuses })}
                />
              )}
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
            <Textarea label="Комментарий" value={draft.note} onChange={e => set({ note: e.target.value })} hint="Enter — перенос строки" />
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
