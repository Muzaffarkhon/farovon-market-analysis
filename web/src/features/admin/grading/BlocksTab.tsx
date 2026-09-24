import { useState } from 'react';
import type { AdminGradingBlock } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Select } from '../../../design/Select';
import { Skeleton } from '../../../design/Skeleton';
import s from '../Admin.module.css';
import { useBlockPositions } from './useGradingAdmin';

export function BlocksTab({ blocks }: { blocks: AdminGradingBlock[] }) {
  const [block, setBlock] = useState(blocks[0]?.key ?? '');
  const p = useBlockPositions(block);

  return (
    <div className={s.screenFill}>
      <div className={s.head}>
        <Select label="Блок" value={block} onChange={e => setBlock(e.target.value)} options={blocks.map(b => ({ value: b.key, label: `${b.label} (${b.pair_count})` }))} />
      </div>

      {p.loading && <Skeleton lines={5} />}
      {p.error && <p className={s.empty}>{p.error.message}</p>}

      <div className={s.tableWrapFill}>
        <table className={s.table}>
          <thead><tr><th>Подразделение</th><th>Должность</th><th>Штат</th><th></th></tr></thead>
          <tbody>
            {(p.rows ?? []).map(row => (
              <PositionRow key={row.unit + '|' + row.position} row={row} blocks={blocks} currentBlock={block} onReassign={p.reassign} onResetEvaluation={p.resetEvaluation} />
            ))}
            {!p.rows?.length && !p.loading && <tr><td colSpan={4} className={s.empty}>В этом блоке нет должностей</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PositionRow({ row, blocks, currentBlock, onReassign, onResetEvaluation }: {
  row: { unit: string; position: string; staff_count: number };
  blocks: AdminGradingBlock[];
  currentBlock: string;
  onReassign: (a: { unit: string; position: string; block: string }) => void;
  onResetEvaluation: (a: { block: string; job_title: string }) => void;
}) {
  const [target, setTarget] = useState(currentBlock);
  return (
    <tr>
      <td>{row.unit}</td>
      <td>{row.position}</td>
      <td>{row.staff_count}</td>
      <td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={target} onChange={e => setTarget(e.target.value)} aria-label={`Перенести «${row.position}» в блок`}>
          {blocks.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
        <Button
          size="sm" variant="secondary" disabled={target === currentBlock}
          onClick={() => onReassign({ unit: row.unit, position: row.position, block: target })}
        >
          Перенести
        </Button>
        <Button
          size="sm" variant="danger"
          onClick={() => { if (confirm(`Сбросить утверждённую оценку должности «${row.position}»?`)) onResetEvaluation({ block: currentBlock, job_title: row.position }); }}
        >
          Сбросить оценку
        </Button>
      </td>
    </tr>
  );
}
