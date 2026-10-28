/**
 * [FEAT-20260824-CLAIMPROFILE] Taking a case refreshes that member's profile —
 * and that one trigger is allowed past the 10-second cooldown.
 *
 * WHY THE BYPASS EXISTS: the owner's rule is that the moment an admin takes a
 * room, the right-hand panel must already be showing that customer's newest
 * data. The cooldown is a flood guard for a button a human can hold down; a case
 * being taken is a single deliberate act, and if it lands inside another
 * refresh's window the admin gets a stale panel and no indication why. Owner,
 * 24/08/2026: it must happen immediately, cooldown or not.
 *
 * ⚠️ WHY A CLOSED VALUE AND NOT A BOOLEAN. `force: true` would let any caller
 * switch the guard off, and the first place that gets copied is the manual
 * button — which is exactly what the cooldown protects. `trigger: 'case_taken'`
 * can only mean the one sanctioned reason, it is the only value the DTO accepts,
 * and it lands in the audit line so a burst can be traced to whoever took what.
 * ค่าปิด ไม่ใช่ boolean — boolean เปิดรูให้ปุ่มมือ.
 *
 * ⚠️ THE SLOT IS STILL RESERVED. A bypass does not leave the window open behind
 * it: the guard is stamped as usual, so a manual refresh a second later still
 * cools down. Otherwise the bypass would be a hole rather than an exception.
 */
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { RefreshRawProfileDto } from '@/modules/chat/dto/member.dto';
import { MembersService } from '@/modules/chat/members.service';

const MEMBER_ID = 'a0d000000000000000000069';
const HOOK_ID = 'a0d00000000000000000007b';
const LINE_USER = 'U-line-1';

function harness() {
  const calls: string[] = [];
  const member = {
    _id: MEMBER_ID,
    line_user_id: LINE_USER,
    raw_profile_data: { name: 'เก่า' },
    profile_data_updated_at: new Date('2026-08-24T10:00:00Z'),
  };
  const lean = <T>(v: T) => ({ lean: () => v, exec: () => Promise.resolve(v) });
  const memberModel = {
    findById: () => lean(member),
    updateOne: () => ({ exec: () => Promise.resolve({}) }),
  };
  const hookModel = {
    findById: () => lean({ _id: HOOK_ID }),
    // getAllowedHookIds asks this; `null` = super user ⇒ scope always allows
    find: () => lean([]),
  };
  /* `ensureMemberInScope` ถามด้วย `exists()` (เป็น JOIN ไม่ใช่เช็ค field —
     ดูคอมเมนต์ที่ constructor) · ตอบ truthy = ผู้เรียกแชร์ห้องกับ member คนนี้
     เทสชุดนี้ว่าด้วย cooldown ไม่ใช่เรื่องขอบเขตสิทธิ์ */
  const chatRoomModel = {
    findOne: () => lean({ _id: 'room-1' }),
    exists: () => ({
      lean: () => ({ _id: 'room-1' }),
      exec: () => Promise.resolve({ _id: 'room-1' }),
    }),
  };
  const customToolService = {
    getCombinedData: (...a: unknown[]) => {
      calls.push('getCombinedData');
      void a;
      return Promise.resolve({});
    },
  };
  const auditLog = { record: () => Promise.resolve(undefined) };

  const svc = new MembersService(
    memberModel as never,
    hookModel as never,
    customToolService as never,
    chatRoomModel as never,
    auditLog as never,
    /* [FEAT-20260905-CUSTPROV] the resolver, appended last like the two params
       before it. The stamp is not what this spec is about, so the default entry
       is enough — but it must be PRESENT, or the service cannot construct.
       ⚠️ `viewOf` is stubbed because a profile answer now carries `view`
       (PART 7 §36) and `stampedProfile` asks for it on every branch this spec
       drives. What the view CONTAINS is proven in
       `customer-provider-envelope.spec.ts`; here it only has to answer. */
    {
      /* [FEAT-20260907-PROVCONDS] stampedProfile now resolves the entry for its
         optional condition stamps; a bare entry (declares none) stamps nothing,
         so every assertion below is unchanged by construction. */
      resolve: () => ({ name: 'stub' }),
      activeName: () => 'shopapi_v1',
      viewOf: () => ({ sections: [] }),
    } as never,
  );
  /* super user ⇒ every scope check passes without a room join.
     🔴 `roleName`, NOT `role: { name }` — corrected 06/09/2026. `isSuperUser`
     (`common/auth/super-role.ts:36`) reads `user.roleName`, so the old shape was
     NOT a super user at all: `getAllowedHookIds` answered `[]` and this fixture
     only got through `ensureMemberInScope` because the `chatRoomModel.exists`
     stub below returns truthy for anyone. The moment a scope rule appeared that
     asks the id list instead of the room join (`ensureHookInScope`), the fixture
     stopped matching its own comment and these cooldown cases went red for a
     reason that had nothing to do with cooldown.
     The intent is unchanged — this suite is about the cooldown, not about scope —
     it is now expressed in the shape the code actually reads.
     fixture ต้องเป็น super user จริง ไม่ใช่แค่เขียนว่าเป็น */
  const auth = { roleName: 'superadmin', permissions: ['ticket.manage'] };
  return { svc, calls, auth };
}

describe('[CLAIMPROFILE] taking a case refreshes the profile past the cooldown', () => {
  it('⭐ (T1 TARGET) trigger=case_taken fetches even inside the cooldown window', async () => {
    const h = harness();

    // first call stamps the guard
    await h.svc.refreshRawProfile(
      MEMBER_ID,
      { hook_id: HOOK_ID },
      h.auth as never,
    );
    expect(h.calls).toHaveLength(1);

    // immediately again, WITH the trigger
    const res = await h.svc.refreshRawProfile(
      MEMBER_ID,
      { hook_id: HOOK_ID, trigger: 'case_taken' } as never,
      h.auth as never,
    );

    expect(h.calls).toHaveLength(2);
    expect(res['reason']).not.toBe('cooldown');
  });

  it('⭐ (P1 PIN) WITHOUT the trigger the cooldown still holds — the manual button is unchanged', async () => {
    const h = harness();

    await h.svc.refreshRawProfile(
      MEMBER_ID,
      { hook_id: HOOK_ID },
      h.auth as never,
    );
    const res = await h.svc.refreshRawProfile(
      MEMBER_ID,
      { hook_id: HOOK_ID },
      h.auth as never,
    );

    expect(h.calls).toHaveLength(1); // second one never left the process
    expect(res['reason']).toBe('cooldown');
    expect(res['refreshed']).toBe(false);
  });

  it('⭐ (P2 PIN) a bypass still stamps the guard — it is an exception, not a hole', async () => {
    const h = harness();

    await h.svc.refreshRawProfile(
      MEMBER_ID,
      { hook_id: HOOK_ID, trigger: 'case_taken' } as never,
      h.auth as never,
    );
    // a manual refresh right behind it must still be refused
    const res = await h.svc.refreshRawProfile(
      MEMBER_ID,
      { hook_id: HOOK_ID },
      h.auth as never,
    );

    expect(h.calls).toHaveLength(1);
    expect(res['reason']).toBe('cooldown');
  });

  it('(P3 PIN) the trigger does not skip validation — a bad hook_id is still refused', async () => {
    const h = harness();

    await expect(
      h.svc.refreshRawProfile(
        MEMBER_ID,
        { hook_id: 'not-an-id', trigger: 'case_taken' } as never,
        h.auth as never,
      ),
    ).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
});

/* ⚠️ เคสข้างล่างนี้จำเป็น เพราะเคสข้างบน "เรียก service ตรง ๆ"
 *
 * mutation ที่เปลี่ยน `@IsIn(['case_taken'])` เป็น `@IsString()` **ผ่านทุกเคส
 * ข้างบน** — เพราะการเรียก service ตรง ๆ ข้าม ValidationPipe ไปทั้งชั้น ซึ่งเป็น
 * ชั้นเดียวที่บังคับว่า trigger รับได้ค่าเดียว
 *
 * ⇒ ตรวจ decorator ที่ตัว DTO เอง ไม่ใช่ผ่าน service · ไม่งั้น "ค่าปิด" ที่เป็น
 * เหตุผลทั้งหมดของดีไซน์นี้ ไม่มีอะไรคุมเลย
 * เรียก service ตรง ๆ ไม่ได้พิสูจน์ชั้น validate — สกิล dev-local §5 เตือนไว้แล้ว
 */
describe('[CLAIMPROFILE] DTO ยอมรับ trigger ค่าเดียวเท่านั้น', () => {
  const check = (obj: Record<string, unknown>) =>
    validateSync(plainToInstance(RefreshRawProfileDto, obj));

  it('⭐ ค่าที่อนุญาตผ่าน', () => {
    expect(check({ hook_id: HOOK_ID, trigger: 'case_taken' })).toHaveLength(0);
  });

  it('⭐ ค่าอื่นถูกปฏิเสธ — รวมถึงท่า boolean ที่ดีไซน์นี้ตั้งใจกัน', () => {
    for (const bad of ['force', 'true', 'manual_refresh', 'CASE_TAKEN', '']) {
      expect({
        bad,
        errors: check({ hook_id: HOOK_ID, trigger: bad }).length,
      }).toEqual({ bad, errors: 1 });
    }
  });

  it('ไม่ส่ง trigger มาเลยก็ยังผ่าน — ปุ่ม refresh มือไม่ถูกบังคับให้ส่งอะไรใหม่', () => {
    expect(check({ hook_id: HOOK_ID })).toHaveLength(0);
  });
});

/* [FEAT-20260825-CHATOPENFRESH] เหตุผลที่สองที่ข้าม cooldown ได้ — เปิดห้องแชท
   เจ้าของ 25/08: *"เวลาเข้ามาที่ chat ใดๆ ก็ต้องดึง profile สดๆ ทันที
   ทั้ง site rule / raw profile … ทะลุเงื่อนไข cooldown ทุกครั้ง"*
   ⚠️ ยังเป็นค่าปิด (@IsIn) ไม่ใช่ boolean — เพิ่มค่าที่อนุญาต ไม่ได้เปิดรู
   ⚠️ ป้าย log ต้องบอกเหตุผลจริง แยก `chat_opened` ออกจาก `manual_refresh`
      ไม่งั้นอ่าน log ย้อนหลังแยกไม่ออกว่าใครสั่งดึงเพราะอะไร */
describe('[CHATOPENFRESH] เปิดห้องแชท = ข้าม cooldown ได้', () => {
  it('⭐⭐ DTO ยอมรับ trigger chat_opened', () => {
    const dto = plainToInstance(RefreshRawProfileDto, {
      hook_id: HOOK_ID,
      trigger: 'chat_opened',
    });
    expect(validateSync(dto as object)).toEqual([]);
  });

  it('⭐ DTO ยังปฏิเสธค่าที่ไม่ได้อนุญาต — ค่าปิดต้องยังปิดอยู่ (PIN)', () => {
    const dto = plainToInstance(RefreshRawProfileDto, {
      hook_id: HOOK_ID,
      trigger: 'force',
    });
    expect(validateSync(dto as object).length).toBeGreaterThan(0);
  });

  it('⭐ DTO ยังยอมรับ case_taken เหมือนเดิม (PIN)', () => {
    const dto = plainToInstance(RefreshRawProfileDto, {
      hook_id: HOOK_ID,
      trigger: 'case_taken',
    });
    expect(validateSync(dto as object)).toEqual([]);
  });
});

/**
 * [FIX-20260906-HOOKSCOPE] The hook id in the BODY is a second identifier, and it
 * was scoped against nothing.
 *
 * `ensureMemberInScope` answers "may this caller reach this MEMBER" with a join
 * over rooms. It says nothing about the `hook_id` this route then uses to choose
 * WHICH OA's credentials fetch the profile. An operator scoped to OA A, sharing a
 * room with a member under A, could post `{"hook_id":"<OA B>"}` and have the
 * server fetch that member's profile through an OA they cannot see — and the
 * answer is stored on the member and returned to them.
 * ตรวจว่าเข้าถึงสมาชิกได้ ไม่ได้แปลว่าเข้าถึง OA ที่ส่งมาในบอดี้ได้
 *
 * Raised by adversarial review, unanimous across four verifiers, and reachable
 * from the real route (`POST /api/line-users/:id/raw-profile/refresh`).
 */
describe('[FIX-20260906-HOOKSCOPE] refreshRawProfile scopes the hook id it is given', () => {
  it('⭐ refuses a hook the caller may not see', async () => {
    const h = harness();
    /* A real operator shape: not a super user, and allowed ONE OA which is not the
       one being asked for. `getAllowedHookIds` reads `allowedHooks` before it ever
       looks at groups, so this is the tier the rule must honour. */
    const scoped = {
      roleName: 'operator',
      permissions: ['ticket.manage'],
      allowedHooks: ['a0d00000000000000000007c'],
    };
    await expect(
      h.svc.refreshRawProfile(MEMBER_ID, { hook_id: HOOK_ID }, scoped as never),
    ).rejects.toThrow(ForbiddenException);
    // and nothing left the process on the caller's behalf
    expect(h.calls).not.toContain('getCombinedData');
  });

  it('allows the hook when it IS in the caller`s list — the guard is not a blanket refusal', async () => {
    /* The vacuity guard for the case above: a rule that refused everyone would
       pass it while breaking every operator. */
    const h = harness();
    const scoped = {
      roleName: 'operator',
      permissions: ['ticket.manage'],
      allowedHooks: [HOOK_ID],
    };
    await expect(
      h.svc.refreshRawProfile(MEMBER_ID, { hook_id: HOOK_ID }, scoped as never),
    ).resolves.toBeDefined();
  });
});
