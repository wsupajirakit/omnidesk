/**
 * [FEAT-20260823-BCASTAUDFE] 🔌 THE AUDIENCE SEAM — FE and BE must agree.
 * ===========================================================================
 * เจ้าของสั่ง 23/08: *"fe+be ตรงสวมท่อต้องบอกกันตลอด จะได้อัพเดทเงื่อนไขจริงให้ทัน
 * ป้องกัน error / ตกหล่น ส่งผิดค่า"*
 *
 * WHY A TEST AND NOT A COMMENT. `services/media/flexMessageService.ts` already
 * carried a comment saying "เพิ่ม column ใหม่ให้การ์ดเมื่อไหร่ ต้องเพิ่มที่นี่ด้วยเสมอ",
 * and the very next field added was still dropped — the comment was read only
 * after the bug was reported. This file is that comment in a form that fails.
 *
 * WHAT DRIFTS, AND WHAT IT COSTS
 *   · an OP the backend accepts but this side does not know → the picker can
 *     never offer it, and nobody finds out
 *   · an op this side offers that the backend does not → `buildAudienceFilter`
 *     REFUSES THE WHOLE JOB, so the campaign simply does not send
 *   · a wire field renamed → `undefined` everywhere, with no error
 *
 * 🔴 The audience list itself is deliberately NOT pinned here. It is read at
 *    runtime precisely so a backend can add a field without touching this repo
 *    — pinning the keys would undo that. What is pinned is the CONTRACT: the
 *    operator vocabulary and the wire field names.
 *    ปักหมุดสัญญา ไม่ใช่ปักหมุดรายการ.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const feRoot = resolve(here, '..');

/* ⚠️ [FIX-20260825-SEAMLANE] แก้ 2 อย่างพร้อมกัน 25/08 — ทั้งคู่ทำให้เทสนี้
   "ผ่านโดยไม่ได้ตรวจ" มาก่อนหน้านี้

   ① ตัวชี้เลน BE เคยเป็น `../backend` sibling path ซึ่งตอนเขียน (23/08) คือเลนที่
      FE นี้คุยด้วยจริง · งาน broadcast ย้ายมาที่ `dev` ของ `omnidesk-api` แล้ว และ
      worktree นั้น **ตามหลังอยู่ 46 commit** ⇒ เทสไปเทียบกับสัญญาที่เลิกใช้แล้ว
      ⇒ ชี้มาที่ `../omnidesk-api` ซึ่งเป็นเลนที่ FE นี้ deploy คู่กันจริง

   ② regex ดึงชื่อ op เป็น `/'([a-z]+)'/` ซึ่ง **ไม่รับ underscore**
      พิสูจน์แล้ว: `'has_value'` / `'no_value'` ถูกทิ้งทั้งสองฝั่ง ⇒ เทสเทียบแค่
      5 ตัวเดิมแล้วเขียว ทั้งที่ของใหม่ไม่ถูกตรวจเลยสักตัว
      ⇒ เปลี่ยนเป็น `[a-z_]+` · นี่คือโหมดพังแบบเดียวกับที่หัวไฟล์นี้บ่นไว้เอง
        คือ "ตัวกันหลุดที่อ่านแล้วสบายใจ แต่ไม่ได้กันอะไร"

   ⚠️ ถ้าวันไหนงาน broadcast กลับไปอยู่ worktree แยกอีก ให้ย้ายตัวชี้ตามไป —
      สิ่งที่ต้องคงไว้คือ "ชี้ไปเลนที่ deploy คู่กับ FE นี้" ไม่ใช่ชื่อโฟลเดอร์ */

/**
 * The backend lane, when both worktrees are checked out side by side.
 * Absent (CI clones one repo) ⇒ the cross-repo cases skip themselves rather
 * than fail — a red build that only means "the other repo is not here" trains
 * people to ignore red. ไม่มี repo อีกฝั่ง = ข้าม ไม่ใช่แดง.
 */
const BE_TYPES = resolve(
  feRoot,
  '../backend/src/modules/content/audience/sources/audience-source.types.ts',
);
/* [UI-20260825-REGLABELS] ทะเบียนตัวกรอง — ที่มาของป้ายที่ฟอร์ม broadcast แสดง */
const BE_REGISTRY = resolve(
  feRoot,
  '../backend/src/modules/content/audience/sources/audience-source.registry.ts',
);
const BE_FILTER = resolve(
  feRoot,
  '../backend/src/modules/content/audience/sources/audience-filter.ts',
);
/* ⚠️ TWO FILES. `listAudienceSources` moved to the read half on 23/08 when the
   backend class was split at its line ratchet. A guard pinned to one filename
   goes red for an ordinary move, which is noise that teaches people to ignore
   it. ผูกกับพฤติกรรม ไม่ใช่ชื่อไฟล์. */
const BE_SERVICE_FILES = [
  '../backend/src/modules/content/broadcasts.service.ts',
  '../backend/src/modules/content/broadcasts-read.service.ts',
].map((r) => resolve(feRoot, r));

const readIfPresent = (p: string): string | null => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

/**
 * 🔴 COMMENTS STRIPPED BEFORE ANY `not.toContain`.
 *
 * A guard that greps the raw text trips on the prose that EXPLAINS the rule:
 * the service names `scope_by_hook` while documenting that the wire name is
 * different, and a naive search would call that a violation. This has already
 * cost time once on this project (`\bplates\b`, where an explanatory comment
 * failed another lane's guard). Assert against CODE, never against prose.
 * เทสต้องอ่านโค้ด ไม่ใช่คอมเมนต์ที่อธิบายกฎ.
 */
const readCode = (rel: string): string =>
  readFileSync(resolve(feRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[^\n'"`]*\/\/.*$/gm, (l) => l.slice(0, l.indexOf('//')));

const feTypes = readCode('types/campaign.ts');
const feService = readCode('services/messaging/broadcastService.ts');

/** `AudienceRule['op']`'s union members, as this repo declares them. */
const feOps = (): string[] => {
  const from = feTypes.indexOf("op: '");
  expect(from).toBeGreaterThan(-1);
  const line = feTypes.slice(from, feTypes.indexOf(';', from));
  return [...line.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string).sort();
};

describe('🔌 audience seam — the operator vocabulary', () => {
  it('this side declares exactly the ops the backend accepts', () => {
    const be = readIfPresent(BE_TYPES);
    if (be === null) return; // backend lane not checked out — see the header

    const decl = be.slice(be.indexOf('export type AudienceOp'));
    const beOps = [...decl.slice(0, decl.indexOf(';')).matchAll(/'([a-z_]+)'/g)]
      .map((m) => m[1] as string)
      .sort();

    expect(beOps.length).toBeGreaterThan(0);
    expect(feOps()).toEqual(beOps);
  });

  /* [UI-20260825-REGLABELS] ป้ายที่แอดมินคนเดียวกันอ่านสองที่ ต้องเป็นคำเดียวกัน
     การ์ด "การติดตาม" (panel ขวา) กับตัวกรองผู้รับตอนสร้าง broadcast อ้างถึง
     **เงื่อนไขเดียวกัน** — `abandon_trigger_at` ที่ยังไม่มีโปรไฟล์
     คำต่างกันเมื่อไหร่ แอดมินจะนึกว่าเป็นคนละอย่างแล้วเลือกผิดกลุ่มผู้รับ
     ⚠️ เขียนเป็นเทสไม่ใช่คอมเมนต์ ด้วยเหตุผลเดียวกับที่หัวไฟล์นี้บอกไว้ */
  /* [FEAT-20260825-HELPERTRIGGER] โตเป็นสามคู่ — ทุกแถวเตือนในการ์ดมีคู่ของมัน
     ในทะเบียนตัวกรอง และต้องใช้คำเดียวกันเป๊ะ */
  it.each([
    ['ABANDON_ROW', "'follow_up.abandon_at'"],
    ['REQUEST_REG_ROW', "'follow_up.request_reg_at'"],
    ['CUSTOMER_HELPER_ROW', "'follow_up.customer_helper_at'"],
  ])('⭐ ป้าย %s ตรงกันทั้งการ์ดและตัวกรอง broadcast', (feConst, beKey) => {
    const be = readIfPresent(BE_REGISTRY);
    if (be === null) return; // backend lane not checked out

    const feCard = readCode('components/member/follow-up/followStamps.ts');
    const at = feCard.indexOf(`${feConst} = {`);
    expect(at, `${feConst} ยังอยู่ไหม`).toBeGreaterThan(-1);
    const feLabel = /label:\s*'([^']+)'/.exec(feCard.slice(at))?.[1];
    expect(feLabel, `${feConst}.label ยังอยู่ไหม`).toBeTruthy();

    const beAt = be.indexOf(beKey);
    expect(beAt, `${beKey} ยังอยู่ในทะเบียนไหม`).toBeGreaterThan(-1);
    const beLabel = /label_th:\s*'([^']+)'/.exec(be.slice(beAt))?.[1];
    expect(beLabel, `label_th ของ ${beKey} ยังอยู่ไหม`).toBeTruthy();

    expect(feLabel).toBe(beLabel);
  });

  it('🔴 does not offer `exists` — the backend refuses it by design', () => {
    /* `$exists` in a SELECTION query destroys a covered read and turns it into
       a full fetch; the backend's own type comment records the measurement and
       asks for a range instead. Offering it here would produce jobs the
       backend rejects. ห้าม $exists ในตัว query. */
    expect(feOps()).not.toContain('exists');
  });
});

describe('🔌 audience seam — the wire field names', () => {
  it('🔴 reads `requires_hook_scope`, the name on the WIRE', () => {
    /* The backend stores it as `scope_by_hook` and renames it on the way out
       (`broadcasts.service.ts`, `listAudienceSources`). Copying the internal
       name reads `undefined` for every source, with no error anywhere.
       ชื่อในโค้ด BE ≠ ชื่อบนสาย. */
    expect(feService).toContain('requires_hook_scope');
    expect(feService).not.toContain('scope_by_hook');
  });

  it('the backend really does rename it — not an assumption on this side', () => {
    const be = BE_SERVICE_FILES.map(readIfPresent).filter(Boolean).join('\n') || null;
    if (be === null) return;
    expect(be).toContain('requires_hook_scope: s.scope_by_hook');
  });

  it('🔴 honours `deprecated`: keeps reading it, stops offering it', () => {
    /* A retired source still has live jobs pointing at it, so it must render
       on a saved job and never appear as a new choice.
       เลิกใช้ = ไม่เสนอใหม่ แต่ของเดิมต้องยังอ่านออก. */
    expect(feService).toContain('deprecated');
    expect(feService).toMatch(/\.filter\(.*!\w+\.deprecated/);
  });

  it('the backend actually sends `deprecated` — otherwise the filter is dead', () => {
    const be = BE_SERVICE_FILES.map(readIfPresent).filter(Boolean).join('\n') || null;
    if (be === null) return;
    expect(be).toMatch(/deprecated\?: boolean/);
    expect(be).toContain('deprecated: true');
  });
});

describe('🔌 audience seam — the list stays a runtime read', () => {
  it('🔴 no audience key is hard-coded on this side', () => {
    /* The backend adds a field by adding ONE registry entry and changing
       nothing else. A key copied into this repo goes stale the moment that
       happens — the form would hide a new field or offer a retired one.
       รายการต้องดึงตอนรัน ห้าม hard-code. */
    for (const key of [
      'follow_up.abandon_at',
      'first_ticket_at',
      'display_name',
      'phone_number',
    ]) {
      expect(feService).not.toContain(key);
      expect(feTypes).not.toContain(key);
    }
  });

  it('and the reader endpoint is the one that serves that registry', () => {
    expect(feService).toContain('/api/broadcasts/audience-sources');
  });
});


describe('🔌 audience seam — the condition ceiling', () => {
  /**
   * 🔴 THE BACKEND REFUSES PAST IT, IT DOES NOT TRIM. A form that allowed one
   * more than the backend accepts lets an admin save a campaign that can never
   * send, and the error arrives far from the button that caused it. A form that
   * allowed one FEWER quietly makes a legal campaign unbuildable.
   * เพดานสองฝั่งต้องเท่ากันเป๊ะ ไม่ใช่แค่ใกล้เคียง.
   */
  const feBuilder = readCode('components/campaign/audience/AudienceRuleBuilder.tsx');

  const feCap = (): number => {
    const m = feBuilder.match(/const MAX_RULES = (\d+)/);
    expect(m).not.toBeNull();
    return Number(m?.[1]);
  };

  it('this side declares a ceiling at all', () => {
    expect(feCap()).toBeGreaterThan(0);
  });

  it('🔴 it is the SAME number the backend enforces', () => {
    const be = readIfPresent(BE_FILTER);
    if (be === null) return; // backend lane not checked out — see the header
    const m = be.match(/export const MAX_AUDIENCE_RULES = (\d+)/);
    expect(m).not.toBeNull();
    expect(feCap()).toBe(Number(m?.[1]));
  });

  it('🔴 the backend REFUSES rather than trimming', () => {
    /* If it ever started trimming, mirroring the cap here would stop being
       necessary — and worse, the audience would silently widen. */
    const be = readIfPresent(BE_FILTER);
    if (be === null) return;
    expect(be).toMatch(/rules\.length > MAX_AUDIENCE_RULES/);
    expect(be).toMatch(/too many audience conditions/);
  });
});
