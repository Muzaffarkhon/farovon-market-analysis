import { useState } from 'react';
import { Button } from '../../../design/Button';
import { Combobox } from '../../../design/Combobox';
import { useConfirm } from '../../../design/Confirm';
import { Select } from '../../../design/Select';
import { useScreenTitle } from '../../shell/Shell';
import s from '../Admin.module.css';
import { useCompCommittee } from './useCompCommittee';

/**
 * Комиссия по пересмотру заработной платы — глобальная, не по блокам.
 * Голосование большинством от зафиксированного состава (§5 ТЗ), режим
 * открытое/закрытое переключается здесь же и действует на новые заявки.
 */
export function CompCommitteeScreen() {
  useScreenTitle('Изменение ЗП');
  const c = useCompCommittee();
  const confirm = useConfirm();
  const [login, setLogin] = useState('');

  return (
    <div data-wide>
      <Select
        label="Режим голосования" value={c.voteMode} onChange={e => c.saveVoteMode(e.target.value as 'open' | 'closed')}
        options={[
          { value: 'closed', label: 'Закрытое — голоса видны только после итога' },
          { value: 'open', label: 'Открытое — члены комиссии видят голоса друг друга сразу' }
        ]}
        hint="Действует на новые заявки; уже идущее голосование режим не меняет"
      />

      <h4 className={s.hint} style={{ marginTop: 'var(--s-4)' }}>Состав комиссии — решает большинством от состава</h4>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>ФИО</th><th>Логин</th><th></th></tr></thead>
          <tbody>
            {c.members.map(m => (
              <tr key={m.login}>
                <td>{m.fio}</td><td>{m.login}</td>
                <td>
                  <Button
                    size="sm" variant="danger"
                    onClick={async () => { if (await confirm({ message: `Исключить «${m.fio}» из комиссии?`, danger: true })) c.remove(m.login); }}
                  >
                    Исключить
                  </Button>
                </td>
              </tr>
            ))}
            {!c.members.length && <tr><td colSpan={3} className={s.empty}>Комиссия не назначена</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={s.formFoot} style={{ justifyContent: 'flex-start', marginTop: 'var(--s-3)' }}>
        <Combobox label="Сотрудник" value={login} onChange={setLogin} options={c.userOptions} placeholder="Начните вводить ФИО или логин" />
        <Button disabled={!login.trim()} onClick={() => { c.add(login.trim()); setLogin(''); }}>Добавить в комиссию</Button>
      </div>
    </div>
  );
}
