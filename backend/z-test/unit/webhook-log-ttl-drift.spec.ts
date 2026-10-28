/**
 * [FEAT-20260821-WLOGTTLDRIFT] The retention number lives in ONE place and the
 * drift check reads the live index honestly — every shape a real database can
 * hold is a case here, including the two traps the schema comment warns about.
 */
import {
  WEBHOOK_LOG_TTL_DAYS,
  WEBHOOK_LOG_TTL_INDEX_NAME,
  WEBHOOK_LOG_TTL_SECONDS,
  webhookLogTtlDrift,
} from '@/modules/system';

describe('the one number', () => {
  it('is 45 days, in seconds, and the index name carries the same number', () => {
    expect(WEBHOOK_LOG_TTL_DAYS).toBe(45);
    expect(WEBHOOK_LOG_TTL_SECONDS).toBe(3_888_000);
    expect(WEBHOOK_LOG_TTL_INDEX_NAME).toBe('created_at_ttl45');
  });
});

describe('webhookLogTtlDrift', () => {
  const ok = {
    name: 'created_at_ttl45',
    key: { created_at: 1 },
    expireAfterSeconds: 3_888_000,
  };
  const others = [
    { name: '_id_', key: { _id: 1 } },
    { name: 'status_1_created_at_-1', key: { status: 1, created_at: -1 } },
  ];

  it('null when the live index matches the code', () => {
    expect(webhookLogTtlDrift([...others, ok])).toBeNull();
  });
  it('names the drift when the database still expires at 30 days (seen live 21/08)', () => {
    const d = webhookLogTtlDrift([
      ...others,
      { ...ok, name: 'created_at_ttl30', expireAfterSeconds: 2_592_000 },
    ]);
    expect(d).toContain('30 days');
    expect(d).toContain('code says 45');
    expect(d).toContain('set-log-retention.js --yes');
  });
  it('names the drift when the legacy 90-day index is still there', () => {
    expect(
      webhookLogTtlDrift([
        ...others,
        {
          name: 'created_at_1',
          key: { created_at: 1 },
          expireAfterSeconds: 7_776_000,
        },
      ]),
    ).toContain('90 days');
  });
  it('warns when there is no TTL index at all', () => {
    expect(webhookLogTtlDrift(others)).toContain('NO TTL index');
  });
  it('warns on the name trap: right seconds under a wrong name', () => {
    expect(webhookLogTtlDrift([{ ...ok, name: 'created_at_ttl30' }])).toContain(
      'expected "created_at_ttl45"',
    );
  });
  it('ignores a compound index that merely starts with created_at', () => {
    expect(
      webhookLogTtlDrift([
        ok,
        {
          name: 'created_at_1_status_1',
          key: { created_at: 1, status: 1 },
          expireAfterSeconds: 1,
        },
      ]),
    ).toBeNull();
  });
});
