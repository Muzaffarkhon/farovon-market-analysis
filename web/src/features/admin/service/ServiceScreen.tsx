import { useState } from 'react';
import type { DataStatus } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Skeleton } from '../../../design/Skeleton';
import { useSessionData } from '../../auth/useSession';
import { useScreenTitle } from '../../shell/Shell';
import adminStyles from '../Admin.module.css';
import { LocksSheet } from './LocksSheet';
import s from './Service.module.css';
import { SurveyImportWizard } from './SurveyImportWizard';
import { useMaintenance } from './useMaintenance';

const STAT_LABELS: { key: keyof DataStatus; label: string }[] = [
  { key: 'divisions', label: 'Подразделений' },
  { key: 'divisionsWithCode', label: 'Подразделений с кодом' },
  { key: 'staffPairs', label: 'Пар «должность-подразделение»' },
  { key: 'staffUnits', label: 'Подразделений со штаткой' },
  { key: 'positions', label: 'Должностей в справочнике' },
  { key: 'companies', label: 'Компаний в справочнике' },
  { key: 'companiesWithDirs', label: 'Компаний с направлениями' },
  { key: 'companiesWithCode', label: 'Компаний с кодом' },
  { key: 'competitors', label: 'Строк участников рынка' },
  { key: 'competitorUnits', label: 'Подразделений с участниками' },
  { key: 'surveys', label: 'Активных анкет' }
];

type SimpleTask = { type: string; title: string; note: string; danger?: boolean };

const SIMPLE_TASKS: SimpleTask[] = [
  { type: 'clean_segments', title: 'Почистить сегменты и регионы', note: 'Убирает лишние пробелы, подтягивает сегмент/регион из справочника компаний туда, где они пустые, добавляет отсутствующие компании в справочник.' },
  { type: 'fix_links', title: 'Починить связи с оргструктурой', note: 'Находит участников рынка и анкеты, у которых подразделение разошлось с оргструктурой, и обновляет направление, ответственного и HRBP по актуальным данным.' },
  { type: 'import_staffing', title: 'Импорт штатного расписания', note: 'Заполняет базовый список пар «должность — подразделение» из штатного расписания, уже загруженного на сервер.' },
  { type: 'import_company_dirs', title: 'Импорт направлений компаний', note: 'Сверяет направления и коды компаний по тому, как они реально используются в анкетах.' },
  { type: 'mass_reminder', title: 'Массовое напоминание', note: 'Отправляет в Telegram напоминание всем, у кого остались незакрытые анкеты по текущему периоду.' }
];

const DISTRIBUTE_TASKS: SimpleTask[] = [
  { type: 'distribute_companies', title: 'Раздать базовый набор компаний', note: 'Отделам без единого участника рынка добавляет базовый набор компаний их направления. Отделы, где компании уже есть, не трогает.' },
  { type: 'undo_distribute', title: 'Отменить раздачу компаний', note: 'Убирает добавленные раздачей строки, которые никто не трогал — если по компании уже отметили актуальность или оставили комментарий, строка остаётся.', danger: true }
];

export function ServiceScreen() {
  useScreenTitle('Обслуживание и статус данных');
  const { user } = useSessionData();
  const canEdit = user.role === 'admin' || user.capabilities.includes('service:edit');
  const m = useMaintenance();
  const confirm = useConfirm();
  const [running, setRunning] = useState<string | null>(null);
  const [locksOpen, setLocksOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  async function runSimple(task: SimpleTask) {
    const ok = await confirm({ title: task.title, message: task.note, okLabel: 'Выполнить', danger: task.danger });
    if (!ok) return;
    setRunning(task.type);
    m.runSimple(task.type, { onSettled: () => setRunning(null) });
  }

  async function runDistribute(task: SimpleTask) {
    setRunning(task.type);
    try {
      await m.runDistribute(task.type as 'distribute_companies' | 'undo_distribute');
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className={adminStyles.screenFill} data-wide>
      <div className={adminStyles.head}>
        <div className={s.sectionTitle}>Статус загруженных данных</div>
        <Button size="sm" variant="secondary" loading={m.statusLoading} onClick={m.refetchStatus}>Обновить</Button>
      </div>

      {m.statusError ? <p className={adminStyles.empty}>{m.statusError.message}</p> : m.statusLoading ? <Skeleton lines={4} /> : (
        <div className={s.statGrid}>
          {STAT_LABELS.map(({ key, label }) => (
            <div key={key} className={s.stat}>
              <span className={s.statValue}>{m.status?.[key] ?? '—'}</span>
              <span className={s.statLabel}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <>
          <div className={s.sectionTitle}>Сервисные задачи</div>
          <div className={s.taskList}>
            {SIMPLE_TASKS.map(task => (
              <div key={task.type} className={s.task}>
                <div>
                  <div className={s.taskTitle}>{task.title}</div>
                  <div className={s.taskNote}>{task.note}</div>
                </div>
                <Button size="sm" variant="secondary" loading={running === task.type} onClick={() => runSimple(task)}>Запустить</Button>
              </div>
            ))}
            {DISTRIBUTE_TASKS.map(task => (
              <div key={task.type} className={s.task}>
                <div>
                  <div className={s.taskTitle}>{task.title}</div>
                  <div className={s.taskNote}>{task.note}</div>
                </div>
                <Button size="sm" variant={task.danger ? 'danger' : 'secondary'} loading={running === task.type} onClick={() => runDistribute(task)}>Запустить</Button>
              </div>
            ))}
            <div className={s.task}>
              <div>
                <div className={s.taskTitle}>Блокировки записей</div>
                <div className={s.taskNote}>Кто сейчас числится автором последних правок участников рынка и анкет — можно снять блокировку с одного человека, роли или со всех сразу.</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => { m.loadLocks(); setLocksOpen(true); }}>Показать</Button>
            </div>
            <div className={s.task}>
              <div>
                <div className={s.taskTitle}>Импорт анкеты из CSV</div>
                <div className={s.taskNote}>Массовая загрузка ответов опроса зарплат (выгрузка листа «Ответы») — с проверкой файла перед загрузкой.</div>
              </div>
              <Button size="sm" onClick={() => setImportOpen(true)}>Загрузить файл</Button>
            </div>
          </div>
        </>
      )}

      {locksOpen && (
        <LocksSheet
          locks={m.locks} loading={m.locksLoading} unlocking={m.unlocking}
          onUnlock={a => m.unlock(a)}
          onClose={() => setLocksOpen(false)}
        />
      )}

      {importOpen && (
        <SurveyImportWizard onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}
