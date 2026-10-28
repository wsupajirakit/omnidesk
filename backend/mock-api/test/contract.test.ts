/* The two mocks are separate services but tell ONE story: the backend reads a member's
   statements from member-api (`data.profile.transaction.statement[]`) and uploads the slip to
   walletpay-api using the refId inside them. Every such refId must exist there, same amount. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const members = JSON.parse(readFileSync(new URL('../apps/member-api/data/members.json', import.meta.url), 'utf8')) as {
  accounts: Array<{ profile: { transaction?: { statement?: Array<{ amount: number; provider_code: string; info: { trade_no: string; response: { data: { id: string } } } }> } } }>;
};
const payins = JSON.parse(readFileSync(new URL('../apps/walletpay-api/data/payins.json', import.meta.url), 'utf8')) as { payins: Array<{ refId: string; amount: number }> };

test('every walletpay statement in member-api points at a known pay-in with the same amount', () => {
  const stmts = members.accounts.flatMap((a) => a.profile.transaction?.statement ?? []).filter((s) => s.provider_code === 'walletpay');
  assert.ok(stmts.length > 0);
  for (const s of stmts) {
    assert.equal(s.info.trade_no, s.info.response.data.id);
    const p = payins.payins.find((x) => x.refId === s.info.trade_no);
    assert.ok(p, `statement refId ${s.info.trade_no} has no pay-in`);
    assert.equal(p.amount, s.amount);
  }
});
