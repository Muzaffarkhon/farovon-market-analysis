import { useState } from 'react';
import type { Division, SaveDivisionPayload } from '../../../api/contract';
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
export function DivisionForm({ division, onClose, onSubmit }: {
  division: Division;
  onClose: () => void;
  onSubmit: (p: SaveDivisionPayload) => void;
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
        <div className={s.formFoot}>
          <Button
            onClick={() => onSubmit({
              unit: division.unit,
              dir: isAdmin ? dir : undefined,
              head, resp,
              hrbp: isAdmin ? hrbp : undefined,
              note,
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
