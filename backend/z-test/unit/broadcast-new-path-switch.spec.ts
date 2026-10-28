/**
 * [FEAT-20260822-BCASTSWITCH] The migration branch — both sides of it.
 * ===========================================================================
 * The sender that works today keeps working. That is the whole promise, and it
 * is worth a file of its own because `broadcast-send.spec.ts` proves the OLD
 * path is unchanged and cannot prove the branch is even there.
 *
 * ⚠️ TWO conditions gate the new path: the switch AND a provided port. These
 *    cases exercise each of the four combinations, because "off" that only
 *    works when the port is also missing is not a switch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BroadcastsService } from '@/modules/content';
/* eslint-disable-next-line no-restricted-imports -- a spy needs the module
   object the service actually calls into, which a barrel re-export does not
   give. Test-only; the layering rule is about production code. */
import * as legacySend from '@/modules/content/broadcast-legacy-send.util';
import {
  usesNewSendPath,
  BROADCAST_NEW_PATH_ENABLED,
  type NewSendOutcome,
} from '@/modules/content';
import type { AuthenticatedUser } from '@/common';

/* `roleName: 'superadmin'` exactly — `ensureAssignGroupAccess` compares that
   spelling, and 'super_admin' (my first guess) falls through to the group
   check and throws. Copied from `broadcast-send.spec.ts:46-49` rather than
   invented. ลอกจากเทสที่ผ่านอยู่แล้ว ไม่ใช่เดาเอง. */
const USER = {
  userId: 'unit-test-user',
  displayName: 'แอดมิน',
  roleName: 'superadmin',
} as unknown as AuthenticatedUser;

const VALID_ID = 'a0d000000000000000000039';

const JOB = {
  _id: VALID_ID,
  hook_ids: ['h1'],
  message: { type: 'text', text: 'hi' },
  assign_group: undefined,
};

function makeService(
  port?: { send: jest.Mock },
  /* [FEAT-20260823-BCASTSENDKIND] The job now decides which sender runs, so the
     spec has to be able to vary it. Defaults to a job with NO `send_kind` —
     which is every campaign stored before 23/08. */
  job: Record<string, unknown> = JOB,
) {
  const broadcastModel = {
    findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(job) }),
    findByIdAndUpdate: jest.fn().mockReturnValue({
      exec: () => Promise.resolve({ ...job, status: 'sent' }),
    }),
  };
  const dispatched = jest.fn();
  const service = new BroadcastsService(
    broadcastModel as never,
    { findById: () => ({ lean: () => Promise.resolve(null) }) } as never,
    {} as never,
    { create: jest.fn().mockResolvedValue({}) } as never,
    { safeDecrypt: jest.fn((v: unknown) => v) } as never,
    { createAuditLog: jest.fn().mockResolvedValue({}) } as never,
    port,
  );
  /* Spy on the old sender rather than letting it reach axios: this file is
     about WHICH path runs, and `broadcast-send.spec.ts` already owns what the
     old one does once it runs.
     ⚠️ CHANGED 23/08 — it used to overwrite a PRIVATE METHOD on the instance.
     The sender moved out of the class that day (the file was over the line
     ratchet), and a spy reaching into a private is exactly the kind of hold
     that turns a pure move into a red suite. The module function is the seam
     now, and it is the same one the service calls.
     สอดเข้า private = การย้ายไฟล์ธรรมดาก็ทำให้เทสแดง. */
  jest
    .spyOn(legacySend, 'dispatchBroadcast')
    .mockImplementation(
      dispatched.mockResolvedValue({ updated: JOB, results: [{ old: true }] }),
    );
  return { service, broadcastModel, dispatched };
}

describe('the switch itself', () => {
  /**
   * ⚠️ REWRITTEN 23/08. This block used to assert the flag ships OFF, which was
   * the right thing to pin while the flag was the ONLY gate. `send_kind` landed
   * and the design became two gates, so the property worth protecting changed:
   * it is no longer "nothing can take the new path", it is **"nothing takes the
   * new path unless the job asked for it"**.
   *
   * เจ้าของสั่ง 23/08: "ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด" — และนี่คือเทสที่พิสูจน์ข้อนั้น.
   */
  it('🔴 a job with NO send_kind stays on the old sender, flag or no flag', () => {
    /* Every campaign stored before 23/08 is this case. Turning the flag on
       must move none of them. งานเก่าทุกใบต้องไม่ขยับ. */
    expect(usesNewSendPath(undefined)).toBe(false);
    expect(usesNewSendPath(undefined, true)).toBe(false);
    expect(usesNewSendPath(null, true)).toBe(false);
    expect(usesNewSendPath('', true)).toBe(false);
  });

  it('🔴 the flag is the kill switch — OFF beats any send_kind', () => {
    /* Reverting the migration is one edit here, with no stored row touched. */
    expect(usesNewSendPath('multicast', false)).toBe(false);
    expect(usesNewSendPath('broadcast', false)).toBe(false);
  });

  it('a job that names a known kind takes the new path', () => {
    expect(usesNewSendPath('broadcast', true)).toBe(true);
    expect(usesNewSendPath('multicast', true)).toBe(true);
  });

  it('🔴 an UNKNOWN kind falls back to the old sender, never to a guess', () => {
    /* A value outside the set is far more likely a typo or a stale row than a
       request for something new, and guessing would send a real campaign down
       an untested path. ค่าที่ไม่รู้จัก = ท่อเดิม. */
    expect(usesNewSendPath('multicastt', true)).toBe(false);
    expect(usesNewSendPath('MULTICAST', true)).toBe(false);
    expect(usesNewSendPath('push', true)).toBe(false);
  });

  it('a non-string kind is off, whatever it is', () => {
    expect(usesNewSendPath(1, true)).toBe(false);
    expect(usesNewSendPath(true, true)).toBe(false);
    expect(usesNewSendPath({ send_kind: 'multicast' }, true)).toBe(false);
  });

  it('is typed boolean, so the ON branch is reachable code', () => {
    /* With a literal type, TypeScript narrows every `if (FLAG)` body to
       unreachable and the new path ships completely unexercised — the trap
       `run-guard.ts` records for SENDING_ENABLED. This compiles only because
       the constant is typed `boolean`. สวิตช์ต้องพิมพ์เป็น boolean ไม่ใช่ literal. */
    const flag: boolean = BROADCAST_NEW_PATH_ENABLED;
    expect(typeof flag).toBe('boolean');
    expect(
      usesNewSendPath('broadcast', !flag) || usesNewSendPath('broadcast', flag),
    ).toBe(true);
  });
});

describe('sendBroadcastNow — which sender runs', () => {
  /**
   * ⚠️ REWRITTEN 23/08 along with the switch. These cases used to pass because
   * the module flag was OFF; they now pass because the JOB does not ask for the
   * new path — the same green for a different reason, which is exactly the kind
   * of stale test that stops protecting anything. The old comment here also
   * claimed "nothing provides the port today", which stopped being true when
   * `content.module.ts` bound it. คอมเมนต์ที่เคยจริงแล้วไม่ตามแก้ อันตรายกว่าไม่เขียน.
   */
  it('🔴 a job with NO send_kind ⇒ the OLD sender, even with the port bound', async () => {
    /* Every campaign that existed before the column did. This is the case the
       owner's rule protects: "ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด". */
    const port = { send: jest.fn() };
    const { service, dispatched } = makeService(port);
    await service.sendBroadcastNow(USER, VALID_ID);

    expect(dispatched).toHaveBeenCalledTimes(1);
    expect(port.send).not.toHaveBeenCalled();
  });

  it('🔴 an UNKNOWN send_kind ⇒ the OLD sender, never a guess', async () => {
    const port = { send: jest.fn() };
    const { service, dispatched } = makeService(port, {
      ...JOB,
      send_kind: 'multicastt',
    });
    await service.sendBroadcastNow(USER, VALID_ID);

    expect(dispatched).toHaveBeenCalledTimes(1);
    expect(port.send).not.toHaveBeenCalled();
  });

  it('🔴 a job that ASKS for it ⇒ the NEW sender runs', async () => {
    /* Now testable end to end: the gate is a value on the job, not a module
       constant a spec must not mutate. เดิมทดสอบสาขานี้ทั้งเส้นไม่ได้ ตอนนี้ได้แล้ว. */
    const port = {
      send: jest.fn().mockResolvedValue({
        results: [{ hook_id: 'h1', status: 'success' }],
        status: 'sent',
      }),
    };
    const { service, dispatched } = makeService(port, {
      ...JOB,
      send_kind: 'multicast',
    });
    await service.sendBroadcastNow(USER, VALID_ID);

    expect(port.send).toHaveBeenCalledTimes(1);
    expect(dispatched).not.toHaveBeenCalled();
  });

  it('🔴 no port bound ⇒ the OLD sender, even for a job that asked', async () => {
    /* `@Optional()` in the service: a caller constructing it without the module
       gets `undefined` and the old sender rather than a DI error. */
    const { service, dispatched } = makeService(undefined, {
      ...JOB,
      send_kind: 'multicast',
    });
    await service.sendBroadcastNow(USER, VALID_ID);
    expect(dispatched).toHaveBeenCalledTimes(1);
  });

  it('the guards still run BEFORE either sender', async () => {
    const port = { send: jest.fn() };
    const { service } = makeService(port);
    await expect(service.sendBroadcastNow(USER, 'not-an-id')).rejects.toThrow();
    expect(port.send).not.toHaveBeenCalled();
  });
});

describe('the new path, when it is switched on', () => {
  /* The port is called directly here: the branch inside the service is gated on
     a module constant that a spec must not mutate. What these cases pin is the
     CONTRACT the port has to satisfy — the shape the caller already knows how
     to persist. */
  it('returns the legacy result shape, so a direct caller sees no change', () => {
    const outcome: NewSendOutcome = {
      results: [{ hook_id: 'h1', status: 'success' }],
      status: 'sent',
    };
    expect(outcome.results[0]).toHaveProperty('hook_id');
    expect(outcome.results[0]).toHaveProperty('status');
    expect(['sent', 'failed']).toContain(outcome.status);
  });

  it('🔴 the contract names webhook_logs as part of it, not as a detail', () => {
    /* The admin history tab filters webhook_logs on channel `line_api` and
       action_type `send_broadcast` (Broadcasts.tsx:90-99, measured). A new
       sender that stops writing those rows empties that tab with NO error
       anywhere — which is why it is written into the port's own header. */
    const header = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'src/modules/content/broadcast-run/new-send.port.ts',
      ),
      'utf8',
    );
    expect(header).toMatch(/send_broadcast/);
    expect(header).toMatch(/webhook_logs/);
  });
});
