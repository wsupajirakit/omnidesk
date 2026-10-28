/**
 * [FEAT-20260822-BCASTGLOBALQUOTA] Many individually-legal jobs must not add up
 * to a volume nobody agreed to. These cases pin that.
 */
import {
  GLOBAL_QUOTA,
  GLOBAL_QUOTA_SCOPE,
  checkGlobalQuota,
} from '@/modules/content';

const empty = {
  lastHour: { recipients: 0, requests: 0 },
  lastDay: { recipients: 0, requests: 0 },
};

describe('global quota — the ceiling no single run can see', () => {
  it('counts everything together by default', () => {
    // The only mode that can notice "six small jobs add up".
    expect(GLOBAL_QUOTA_SCOPE).toBe('combined');
  });

  it('lets a normal run through and says what is left', () => {
    const v = checkGlobalQuota(empty, { recipients: 10_000, requests: 20 });
    expect(v.allow).toBe(true);
    expect(v.remaining.recipients).toBe(GLOBAL_QUOTA.hour.recipients);
  });

  it('🔴 six individually-legal jobs are stopped by the hour together', () => {
    // Each of these runs passes every per-run ceiling. Only this guard sees it.
    const used = { recipients: 45_000, requests: 90 };
    const v = checkGlobalQuota(
      { lastHour: used, lastDay: used },
      { recipients: 10_000, requests: 20 },
    );
    expect(v.allow).toBe(false);
    expect(!v.allow && v.reason).toBe('hour-recipients');
    expect(v.remaining.recipients).toBe(5_000);
  });

  it('stops on the day even when the hour is clear', () => {
    const v = checkGlobalQuota(
      {
        lastHour: { recipients: 0, requests: 0 },
        lastDay: { recipients: 299_000, requests: 100 },
      },
      { recipients: 5_000, requests: 10 },
    );
    expect(!v.allow && v.reason).toBe('day-recipients');
  });

  it('caps requests as well as recipients — either can be the problem', () => {
    const v = checkGlobalQuota(
      {
        lastHour: { recipients: 0, requests: GLOBAL_QUOTA.hour.requests },
        lastDay: { recipients: 0, requests: 0 },
      },
      { recipients: 1, requests: 1 },
    );
    expect(!v.allow && v.reason).toBe('hour-requests');
  });

  it('lands exactly on the limit and still allows it', () => {
    const v = checkGlobalQuota(
      {
        lastHour: { recipients: 40_000, requests: 0 },
        lastDay: { recipients: 40_000, requests: 0 },
      },
      { recipients: 10_000, requests: 0 },
    );
    expect(v.allow).toBe(true);
    expect(v.remaining.recipients).toBe(10_000);
  });

  it('🔴 never trims a run down to fit — it refuses and reports the room', () => {
    // Trimming would pick winners out of one audience with no way to explain it,
    // and the leftover people would look delivered.
    const v = checkGlobalQuota(
      {
        lastHour: { recipients: 49_000, requests: 0 },
        lastDay: { recipients: 49_000, requests: 0 },
      },
      { recipients: 5_000, requests: 10 },
    );
    expect(v.allow).toBe(false);
    expect(v.remaining.recipients).toBe(1_000); // told, not silently used
  });

  it('🔴 fails CLOSED when usage cannot be read', () => {
    for (const bad of [
      {
        lastHour: { recipients: Number.NaN, requests: 0 },
        lastDay: empty.lastDay,
      },
      { lastHour: empty.lastHour, lastDay: { recipients: -1, requests: 0 } },
    ]) {
      const v = checkGlobalQuota(bad, { recipients: 1, requests: 1 });
      expect(v.allow).toBe(false);
      expect(!v.allow && v.reason).toBe('unreadable-usage');
    }
  });

  it('treats an unreadable demand as zero rather than throwing', () => {
    const v = checkGlobalQuota(empty, {
      recipients: Number.NaN,
      requests: Number.NaN,
    });
    expect(v.allow).toBe(true);
  });

  it('the hour budget is tighter than the day budget', () => {
    expect(GLOBAL_QUOTA.hour.recipients).toBeLessThan(
      GLOBAL_QUOTA.day.recipients,
    );
    expect(GLOBAL_QUOTA.hour.requests).toBeLessThan(GLOBAL_QUOTA.day.requests);
  });
});
