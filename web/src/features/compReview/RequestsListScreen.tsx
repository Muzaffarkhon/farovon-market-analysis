import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { CompRequestListItem, CompRequestStatus } from '../../api/contract';
import { Badge, type BadgeTone } from '../../design/Badge';
import { Button } from '../../design/Button';
import { Skeleton } from '../../design/Skeleton';
import { useScreenTitle } from '../shell/Shell';
import { useCompAccess, useCreateDraft, useCompReasons } from './useCompReview';
import { useRequestsList } from './useCompReview';
import s from './CompReview.module.css';

const STATUS_LABEL: Record<CompRequestStatus, string> = {
  draft: 'Черновик', cb_review: 'Проверка C&B', hrd_review: 'Согласование HRD',
  committee: 'Голосование комиссии', payroll: 'У кадровика', closed: 'Закрыта'
};
const STATUS_TONE: Record<CompRequestStatus, BadgeTone> = {
  draft: 'muted', cb_review: 'neutral', hrd_review: 'neutral', committee: 'warn', payroll: 'warn', closed: 'ok'
};

function RequestRow({ r, typeLabel }: { r: CompRequestListItem; typeLabel: string }) {
  return (
    <Link to={`/comp/${r.id}`} className={s.row}>
      <div className={s.rowTop}>
        <span className={s.cardTitle}>#{r.id} · {r.unit || typeLabel}</span>
        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
      </div>
      <div className={s.hint}>{typeLabel} · инициатор {r.initiatorLogin} · {new Date(r.createdAt.replace(' ', 'T')).toLocaleDateString('ru-RU')}</div>
      {r.comment && <div className={s.hint}>{r.comment}</div>}
    </Link>
  );
}

/** Реестр (§6 ТЗ): «Ждут меня / Мои / Все актуальные / Закрытые», набор зависит от прав. */
export function RequestsListScreen() {
  useScreenTitle('Пересмотр заработной платы');
  const navigate = useNavigate();
  const access = useCompAccess();
  const { requestTypes } = useCompReasons();
  const [tab, setTab] = useState<'waiting' | 'mine' | 'all' | 'closed'>('waiting');
  const list = useRequestsList(tab);
  const { create, creating } = useCreateDraft();

  const typeLabel = (t: string) => requestTypes.find(x => x.code === t)?.label ?? t;

  async function newDraft() {
    const r = await create({ requestType: 'planned' });
    navigate(`/comp/${r.request.id}`);
  }

  if (access.loading) return <Skeleton lines={4} />;

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'waiting', label: 'Ждут меня' },
    { key: 'mine', label: 'Мои' },
    { key: 'all', label: 'Все актуальные' },
    { key: 'closed', label: 'Закрытые' }
  ];

  return (
    <div data-wide>
      <div className={s.head}>
        <div className={s.tabs} style={{ marginBottom: 0, border: 0 }}>
          {tabs.map(t => (
            <button key={t.key} type="button" className={[s.tab, tab === t.key ? s.tabActive : ''].join(' ')} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        {access.canSubmit && <Button loading={creating} onClick={newDraft}>+ Новая заявка</Button>}
      </div>

      {list.loading ? <Skeleton lines={5} /> : (
        <div className={s.list}>
          {list.rows.map(r => <RequestRow key={r.id} r={r} typeLabel={typeLabel(r.requestType)} />)}
          {!list.rows.length && <p className={s.empty}>Заявок нет</p>}
        </div>
      )}
    </div>
  );
}
