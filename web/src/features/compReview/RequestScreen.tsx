import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Badge, type BadgeTone } from '../../design/Badge';
import { Button } from '../../design/Button';
import { Combobox } from '../../design/Combobox';
import { useConfirm } from '../../design/Confirm';
import { Input } from '../../design/Input';
import { Select } from '../../design/Select';
import { Skeleton } from '../../design/Skeleton';
import { Textarea } from '../../design/Textarea';
import { useSessionData } from '../auth/useSession';
import { useScreenTitle } from '../shell/Shell';
import { EmployeeAddForm } from './EmployeeAddForm';
import { EmployeeCard } from './EmployeeCard';
import { useCompAccess, useCompReasons, useCompRequest, useUnitOptions } from './useCompReview';
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
  useScreenTitle('Заявка на изменение ЗП');
  const { id } = useParams();
  const requestId = Number(id);
  const navigate = useNavigate();
  const { user } = useSessionData();
  const access = useCompAccess();
  const { requestTypes } = useCompReasons();
  const confirm = useConfirm();
  const req = useCompRequest(requestId);
  const unitOptions = useUnitOptions();
  const [cbReturnComment, setCbReturnComment] = useState('');
  const [hrdRejectComment, setHrdRejectComment] = useState('');
  const [comment, setComment] = useState('');
  const [basisDocumentDraft, setBasisDocumentDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [effectiveDateDraft, setEffectiveDateDraft] = useState('');

  useEffect(() => {
    if (req.request) {
      setBasisDocumentDraft(req.request.basisDocument ?? '');
      setCommentDraft(req.request.comment ?? '');
      setEffectiveDateDraft(req.request.effectiveDate ?? '');
    }
  }, [req.request?.id]);

  if (req.loading) return <Skeleton lines={8} />;
  if (req.error || !req.request) return <p className={s.empty}>Заявка не найдена или недоступна</p>;

  const r = req.request;
  const isDraft = r.status === 'draft';
  const isOwner = r.initiatorLogin === user.login || user.role === 'admin';
  const canEditDraft = isDraft && isOwner;
  // Экран кадровика урезан по ТЗ (§4 comp-review-design.md): только ФИО,
  // подразделение, должность, новый оклад, новые переменные части, дата
  // вступления в силу, номер заявки и кнопка «Внесено в 1С» — без
  // обоснований, рыночных данных, грейда и ленты с чужими голосами и
  // комментариями. Действует только пока у человека нет другой роли в
  // маршруте — тогда он видит всё как обычно.
  const isPayrollOnly = access.canPayroll && !access.isAdmin && !access.canReviewCb
    && !access.canApproveHrd && !access.isCommitteeMember && !isOwner;

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
            <Combobox
              label="Подразделение" options={unitOptions.options} loading={unitOptions.loading}
              value={r.unit} onChange={unit => req.updateHeader({ unit })}
            />
            <Input
              label="Дата вступления в силу" type="date" value={effectiveDateDraft}
              onChange={e => setEffectiveDateDraft(e.target.value)}
              onBlur={() => { if (effectiveDateDraft !== (r.effectiveDate ?? '')) req.updateHeader({ effectiveDate: effectiveDateDraft }); }}
            />
            <Input
              label="Документ-основание" value={basisDocumentDraft}
              onChange={e => setBasisDocumentDraft(e.target.value)}
              onBlur={() => { if (basisDocumentDraft !== r.basisDocument) req.updateHeader({ basisDocument: basisDocumentDraft }); }}
            />
          </div>
        ) : (
          <div className={s.kpiRow}>
            {!isPayrollOnly && <span><span className={s.metaLabel}>Тип:</span> {requestTypes.find(t => t.code === r.requestType)?.label ?? r.requestType}</span>}
            {r.unit && <span><span className={s.metaLabel}>Подразделение:</span> {r.unit}</span>}
            {r.effectiveDate && <span><span className={s.metaLabel}>Дата вступления в силу:</span> {r.effectiveDate}</span>}
          </div>
        )}
        {canEditDraft ? (
          <Textarea
            label="Общий комментарий" value={commentDraft}
            onChange={e => setCommentDraft(e.target.value)}
            onBlur={() => { if (commentDraft !== r.comment) req.updateHeader({ comment: commentDraft }); }}
            rows={2}
          />
        ) : (r.comment && !isPayrollOnly) ? <div className={s.hint}>{r.comment}</div> : null}
      </div>

      <div className={s.list}>
        {r.employees.map(e => (
          <EmployeeCard
            key={e.id} e={e} request={r}
            access={{ canReviewCb: access.canReviewCb, isCommitteeMember: access.isCommitteeMember, canPayroll: access.canPayroll, isAdmin: access.isAdmin, restricted: isPayrollOnly }}
            actions={{
              remove: canEditDraft ? () => req.removeEmployee(e.id) : undefined,
              setMarketData: data => req.setMarketData({ employeeId: e.id, ...data }),
              vote: (vote, c) => req.vote({ employeeId: e.id, vote, comment: c }),
              forceDecide: decision => req.forceDecide({ employeeId: e.id, decision }),
              remindVoters: () => req.remindVoters(e.id),
              markPayrollEntered: data => req.markPayrollEntered({ employeeId: e.id, ...data }),
              addVariablePay: data => req.addVariablePay({ employeeId: e.id, data }),
              removeVariablePay: variablePayId => req.removeVariablePay(variablePayId)
            }}
          />
        ))}
        {!r.employees.length && <p className={s.empty}>В заявке пока нет сотрудников</p>}
      </div>

      {canEditDraft && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <EmployeeAddForm onAdd={data => req.addEmployee(data)} adding={false} unit={r.unit} requestType={r.requestType} />
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

      {!isPayrollOnly && (
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
      )}
    </div>
  );
}
