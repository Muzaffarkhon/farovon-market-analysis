import { useState } from 'react';
import type { CompEmployeeStatus, CompRequest, CompRequestEmployee, CompVariablePay } from '../../api/contract';
import { Badge } from '../../design/Badge';
import { Button } from '../../design/Button';
import { useConfirm } from '../../design/Confirm';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import { useCompReasons, useVariablePayKinds } from './useCompReview';
import s from './CompReview.module.css';

const fmt = new Intl.NumberFormat('ru-RU');
const pct = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);

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

function AddVariablePayLine({ onAdd }: { onAdd: (a: { kind: string; amount: number; amountType: 'sum' | 'percent'; period?: string; isProposed?: boolean }) => void }) {
  const kinds = useVariablePayKinds();
  const [kind, setKind] = useState('');
  const [amount, setAmount] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>+ добавить вид</Button>;
  return (
    <div className={s.vpRow}>
      <Select label="" aria-label="Вид" placeholder="Вид…" value={kind} onChange={e => setKind(e.target.value)} options={kinds.map(k => ({ value: k, label: k }))} />
      <Input label="" aria-label="Размер" type="number" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 100 }} />
      <Button
        size="sm"
        disabled={!kind || !(Number(amount) > 0)}
        onClick={() => { onAdd({ kind, amount: Number(amount), amountType: 'sum' }); setKind(''); setAmount(''); setOpen(false); }}
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
    setMarketData: (median?: number) => void;
    vote: (vote: 'for' | 'against', comment?: string) => void;
    forceDecide: (decision: 'approved' | 'rejected') => void;
    remindVoters: () => void;
    markPayrollEntered: () => void;
    addVariablePay: (a: { kind: string; amount: number; amountType: 'sum' | 'percent'; period?: string; isProposed?: boolean }) => void;
    removeVariablePay: (id: number) => void;
  };
}) {
  const confirm = useConfirm();
  const { reasons } = useCompReasons();
  const [medianInput, setMedianInput] = useState(e.marketMedian != null ? String(e.marketMedian) : '');
  const [voteComment, setVoteComment] = useState('');
  const reasonLabel = reasons.find(r => r.code === e.reasonCode)?.label ?? e.reasonCode;

  // Сервер уже маскирует чужие голоса в «закрытом» режиме (voteMode='closed') —
  // votedAt приходит всегда, vote бывает null у чужих голосов до итога.
  const votedCount = e.votes.length;

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.cardTitle}>{e.fio}</div>
          <div className={s.hint}>{e.unit}{e.position ? `, ${e.position}` : ''}</div>
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
        {e.gradePayFrom != null && e.gradePayTo != null && (
          <span>Вилка {fmt.format(e.gradePayFrom)}–{fmt.format(e.gradePayTo)} · положение {pct(e.vilkaBefore)} → {pct(e.vilkaAfter)}</span>
        )}
        {e.marketMedian != null && <span>Медиана рынка {fmt.format(e.marketMedian)} · compa-ratio {e.compaRatio}</span>}
        {e.isException && <Badge tone="warn">исключение из правила 6 мес.</Badge>}
      </div>

      <div className={s.hint}>{reasonLabel}{e.reasonText ? ` — ${e.reasonText}` : ''}</div>

      {e.variablePay.map(v => (
        <VariablePayLine key={v.id} v={v} onRemove={request.status === 'draft' ? () => actions.removeVariablePay(v.id) : undefined} />
      ))}
      {request.status === 'draft' && <AddVariablePayLine onAdd={actions.addVariablePay} />}

      {/* C&B: рыночная медиана */}
      {request.status === 'cb_review' && access.canReviewCb && (
        <div className={s.vpRow}>
          <Input label="" aria-label="Рыночная медиана" type="number" placeholder="Медиана рынка" value={medianInput} onChange={e2 => setMedianInput(e2.target.value)} style={{ maxWidth: 160 }} />
          <Button size="sm" onClick={() => actions.setMarketData(medianInput.trim() ? Number(medianInput) : undefined)}>Сохранить / подтянуть из бенчмаркинга</Button>
        </div>
      )}

      {/* Комиссия: голосование */}
      {request.status === 'committee' && e.status === 'active' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
          <div className={s.hint}>Проголосовало: {votedCount} из {request.committeeSize}</div>
          {access.isCommitteeMember && (
            <>
              <Input label="Комментарий (необязательно)" value={voteComment} onChange={e2 => setVoteComment(e2.target.value)} />
              <div className={s.cardFoot}>
                <Button size="sm" variant="danger" onClick={() => actions.vote('against', voteComment.trim() || undefined)}>Против</Button>
                <Button size="sm" onClick={() => actions.vote('for', voteComment.trim() || undefined)}>За</Button>
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
        <div className={s.cardFoot}>
          <Button
            size="sm"
            onClick={async () => { if (await confirm(`Отметить, что изменение оклада «${e.fio}» внесено в 1С?`)) actions.markPayrollEntered(); }}
          >
            Внесено в 1С
          </Button>
        </div>
      )}

      {request.status === 'draft' && actions.remove && (
        <div className={s.cardFoot}>
          <Button size="sm" variant="ghost" onClick={actions.remove}>Убрать из заявки</Button>
        </div>
      )}
    </div>
  );
}
