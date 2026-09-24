import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Badge, type BadgeTone } from '../../design/Badge';
import { Button } from '../../design/Button';
import { useConfirm } from '../../design/Confirm';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import { Skeleton } from '../../design/Skeleton';
import { Textarea } from '../../design/Textarea';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import { EmployeeAddForm } from './EmployeeAddForm';
import { EmployeeCard } from './EmployeeCard';
import { useCompAccess, useCompReasons, useCompRequest } from './useCompReview';
import type { CompRequestStatus } from '../../api/contract';
import s from './CompReview.module.css';

const STATUS_LABEL: Record<CompRequestStatus, string> = {
  draft: 'Черновик', cb_review: 'Проверка C&B', hrd_review: 'Согласование HRD',
  committee: 'Голосование комиссии', payroll: 'У кадровика', closed: 'Закрыта'
};
const STATUS_TONE: Record<CompRequestStatus, BadgeTone> = {
  draft: 'muted', cb_review: 'neutral', hrd_review: 'neutral', committee: 'warn', payroll: 'warn', closed: 'ok'
};

export function RequestScreen() {
  useScreenTitle('Заявка на пересмотр ЗП');
  const { id } = useParams();
  const requestId = Number(id);
  const navigate = useNavigate();
  const { user } = useSessionData();
  const access = useCompAccess();
  const { requestTypes } = useCompReasons();
  const confirm = useConfirm();
  const req = useCompRequest(requestId);
  const [cbReturnComment, setCbReturnComment] = useState('');
  const [hrdRejectComment, setHrdRejectComment] = useState('');
  const [comment, setComment] = useState('');

  if (req.loading) return <Skeleton lines={8} />;
  if (req.error || !req.request) return <p className={s.empty}>Заявка не найдена или недоступна</p>;

  const r = req.request;
  const isDraft = r.status === 'draft';
  const isOwner = r.initiatorLogin === user.login || user.role === 'admin';
  const canEditDraft = isDraft && isOwner;

  return (
    <div data-wide>
      <div className={s.head}>
        <div>
          <div className={s.cardTitle}>Заявка #{r.id}</div>
          <div className={s.hint}>Инициатор: {r.initiatorLogin} · создана {new Date(r.createdAt.replace(' ', 'T')).toLocaleString('ru-RU')}</div>
        </div>
        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
      </div>

      <div className={s.card} style={{ marginBottom: 'var(--s-4)' }}>
        {canEditDraft ? (
          <div className={s.row2}>
            <Select
              label="Тип заявки" value={r.requestType} options={requestTypes.map(t => ({ value: t.code, label: t.label }))}
              onChange={e => req.updateHeader({ requestType: e.target.value as typeof r.requestType })}
            />
            <Input label="Подразделение" value={r.unit} onChange={e => req.updateHeader({ unit: e.target.value })} />
            <Input label="Дата вступления в силу" type="date" value={r.effectiveDate ?? ''} onChange={e => req.updateHeader({ effectiveDate: e.target.value })} />
            <Input label="Документ-основание" value={r.basisDocument} onChange={e => req.updateHeader({ basisDocument: e.target.value })} />
          </div>
        ) : (
          <div className={s.kpiRow}>
            <span>Тип: {requestTypes.find(t => t.code === r.requestType)?.label ?? r.requestType}</span>
            {r.unit && <span>Подразделение: {r.unit}</span>}
            {r.effectiveDate && <span>Дата вступления в силу: {r.effectiveDate}</span>}
          </div>
        )}
        {canEditDraft ? (
          <Textarea label="Общий комментарий" value={r.comment} onChange={e => req.updateHeader({ comment: e.target.value })} rows={2} />
        ) : r.comment ? <div className={s.hint}>{r.comment}</div> : null}
      </div>

      <div className={s.list}>
        {r.employees.map(e => (
          <EmployeeCard
            key={e.id} e={e} request={r}
            access={{ canReviewCb: access.canReviewCb, isCommitteeMember: access.isCommitteeMember, canPayroll: access.canPayroll, isAdmin: access.isAdmin }}
            actions={{
              remove: canEditDraft ? () => req.removeEmployee(e.id) : undefined,
              setMarketData: median => req.setMarketData({ employeeId: e.id, marketMedian: median }),
              vote: (vote, c) => req.vote({ employeeId: e.id, vote, comment: c }),
              forceDecide: decision => req.forceDecide({ employeeId: e.id, decision }),
              remindVoters: () => req.remindVoters(e.id),
              markPayrollEntered: () => req.markPayrollEntered(e.id),
              addVariablePay: data => req.addVariablePay({ employeeId: e.id, data }),
              removeVariablePay: variablePayId => req.removeVariablePay(variablePayId)
            }}
          />
        ))}
        {!r.employees.length && <p className={s.empty}>В заявке пока нет сотрудников</p>}
      </div>

      {canEditDraft && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <EmployeeAddForm onAdd={data => req.addEmployee(data)} adding={false} />
        </div>
      )}

      <div className={s.formFoot} style={{ marginTop: 'var(--s-4)' }}>
        {canEditDraft && (
          <>
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirm({ message: 'Удалить черновик безвозвратно?', danger: true })) { await req.deleteDraft(undefined); navigate('/comp'); }
              }}
            >
              Удалить черновик
            </Button>
            <Button loading={req.submitting} disabled={!r.employees.length} onClick={() => req.submit(undefined)}>Отправить на проверку C&B</Button>
          </>
        )}

        {r.status === 'cb_review' && access.canReviewCb && (
          <>
            <Input label="" aria-label="Комментарий к возврату" placeholder="Комментарий к возврату на доработку" value={cbReturnComment} onChange={e => setCbReturnComment(e.target.value)} style={{ minWidth: 260 }} />
            <Button variant="secondary" disabled={!cbReturnComment.trim()} onClick={() => { req.cbReturn(cbReturnComment); setCbReturnComment(''); }}>Вернуть на доработку</Button>
            <Button onClick={() => req.cbForward(undefined)}>Передать на согласование HRD</Button>
          </>
        )}

        {r.status === 'hrd_review' && access.canApproveHrd && (
          <>
            <Input label="" aria-label="Комментарий к отклонению" placeholder="Комментарий к отклонению" value={hrdRejectComment} onChange={e => setHrdRejectComment(e.target.value)} style={{ minWidth: 260 }} />
            <Button variant="danger" disabled={!hrdRejectComment.trim()} onClick={() => { req.hrdReject(hrdRejectComment); setHrdRejectComment(''); }}>Отклонить</Button>
            <Button onClick={() => req.hrdApprove(undefined)}>Согласовать</Button>
          </>
        )}
      </div>

      <div style={{ marginTop: 'var(--s-4)' }}>
        <h4 className={s.hint}>Лента</h4>
        <div className={s.feed}>
          {r.activity.map(a => (
            <div key={a.id} className={s.feedItem}>
              <span className={s.feedMeta}>{new Date(a.createdAt.replace(' ', 'T')).toLocaleString('ru-RU')} · {a.actorLogin}</span>
              {' — '}{a.action}{a.employeeFio ? ` (${a.employeeFio})` : ''}{a.comment ? `: ${a.comment}` : ''}
            </div>
          ))}
        </div>
        <div className={s.formFoot} style={{ marginTop: 'var(--s-2)' }}>
          <Input label="" aria-label="Комментарий" placeholder="Добавить комментарий" value={comment} onChange={e => setComment(e.target.value)} style={{ minWidth: 260 }} />
          <Button variant="secondary" disabled={!comment.trim()} onClick={() => { req.addComment(comment); setComment(''); }}>Отправить</Button>
        </div>
      </div>
    </div>
  );
}
