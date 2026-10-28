/**
 * [FIX-20260824-CASGHOST] The CAS guard must only arm when the client SENT it.
 * ===========================================================================
 * `[FIX-20260823-CLAIMCAS]` decided "did the caller send an expectation?" with
 * `'expected_admin_user_id' in updateData`. That reads correctly and is wrong
 * here: `main.ts` runs `ValidationPipe({ transform: true })`, and
 * class-transformer puts EVERY property declared on the DTO onto the instance —
 * absent ones as `undefined`. The key therefore always exists, the guard always
 * armed, and its filter became "the ticket must have NO owner" for callers who
 * never asked for a guard at all.
 *
 * 🔴 WHAT IT BROKE IN PRODUCTION (stg-omnidesk, 24/08, ticket 6a8b8850…):
 *    `PUT /api/tickets/:id` with `{"admin_user_id":"…"}` — transferring one's
 *    OWN case to a colleague — came back 409 "เคสนี้ถูกรับไปแล้วโดยแอดมินท่านอื่น".
 *    Nobody had taken it. Claiming a case broke the same way, and pressing
 *    again could never help: the condition that failed never changes.
 *    รับเคส/โอนเคส พังทั้งคู่ · กดซ้ำไม่มีวันผ่าน.
 *
 * The first test below is the REPRODUCTION — it fails on the old line and
 * passes on the new one. The rest pin the three-way meaning the original fix
 * wanted, so a future edit cannot collapse `''` into "not sent" either.
 *
 * ⚠️ Do NOT "simplify" this back to `in`, or to a truthy test:
 *      `in`      → always true under transform (this bug)
 *      truthy    → `''` stops meaning "I saw it unowned" (the 23/08 race returns)
 *
 * revert: delete this file together with the tickets.service.ts fix.
 */
import { plainToInstance } from 'class-transformer';

/* ⭐ THE REAL PREDICATE — the one `tickets.service.ts:1083` calls. Re-implementing
   the rule here instead would make every test below pass against the BROKEN code
   too: that is exactly what happened on the first draft of this file, and the
   mutation check caught it. เทสต้องเรียกของจริง ไม่ใช่เขียนกติกาซ้ำ. */
import { isCasRequested, UpdateTicketDto } from '@/modules/tickets';

/** The DTO instance `updateTicket` is handed, shaped exactly as the pipe makes it. */
const asUpdateData = (
  body: Record<string, unknown>,
): Record<string, unknown> => ({
  ...(plainToInstance(UpdateTicketDto, body, {
    enableImplicitConversion: true,
  }) as unknown as Record<string, unknown>),
});

const armed = (body: Record<string, unknown>): boolean =>
  isCasRequested(asUpdateData(body));

describe('[FIX-20260824-CASGHOST] the CAS guard arms only when asked', () => {
  it('🔴 transferring a case (no expectation sent) does NOT arm the guard', () => {
    /* The real stg payload, verbatim. Under the old `in` test this was `true`,
       which is the whole bug. ตัว payload จริงจากเคสที่พัง. */
    expect(armed({ admin_user_id: 'a0d000000000000000000084' })).toBe(false);
  });

  it('the key IS present on the instance — which is why `in` cannot be used', () => {
    /* Pinned as a fact about the framework, not about us: if a future upgrade
       ever stops materialising absent keys, this goes red and whoever sees it
       learns the constraint instead of guessing. ตรึงพฤติกรรม framework ไว้. */
    expect(
      'expected_admin_user_id' in asUpdateData({ admin_user_id: 'x' }),
    ).toBe(true);
  });

  it('an empty string DOES arm it — "I saw the case unowned"', () => {
    expect(armed({ admin_user_id: 'a', expected_admin_user_id: '' })).toBe(
      true,
    );
  });

  it('an owner id DOES arm it — "I saw that person holding it"', () => {
    expect(
      armed({
        admin_user_id: 'a',
        expected_admin_user_id: 'a0d000000000000000000084',
      }),
    ).toBe(true);
  });

  it('closing, re-categorising and other plain writes do not arm it', () => {
    /* The DTO's own promise — "ไม่ส่งมา = พฤติกรรมเดิมทุกบรรทัด"
       (dto/ticket.dto.ts:107) — restored and now enforced. */
    expect(armed({ job_status: 2 })).toBe(false);
    expect(armed({ category: 'Payment' })).toBe(false);
    expect(armed({ need_detail: 'x' })).toBe(false);
  });
});
