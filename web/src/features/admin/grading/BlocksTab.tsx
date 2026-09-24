import { useState } from 'react';
import type { AdminGradingBlock } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Select } from '../../../design/Select';
import { Skeleton } from '../../../design/Skeleton';
import { SortTh } from '../../../design/SortTh';
import { useSort } from '../../../design/useSort';
import s from '../Admin.module.css';
import { useBlockPositions } from './useGradingAdmin';

export function BlocksTab({ blocks }: { blocks: AdminGradingBlock[] }) {
  const [block, setBlock] = useState(blocks[0]?.key ?? '');
  const p = useBlockPositions(block);

  const { sorted, sortKey, sortDir, sortBy } = useSort(p.rows ?? [], (row, key) => {
    switch (key) {
      case 'unit': return row.unit;
      case 'position': return row.position;
      case 'staff': return row.staff_count;
      default: return '';
    }
  });

  return (
    <div className={s.screenFill}>
      <div className={s.head}>
        <Select label="Блок" value={block} onChange={e => setBlock(e.target.value)} options={blocks.map(b => ({ value: b.key, label: `${b.label} (${b.pair_count})` }))} />
      </div>

      {p.loading && <Skeleton lines={5} />}
      {p.error && <p className={s.empty}>{p.error.message}</p>}

      <div className={s.tableWrapFill}>
        <table className={s.table}>
          <thead>
            <tr>
              <SortTh label="Подразделение" sortKey="unit" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Должность" sortKey="position" activeKey={sortKey} dir={sortDir} onSort={sortBy} />
              <SortTh label="Штат" sortKey="staff" activeKey={sortKey} dir={sortDir} onSort={sortBy} numeric />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <PositionRow
                key={row.unit + '|' + row.position} row={row} blocks={blocks} currentBlock={block}
                onReassign={p.reassign} onResetEvaluation={p.resetEvaluation} onRestoreEvaluation={p.restoreEvaluation}
              />
            ))}
            {!p.rows?.length && !p.loading && <tr><td colSpan={4} className={s.empty}>В этом блоке нет должностей</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PositionRow({ row, blocks, currentBlock, onReassign, onResetEvaluation, onRestoreEvaluation }: {
  row: { unit: string; position: string; staff_count: number; has_reset_backup?: boolean };
  blocks: AdminGradingBlock[];
  currentBlock: string;
  onReassign: (a: { unit: string; position: string; block: string }) => void;
  onResetEvaluation: (a: { block: string; job_title: string }) => void;
  onRestoreEvaluation: (a: { block: string; job_title: string }) => void;
}) {
  const [target, setTarget] = useState(currentBlock);
  const confirm = useConfirm();
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
          onClick={async () => { if (await confirm({ message: `Сбросить утверждённую оценку должности «${row.position}»?`, danger: true })) onResetEvaluation({ block: currentBlock, job_title: row.position }); }}
        >
          Сбросить оценку
        </Button>
        {row.has_reset_backup && (
          <Button
            size="sm" variant="secondary"
            onClick={async () => { if (await confirm(`Восстановить последнюю сброшенную оценку должности «${row.position}»?`)) onRestoreEvaluation({ block: currentBlock, job_title: row.position }); }}
          >
            Восстановить оценку
          </Button>
        )}
      </td>
    </tr>
  );
}
