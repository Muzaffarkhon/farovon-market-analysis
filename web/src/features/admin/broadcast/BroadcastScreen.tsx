import { useMemo, useState } from 'react';
import { Button } from '../../../design/Button';
import { useConfirm } from '../../../design/Confirm';
import { Input } from '../../../design/Input';
import { Skeleton } from '../../../design/Skeleton';
import { Textarea } from '../../../design/Textarea';
import { useScreenTitle } from '../../shell/Shell';
import { BroadcastHistoryItem } from './BroadcastHistoryItem';
import { useBroadcast } from './useBroadcast';
import s from '../Admin.module.css';

const MAX_BODY = 3500;

/** Рассылка сообщений через Telegram-бота — та же логика, что в старом клиенте (client/app.js: bcSend/bcDrawHist). */
export function BroadcastScreen() {
  useScreenTitle('Рассылка');
  const b = useBroadcast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [body, setBody] = useState('');
  const [withButton, setWithButton] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return b.recipients;
    return b.recipients.filter(r => r.fio.toLowerCase().includes(q) || r.units.some(u => u.toLowerCase().includes(q)));
  }, [b.recipients, search]);

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllShown() {
    const shownIds = shown.map(r => r.id);
    const allSelected = shownIds.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      shownIds.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }

  const canSend = body.trim().length > 0 && body.length <= MAX_BODY && selected.size > 0;

  async function send() {
    if (!canSend) return;
    const yes = await confirm({
      title: 'Отправить рассылку?',
      message: `Сообщение получат ${selected.size} чел. Отменить отправку после нажатия нельзя.`,
      okLabel: 'Отправить',
      danger: true
    });
    if (!yes) return;
    b.send({ body: body.trim(), withButton, userIds: [...selected] });
    setBody('');
    setSelected(new Set());
  }

  return (
    <div data-wide>
      <div>
        <h4 className={s.hint}>Новое сообщение</h4>
        <Textarea
          label="Текст рассылки" value={body} onChange={e => setBody(e.target.value)}
          rows={4} hint={`${body.length} / ${MAX_BODY}`}
        />
        <label className={s.unitRow}>
          <input type="checkbox" checked={withButton} onChange={e => setWithButton(e.target.checked)} />
          С кнопкой «Открыть «Обзор рынка»»
        </label>

        <div style={{ marginTop: 'var(--s-3)' }}>
          <div className={s.hint} style={{ marginBottom: 4 }}>
            Получатели ({selected.size} выбрано из {b.totalActive} активных с привязанным Telegram)
          </div>
          <Input label="Поиск по ФИО или подразделению" value={search} onChange={e => setSearch(e.target.value)} />
          {b.recipientsLoading ? <Skeleton lines={4} /> : (
            <div className={s.unitList} style={{ marginTop: 'var(--s-2)' }}>
              <label className={s.unitRow}>
                <input
                  type="checkbox"
                  checked={shown.length > 0 && shown.every(r => selected.has(r.id))}
                  onChange={toggleAllShown}
                />
                <b>Выбрать все показанные ({shown.length})</b>
              </label>
              {shown.map(r => (
                <label key={r.id} className={s.unitRow}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  {r.fio} <span className={s.hint}>· {r.units.join(', ')}</span>
                </label>
              ))}
              {!shown.length && <span className={s.hint}>Никого не найдено</span>}
            </div>
          )}
        </div>

        <div className={s.formFoot} style={{ marginTop: 'var(--s-3)' }}>
          <Button loading={b.sending} disabled={!canSend} onClick={send}>Отправить</Button>
        </div>
      </div>

      <div style={{ marginTop: 'var(--s-4)' }}>
        <h4 className={s.hint}>История рассылок</h4>
        {b.historyLoading && <Skeleton lines={4} />}
        {!b.historyLoading && !b.history.length && <p className={s.empty}>Рассылок пока не было</p>}
        {b.history.map(item => <BroadcastHistoryItem key={item.id} item={item} />)}
      </div>
    </div>
  );
}
