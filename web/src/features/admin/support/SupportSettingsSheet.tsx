import { useState } from 'react';
import { Button } from '../../../design/Button';
import { Chip } from '../../../design/Chip';
import { Input } from '../../../design/Input';
import { Sheet } from '../../../design/Sheet';
import { Textarea } from '../../../design/Textarea';
import { useSupportSettings } from './useSupportSettings';
import s from './SupportInbox.module.css';

type Item = { id: number; primary: string; secondary?: string | null };

/**
 * Список с инлайн-редактированием — общий для трёх вкладок (фразы для
 * админов, вопросы-кнопки гостям, FAQ). `secondary` — необязательный
 * второй текст (ответ бота на вопрос гостя / ответ FAQ).
 */
function EditableList({ items, secondaryLabel, onSave, onDelete, saving }: {
  items: Item[]; secondaryLabel?: string;
  onSave: (id: number | null, primary: string, secondary?: string) => void;
  onDelete: (id: number) => void;
  saving: boolean;
}) {
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');

  const startEdit = (item?: Item) => {
    setEditingId(item ? item.id : 'new');
    setPrimary(item?.primary ?? '');
    setSecondary(item?.secondary ?? '');
  };
  const cancel = () => setEditingId(null);
  const save = () => {
    if (!primary.trim()) return;
    onSave(editingId === 'new' ? null : (editingId as number), primary.trim(), secondaryLabel ? secondary.trim() : undefined);
    setEditingId(null);
  };

  return (
    <div className={s.list}>
      {items.map(item => (
        <div key={item.id} className={s.row} style={{ cursor: 'default' }}>
          {editingId === item.id ? (
            <>
              <Input label="" aria-label="Текст" value={primary} onChange={e => setPrimary(e.target.value)} />
              {secondaryLabel && (
                <Textarea label="" aria-label={secondaryLabel} placeholder={secondaryLabel} value={secondary} onChange={e => setSecondary(e.target.value)} rows={2} />
              )}
              <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                <Button size="sm" loading={saving} onClick={save}>Сохранить</Button>
                <Button size="sm" variant="ghost" onClick={cancel}>Отмена</Button>
              </div>
            </>
          ) : (
            <>
              <div className={s.rowTop}>
                <span className={s.rowName}>{item.primary}</span>
                <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(item)}>Изменить</Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm('Удалить?')) onDelete(item.id); }}>Удалить</Button>
                </div>
              </div>
              {item.secondary && <div className={s.rowPreview}>{item.secondary}</div>}
            </>
          )}
        </div>
      ))}

      {editingId === 'new' ? (
        <div className={s.row} style={{ cursor: 'default' }}>
          <Input label="" aria-label="Текст" value={primary} onChange={e => setPrimary(e.target.value)} autoFocus />
          {secondaryLabel && (
            <Textarea label="" aria-label={secondaryLabel} placeholder={secondaryLabel} value={secondary} onChange={e => setSecondary(e.target.value)} rows={2} />
          )}
          <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
            <Button size="sm" loading={saving} onClick={save}>Добавить</Button>
            <Button size="sm" variant="ghost" onClick={cancel}>Отмена</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => startEdit()}>+ Добавить</Button>
      )}
    </div>
  );
}

export function SupportSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'admin' | 'guest' | 'faq'>('admin');
  const st = useSupportSettings();

  return (
    <Sheet open={open} onClose={onClose} title="Настройки чата поддержки">
      <div className={s.head}>
        <Chip active={tab === 'admin'} onClick={() => setTab('admin')}>Фразы для админов</Chip>
        <Chip active={tab === 'guest'} onClick={() => setTab('guest')}>Вопросы гостям</Chip>
        <Chip active={tab === 'faq'} onClick={() => setTab('faq')}>FAQ</Chip>
      </div>

      {tab === 'admin' && (
        <EditableList
          items={st.adminReplies.map(r => ({ id: r.id, primary: r.text }))}
          saving={st.savingReply}
          onSave={(id, text) => st.saveReply({ id: id ?? undefined, text, audience: 'admin' })}
          onDelete={id => st.deleteReply({ id, audience: 'admin' })}
        />
      )}
      {tab === 'guest' && (
        <EditableList
          items={st.guestReplies.map(r => ({ id: r.id, primary: r.text, secondary: r.answer }))}
          secondaryLabel="Ответ (необязательно — покажется гостю сразу, без ожидания администратора)"
          saving={st.savingReply}
          onSave={(id, text, answer) => st.saveReply({ id: id ?? undefined, text, audience: 'guest', answer })}
          onDelete={id => st.deleteReply({ id, audience: 'guest' })}
        />
      )}
      {tab === 'faq' && (
        <EditableList
          items={st.faq.map(f => ({ id: f.id, primary: f.question, secondary: f.answer }))}
          secondaryLabel="Ответ"
          saving={st.savingFaq}
          onSave={(id, question, answer) => st.saveFaq({ id: id ?? undefined, question, answer: answer ?? '' })}
          onDelete={st.deleteFaq}
        />
      )}
    </Sheet>
  );
}
