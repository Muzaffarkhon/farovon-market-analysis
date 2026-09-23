import { useState } from 'react';
import type { StaffImportReport } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { FileInput } from '../../../design/FileInput';
import { Sheet } from '../../../design/Sheet';
import s from '../Admin.module.css';

/**
 * Импорт целиком заменяет справочник (сервер делает DELETE + вставку заново),
 * поэтому commit доступен только после dry-run в этом же сеансе формы — не
 * даём отправить файл вслепую, минуя предпросмотр.
 */
export function StaffImportWizard({ onClose, onDryRun, onCommit, committing }: {
  onClose: () => void;
  onDryRun: (csv: string) => Promise<{ report: StaffImportReport }>;
  onCommit: (csv: string) => void;
  committing: boolean;
}) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<StaffImportReport | null>(null);
  const [checking, setChecking] = useState(false);

  const handleSelect = async (text: string, file: File) => {
    setCsv(text);
    setFileName(file.name);
    setReport(null);
  };

  const runDryRun = async () => {
    if (!csv) return;
    setChecking(true);
    try {
      const r = await onDryRun(csv);
      setReport(r.report);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Импорт справочника из 1С">
      <div className={s.form}>
        <FileInput
          label="Файл CSV" accept=".csv,text/csv"
          hint="Выгрузка 1С «Список сотрудников организаций» без переименования колонок"
          onSelect={handleSelect}
        />
        {fileName && <p className={s.hint}>Выбран файл: {fileName}</p>}
        {csv && !report && (
          <Button loading={checking} onClick={runDryRun}>Проверить файл</Button>
        )}
        {report && (
          <div className={s.form}>
            <p>
              Строк в файле: {report.rowsInFile}. Будет загружено: {report.rowsPrepared} человек
              в {report.units} подразделениях.
            </p>
            {report.rowsSkipped > 0 && <p className={s.hint}>Отбраковано строк: {report.rowsSkipped} (нет ФИО, подразделения или дубль).</p>}
            {report.unmatchedCount > 0 && (
              <p className={s.hint}>
                Не сопоставлено с оргструктурой: {report.unmatchedCount} человек в {report.unmatchedUnits.length}{' '}
                подразделениях — {report.unmatchedUnits.slice(0, 10).map(u => `${u.unit} (${u.count})`).join(', ')}
                {report.unmatchedUnits.length > 10 ? '…' : ''}
              </p>
            )}
            <p className={s.hint}>Подтверждение полностью заменит текущий справочник сотрудников этим файлом.</p>
            <div className={s.formFoot}>
              <Button variant="secondary" onClick={() => setReport(null)}>Выбрать другой файл</Button>
              <Button loading={committing} onClick={() => csv && onCommit(csv)}>Подтвердить импорт</Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
