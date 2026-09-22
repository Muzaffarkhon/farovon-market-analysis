import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../../api/client';
import type { SurveyDraft } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import { Select } from '../../design/Select';
import { Skeleton } from '../../design/Skeleton';
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY, DEFAULT_PAY_PERIOD } from '../../domain/currency';
import { companyFilled, normName, recordProgress } from '../../domain/progress';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import { usePeriodId } from '../shell/usePeriodId';
import { CompanyForm } from './CompanyForm';
import { CompanyPicker } from './CompanyPicker';
import { GroupSpreadDialog } from './GroupSpreadDialog';
import { NoComparisonButton } from './NoComparisonButton';
import { useSheetActions } from './useSheetActions';
import { useUnitData } from './useUnitData';
import s from './Survey.module.css';

function emptyDraft(company: string, posOur: string, cur: string): SurveyDraft {
  return {
    company, posOur, payFrom: '', payTo: '', cur, payPer: DEFAULT_PAY_PERIOD,
    bonHas: '', bonuses: [], benefits: [], extra: '', schedule: '', source: '', trust: '', note: ''
  };
}

export function SheetScreen() {
  const { unit = '', position = '' } = useParams();
  const decodedUnit = decodeURIComponent(unit);
  const decodedPos = decodeURIComponent(position);
  useScreenTitle(decodedPos);
  const periodId = usePeriodId();
  const session = useSessionData();
  const data = useUnitData(decodedUnit, periodId);
  const actions = useSheetActions({
    unit: decodedUnit, periodId, groupKey: data.groupKey, groupUnits: data.groupUnits
  });

  const selected = useMemo(() => data.selections[decodedPos] ?? [], [data.selections, decodedPos]);
  const marked = data.noComparison.has(decodedPos);
  const existing = useMemo(
    () => data.drafts.filter(d => normName(d.posOur) === normName(decodedPos)),
    [data.drafts, decodedPos]
  );

  const [active, setActive] = useState('');
  const [draft, setDraft] = useState<SurveyDraft | null>(null);
  const [cur, setCur] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>();
  const [spreadAsk, setSpreadAsk] = useState(false);
  const [spreadDecided, setSpreadDecided] = useState<boolean | null>(null);

  // Валюта выбирается один раз в шапке листа и применяется ко всем компаниям
  // этой должности. От других должностей не наследуется (ТЗ 3.2).
  useEffect(() => {
    if (cur) return;
    setCur(existing.find(e => e.cur)?.cur || DEFAULT_CURRENCY);
  }, [existing, cur]);

  // Первая компания открывается сама; после добавления новой — переключаемся на неё.
  useEffect(() => {
    if (active && selected.some(c => normName(c) === normName(active))) return;
    setActive(selected[0] ?? '');
  }, [selected, active]);

  // Черновик пересобирается при смене компании и при обновлении данных с
  // сервера. Намеренно НЕ зависит от cur: смена валюты в шапке не должна
  // стирать то, что человек уже набрал в форме.
  useEffect(() => {
    if (!active) { setDraft(null); return; }
    const found = existing.find(e => normName(e.company) === normName(active));
    setDraft(found ? { ...found } : emptyDraft(active, decodedPos, DEFAULT_CURRENCY));
    setServerFields(undefined);
  }, [active, existing, decodedPos]);

  if (data.isLoading) return <Skeleton lines={8} />;
  if (data.error) return <p className={s.empty}>{data.error instanceof ApiError ? data.error.message : 'Не удалось загрузить данные'}</p>;

  const needAsk = data.groupUnits.length >= 2 && spreadDecided === null;

  async function persist(spread: boolean) {
    if (!draft) return;
    setSaving(true);
    setServerFields(undefined);
    try {
      await actions.saveCompany({ ...draft, cur }, spread);
    } catch (e) {
      if (e instanceof ApiError) {
        setServerFields(e.fields);
        // Текст сервера показываем как есть — он точнее общей фразы.
        if (!e.fields) setServerFields({ payFrom: e.message });
      }
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (needAsk) { setSpreadAsk(true); return; }
    void persist(spreadDecided !== false);
  }

  async function toggleCompany(name: string, checked: boolean) {
    setBusy(true);
    try {
      const next = checked
        ? [...selected, name]
        : selected.filter(c => normName(c) !== normName(name));
      await actions.setCompanies(decodedPos, next);
      if (checked) setActive(name);
    } catch { /* тост показал useSheetActions */ } finally { setBusy(false); }
  }

  async function addNew(name: string) {
    setBusy(true);
    try {
      await actions.addCompanyToDictionary(name);
      await actions.setCompanies(decodedPos, [...selected, name]);
      setActive(name);
    } catch { /* тост показал useSheetActions */ } finally { setBusy(false); }
  }

  const poolCompanies = Array.from(new Set(data.drafts.map(d => d.company).filter(Boolean)));

  return (
    <div>
      <div className={s.sheetHead}>
        <Select
          className={s.cur} label="Валюта" options={CURRENCY_OPTIONS} value={cur}
          onChange={e => setCur(e.target.value)}
        />
        <div className={s.spacer} />
        {selected.length === 0 && (
          <NoComparisonButton
            marked={marked} busy={busy}
            onMark={() => { setBusy(true); void actions.setNoComparison(decodedPos).finally(() => setBusy(false)); }}
            onClear={() => { setBusy(true); void actions.clearNoComparison(decodedPos).finally(() => setBusy(false)); }}
          />
        )}
        <Button onClick={() => setPickerOpen(true)}>Добавить компанию</Button>
      </div>

      {selected.length === 0 ? (
        <p className={s.empty}>
          {marked
            ? 'По этой должности сравнивать не с кем — решение записано. Можно передумать и добавить компанию.'
            : 'Компании ещё не выбраны. Нажмите «Добавить компанию» или отметьте, что сравнивать не с кем.'}
        </p>
      ) : (
        <div className={s.sheet}>
          <div className={s.companyStrip}>
            {selected.map(c => {
              const rec = existing.find(e => normName(e.company) === normName(c));
              const p = rec ? recordProgress(rec) : { done: 0, total: 9 };
              const full = rec ? companyFilled(rec) : false;
              return (
                <button
                  key={c} type="button"
                  className={[s.companyBtn, normName(c) === normName(active) ? s.selected : ''].join(' ')}
                  onClick={() => setActive(c)}
                >
                  <span>{c}</span>
                  <Badge tone={full ? 'ok' : 'neutral'}>{p.done} из {p.total}</Badge>
                </button>
              );
            })}
          </div>
          {draft && (
            <CompanyForm
              draft={draft} refs={session.ref} benefits={session.benefits}
              saving={saving} serverFields={serverFields}
              onChange={setDraft} onSave={save}
            />
          )}
        </div>
      )}

      <CompanyPicker
        open={pickerOpen} onClose={() => setPickerOpen(false)}
        selected={selected} poolCompanies={poolCompanies} busy={busy}
        onToggle={(name, checked) => void toggleCompany(name, checked)}
        onAddNew={name => void addNew(name)}
      />
      <GroupSpreadDialog
        open={spreadAsk} units={data.groupUnits}
        onClose={() => setSpreadAsk(false)}
        onOnlyHere={() => { setSpreadDecided(false); setSpreadAsk(false); void persist(false); }}
        onSpread={() => { setSpreadDecided(true); setSpreadAsk(false); void persist(true); }}
      />
    </div>
  );
}
