import { useState } from 'react';
import type { AdminGradingBlock } from '../../../api/contract';
import { Button } from '../../../design/Button';
import { Input } from '../../../design/Input';
import { Select } from '../../../design/Select';
import s from '../Admin.module.css';
import { useCommittee } from './useGradingAdmin';

export function CommitteeTab({ blocks }: { blocks: AdminGradingBlock[] }) {
  const [block, setBlock] = useState(blocks[0]?.key ?? '');
  const [login, setLogin] = useState('');
  const c = useCommittee(block);

  return (
    <div>
      <div className={s.head}>
        <Select label="Блок" value={block} onChange={e => setBlock(e.target.value)} options={blocks.map(b => ({ value: b.key, label: b.label }))} />
      </div>

      <h4 className={s.hint}>Состав комиссии</h4>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>ФИО</th><th>Логин</th><th>Роль</th><th></th></tr></thead>
          <tbody>
            {(c.members ?? []).map(m => (
              <tr key={m.login}>
                <td>{m.fio ?? '—'}</td><td>{m.login}</td><td>{m.role ?? ''}</td>
                <td><Button size="sm" variant="danger" onClick={() => { if (confirm(`Исключить «${m.fio ?? m.login}» из комиссии?`)) c.remove(m.login); }}>Исключить</Button></td>
              </tr>
            ))}
            {!c.members?.length && <tr><td colSpan={4} className={s.empty}>Комиссия не назначена — оценки идут напрямую</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={s.formFoot} style={{ justifyContent: 'flex-start', marginTop: 'var(--s-3)' }}>
        <Input label="Логин пользователя" value={login} onChange={e => setLogin(e.target.value)} />
        <Button disabled={!login.trim()} onClick={() => { c.add(login.trim()); setLogin(''); }}>Добавить в комиссию</Button>
      </div>

      <h4 className={s.hint} style={{ marginTop: 'var(--s-4)' }}>Ждут кворума ({c.committeeSize} чел. в комиссии)</h4>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>Должность</th><th>Сдали</th><th></th></tr></thead>
          <tbody>
            {(c.pending ?? []).map(row => (
              <tr key={row.job_title}>
                <td>{row.job_title}</td>
                <td>{row.submitted_count} из {c.committeeSize}</td>
                <td>
                  <Button
                    size="sm" variant="danger"
                    onClick={() => { if (confirm(`Подвести итог по «${row.job_title}» вручную, не дожидаясь остальных членов комиссии?`)) c.finalize(row.job_title); }}
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
