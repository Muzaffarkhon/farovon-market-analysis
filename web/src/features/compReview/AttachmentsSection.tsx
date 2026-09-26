import type { CompAttachment, CompAttachTokenResponse } from '../../api/contract';
import { Button } from '../../design/Button';
import { compReviewApi } from '../../api/compReview';
import s from './CompReview.module.css';

const fmtSize = (bytes: number | null) => {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

/** Список файлов + кнопка «Прикрепить через Telegram» — общий вид для файлов
 *  сотрудника (EmployeeCard) и файла-основания заявки (RequestScreen),
 *  различаются только тем, к чему привязан hook (useAttachments/useRequestAttachments). */
export function AttachmentsSection({ label, max, canRemove, att }: {
  label: string;
  max: number;
  canRemove: boolean;
  att: {
    rows: CompAttachment[]; polling: boolean;
    requestToken: () => Promise<CompAttachTokenResponse>; requestingToken: boolean;
    remove: (attachmentId: number) => void;
  };
}) {
  return (
    <div className={s.vpRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s-1)' }}>
      <div className={s.hint} style={{ fontWeight: 600 }}>{label}{att.rows.length ? ` (${att.rows.length}/${max})` : ''}</div>
      {att.rows.map(a => (
        <div key={a.id} className={s.vpRow}>
          <a href={compReviewApi.attachmentDownloadUrl(a.id)} target="_blank" rel="noreferrer">{a.fileName}</a>
          <span className={s.hint}>{fmtSize(a.sizeBytes)}</span>
          {canRemove && <Button size="sm" variant="ghost" onClick={() => att.remove(a.id)}>Убрать</Button>}
        </div>
      ))}
      {!att.rows.length && <span className={s.hint}>Пока нет прикреплённых файлов</span>}
      {att.rows.length < max && (
        <Button
          size="sm" variant="secondary" loading={att.requestingToken}
          onClick={async () => {
            // Открываем вкладку синхронно в обработчике клика, иначе браузер
            // (особенно на телефоне) считает её всплывающим окном без связи
            // с действием пользователя и молча блокирует — ссылка "не работает".
            const tab = window.open('', '_blank');
            try {
              const r = await att.requestToken();
              if (tab) tab.location.href = r.deepLink; else window.open(r.deepLink, '_blank');
            } catch {
              tab?.close();
              // тост об ошибке уже показан внутри useAttachments (onError мутации)
            }
          }}
        >
          📎 Прикрепить через Telegram
        </Button>
      )}
      {att.polling && <span className={s.hint}>Ждём файл из Telegram — появится здесь сам…</span>}
    </div>
  );
}
