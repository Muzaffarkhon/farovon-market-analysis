import { useState } from 'react';
import { benchmarkApi } from '../../../api/benchmark';
import type {
  BenchmarkColumnMap, BenchmarkImportMode, BenchmarkImportReport, BenchmarkSource
} from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Select } from '../../../design/Select';
import { Sheet } from '../../../design/Sheet';
import s from '../Admin.module.css';
import { useImportWizard } from './useBenchmarkAdmin';

type Step = 'upload' | 'sheet' | 'map' | 'report';

const COLUMN_FIELDS: { key: keyof BenchmarkColumnMap; label: string; modes: BenchmarkImportMode[]; required?: boolean }[] = [
  { key: 'posLabel', label: 'Название должности', modes: ['percentiles', 'raw'], required: true },
  { key: 'code', label: 'Код должности', modes: ['percentiles', 'raw'] },
  { key: 'region', label: 'Регион', modes: ['percentiles', 'raw'] },
  { key: 'grade', label: 'Грейд', modes: ['percentiles', 'raw'] },
  { key: 'p25', label: 'Перцентиль 25', modes: ['percentiles'] },
  { key: 'p50', label: 'Перцентиль 50 / медиана', modes: ['percentiles'] },
  { key: 'p75', label: 'Перцентиль 75', modes: ['percentiles'] },
  { key: 'sampleN', label: 'Размер выборки', modes: ['percentiles'] },
  { key: 'value', label: 'Оклад', modes: ['raw'], required: true },
  { key: 'company', label: 'Компания', modes: ['raw'] }
];

function rowsToText(rows: string[][]): string {
  return rows.map(r => r.map(c => (c ?? '').replace(/\t/g, ' ')).join('\t')).join('\n');
}

export function BenchmarkImportWizard({ sources, onClose }: { sources: BenchmarkSource[]; onClose: () => void }) {
  const w = useImportWizard();
  const [step, setStep] = useState<Step>('upload');
  const [sourceKey, setSourceKey] = useState(sources.find(s2 => s2.key !== 'internal')?.key ?? '');
  const [fileBase64, setFileBase64] = useState('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [grid, setGrid] = useState<string[][]>([]);
  const [mode, setMode] = useState<BenchmarkImportMode>('percentiles');
  const [columnMap, setColumnMap] = useState<BenchmarkColumnMap>({ posLabel: 0 });
  const [currency, setCurrency] = useState('сомони');
  const [reportDate, setReportDate] = useState('');
  const [dataAsOf, setDataAsOf] = useState('');
  const [title, setTitle] = useState('');
  const [report, setReport] = useState<BenchmarkImportReport | null>(null);

  const handleFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    setFileBase64(base64);
    const r = await w.xlsxSheets(base64);
    setSheets(r.sheets);
    if (r.sheets.length === 1) {
      setSheet(r.sheets[0]);
      const g = await w.xlsxGrid({ fileBase64: base64, sheet: r.sheets[0] });
      setGrid(g.rows);
      setStep('map');
    } else {
      setStep('sheet');
    }
  };

  const pickSheet = async (name: string) => {
    setSheet(name);
    const g = await w.xlsxGrid({ fileBase64, sheet: name });
    setGrid(g.rows);
    setStep('map');
  };

  const runDryRun = async () => {
    const text = rowsToText(grid);
    let fxRate = 1;
    if (currency && currency.toLowerCase() !== 'сомони' && currency.toUpperCase() !== 'TJS') {
      const fx = await benchmarkApi.fx(currency);
      fxRate = fx.rate;
    }
    const r = await w.dryRun({ sourceKey, text, mode, columnMap, currency, reportDate, dataAsOf, title, fxRate });
    setReport(r.report);
    setStep('report');
  };

  const commit = () => {
    const text = rowsToText(grid);
    w.commit({ sourceKey, text, mode, columnMap, currency, reportDate, dataAsOf, title });
    onClose();
  };

  const header = grid[0] ?? [];
  const fields = COLUMN_FIELDS.filter(f => f.modes.includes(mode));

  return (
    <Sheet open onClose={onClose} title="Импорт данных бенчмарка">
      <div className={s.form}>
        <Select label="Источник" value={sourceKey} onChange={e => setSourceKey(e.target.value)} options={sources.filter(s2 => s2.key !== 'internal').map(src => ({ value: src.key, label: src.title }))} />

        {step === 'upload' && (
          <div className={s.form}>
            <label className={s.hint} htmlFor="benchmark-xlsx-file">Файл Excel (.xlsx)</label>
            <input
              id="benchmark-xlsx-file" type="file" accept=".xlsx"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
            />
          </div>
        )}

        {step === 'sheet' && (
          <div className={s.form}>
            <Select label="Лист" value={sheet} onChange={e => pickSheet(e.target.value)} placeholder="— выберите —" options={sheets.map(sh => ({ value: sh, label: sh }))} />
          </div>
        )}

        {step === 'map' && (
          <div className={s.form}>
            <Select
              label="Тип данных" value={mode}
              onChange={e => setMode(e.target.value as BenchmarkImportMode)}
              options={[{ value: 'percentiles', label: 'Перцентили по должности' }, { value: 'raw', label: 'Сырые оклады' }]}
            />
            {fields.map(f => (
              <Select
                key={f.key} label={f.label + (f.required ? ' *' : '')} placeholder="— не используется —"
                value={columnMap[f.key] != null ? String(columnMap[f.key]) : ''}
                onChange={e => setColumnMap(prev => ({ ...prev, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                options={header.map((h, i) => ({ value: String(i), label: h || `Колонка ${i + 1}` }))}
              />
            ))}
            <Input label="Валюта" value={currency} onChange={e => setCurrency(e.target.value)} />
            <Input label="Дата отчёта" type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} />
            <Input label="Данные на дату" type="date" value={dataAsOf} onChange={e => setDataAsOf(e.target.value)} />
            <Input label="Название датасета" value={title} onChange={e => setTitle(e.target.value)} hint="Пусто — сформируется автоматически" />
            <div className={s.formFoot}>
              <Button loading={w.dryRunPending} disabled={columnMap.posLabel == null || !sourceKey} onClick={runDryRun}>Проверить файл</Button>
            </div>
          </div>
        )}

        {step === 'report' && report && (
          <div className={s.form}>
            <p>
              Строк в файле: {report.totalLines}. Годных к импорту: {report.validRows}.
              Новых должностей источника: {report.newPositionsCount}.
            </p>
            {report.errors.length > 0 && (
              <p className={s.hint}>Ошибки ({report.errors.length}): {report.errors.slice(0, 5).map(e => `стр. ${e.line}: ${e.message}`).join('; ')}</p>
            )}
            {report.warnings.length > 0 && (
              <p className={s.hint}>Предупреждения ({report.warnings.length}): {report.warnings.slice(0, 5).map(e => `стр. ${e.line}: ${e.message}`).join('; ')}</p>
            )}
            <p className={s.hint}>Подтверждение создаст новый датасет источника «{sources.find(s2 => s2.key === sourceKey)?.title}».</p>
            <div className={s.formFoot}>
              <Button variant="secondary" onClick={() => setStep('map')}>Изменить настройки</Button>
              <Button loading={w.committing} disabled={report.validRows === 0} onClick={commit}>Подтвердить импорт</Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
