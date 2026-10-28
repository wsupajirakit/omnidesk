/**
 * [FEAT-20261014-LOGREDACT] The prefetch audit log stops storing the loan partner's personal data.
 * ============================================================================
 * Driven through the shipped `getCombinedData` with the real tool and the partner's real
 * answers (`z-test/lib/loan-v1-upstream.ts`); what is asserted is what reaches the
 * `webhook_logs` writer. TARGET: loan_v1 bound ⇒ declared personal fields are `[redacted]`,
 * everything else (money, dates, statuses, contract code) is as answered, and the data the
 * BOT uses is untouched. PIN: unbound / shop-api ⇒ the row carries the very same object.
 */
import {
  DEFAULT_CUSTOMER_PROVIDER,
  REDACTED,
  bindActiveProvider,
  buildCustomerProviderRegistry,
  redactForLog,
  resetActiveProvider,
} from '@/modules/customer-provider';
import type { CustomToolService } from '@/modules/external';
import { type WebhookLogWriter } from '@/modules/system';

import {
  LOAN_FIXTURE,
  answerWith,
  makeLoanToolService,
} from '../lib/loan-v1-upstream';

jest.mock('axios');

const LOAN = buildCustomerProviderRegistry().get('loan_v1')!;
type Row = { action_type: string; raw_response: unknown };
/* walk an untyped JSON answer by keys — the test only reads what the fixture holds */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function fetchAndCaptureLogs(): Promise<{
  rows: Row[];
  combined: Record<string, { data?: unknown }>;
}> {
  const svc: CustomToolService = await makeLoanToolService();
  const wlog = (svc as unknown as { wlog: WebhookLogWriter })
    .wlog as unknown as { persist: jest.Mock };
  answerWith((f) => f.success);
  const combined = (await svc.getCombinedData(
    'U00000000000000000000000000000000',
    {
      _id: 'h1',
      alias: 'loan-oa',
    } as never,
  )) as Record<string, { data?: unknown }>;
  await new Promise((r) => setImmediate(r));
  return { rows: wlog.persist.mock.calls.map((c) => c[0] as Row), combined };
}
const rowFor = (rows: Row[], key: string) =>
  rows.find(
    (r) => r.action_type === `customer_link_fetch_${key.toLowerCase()}`,
  )!;

afterEach(() => resetActiveProvider());

describe('[LOGREDACT] TARGET — loan_v1: personal fields never reach webhook_logs verbatim', () => {
  beforeEach(() => bindActiveProvider(LOAN));

  it('the php member block: national id, names, phone, LINE uid, photo are redacted', async () => {
    const { rows } = await fetchAndCaptureLogs();
    const member = (rowFor(rows, 'INSTALLMENT_CURRENT').raw_response as Json)
      .data.member;
    for (const k of [
      'identityNumber',
      'name',
      'nickname',
      'tel',
      'lineUid',
      'profile',
    ]) {
      expect({ k, v: member[k] }).toEqual({ k, v: REDACTED });
    }
    /* non-personal member fields are kept */
    expect(member.id).toBe(
      (LOAN_FIXTURE['INSTALLMENT_CURRENT']!.success.body as Json).data.member
        .id,
    );
  });

  it('the profile: customer name/phone redacted; the contract number and money kept', async () => {
    const { rows } = await fetchAndCaptureLogs();
    const d = (rowFor(rows, 'CUSTOMER_PROFILE').raw_response as Json).data;
    const real = (LOAN_FIXTURE['CUSTOMER_PROFILE']!.success.body as Json).data;
    expect(d.customer.customer_name).toBe(REDACTED);
    expect(d.customer.customer_tel).toBe(REDACTED);
    expect(d.contract.contract_number).toBe(real.contract.contract_number);
    expect(d.installment).toEqual(real.installment);
  });

  it('a product NAME is not a person — kept (path, not key, decides)', async () => {
    const { rows } = await fetchAndCaptureLogs();
    const p = (rowFor(rows, 'INSTALLMENT_CURRENT').raw_response as Json).data
      .product;
    expect(p.name).toBe(
      (LOAN_FIXTURE['INSTALLMENT_CURRENT']!.success.body as Json).data.product
        .name,
    );
  });

  it('🔴 the data the BOT uses is untouched — only the log copy is redacted', async () => {
    const { combined } = await fetchAndCaptureLogs();
    expect(combined['INSTALLMENT_CURRENT']!.data).toEqual(
      LOAN_FIXTURE['INSTALLMENT_CURRENT']!.success.body,
    );
  });
});

describe('[LOGREDACT] 🔴 PIN — no declaration: the log row carries the same object', () => {
  it.each([
    ['unbound', () => resetActiveProvider()],
    ['shopapi_v1 bound', () => bindActiveProvider(DEFAULT_CUSTOMER_PROVIDER)],
  ])('%s', async (_l, bind) => {
    bind();
    const { rows, combined } = await fetchAndCaptureLogs();
    expect(rowFor(rows, 'INSTALLMENT_CURRENT').raw_response).toBe(
      combined['INSTALLMENT_CURRENT']!.data,
    );
  });

  it('redactForLog with no paths returns its input by reference', () => {
    const v = { a: { b: 1 } };
    expect(redactForLog(v, [])).toBe(v);
  });
});
