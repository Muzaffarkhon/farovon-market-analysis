import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { surveyApi } from '../../api/survey';
import { ApiError } from '../../api/client';
import type { SurveyDraft } from '../../api/contract';
import { useToast } from '../../design/Toast';

type Args = { unit: string; periodId: number | null; groupKey: string; groupUnits: string[] };

/**
 * Действия листа заполнения. Все они меняют данные подразделения (а при
 * смежной группе — и соседних площадок), поэтому после каждого сбрасываем
 * кеш по всем затронутым подразделениям.
 */
export function useSheetActions({ unit, periodId, groupKey, groupUnits }: Args) {
  const qc = useQueryClient();
  const toast = useToast();

  const invalidate = useCallback(async () => {
    const units = groupUnits.length ? groupUnits : [unit];
    await Promise.all(units.flatMap(u => [
      qc.invalidateQueries({ queryKey: ['survey', u, periodId] }),
      qc.invalidateQueries({ queryKey: ['selections', u, periodId] })
    ]));
  }, [qc, unit, periodId, groupUnits]);

  const fail = useCallback((e: unknown, fallback: string) => {
    toast.show(e instanceof ApiError ? e.message : fallback, 'error');
  }, [toast]);

  /** Сохранение карточки компании. spreadToGroup=false — только в текущее подразделение. */
  const saveCompany = useCallback(async (draft: SurveyDraft, spreadToGroup: boolean) => {
    await surveyApi.saveDetails({
      unit,
      upsert: [draft],
      groupKey: spreadToGroup ? groupKey : '',
      periodId
    });
    await invalidate();
    toast.show('Сохранено', 'ok');
  }, [unit, groupKey, periodId, invalidate, toast]);

  /** Полный список выбранных компаний по должности — сервер сам вычисляет разницу. */
  const setCompanies = useCallback(async (posOur: string, companies: string[]) => {
    try {
      await surveyApi.saveSelection({ unit, posOur, companies, groupKey, periodId });
      await invalidate();
    } catch (e) {
      fail(e, 'Не удалось сохранить выбор компаний');
      throw e;
    }
  }, [unit, groupKey, periodId, invalidate, fail]);

  const addCompanyToDictionary = useCallback(async (name: string) => {
    try {
      await surveyApi.addCompany(name, unit);
      await qc.invalidateQueries({ queryKey: ['session'] });
    } catch (e) {
      fail(e, 'Не удалось добавить компанию в справочник');
      throw e;
    }
  }, [unit, qc, fail]);

  const setNoComparison = useCallback(async (posOur: string) => {
    try {
      await surveyApi.setNoComparison({ unit, posOur, periodId, groupKey });
      await invalidate();
      toast.show('Отмечено: сравнивать не с кем', 'ok');
    } catch (e) {
      fail(e, 'Не удалось сохранить отметку');
    }
  }, [unit, periodId, groupKey, invalidate, toast, fail]);

  const clearNoComparison = useCallback(async (posOur: string) => {
    try {
      await surveyApi.clearNoComparison({ unit, posOur, periodId, groupKey });
      await invalidate();
      toast.show('Отметка снята', 'ok');
    } catch (e) {
      fail(e, 'Не удалось снять отметку');
    }
  }, [unit, periodId, groupKey, invalidate, toast, fail]);

  return { saveCompany, setCompanies, addCompanyToDictionary, setNoComparison, clearNoComparison };
}
