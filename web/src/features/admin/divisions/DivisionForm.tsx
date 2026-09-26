import { useMemo, useState } from 'react';
import type { AdjacentGroupSuggestion, Division, SaveDivisionPayload } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Sheet } from '../../../design/Sheet';
import { useSessionData } from '../../auth/useSession';
import s from '../Admin.module.css';

/**
 * dir_head/head назначают ответственных только по своей ветке — сервер
 * это и так проверяет (403 на чужое, на смену `dir`), но поля показываем
 * недоступными для них здесь же, чтобы не выдавать иллюзию возможности:
 * значение видно, но менять его может только admin/cb.
 */
export function DivisionForm({ division, suggestions, onClose, onSubmit, onApplyGroup, onMove, onToggleHidden, onDelete }: {
  division: Division;
  suggestions: AdjacentGroupSuggestion[];
  onClose: () => void;
  onSubmit: (p: SaveDivisionPayload) => void;
  onApplyGroup: (p: { key: string; units: string[] }) => void;
  /** Только на узком экране — на десктопе те же действия остаются в строке
      таблицы (DivisionsScreen.tsx, .tableWrapFill без .hideOnMobile), в
      .tableCompact для них нет места отдельной колонкой. */
  onMove?: () => void;
  onToggleHidden?: () => void;
  onDelete?: () => void;
}) {
  const { user } = useSessionData();
  const isAdmin = user.role === 'admin' || user.role === 'cb';

  const [dir, setDir] = useState(division.dir ?? '');
  const [head, setHead] = useState(division.head ?? '');
  const [resp, setResp] = useState(division.resp ?? '');
  const [hrbp, setHrbp] = useState(division.hrbp ?? '');
  const [note, setNote] = useState(division.note ?? '');
  const [region, setRegion] = useState(division.region ?? '');
  const [orgRole, setOrgRole] = useState(division.org_role ?? '');
  const [surveyTarget, setSurveyTarget] = useState(!!division.is_survey_target);
  const [group, setGroup] = useState(division.group_key ?? '');

  // Подсказка «похоже на смежную группу» — только если у площадки ещё нет
  // ручного ключа: сервер и так не предложит группу тому, у кого он уже есть.
  const suggestion = useMemo(
    () => (division.group_key ? null : suggestions.find(sg => sg.units.some(u => u.unit === division.unit)) ?? null),
    [suggestions, division.group_key, division.unit]
  );
  const [checkedMates, setCheckedMates] = useState<Set<string>>(() => new Set(suggestion?.units.map(u => u.unit).filter(u => u !== division.unit)));

  return (
    <Sheet open onClose={onClose} title={division.unit}>
      <div className={s.form}>
        <Input label="Направление" value={dir} onChange={e => setDir(e.target.value)} disabled={!isAdmin} />
        <Input label="Руководитель" value={head} onChange={e => setHead(e.target.value)} />
        <Input label="Ответственный" value={resp} onChange={e => setResp(e.target.value)} />
        <Input label="HRBP" value={hrbp} onChange={e => setHrbp(e.target.value)} disabled={!isAdmin} />
        <Input label="Регион" value={region} onChange={e => setRegion(e.target.value)} disabled={!isAdmin} />
        <Input label="Роль в оргструктуре" value={orgRole} onChange={e => setOrgRole(e.target.value)} disabled={!isAdmin} />
        <Input label="Примечание" value={note} onChange={e => setNote(e.target.value)} />
        <label className={s.unitRow}>
          <input type="checkbox" checked={surveyTarget} disabled={!isAdmin} onChange={e => setSurveyTarget(e.target.checked)} />
          Цель сбора анкет
        </label>
        <Input label="Смежная группа" placeholder="Пусто — своя карточка" value={group} onChange={e => setGroup(e.target.value)} disabled={!isAdmin} />

        {isAdmin && suggestion && (
          <div className={s.form} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
            <p className={s.hint}>Похоже на смежную группу «{suggestion.key}». Отметьте площадки:</p>
            {suggestion.units.map(u => (
              <label key={u.unit} className={s.unitRow}>
                <input
                  type="checkbox"
                  checked={u.unit === division.unit || checkedMates.has(u.unit)}
                  disabled={u.unit === division.unit}
                  onChange={() => setCheckedMates(prev => {
                    const next = new Set(prev);
                    if (next.has(u.unit)) next.delete(u.unit); else next.add(u.unit);
                    return next;
                  })}
                />
                {u.unit}
              </label>
            ))}
            <Button
              size="sm"
              onClick={() => { onApplyGroup({ key: suggestion.key, units: [division.unit, ...checkedMates] }); onClose(); }}
            >
              Объединить отмеченные
            </Button>
          </div>
        )}

        <div className={s.formFoot}>
          {(onMove || onToggleHidden || onDelete) && (
            <div className={s.mobileFormActions}>
              {onMove && <Button size="sm" variant="secondary" onClick={onMove}>Переместить</Button>}
              {onToggleHidden && (
                <Button size="sm" variant="secondary" onClick={onToggleHidden}>
                  {division.is_hidden ? 'Показать' : 'Скрыть'}
                </Button>
              )}
              {onDelete && <Button size="sm" variant="danger" onClick={onDelete}>Удалить</Button>}
            </div>
          )}
          <Button
            onClick={() => onSubmit({
              unit: division.unit,
              dir: isAdmin ? dir : undefined,
              head, resp,
              hrbp: isAdmin ? hrbp : undefined,
              note,
              group: isAdmin ? group : undefined,
              region: isAdmin ? region : undefined,
              org_role: isAdmin ? orgRole : undefined,
              is_survey_target: isAdmin ? (surveyTarget ? 1 : 0) : undefined
            })}
          >
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
