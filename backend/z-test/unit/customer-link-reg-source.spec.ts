/**
 * [FEAT-20260819-REGSOURCE] who registered this customer — proof, not intention
 * ===========================================================================
 * Owner: "cuslink ของเราแยกออกไหมว่า ลงทะเบียนด้วย liff user หรือ admin · อยากได้
 * registered at กับ registered by · seamless ระบบเดิมห้ามพัง ลูกค้า + แอดมินกด
 * ลงทะเบียนได้แบบ seamless".
 *
 * The three things that would make this feature silently useless, each pinned
 * below rather than argued about:
 *   1. the schema not declaring the fields — `strict: true` then drops the
 *      `$set` with no error and every stamp vanishes;
 *   2. the stamp being rewritable — a second press would overwrite who really
 *      did it first;
 *   3. unlink not clearing it — a re-registration would keep the old source AND
 *      be refused, because first-writer-wins would already see a value.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CustomerLinkService } from '@/modules/customer-link/customer-link.service';
import {
  REGISTERED_BY,
  registeredByFor,
  stampLinkRegistration,
} from '@/modules/customer-link/registration-stamp.helper';

const src = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');

/** A member model that records what it was asked to write. */
const makeMemberModel = (modifiedCount = 1) => {
  const updateOne = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue({ modifiedCount }),
  });
  return { model: { updateOne } as never, updateOne };
};

describe('[FEAT-20260819-REGSOURCE] registeredByFor — the only question asked', () => {
  it('an admin id present means an admin did it', () => {
    expect(registeredByFor('admin-42')).toBe('admin');
  });

  it.each([null, undefined, ''])(
    'no admin id (%p) means the customer did it themselves via LIFF',
    (v) => {
      expect(registeredByFor(v as never)).toBe('member');
    },
  );

  it('the reserved values exist but nothing produces them yet', () => {
    /* [FEAT-20260820-MEMBERSOURCE] `system` → `member` (owner: "ลูกค้ากดเอง
       เปลี่ยนเป็น member" — `system` read as "the software did it", the opposite
       of what it meant), `agent_auto` reserved alongside `other`, and `system`
       KEPT as a legacy name so rows written before the rename stay declared.
       ⚠️ Dropping `system` from this list is what would make the rename stop
       being seamless: real rows hold it. เก็บชื่อเก่าไว้ = ไม่ต้อง migrate.
       ⚠️ This list going red is the point: it is what makes renaming a stored
       value a deliberate act instead of a typo. เปลี่ยนค่าที่เก็บลง DB ต้องมาแก้ตรงนี้. */
    /* DESTINATION 4 of 7. This going red on a new value is the DESIGN, not an
       obstacle: it is the reminder to walk the other six destinations listed in
       `omnidesk-api/src/modules/customer-link/registration-stamp.helper.ts`.
       Update it LAST, once the value is labelled, cleared on unlink, and either
       counted or deliberately not. */
    expect([...REGISTERED_BY]).toEqual([
      'admin',
      'member',
      'agent_auto',
      'semi_admin',
      'other',
      'system',
    ]);
    /* legacy and reserved alike: declared, but produced by nothing */
    expect(['agent_auto', 'other', 'system']).not.toContain(
      registeredByFor(null),
    );
    expect(['agent_auto', 'other', 'system']).not.toContain(
      registeredByFor('admin-1'),
    );
    // pinned so a future source is added deliberately, not by accident
    expect(['admin', 'member']).toContain(registeredByFor('x'));
    expect(['admin', 'member']).toContain(registeredByFor(null));
  });
});

describe('[FEAT-20260819-REGSOURCE] stampLinkRegistration — the write itself', () => {
  it('writes BOTH fields in ONE $set, so a source without a time is impossible', async () => {
    const { model, updateOne } = makeMemberModel();
    await stampLinkRegistration(
      { channelUserId: 'Uabc', adminUserId: 'admin-42' },
      { memberModel: model, warn: jest.fn() },
    );
    const [, update] = updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(Object.keys(update)).toEqual(['$set']);
    expect(Object.keys(update.$set).sort()).toEqual([
      'link_registered_at',
      'link_registered_by',
    ]);
    expect(update.$set['link_registered_by']).toBe('admin');
    expect(update.$set['link_registered_at']).toBeInstanceOf(Date);
  });

  it('the customer path stores member, not admin', async () => {
    const { model, updateOne } = makeMemberModel();
    await stampLinkRegistration(
      { channelUserId: 'Uabc', adminUserId: null },
      { memberModel: model, warn: jest.fn() },
    );
    const [, update] = updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set['link_registered_by']).toBe('member');
  });

  it('FIRST WRITER WINS is in the FILTER — pressing twice cannot rewrite it', async () => {
    const { model, updateOne } = makeMemberModel();
    await stampLinkRegistration(
      { channelUserId: 'Uabc', adminUserId: 'admin-42' },
      { memberModel: model, warn: jest.fn() },
    );
    const [filter] = updateOne.mock.calls[0] as [Record<string, unknown>];
    expect(filter['line_user_id']).toBe('Uabc');
    // absent OR explicit null — both mean "never stamped"
    expect(filter['$or']).toEqual([
      { link_registered_by: { $exists: false } },
      { link_registered_by: null },
    ]);
  });

  it('says false when it did not write — somebody else was first', async () => {
    const { model } = makeMemberModel(0);
    expect(
      await stampLinkRegistration(
        { channelUserId: 'Uabc' },
        { memberModel: model, warn: jest.fn() },
      ),
    ).toBe(false);
  });

  it('a database failure is swallowed — a label must never fail a registration', async () => {
    const warn = jest.fn();
    const model = {
      updateOne: () => ({
        exec: () => Promise.reject(new Error('mongo down')),
      }),
    } as never;
    await expect(
      stampLinkRegistration(
        { channelUserId: 'Uabc' },
        { memberModel: model, warn },
      ),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('no channel id means no write at all — never a filter that matches everyone', async () => {
    const { model, updateOne } = makeMemberModel();
    expect(
      await stampLinkRegistration(
        { channelUserId: '' },
        { memberModel: model, warn: jest.fn() },
      ),
    ).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe('[FEAT-20260819-REGSOURCE] seamless — the ways it could silently do nothing', () => {
  const schema = src('src/modules/chat/schemas/member.schema.ts');
  const service = src('src/modules/customer-link/customer-link.service.ts');
  const noComments = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('the schema DECLARES both fields — strict:true drops undeclared paths in silence', () => {
    const body = noComments(schema);
    expect(body).toContain('link_registered_by?: string | null;');
    expect(body).toContain('link_registered_at?: Date | null;');
    expect(body).toContain('@Prop({ type: Date, default: null })');
  });

  it('both default to null, so every one of the 831 registered members stays valid', () => {
    const body = noComments(schema);
    const by = body.slice(
      body.indexOf('link_registered_by') - 120,
      body.indexOf('link_registered_by'),
    );
    const at = body.slice(
      body.indexOf('link_registered_at') - 120,
      body.indexOf('link_registered_at'),
    );
    expect(by).toContain('default: null');
    expect(at).toContain('default: null');
  });

  it('NOT a Mongoose enum — an unforeseen value must not throw on the customer path', () => {
    expect(noComments(schema)).not.toMatch(/enum:\s*\[?[^\]]*registered/i);
    const byProp = noComments(schema);
    const idx = byProp.indexOf('link_registered_by');
    expect(byProp.slice(idx - 150, idx)).not.toContain('enum');
  });

  it('unlink clears BOTH, so registering again is stamped afresh instead of refused', () => {
    const body = noComments(service);
    const unset = body.slice(
      body.indexOf('$unset: {'),
      body.indexOf('$unset: {') + 400,
    );
    expect(unset).toContain('link_registered_by');
    expect(unset).toContain('link_registered_at');
  });
});

describe('[FEAT-20260819-REGSOURCE] wiring — both paths reach it, nothing else does', () => {
  const makeSvc = () => {
    const memberModel = {
      updateOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      }),
    };
    const svc = new CustomerLinkService(
      {} as never,
      memberModel as never,
      { safeDecrypt: (v: string) => v } as never,
      {} as never,
      { create: jest.fn().mockResolvedValue({ _id: 'wh1' }) } as never,
      {} as never,
      {
        sendLinePushMessage: jest.fn().mockResolvedValue({ status: 200 }),
      } as never,
      { logMessage: jest.fn().mockResolvedValue({ _id: 'm1' }) } as never,
    );
    const s = svc as unknown as Record<string, unknown>;
    s['resolveConfig'] = () => ({});
    s['toUpstreamPayload'] = (input: Record<string, unknown>) => ({
      payload: { line_user_id: input['channel_user_id'], web_code: 'w' },
      error: null,
    });
    s['validateMatchPayload'] = () => null;
    s['effectiveWebCode'] = () => 'w';
    s['alreadyLinked'] = jest.fn().mockResolvedValue(false);
    s['refreshStoredProfile'] = jest.fn().mockResolvedValue(undefined);
    s['publishProfileEvent'] = jest.fn().mockResolvedValue(undefined);
    s['pushLinkedNotice'] = jest.fn().mockResolvedValue(undefined);
    return { svc, memberModel, s };
  };

  const runMatch = async (ok: boolean, adminUserId: string | null) => {
    const { svc, memberModel, s } = makeSvc();
    s['callUpstream'] = jest
      .fn()
      .mockResolvedValue({ ok, status: ok ? 200 : 400 });
    await (
      svc as unknown as { match: (i: unknown, c: unknown) => Promise<unknown> }
    ).match({ channel_user_id: 'Uabc' }, { hook: { _id: 'h1' }, adminUserId });
    // the stamp is fired with `void`; let its microtask land
    await Promise.resolve();
    await Promise.resolve();
    return memberModel.updateOne.mock.calls;
  };

  /* The hook in these two carries NO custom tool — `{ _id: 'h1' }`. That is the
     point, not an omission: `refreshStoredProfile` is gated on
     `custom_tool_status`/`custom_tool_id`, so stamping inside it would have left
     every tool-less hook unrecorded. These pass, so the stamp is not gated.
     hook ที่ไม่มี custom tool ก็ต้องถูกบันทึก. */
  /* [FEAT-20260820-CLEARONLINK] These used to assert `toHaveLength(1)` — the
     stamp was the only write a successful registration made. It is not any more:
     the follow-up mark is now cleared on the same success, so a bare count broke
     the day that landed and would break again on the next writer. Each case now
     looks for ITS OWN write instead of counting them all.
     นับจำนวน write ไม่ได้แล้ว · ต้องหา write ของตัวเองให้เจอ. */
  const stampOf = (calls: unknown[]): Record<string, unknown> | undefined =>
    (
      calls.find(
        (c) => (c as [unknown, Record<string, unknown>])[1]?.['$set'],
      ) as [unknown, { $set: Record<string, unknown> }] | undefined
    )?.[1].$set;

  it('ลูกค้ากดเอง (LIFF) → stamped member', async () => {
    const calls = await runMatch(true, null);
    expect(stampOf(calls)?.['link_registered_by']).toBe('member');
  });

  it('แอดมินกดให้ → stamped admin', async () => {
    const calls = await runMatch(true, 'admin-42');
    expect(stampOf(calls)?.['link_registered_by']).toBe('admin');
  });

  it.each([
    ['ลูกค้ากดเอง (LIFF)', null],
    ['แอดมินกดให้', 'admin-42'],
  ])(
    '⭐ %s → the follow-up mark is cleared on the same success',
    async (_label, adminUserId) => {
      /* Proved here rather than only in the helper's own suite, because this
         suite drives the REAL service method — so it is evidence that the call is
         wired into the path both the LIFF page and the admin button take, not
         just that the helper works when called by a test.
         ขับ service จริง ไม่ใช่เรียก helper ตรง ๆ. */
      const calls = await runMatch(true, adminUserId);
      const unset = calls.find(
        (c) => (c as [unknown, { $unset?: unknown }])[1]?.$unset,
      ) as
        | [Record<string, unknown>, { $unset: Record<string, unknown> }]
        | undefined;
      expect(unset?.[0]).toEqual({ line_user_id: 'Uabc' });
      expect(unset?.[1].$unset).toEqual({
        'config.follow_up.line.abandon_trigger_at': '',
      });
      /* ⚠️ and the record is NOT among them — owner: "ห้ามเคลียร์ห้ามยุ่ง". */
      expect(JSON.stringify(calls)).not.toContain('request_reg_at');
    },
  );

  it('⭐ a registration that failed clears nobody', async () => {
    /* the mark says "still stuck", and a failed registration leaves that true.
       ลงทะเบียนไม่สำเร็จ = ยังติดอยู่ ห้ามล้าง. */
    expect(await runMatch(false, null)).toHaveLength(0);
  });

  it('upstream refused → nothing is stamped', async () => {
    expect(await runMatch(false, 'admin-42')).toHaveLength(0);
  });
});
