import { useState } from 'react';
import type { AdminGradingBlock, GradingFactor, GradingFactorScope } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Select } from '../../../design/Select';
import { Sheet } from '../../../design/Sheet';
import { Skeleton } from '../../../design/Skeleton';
import { Textarea } from '../../../design/Textarea';
import s from '../Admin.module.css';
import { useFactorsAdmin } from './useGradingAdmin';

export function FactorsTab({ blocks }: { blocks: AdminGradingBlock[] }) {
  const [scope, setScope] = useState<GradingFactorScope>('position');
  const [dir, setDir] = useState('');
  const [editing, setEditing] = useState<{ row: GradingFactor; idx: number } | null>(null);
  const f = useFactorsAdmin(scope, dir);
  const confirm = useConfirm();

  return (
    <div className={s.screenFill}>
      <div className={s.head}>
        <Select
          label="Анкета" value={scope}
          onChange={e => { setScope(e.target.value as GradingFactorScope); setDir(''); }}
          options={[{ value: 'position', label: 'Оценка должностей' }, { value: 'risk', label: 'Риски незаменимости' }]}
        />
        {scope === 'position' && (
          <Select
            label="Область" value={dir} onChange={e => setDir(e.target.value)}
            options={[{ value: '', label: 'Общая формулировка' }, ...blocks.map(b => ({ value: 'block:' + b.key, label: b.label }))]}
          />
        )}
      </div>

      {f.loading && <Skeleton lines={4} />}
      {f.error && <p className={s.empty}>{f.error.message}</p>}

      <div className={s.tableWrapFill}>
        <table className={s.table}>
          <thead><tr><th>№</th><th>Вопрос</th><th></th></tr></thead>
          <tbody>
            {(f.rows ?? []).map((row, i) => (
              <tr key={row.code}>
                <td>{i + 1}</td>
                <td>{row.title}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <Button size="sm" variant="secondary" onClick={() => setEditing({ row, idx: i + 1 })}>Изменить</Button>
                  <Button
                    size="sm" variant="secondary"
                    onClick={async () => {
                      const msg = dir ? 'Удалить переопределение для этой области?' : 'Вернуть исходную формулировку из Google-формы?';
                      if (await confirm(msg)) f.reset(i + 1);
                    }}
                  >
                    {dir ? 'Удалить переопределение' : 'Сбросить'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <FactorForm
          row={editing.row}
          onClose={() => setEditing(null)}
          onSubmit={p => { f.save({ scope, idx: editing.idx, dir, ...p }); setEditing(null); }}
        />
      )}
    </div>
  );
}

function FactorForm({ row, onClose, onSubmit }: {
  row: GradingFactor;
  onClose: () => void;
  onSubmit: (p: { title: string; help: string; options: string[]; examples: string[] }) => void;
}) {
  const [title, setTitle] = useState(row.title);
  const [help, setHelp] = useState(row.help);
  const [options, setOptions] = useState<string[]>(row.options);
  const [examples, setExamples] = useState<string[]>(row.examples);

  const setOption = (i: number, v: string) => setOptions(prev => prev.map((o, idx) => idx === i ? v : o));
  const setExample = (i: number, v: string) => setExamples(prev => prev.map((o, idx) => idx === i ? v : o));

  return (
    <Sheet open onClose={onClose} title="Формулировка вопроса">
      <div className={s.form}>
        <Textarea label="Вопрос" value={title} onChange={e => setTitle(e.target.value)} />
        <Textarea label="Пояснение" value={help} onChange={e => setHelp(e.target.value)} />
        {options.map((opt, i) => (
          <div key={i} className={s.form} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 'var(--s-3)' }}>
            <Textarea label={`Вариант ${i + 1} балл`} value={opt} onChange={e => setOption(i, e.target.value)} />
            <Textarea label={`Эталон-должность (необязательно)`} value={examples[i] ?? ''} onChange={e => setExample(i, e.target.value)} />
          </div>
        ))}
        <div className={s.formFoot}>
          <Button disabled={!title.trim() || options.some(o => !o.trim())} onClick={() => onSubmit({ title, help, options, examples })}>
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
