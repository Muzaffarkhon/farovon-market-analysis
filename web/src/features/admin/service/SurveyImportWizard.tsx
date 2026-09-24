import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SurveyImportReport } from '../../../api/contract';
import { maintenanceApi } from '../../../api/maintenance';
import { ApiError } from '../../../api/client';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { FileInput } from '../../../design/FileInput';
import { Sheet } from '../../../design/Sheet';
import { useToast } from '../../../design/Toast';
import s from '../Admin.module.css';

/**
 * Выгрузка листа «Ответы» из формы опроса зарплат — тот же приём, что у
 * импорта справочника сотрудников (StaffImportWizard): без предпросмотра
 * (dry-run) файл на сервер не уходит. В отличие от справочника, этот импорт
 * не заменяет данные целиком, а добавляет строки — дубли (та же связка
 * подразделение+компания+должность+оклад, что уже активна в текущем периоде)
 * либо пропускаются, либо обновляются — выбор один на весь файл, не построчно.
 */
export function SurveyImportWizard({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<SurveyImportReport | null>(null);
  const [dupAction, setDupAction] = useState<'skip' | 'update'>('skip');

  const dryRun = useMutation({
    mutationFn: (text: string) => maintenanceApi.importSurveyDryRun(text),
    onSuccess: r => setReport(r.report),
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось проверить файл', 'error')
  });

  const commit = useMutation({
    mutationFn: () => maintenanceApi.importSurveyCommit(csv!, dupAction),
    onSuccess: r => {
      toast.show(r.message, 'ok');
      void qc.invalidateQueries({ queryKey: ['data-status'] });
      onClose();
    },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось загрузить анкету', 'error')
  });

  const handleSelect = (text: string, file: File) => {
    setCsv(text);
    setFileName(file.name);
    setReport(null);
  };

  async function handleCommit() {
    if (!csv) return;
    if (report && report.duplicatesInDb > 0) {
      const action = dupAction === 'update' ? 'обновлены' : 'пропущены';
      const ok = await confirm({
        title: 'Загрузить анкету',
        message: `${report.duplicatesInDb} строк совпадают с уже активными анкетами — они будут ${action}. Продолжить?`,
        okLabel: 'Загрузить'
      });
      if (!ok) return;
    }
    commit.mutate();
  }

  return (
    <Sheet open onClose={onClose} title="Импорт анкеты из CSV">
      <div className={s.form}>
        <FileInput
          label="Файл CSV" accept=".csv,text/csv"
          hint="Выгрузка листа «Ответы» формы опроса зарплат, без переименования колонок"
          onSelect={handleSelect}
        />
        {fileName && <p className={s.hint}>Выбран файл: {fileName}</p>}
        {csv && !report && (
          <Button loading={dryRun.isPending} onClick={() => dryRun.mutate(csv)}>Проверить файл</Button>
        )}

        {report && (
          <div className={s.form}>
            <p>
              Строк в файле: {report.rowsInFile}. Будет загружено: {report.rowsPrepared}
              {report.rowsSkipped > 0 && <> (отбраковано {report.rowsSkipped})</>}.
            </p>
            <p className={s.hint}>
              Новых компаний: {report.companiesNew} из {report.companies}. Новых должностей: {report.positionsNew} из {report.positions}.
              {report.unitsNew.length > 0 && <> Новых подразделений: {report.unitsNew.length} ({report.unitsNew.slice(0, 8).join(', ')}{report.unitsNew.length > 8 ? '…' : ''}).</>}
            </p>
            {report.unitsUnassigned > 0 && (
              <p className={s.hint}>Не удалось определить подразделение у {report.unitsUnassigned} строк — они попадут в общую папку.</p>
            )}
            {report.cellIssues > 0 && (
              <p className={s.hint}>Пропущенных ячеек (текст в числовом поле, пустые обязательные значения и т.п.): {report.cellIssues}.</p>
            )}
            {report.suspiciousHourly > 0 && (
              <p className={s.hint}>Подозрительно маленький оклад (похоже на почасовую ставку) — {report.suspiciousHourly} строк, стоит перепроверить вручную.</p>
            )}
            {report.rowsSkipped > 0 && (
              <p className={s.hint}>Отбраковано: {report.skippedRows.slice(0, 5).map(r => `строка ${r.row} (${r.reason})`).join('; ')}{report.skippedRows.length > 5 ? '…' : ''}</p>
            )}

            {report.duplicatesInDb > 0 && (
              <div className={s.unitList} style={{ maxHeight: 'none' }}>
                <p className={s.hint}>{report.duplicatesInDb} строк совпадают с уже активными анкетами (то же подразделение, компания, должность и оклад) — что делать с ними:</p>
                <label className={s.unitRow}>
                  <input type="radio" name="dupAction" checked={dupAction === 'skip'} onChange={() => setDupAction('skip')} /> Пропустить дубли
                </label>
                <label className={s.unitRow}>
                  <input type="radio" name="dupAction" checked={dupAction === 'update'} onChange={() => setDupAction('update')} /> Обновить дубли новыми значениями
                </label>
              </div>
            )}

            <div className={s.formFoot}>
              <Button variant="secondary" onClick={() => setReport(null)}>Выбрать другой файл</Button>
              <Button loading={commit.isPending} onClick={handleCommit}>Загрузить {report.rowsPrepared} анкет</Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
