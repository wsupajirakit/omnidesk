/**
 * [FEAT-20260820-FOLLOWUPINDEX] every follow-up key stays queryable — enforced
 * ===========================================================================
 * Owner, 2026-08-20: "member > follow up ทุกอย่างข้างในทำ index ไว้ได้ไหม เผื่อไว้เลย
 * เผื่อคนคิวรี่ตรง".
 *
 * THE ANSWER ON THE DAY: both keys that exist — `abandon_trigger_at` and
 * `request_reg_at` — already carry a partial index, verified against the live
 * collection and not only against the schema source. So nothing was added.
 *
 * WHAT WAS MISSING IS THE GUARANTEE, WHICH IS WHAT THIS FILE IS. A third key can
 * be added to the registry in one line, and nothing anywhere would notice that it
 * shipped without an index — the query would simply collection-scan, quietly,
 * for as long as it took somebody to measure it. This test is that notice.
 * ไม่ได้เพิ่ม index เพราะครบแล้ว · แต่เพิ่ม "ตัวดัก" ไม่ให้คีย์ใหม่หลุดโดยไม่มี index.
 *
 * WHY PARTIAL, ALWAYS. A follow-up stamp is carried by a small minority of
 * members, so a partial index grows with the stamped few rather than with the
 * collection, and a member without the stamp is never touched by a write to it.
 * `$exists: true` is the filter because that is exactly the question these keys
 * answer — "was this ever stamped" — and because `$unset`, not `null`, is how the
 * clear step removes a member from it.
 *
 * TO ADD A KEY: put it in `MEMBER_CONFIG_KEYS`, then add the matching
 *   MemberSchema.index({ 'config.<key>': 1 }, { background: true,
 *     partialFilterExpression: { 'config.<key>': { $exists: true } } });
 * in `member.schema.ts`. This test tells you if you forgot.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MEMBER_CONFIG_KEYS, MEMBER_CONFIG_ROOT } from '@/modules/chat/config';

const SCHEMA = 'src/modules/chat/schemas/member.schema.ts';

/** Comments stripped — an index named only in prose must not satisfy this. */
const schemaSource = readFileSync(join(process.cwd(), SCHEMA), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

const followUpKeys = Object.keys(MEMBER_CONFIG_KEYS).filter((k) =>
  k.startsWith('follow_up.'),
);

describe('⭐ every follow-up key is directly queryable', () => {
  it('there is at least one — a silent empty list would pass everything below', () => {
    /* the vacuity guard: without it, deleting the registry would turn this whole
       file green. ถ้าลิสต์ว่าง เทสข้างล่างผ่านหมดโดยไม่ได้ตรวจอะไรเลย. */
    expect(followUpKeys.length).toBeGreaterThan(0);
  });

  it.each(followUpKeys)('%s has an index', (key) => {
    const path = `${MEMBER_CONFIG_ROOT}.${key}`;
    expect(schemaSource).toContain(`MemberSchema.index(\n  { '${path}': 1 }`);
  });

  it.each(followUpKeys)('%s is indexed PARTIALLY, on $exists', (key) => {
    const path = `${MEMBER_CONFIG_ROOT}.${key}`;
    const at = schemaSource.indexOf(`{ '${path}': 1 }`);
    const decl = schemaSource.slice(at, at + 400);
    expect(decl).toContain('partialFilterExpression');
    expect(decl).toContain(`'${path}': { $exists: true }`);
    /* background, so creating it on a live collection never blocks writes. */
    expect(decl).toContain('background: true');
  });

  it('every follow-up key that exists today, pinned by name', () => {
    /* a rename is a data migration, not a refactor: rows already carry the old
       path. This fails loudly if one is renamed, which is the point.
       เปลี่ยนชื่อ = ต้องย้ายข้อมูลจริง ไม่ใช่แก้โค้ดเฉย ๆ. */
    /* grown 2026-08-25 — [FEAT-20260825-HELPERTRIGGER]:
       `customer_helper_trigger_at` records WHEN the customer-helper was LAST
       offered. ROLLING (overwritten every time, cleared by nobody) and carries
       its own partial index, which is why the case above passes for it too.
       ⚠️ ชื่อเดิมที่เสนอมาคือ `customer_helper_triggered_at` — เปลี่ยนเป็น
          `..._trigger_at` เพราะ **ไม่มีคีย์ไหนในถุงนี้ใช้รูป `-ed` เลย**
          (`abandon_trigger_at` · `request_reg_at` · `notice_*_at`) ⇒ ใช้ `-ed`
          จะเป็นตัวเดียวที่แหวก · คนละธรรมเนียมกับคอลัมน์ระดับบนสุดของ members
          ซึ่งใช้ `-ed` ทั้งหมด (`last_synced_at` · `link_registered_at`) */
    expect(followUpKeys.sort()).toEqual([
      'follow_up.line.abandon_trigger_at',
      'follow_up.line.customer_helper_trigger_at',
      'follow_up.line.notice_deposit_at',
      'follow_up.line.notice_payment_at',
      'follow_up.line.notice_withdraw_at',
      'follow_up.line.request_reg_at',
    ]);
  });
});
