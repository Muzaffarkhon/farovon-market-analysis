import { Button } from '../../../design/Button';
import { Chip } from '../../../design/Chip';
import { Input } from '../../../design/Input';
import { Skeleton } from '../../../design/Skeleton';
import { useScreenTitle } from '../../shell/Shell';
import { ThreadDetail } from './ThreadDetail';
import { ThreadList } from './ThreadList';
import { useSupportInbox } from './useSupportInbox';
import s from './SupportInbox.module.css';

export function SupportInboxScreen() {
  useScreenTitle('Чат поддержки');
  const inbox = useSupportInbox();

  return (
    <div>
      <div className={s.head}>
        <Input
          label="" aria-label="Поиск" placeholder="Поиск по имени, телефону, теме, тексту…" className={s.search}
          value={inbox.searchInput} onChange={e => inbox.setSearchInput(e.target.value)}
        />
        <Chip active={inbox.filters.status === 'open'} onClick={() => inbox.setFilter({ status: inbox.filters.status === 'open' ? undefined : 'open' })}>Открыт</Chip>
        <Chip active={inbox.filters.status === 'closed'} onClick={() => inbox.setFilter({ status: inbox.filters.status === 'closed' ? undefined : 'closed' })}>Закрыт</Chip>
        <Chip active={inbox.filters.reply === 'pending'} onClick={() => inbox.setFilter({ reply: inbox.filters.reply === 'pending' ? undefined : 'pending' })}>Ждут ответа</Chip>
        <Chip active={inbox.filters.login === 'missing'} onClick={() => inbox.setFilter({ login: inbox.filters.login === 'missing' ? undefined : 'missing' })}>Без привязки</Chip>
        <Chip active={inbox.filters.unread === 'yes'} onClick={() => inbox.setFilter({ unread: inbox.filters.unread === 'yes' ? undefined : 'yes' })}>Непрочитанные</Chip>
        <Chip active={inbox.filters.archived === 'yes'} onClick={() => inbox.setFilter({ archived: inbox.filters.archived === 'yes' ? undefined : 'yes' })}>Архив</Chip>
        {inbox.active && <Button variant="ghost" size="sm" onClick={inbox.resetFilters}>Сбросить</Button>}
      </div>

      {inbox.threadsLoading ? <Skeleton lines={5} /> : inbox.threadsError ? (
        <p className={s.empty}>{inbox.threadsError.message}</p>
      ) : (
        <ThreadList threads={inbox.threads} onOpen={inbox.open} />
      )}

      <ThreadDetail inbox={inbox} />
    </div>
  );
}
