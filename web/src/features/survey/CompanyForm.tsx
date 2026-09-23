import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { BenefitGroup, Ref, SurveyDraft } from '../../api/contract';
import { Button } from '../../design/Button';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import { Textarea } from '../../design/Textarea';
import { CURRENCIES, PAY_PERIODS, PAY_PERIOD_OPTIONS } from '../../domain/currency';
import { scheduleLabel } from '../../domain/schedule';
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
 * С какого блока открывается карточка: первый незаполненный из обязательных.
 * Льготы и комментарий сюда не входят — они необязательные и «заполненными»
 * не становятся, карточка всегда открывалась бы на них. Дальше человек идёт
 * по Enter или открывает нужный блок заголовком.
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

/**
 * Галочка блока обязана означать ровно то же, что пункты счётчика в
 * `domain/progress.ts`: иначе бывают «все блоки зелёные, а 8 из 9» и человек
 * не понимает, чего от него хотят. Поэтому здесь «и», а не «или»:
 * вилка целиком, льготы отдельно от необязательных прочих выплат.
 */
function blockFilled(key: BlockKey, d: SurveyDraft): boolean {
  switch (key) {
    case 'pay': return !!(d.payFrom && d.payTo);
    case 'schedule': return !!d.schedule;
    case 'bonuses': return !!d.bonHas && bonusesComplete(d.bonHas, d.bonuses);
    case 'benefits': return d.benefits.length > 0;
    case 'source': return !!(d.source && d.trust);
    case 'note': return !!d.note;
  }
}

function blockOf(field: string): BlockKey | undefined {
  return BLOCKS.find(b => BLOCK_FIELDS[b.key].includes(field))?.key;
}

/** Поля блока в порядке обхода. Чипы и кнопки — не поля, Enter на них нажимает. */
function fieldsIn(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>('input:not([type="checkbox"]), select, textarea'));
}

/** Какое поле черновика правит контрол — по data-field (см. разметку ниже). */
const fieldOf = (el: HTMLElement): string => el.dataset.field ?? '';

export function CompanyForm({ draft, refs, benefits, saving, serverFields, onChange, onSave }: {
  draft: SurveyDraft;
  refs: Ref;
  benefits: BenefitGroup[];
  saving: boolean;
  serverFields?: Record<string, string>;
  onChange: (next: SurveyDraft) => void;
  onSave: () => void;
}) {
  // Открыт ровно один блок: так видно, где ты находишься, и открытие блока
  // выше само закрывает нижний — не приходится собирать «гармошку» руками.
  const [open, setOpen] = useState<BlockKey | null>(() => CHAIN.find(k => !blockFilled(k, draft)) ?? 'pay');
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
      ? el.querySelector<HTMLElement>(`[data-field="${CSS.escape(goTo.field)}"], [aria-invalid="true"]`)
      : null;
    const first = target ?? fieldsIn(el)[0];
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
    setOpen(key);
    setGoTo({ key, field: bad });
    // showErrors намеренно не в зависимостях: он меняется на каждую правку
    // черновика, и ошибки сервера показывались бы заново после их снятия.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFields]);

  function toggle(key: BlockKey) {
    setOpen(prev => (prev === key ? null : key));
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
   * Блок пройден: проверяем его целиком, закрываем и открываем следующий.
   * Вызывается, когда Enter нажат на последнем поле блока.
   */
  const leaveBlock = useCallback((from: BlockKey) => {
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

    const next = BLOCKS[BLOCKS.findIndex(b => b.key === from) + 1];
    setOpen(next ? next.key : null);
    if (next) setGoTo({ key: next.key });
  }, [errorsIn, showErrors]);

  /**
   * Enter ведёт по полям блока сверху вниз, и только с последнего поля
   * закрывает блок и открывает следующий. Так человек успевает заполнить
   * «Оклад до» и период выплаты, а не выскакивает из блока на первом же поле.
   */
  function onBlockKeyDown(e: KeyboardEvent<HTMLDivElement>, key: BlockKey) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = e.target as HTMLElement;
    const tag = el.tagName;

    // Ctrl+Enter (Cmd+Enter) — сохранить, откуда угодно, включая комментарий.
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); submit(); return; }

    // В многострочном поле Enter — перенос строки; на кнопке и чипе — нажатие.
    if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (tag === 'INPUT' && (el as HTMLInputElement).type === 'checkbox') return;
    e.preventDefault();

    const body = sections.current[key];
    const controls = body ? fieldsIn(body) : [];
    const i = controls.indexOf(el);

    // Проверяем пройденные поля сразу, не дожидаясь конца блока: иначе «оклад
    // до меньше от» всплывал бы только на последнем поле, когда человек уже
    // ушёл мыслями дальше. Ошибка показывается прямо под полем, где она есть.
    if (i >= 0) {
      const own = errorsIn(key);
      const passed = controls.slice(0, i + 1).map(fieldOf).filter(f => own[f]);
      if (passed.length) {
        const bad: Record<string, string> = {};
        for (const f of passed) bad[f] = own[f];
        showErrors(bad);
        setGoTo({ key, field: passed[0] });
        return;
      }
    }

    if (i >= 0 && i < controls.length - 1) {
      controls[i + 1].focus();
      return;
    }
    leaveBlock(key);
  }

  function submit() {
    const v = validateSurveyItem(draft, { currencies: CURRENCIES, payPeriods: PAY_PERIODS });
    if (!v.ok) {
      showErrors(v.fields);
      const bad = Object.keys(v.fields)[0];
      const key = blockOf(bad);
      if (key) {
        // Раскрываем и прокручиваем к ошибке: раньше она оставалась выше
        // экрана, и человек не понимал, почему не сохраняется.
        setOpen(key);
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
          open={open === b.key}
          filled={blockFilled(b.key, draft)}
          hasError={BLOCK_FIELDS[b.key].some(f => fieldErrors[f])}
          onToggle={() => toggle(b.key)}
          onKeyDown={e => onBlockKeyDown(e, b.key)}
          innerRef={el => { sections.current[b.key] = el; }}
        >
          {b.key === 'pay' && (
            <>
              <div className={s.row}>
                <Input data-field="payFrom" label="Оклад от" inputMode="decimal" value={draft.payFrom} error={fieldErrors.payFrom} onChange={e => set({ payFrom: e.target.value })} />
                <Input data-field="payTo" label="Оклад до" inputMode="decimal" value={draft.payTo} error={fieldErrors.payTo} onChange={e => set({ payTo: e.target.value })} />
              </div>
              <Select data-field="payPer" label="Период выплаты" options={PAY_PERIOD_OPTIONS} value={draft.payPer} error={fieldErrors.payPer} onChange={e => set({ payPer: e.target.value })} />
            </>
          )}
          {b.key === 'schedule' && (
            <Select
              data-field="schedule"
              label="График работы" placeholder="— выберите —" value={draft.schedule} error={fieldErrors.schedule}
              options={refs.schedules.map(v => ({ value: v, label: scheduleLabel(v) }))}
              onChange={e => set({ schedule: e.target.value })}
            />
          )}
          {b.key === 'bonuses' && (
            <>
              <Select
                data-field="bonHas"
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
                data-field="source"
                label="Источник" placeholder="— выберите —" value={draft.source} error={fieldErrors.source}
                options={refs.sources.map(v => ({ value: v, label: v }))}
                onChange={e => set({ source: e.target.value })}
              />
              <Select
                data-field="trust"
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
