import fx from '../../../test/fixtures/surveyValidation.json';
import { validateSurveyItem, isStarted } from './validation';
import type { SurveyDraft } from '../api/contract';

type Case = {
  name: string; item: Record<string, unknown>; ok: boolean; field?: string;
  started?: boolean; payFrom?: number; payTo?: number; company?: string; note?: string; cur?: string;
};

// Те же кейсы, что гоняет сервер (test/surveyValidation.test.js). Расхождение
// правил между клиентом и сервером ловится здесь, а не на живом сборе.
for (const c of fx.cases as Case[]) {
  test('валидация: ' + c.name, () => {
    const r = validateSurveyItem(c.item as Partial<SurveyDraft>, fx.refs);
    expect(r.ok).toBe(c.ok);
    if (!r.ok && c.field) expect(r.fields[c.field]).toBeTruthy();
    if (c.started !== undefined) expect(isStarted(c.item as Partial<SurveyDraft>)).toBe(c.started);
    if (r.ok && c.payFrom !== undefined) expect(r.value.payFrom).toBe(c.payFrom);
    if (r.ok && c.payTo !== undefined) expect(r.value.payTo).toBe(c.payTo);
    if (r.ok && c.company !== undefined) expect(r.value.company).toBe(c.company);
    if (r.ok && c.note !== undefined) expect(r.value.note).toBe(c.note);
    if (r.ok && c.cur !== undefined) expect(r.value.cur).toBe(c.cur);
  });
}

test('список валют клиента совпадает с серверным', async () => {
  const { CURRENCIES, PAY_PERIODS } = await import('./currency');
  const fs = await import('node:fs');
  const path = await import('node:path');
  // vitest запускается из web/ — сервер лежит на уровень выше.
  const src = fs.readFileSync(path.resolve(process.cwd(), '../src/controllers/surveyController.js'), 'utf8');
  const cur = /const ALLOWED_CURRENCIES = \[([^\]]+)\]/.exec(src)![1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  const per = /const ALLOWED_PAY_PERIODS = \[([^\]]+)\]/.exec(src)![1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  expect([...CURRENCIES]).toEqual(cur);
  expect([...PAY_PERIODS]).toEqual(per);
});
