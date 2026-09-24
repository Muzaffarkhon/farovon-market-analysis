import { useState } from 'react';
import type { AdminGradingBlock } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Combobox } from '../../../design/Combobox';
import { useConfirm } from '../../../design/Confirm';
import { Select } from '../../../design/Select';
import { SortTh } from '../../../design/SortTh';
import { useSort } from '../../../design/useSort';
import s from '../Admin.module.css';
import { useCommittee } from './useGradingAdmin';

export function CommitteeTab({ blocks }: { blocks: AdminGradingBlock[] }) {
  const [block, setBlock] = useState(blocks[0]?.key ?? '');
  const [login, setLogin] = useState('');
  const c = useCommittee(block);
  const confirm = useConfirm();

  const membersSort = useSort(c.members ?? [], (row, key) => {
    switch (key) {
      case 'fio': return row.fio ?? '';
      case 'login': return row.login;
      case 'role': return row.role ?? '';
      default: return '';
    }
  });

  const pendingSort = useSort(c.pending ?? [], (row, key) => {
    switch (key) {
      case 'title': return row.job_title;
      case 'submitted': return row.submitted_count;
      default: return '';
    }
  });

  return (
    <div>
      <div className={s.head}>
        <Select label="Блок" value={block} onChange={e => setBlock(e.target.value)} options={blocks.map(b => ({ value: b.key, label: b.label }))} />
      </div>

      <h4 className={s.hint}>Состав комиссии</h4>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <SortTh label="ФИО" sortKey="fio" activeKey={membersSort.sortKey} dir={membersSort.sortDir} onSort={membersSort.sortBy} />
              <SortTh label="Логин" sortKey="login" activeKey={membersSort.sortKey} dir={membersSort.sortDir} onSort={membersSort.sortBy} />
              <SortTh label="Роль" sortKey="role" activeKey={membersSort.sortKey} dir={membersSort.sortDir} onSort={membersSort.sortBy} />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {membersSort.sorted.map(m => (
              <tr key={m.login}>
                <td>{m.fio ?? '—'}</td><td>{m.login}</td><td>{m.role ?? ''}</td>
                <td><Button size="sm" variant="danger" onClick={async () => { if (await confirm({ message: `Исключить «${m.fio ?? m.login}» из комиссии?`, danger: true })) c.remove(m.login); }}>Исключить</Button></td>
              </tr>
            ))}
            {!c.members?.length && <tr><td colSpan={4} className={s.empty}>Комиссия не назначена — оценки идут напрямую</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={s.formFoot} style={{ justifyContent: 'flex-start', marginTop: 'var(--s-3)' }}>
        <Combobox label="Сотрудник" value={login} onChange={setLogin} options={c.userOptions ?? []} placeholder="Начните вводить ФИО или логин" />
        <Button disabled={!login.trim()} onClick={() => { c.add(login.trim()); setLogin(''); }}>Добавить в комиссию</Button>
      </div>

      <h4 className={s.hint} style={{ marginTop: 'var(--s-4)' }}>Ждут кворума ({c.committeeSize} чел. в комиссии)</h4>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <SortTh label="Должность" sortKey="title" activeKey={pendingSort.sortKey} dir={pendingSort.sortDir} onSort={pendingSort.sortBy} />
              <SortTh label="Сдали" sortKey="submitted" activeKey={pendingSort.sortKey} dir={pendingSort.sortDir} onSort={pendingSort.sortBy} numeric />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pendingSort.sorted.map(row => (
              <tr key={row.job_title}>
                <td>{row.job_title}</td>
                <td>{row.submitted_count} из {c.committeeSize}</td>
                <td>
                  <Button
                    size="sm" variant="danger"
                    onClick={async () => { if (await confirm(`Подвести итог по «${row.job_title}» вручную, не дожидаясь остальных членов комиссии?`)) c.finalize(row.job_title); }}
                  >
                    Подвести итог принудительно
                  </Button>
                </td>
              </tr>
            ))}
            {!c.pending?.length && <tr><td colSpan={3} className={s.empty}>Нет должностей в ожидании кворума</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
