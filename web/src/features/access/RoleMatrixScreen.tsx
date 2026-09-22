import { useState } from 'react';
import { Chip } from '../../design/Chip';
import { useScreenTitle } from '../shell/Shell';
import { RoleMatrixTab } from './RoleMatrixTab';
import { PersonalGrantsTab } from './PersonalGrantsTab';
import s from './Access.module.css';

export function RoleMatrixScreen() {
  useScreenTitle('Роли и доступы');
  const [tab, setTab] = useState<'roles' | 'personal'>('roles');
  return (
    <div className={s.screen}>
      <div className={s.tabs}>
        <Chip active={tab === 'roles'} onClick={() => setTab('roles')}>Роли</Chip>
        <Chip active={tab === 'personal'} onClick={() => setTab('personal')}>Личные исключения</Chip>
      </div>
      {tab === 'roles' ? <RoleMatrixTab /> : <PersonalGrantsTab />}
    </div>
  );
}
