import { useState } from 'react';
import type { CompEmployeeStatus, CompRequest, CompRequestEmployee, CompVariablePay } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import { useConfirm } from '../../design/Confirm';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import { useSessionData } from '../auth/useSession';
import { compReviewApi } from '../../api/compReview';
import { useCompReasons, useVariablePayKinds, useAttachments } from './useCompReview';
import s from './CompReview.module.css';

const fmt = new Intl.NumberFormat('ru-RU');
const pct = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);
const fmtSize = (bytes: number | null) => {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

function AttachmentsSection({ employeeId, canRemove }: { employeeId: number; canRemove: boolean }) {
  const att = useAttachments(employeeId);
  return (
    <div className={s.vpRow} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s-1)' }}>
      <div className={s.hint} style={{ fontWeight: 600 }}>Файлы{att.rows.length ? ` (${att.rows.length}/10)` : ''}</div>
      {att.rows.map(a => (
        <div key={a.id} className={s.vpRow}>
          <a href={compReviewApi.attachmentDownloadUrl(a.id)} target="_blank" rel="noreferrer">{a.fileName}</a>
          <span className={s.hint}>{fmtSize(a.sizeBytes)}</span>
          {canRemove && <Button size="sm" variant="ghost" onClick={() => att.remove(a.id)}>Убрать</Button>}
        </div>
      ))}
      {!att.rows.length && <span className={s.hint}>Пока нет прикреплённых файлов</span>}
      {att.rows.length < 10 && (
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

const EMP_STATUS_LABEL: Record<CompEmployeeStatus, string> = {
  active: 'В процессе', rejected_hrd: 'Отклонён HRD', rejected_committee: 'Отклонён комиссией',
  approved_awaiting_payroll: 'Одобрен, ждёт кадровика', done: 'Внесено в 1С'
};

function VariablePayLine({ v, onRemove }: { v: CompVariablePay; onRemove?: () => void }) {
  return (
    <div className={s.vpRow}>
      <span>{v.kind}: {v.amountType === 'percent' ? `${v.amount}%` : fmt.format(v.amount)}{v.period ? `, ${v.period}` : ''}{v.isProposed ? ' (предлагается)' : ''}</span>
      {onRemove && <Button size="sm" variant="ghost" onClick={onRemove}>Убрать</Button>}
    </div>
  );
}

const PERIOD_OPTIONS = [
  { value: 'в месяц', label: 'в месяц' },
  { value: 'в квартал', label: 'в квартал' },
  { value: 'в год', label: 'в год' },
  { value: 'разово', label: 'разово' }
];

function AddVariablePayLine({ onAdd }: { onAdd: (a: { kind: string; amount: number; amountType: 'sum' | 'percent'; period?: string; isProposed?: boolean }) => void }) {
  const kinds = useVariablePayKinds();
  const [kind, setKind] = useState('');
  const [amount, setAmount] = useState('');
  const [amountType, setAmountType] = useState<'sum' | 'percent'>('sum');
  const [period, setPeriod] = useState('');
  const [isProposed, setIsProposed] = useState(false);
  const [open, setOpen] = useState(false);

  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>+ добавить вид</Button>;
  return (
    <div className={s.vpRow}>
      <Select label="" aria-label="Вид" placeholder="Вид…" value={kind} onChange={e => setKind(e.target.value)} options={kinds.map(k => ({ value: k, label: k }))} />
      <Input label="" aria-label="Размер" type="number" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 90 }} />
      <Select
        label="" aria-label="Сумма или %" value={amountType} onChange={e => setAmountType(e.target.value as 'sum' | 'percent')}
        options={[{ value: 'sum', label: 'сумма' }, { value: 'percent', label: '%' }]} style={{ width: 90 }}
      />
      <Select label="" aria-label="Периодичность" placeholder="Периодичность…" value={period} onChange={e => setPeriod(e.target.value)} options={PERIOD_OPTIONS} style={{ width: 130 }} />
      <label className={s.hint} style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={isProposed} onChange={e => setIsProposed(e.target.checked)} /> предлагается
      </label>
      <Button
        size="sm"
        disabled={!kind || !(Number(amount) > 0)}
        onClick={() => {
          onAdd({ kind, amount: Number(amount), amountType, period: period || undefined, isProposed: isProposed || undefined });
          setKind(''); setAmount(''); setAmountType('sum'); setPeriod(''); setIsProposed(false); setOpen(false);
        }}
      >
        Добавить
      </Button>
    </div>
  );
}

export function EmployeeCard({ e, request, access, actions }: {
  e: CompRequestEmployee;
  request: CompRequest;
  access: { canReviewCb: boolean; isCommitteeMember: boolean; canPayroll: boolean; isAdmin: boolean };
  actions: {
    remove?: () => void;
    setMarketData: (data: { marketMin?: number; marketMedian?: number; marketMax?: number }) => void;
    vote: (vote: 'for' | 'against', comment?: string) => void;
    forceDecide: (decision: 'approved' | 'rejected') => void;
    remindVoters: () => void;
    markPayrollEntered: (data: { comment?: string; effectiveDate?: string }) => void;
    addVariablePay: (a: { kind: string; amount: number; amountType: 'sum' | 'percent'; period?: string; isProposed?: boolean }) => void;
    removeVariablePay: (id: number) => void;
  };
}) {
  const confirm = useConfirm();
  const { reasons } = useCompReasons();
  const { user } = useSessionData();
  const [minInput, setMinInput] = useState(e.marketMin != null ? String(e.marketMin) : '');
  const [medianInput, setMedianInput] = useState(e.marketMedian != null ? String(e.marketMedian) : '');
  const [maxInput, setMaxInput] = useState(e.marketMax != null ? String(e.marketMax) : '');
  const [voteComment, setVoteComment] = useState('');
  const [payrollComment, setPayrollComment] = useState('');
  const [payrollDate, setPayrollDate] = useState(new Date().toISOString().slice(0, 10));
  const reasonLabel = reasons.find(r => r.code === e.reasonCode)?.label ?? e.reasonCode;

  // Сервер уже маскирует чужие голоса в «закрытом» режиме (voteMode='closed') —
  // votedAt приходит всегда, vote бывает null у чужих голосов до итога.
  const votedCount = e.votes.length;
  const myVote = e.votes.find(v => v.voterLogin === user.login)?.vote ?? null;

  // Оклад не меняется — заявка должна опираться хотя бы на переменную часть,
  // иначе сервер откажет при отправке (submitDraft); подсказка здесь —
  // чтобы это увидели раньше, ещё в черновике.
  const noSalaryChange = e.currentSalary != null && e.proposedSalary === e.currentSalary;
  const hasProposedVp = e.variablePay.some(v => v.isProposed);

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.cardTitle}>{e.fio}</div>
          <div className={s.hint}>{e.unit}{e.position ? `, ${e.position}` : ''}{e.newPosition ? ` → ${e.newPosition}` : ''}</div>
        </div>
        <Badge tone={e.status === 'done' || e.status === 'approved_awaiting_payroll' ? 'ok' : e.status.startsWith('rejected') ? 'muted' : 'neutral'}>
          {EMP_STATUS_LABEL[e.status]}
        </Badge>
      </div>

      <div className={[s.amount, e.growthPercent && e.growthPercent > 0 ? s.amountUp : ''].join(' ')}>
        {e.currentSalary != null ? fmt.format(e.currentSalary) : '—'} → <b>{fmt.format(e.proposedSalary)}</b>
        {e.growthPercent != null && ` (${pct(e.growthPercent)})`}
      </div>

      <div className={s.kpiRow}>
        <span>Последний пересмотр: {e.lastReviewDate ? new Date(e.lastReviewDate).toLocaleDateString('ru-RU') : 'ни разу'}</span>
        {e.hrBpLogin && <span>HR BP: {e.hrBpLogin}</span>}
        {e.hireDate && <span>Дата выхода на работу: {new Date(e.hireDate).toLocaleDateString('ru-RU')}</span>}
        {(e.probationStartDate || e.probationEndDate) && (
          <span>
            Стажировка: {e.probationStartDate ? new Date(e.probationStartDate).toLocaleDateString('ru-RU') : '—'}
            {' – '}
            {e.probationEndDate ? new Date(e.probationEndDate).toLocaleDateString('ru-RU') : '—'}
          </span>
        )}
        {e.gradePayFrom != null && e.gradePayTo != null && (
          <span>Вилка {fmt.format(e.gradePayFrom)}–{fmt.format(e.gradePayTo)} · положение {pct(e.vilkaBefore)} → {pct(e.vilkaAfter)}</span>
        )}
        {(e.marketMin != null || e.marketMedian != null || e.marketMax != null) && (
          <span>
            Рынок: {e.marketMin != null ? fmt.format(e.marketMin) : '—'} / {e.marketMedian != null ? fmt.format(e.marketMedian) : '—'} / {e.marketMax != null ? fmt.format(e.marketMax) : '—'}
            {e.compaRatio != null && ` · compa-ratio ${e.compaRatio}`}
          </span>
        )}
        {e.isException && <Badge tone="warn">исключение из правила 6 мес.</Badge>}
      </div>

      <div className={s.hint}>{reasonLabel}{e.reasonText ? ` — ${e.reasonText}` : ''}</div>

      {noSalaryChange && !hasProposedVp && request.status === 'draft' && (
        <Badge tone="warn">Оклад не меняется — добавьте предлагаемое изменение переменной части ниже</Badge>
      )}

      {e.variablePay.map(v => (
        <VariablePayLine key={v.id} v={v} onRemove={request.status === 'draft' ? () => actions.removeVariablePay(v.id) : undefined} />
      ))}
      {request.status === 'draft' && <AddVariablePayLine onAdd={actions.addVariablePay} />}

      {/* C&B: рыночный диапазон */}
      {request.status === 'cb_review' && access.canReviewCb && (
        <div className={s.vpRow}>
          <Input label="" aria-label="Минимум рынка" type="number" placeholder="Мин." value={minInput} onChange={e2 => setMinInput(e2.target.value)} style={{ maxWidth: 120 }} />
          <Input label="" aria-label="Медиана рынка" type="number" placeholder="Медиана (или пусто — из бенчмаркинга)" value={medianInput} onChange={e2 => setMedianInput(e2.target.value)} style={{ maxWidth: 200 }} />
          <Input label="" aria-label="Максимум рынка" type="number" placeholder="Макс." value={maxInput} onChange={e2 => setMaxInput(e2.target.value)} style={{ maxWidth: 120 }} />
          <Button
            size="sm"
            onClick={() => actions.setMarketData({
              marketMin: minInput.trim() ? Number(minInput) : undefined,
              marketMedian: medianInput.trim() ? Number(medianInput) : undefined,
              marketMax: maxInput.trim() ? Number(maxInput) : undefined
            })}
          >
            Сохранить
          </Button>
        </div>
      )}

      {/* Комиссия: голосование */}
      {request.status === 'committee' && e.status === 'active' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
          <div className={s.hint}>Проголосовало: {votedCount} из {request.committeeSize}</div>
          {access.isCommitteeMember && (
            <>
              {myVote && <div className={s.hint}>Ваш голос: <b>{myVote === 'for' ? 'за' : 'против'}</b> — можно изменить, пока не подведён итог</div>}
              <Input label="Комментарий (необязательно)" value={voteComment} onChange={e2 => setVoteComment(e2.target.value)} />
              <div className={s.cardFoot}>
                <Button
                  size="sm" variant={myVote === 'against' ? 'danger' : 'secondary'}
                  onClick={() => actions.vote('against', voteComment.trim() || undefined)}
                >
                  {myVote === 'against' ? '✓ Против' : 'Против'}
                </Button>
                <Button
                  size="sm" variant={myVote === 'for' ? 'primary' : 'secondary'}
                  onClick={() => actions.vote('for', voteComment.trim() || undefined)}
                >
                  {myVote === 'for' ? '✓ За' : 'За'}
                </Button>
              </div>
            </>
          )}
          {(access.canReviewCb || access.isAdmin) && (
            <div className={s.cardFoot}>
              <Button size="sm" variant="secondary" onClick={actions.remindVoters}>Напомнить не проголосовавшим</Button>
              {access.isAdmin && (
                <>
                  <Button
                    size="sm" variant="danger"
                    onClick={async () => { if (await confirm({ message: 'Принудительно отклонить, не дожидаясь комиссии?', danger: true })) actions.forceDecide('rejected'); }}
                  >
                    Принудительно отклонить
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => { if (await confirm('Принудительно одобрить, не дожидаясь комиссии?')) actions.forceDecide('approved'); }}
                  >
                    Принудительно одобрить
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Кадровик */}
      {e.status === 'approved_awaiting_payroll' && access.canPayroll && (
        <div className={s.cardFoot} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s-2)' }}>
          <div className={s.vpRow}>
            <Input label="Дата внедрения" type="date" value={payrollDate} onChange={e2 => setPayrollDate(e2.target.value)} style={{ maxWidth: 160 }} />
            <Input label="Комментарий" aria-label="Комментарий кадровика" placeholder="Необязательно" value={payrollComment} onChange={e2 => setPayrollComment(e2.target.value)} style={{ minWidth: 200 }} />
          </div>
          <Button
            size="sm"
            onClick={async () => {
              if (await confirm(`Отметить, что изменение оклада «${e.fio}» внесено в 1С?`)) {
                actions.markPayrollEntered({ comment: payrollComment.trim() || undefined, effectiveDate: payrollDate || undefined });
              }
            }}
          >
            Внесено в 1С
          </Button>
        </div>
      )}
      {e.status === 'done' && (e.payrollComment || e.payrollEffectiveDate) && (
        <div className={s.hint}>
          Внедрено{e.payrollEffectiveDate ? ` ${new Date(e.payrollEffectiveDate).toLocaleDateString('ru-RU')}` : ''}
          {e.payrollComment ? ` — ${e.payrollComment}` : ''}
        </div>
      )}
      <AttachmentsSection employeeId={e.id} canRemove={request.status === 'draft'} />

      {request.status === 'draft' && actions.remove && (
        <div className={s.cardFoot}>
          <Button size="sm" variant="ghost" onClick={actions.remove}>Убрать из заявки</Button>
        </div>
      )}
    </div>
  );
}
