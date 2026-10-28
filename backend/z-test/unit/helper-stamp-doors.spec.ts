/**
 * [FIX-20260827-HELPERSTAMPDOORS] ทุกประตูที่การ์ด helper ออก ต้องประทับเวลา
 * ============================================================================
 * 📖 todo/task/27082026/todo7_27082026_helper-stamp-all-doors.md
 *
 * พิสูจน์บน stg (27/08, ลูกค้า "ek"): ส่งสลิปโดยยังไม่ผูกบัญชี → สาย refuse ตอบ
 * การ์ด customer-helper (`slip_refused_no_profile_flex` · LINE 200) แต่
 * `customer_helper_trigger_at` เป็น null — เพราะตัวเขียน stamp ผูกอยู่กับสาย AI
 * จุดเดียว ทั้งที่การ์ดใบเดียวกันออกได้ 5 ประตู
 *
 * เทสชุดนี้ปักสองชั้น:
 *   1. wrapper ทำงานถูก (เงื่อนไข offered/sent · card=null ต้นทุนศูนย์)
 *   2. 🔴 นับประตูจากซอร์สจริง — จุดใหม่ในอนาคตที่ build การ์ดแล้วลืม stamp = แดงทันที
 *      (นี่คือหนี้ที่ทำให้บั๊กนี้เกิด — ห้ามให้เกิดซ้ำแบบเงียบ ๆ)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { tsFilesUnder } from '../lib/source-census';

const CENSUS_ROOT = join(__dirname, '../..');

/** The service plus every role directory a helper-door body may legitimately move to. */
const doorFileList = (): string[] =>
  [
    'src/modules/webhook/webhook.service.ts',
    ...tsFilesUnder(CENSUS_ROOT, 'src/modules/webhook/hook-reply'),
    ...tsFilesUnder(CENSUS_ROOT, 'src/modules/webhook/non-text'),
    /* [PROG-20260905-G45] the AI reply path — door 5's stamp went with the send. */
    ...tsFilesUnder(CENSUS_ROOT, 'src/modules/webhook/ai-reply'),
  ].filter((f) => existsSync(join(CENSUS_ROOT, f)));

/**
 * A door file, as this census must read it.
 *
 * 🔴 TWO THINGS THAT ARE NOT DOORS USED TO BE COUNTED AS DOORS, and both were found by
 * this census going red on a safe extraction rather than by review:
 *
 *   1. COMMENTS. The census matched raw source, so a doc comment that QUOTES the pattern
 *      it is documenting — `await deps.buildHookHelperFlexFor(` — counted as a build site.
 *      One handler explaining the convention pushed the count from four to six. The same
 *      trap `webhook-log-emitter.spec.ts` already warns about: prose that names the thing
 *      being asserted satisfies the assertion on its own.
 *
 *   2. DEPS BINDINGS. When a door body moves into a role directory, the spine grows a wire
 *      — `stampIfHelperCardDelivered: (card, uid, status) => this.stampIfHelperCardDelivered(…)`.
 *      That is plumbing, not a call site. Counting it means every extraction silently
 *      inflates the census by one, and then nobody can tell an inflated count from a new
 *      door. It is removed by shape: the key, its arrow, and the forwarded call.
 *
 * สายไฟไม่ใช่ประตู · คอมเมนต์ก็ไม่ใช่
 */
const readDoorFile = (f: string): string =>
  readFileSync(join(CENSUS_ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(
      /\b(?:buildHookHelperFlexFor|stampIfHelperCardDelivered):\s*\([^)]*\)\s*=>[\s\S]{0,200}?\),?\n/g,
      '',
    );

const doorSources = (): string[] => doorFileList().map(readDoorFile);

const SRC = readFileSync(
  join(__dirname, '../../src/modules/webhook/webhook.service.ts'),
  'utf8',
);

describe('[FIX-20260827-HELPERSTAMPDOORS] นับประตูจากซอร์สจริง', () => {
  it('⭐ ทุกจุดที่ build การ์ด helper (นอกสาย AI) มี stamp คู่กันครบ', () => {
    /* 🔴 mutation ที่เคสนี้ฆ่า: ลบ call จุดใดจุดหนึ่ง — จำนวนไม่ครบ = แดง
       นับจากซอร์สเพราะ 4 จุดกระจายอยู่ใน method เดียวยาว 6,000 บรรทัด
       การ mount ทดสอบทีละสาขาแพงกว่าหลายเท่าโดยพิสูจน์สิ่งเดียวกัน */
    /* [PROG-20260905-CENSUSCONV] The count is now over the service PLUS the role
       directories a door body can legitimately move to. Four doors are still four doors;
       WHERE they live stopped being the assertion. Counted against the service alone,
       the reduction program's extractions would read as missing doors, and a spec that
       reddens on safe changes gets deleted — taking the fence with it. If the TOTAL
       drops, this still fails. See z-test/unit/source-census.spec.ts for the proof that
       the counter can go red. */
    const doorFiles = doorFileList();
    // Counted over the comment-stripped, binding-stripped sources — see `readDoorFile`.
    const sources = doorFiles.map(readDoorFile);
    const count = (re: RegExp): number =>
      sources.reduce((n, src) => n + (src.match(re) ?? []).length, 0);
    const builds = count(
      /await this\.buildHookHelperFlexFor\(|await deps\.buildHookHelperFlexFor\(/g,
    );
    const stamps = count(
      /this\.stampIfHelperCardDelivered\(|deps\.stampIfHelperCardDelivered\(/g,
    );
    expect(builds).toBe(4); // S1-S4 — จุดที่ 5 (AI) ใช้ resolveCustomerHelperFlex
    expect(stamps).toBe(4); // หนึ่ง call ต่อหนึ่งประตู
  });

  it('สาย AI (จุดที่ 5) ยังใช้ stamp ก้อนเดิมของมัน — ห้ามถูกยุบมาใช้ wrapper', () => {
    /* `offered` ของสาย AI คือ `useHelperQr` ซึ่งครอบเคส text+quick-reply ที่ไม่มี
       flex ด้วย — ยุบมาใช้ wrapper (ที่ผูกกับ "การ์ดถูกสร้าง") = เปลี่ยนความหมาย */
    /* [PROG-20260905-G45] read across the door files, not the service alone: door 5's
       stamp moved into `ai-reply/send-ai-reply.handler.ts` with the send it measures. The
       rule is unchanged — the AI path keeps its OWN stamp, whose `offered` is
       `useHelperQr` and therefore covers the text+quick-reply case that has no flex card.
       Collapsing it onto the wrapper (which is bound to "a card was built") would change
       what the stamp means. */
    const doors = doorSources().join('\n');
    expect(doors).toMatch(/void stampCustomerHelperTrigger\(\{/);
    expect(doors).toMatch(/offered: useHelperQr,/);
  });

  it('ทุก call ของ wrapper เกิดหลัง send และส่ง status ของ response จริง', () => {
    /* [PROG-20260905-CENSUSCONV] The SECOND census in this file, converted for the same
       reason as the first: a door body may now live in a role directory, and counting
       only the service would read a safe move as a missing door. The per-call SHAPE check
       is what actually matters here — every stamp must carry the real response status and
       the LINE user id — and it is applied to every call wherever it lives. */
    /* [PROG-20260905-G19] A DEPS BINDING IS NOT A DOOR, and this census learned that the
       hard way. When the refusal branch moved into a handler, the spine grew
       `stampIfHelperCardDelivered: (card, uid, status) => this.stampIfHelperCardDelivered(…)`
       — a wire, not a call site — and the count went to five while the number of real doors
       was still four. Counting it would mean every future extraction inflates the census by
       one and nobody can tell an inflated count from a new door. Lines that carry the key
       `stampIfHelperCardDelivered:` are the binding; they are excluded by name. */
    const calls = doorSources().flatMap(
      (src) =>
        src.match(/(?:this|deps)\.stampIfHelperCardDelivered\([^)]+\)/g) ?? [],
    );
    expect(calls.length).toBe(4);
    for (const c of calls) {
      expect(c).toMatch(/(res|lineResponse)\?\.status/);
      expect(c).toMatch(/userId/);
    }
  });
});

describe('[FIX-20260827-HELPERSTAMPDOORS] wrapper — เงื่อนไขและต้นทุนศูนย์', () => {
  /* wrapper เป็น private — พิสูจน์พฤติกรรมผ่านซอร์สของตัว wrapper เอง
     (ตรรกะจริงของการเขียนอยู่ใน stampCustomerHelperTrigger ซึ่งมี spec ของตัวเอง
     ครบแล้วที่ customer-helper-trigger.spec.ts — ไม่เทสซ้ำ ไม่บวม) */
  const method = (() => {
    const i = SRC.indexOf('private stampIfHelperCardDelivered(');
    expect(i).toBeGreaterThan(-1);
    return SRC.slice(i, i + 1200);
  })();

  it('🔴 card ว่าง ⇒ return ก่อนแตะอะไรทั้งสิ้น (ศูนย์ I/O บนทาง text ปกติ)', () => {
    expect(method).toMatch(/if \(!card\) return;/);
  });

  it('sent = เฉพาะ 2xx จริง — ใช้ตัวเลข ไม่ใช่ truthy', () => {
    expect(method).toMatch(/httpStatus >= 200/);
    expect(method).toMatch(/httpStatus < 300/);
  });

  it('fire-and-forget + กันหลุดสองชั้น (void ข้างใน + try/catch)', () => {
    expect(method).toMatch(/void stampCustomerHelperTrigger\(/);
    expect(method).toMatch(/} catch \{/);
  });
});
