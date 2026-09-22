import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { surveyApi } from '../../api/survey';
import type { Survey, SurveyDraft } from '../../api/contract';
import { positionState, unitProgress, type PositionState } from '../../domain/progress';
import { useSessionData } from '../auth/useSession';

/** Запись с сервера → черновик формы: числа становятся строками, льготы — массивом. */
export function surveyToDraft(s: Survey): SurveyDraft {
  return {
    id: s.id,
    company: s.company, posOur: s.posOur, posTheir: s.posTheir, grade: s.grade,
    payFrom: s.payFrom ? String(s.payFrom) : '', payTo: s.payTo ? String(s.payTo) : '',
    cur: s.cur, payPer: s.payPer,
    bonHas: s.bonHas === 'не знаю' && !s.bonSize && !s.bonType ? '' : s.bonHas,
    bonuses: Array.isArray(s.bonuses) ? s.bonuses : [],
    schedule: s.schedule,
    benefits: Array.isArray(s.benefits) ? s.benefits : [],
    extra: '', // сервер не отдаёт extra в mapSurveyRow; правка не должна его затирать вслепую
    source: s.source, trust: s.trust, note: s.note
  };
}

export type UnitData = {
  isLoading: boolean;
  error: unknown;
  positions: string[];
  drafts: SurveyDraft[];
  selections: Record<string, string[]>;
  noComparison: Set<string>;
  progress: { decided: number; total: number };
  groupKey: string;
  groupUnits: string[];
  stateOf: (position: string) => PositionState;
};

/**
 * Единственный источник данных для экрана подразделения и листа заполнения.
 * Штатка приходит в сессии, анкеты и выбор компаний — двумя запросами.
 */
export function useUnitData(unit: string, periodId: number | null): UnitData {
  const session = useSessionData();
  const q1 = useQuery({
    queryKey: ['survey', unit, periodId],
    queryFn: () => surveyApi.forPeriod(unit, periodId),
    enabled: !!unit
  });
  const q2 = useQuery({
    queryKey: ['selections', unit, periodId],
    queryFn: () => surveyApi.selections(unit, periodId),
    enabled: !!unit
  });

  const div = session.allUnits.find(d => d.unit === unit);
  const groupKey = div?.group_key ?? '';
  const groupUnits = useMemo(
    () => (groupKey ? session.allUnits.filter(d => d.group_key === groupKey).map(d => d.unit) : []),
    [session.allUnits, groupKey]
  );

  // Всё, что уходит в зависимости эффектов на экранах, обязано быть
  // стабильным между рендерами: иначе .map()/new Set() на каждом рендере
  // запускают эффекты по кругу и лист перерисовывается бесконечно.
  const drafts = useMemo(() => (q1.data?.surveys ?? []).map(surveyToDraft), [q1.data]);
  const selections = useMemo(() => q2.data?.selections ?? {}, [q2.data]);
  const noComparison = useMemo(() => new Set(q2.data?.noComparison ?? []), [q2.data]);
  const positions = useMemo(() => session.positionsByUnit[unit] ?? [], [session.positionsByUnit, unit]);

  const stateOf = (position: string): PositionState => positionState({
    selected: selections[position] ?? [],
    surveys: drafts.filter(d => d.posOur === position),
    noComparison: noComparison.has(position)
  });

  return {
    isLoading: q1.isLoading || q2.isLoading,
    error: q1.error ?? q2.error,
    positions,
    drafts,
    selections,
    noComparison,
    // Серверный прогресс — источник истины (он видит всю штатку), клиентский
    // пересчёт нужен, пока запрос не вернулся.
    progress: q1.data?.progress ?? unitProgress(positions, stateOf),
    groupKey,
    groupUnits,
    stateOf
  };
}
