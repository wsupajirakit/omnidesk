/* [DOC-20260821-BAGRULES] the CONSUMERS list at the central registry must stay true
 * ===========================================================================
 * `member-config.registry.ts` carries two things a grep cannot: the checklist
 * for adding a key, and a list naming every file that touches the bag and what
 * it does with each key. The checklist is prose and stays true on its own. The
 * LIST is a claim about the code — and a claim about code rots the moment
 * somebody adds a reader and forgets the comment.
 *
 * That rot is the debt this file exists to prevent. Every assertion below is
 * "the comment says X, does the code still do X" in both directions:
 *   · a file named in the list must really touch the bag  → no stale entries
 *   · a file that touches the bag must be named in the list → no missing ones
 *
 * ⚠️ THIS IS NOT the same check as `member-config.spec.ts`'s "nothing outside
 * chat/config reaches into member.config". That one is a DENY list of five
 * files, and it answers "did anybody bypass the door". This one answers "is the
 * registry's own description of its callers still accurate". อันนั้นกันคนแอบเข้า
 * อันนี้กันบัญชีโกหก.
 *
 * WHEN THIS GOES RED: the code changed and the registry comment did not. Fix the
 * comment — it is the documentation that is wrong, not the test.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// the barrel, the way the sibling specs reach it
import { MEMBER_CONFIG_KEYS } from '@/modules/chat/config';

const REGISTRY = 'src/modules/chat/config/member-config.registry.ts';
const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const noComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * Every file the registry's CONSUMERS block names.
 *
 * It matches only paths that start at `src/`, which is why the block writes them
 * in full: a shorthand would need this test to guess where it lives, and a guess
 * is exactly the kind of thing that quietly stops matching. เขียน path เต็มไปเลย
 * เทสจะได้ไม่ต้องเดา.
 */
const listed = (): string[] => {
  const body = src(REGISTRY);
  const from = body.indexOf('WHO USES THE BAG TODAY');
  expect(from).toBeGreaterThan(-1);
  const block = body.slice(from, body.indexOf('*/', from));
  return [
    ...new Set(
      [...block.matchAll(/`(src\/[a-z0-9@/_.-]+\.ts)`/g)].map(
        (m) => m[1] as string,
      ),
    ),
  ];
};

describe('⭐ the CONSUMERS list names real files that really use the bag', () => {
  it('⭐ it names at least one file per declared key', () => {
    expect(listed().length).toBeGreaterThanOrEqual(
      Object.keys(MEMBER_CONFIG_KEYS).length,
    );
  });

  it('⭐ every file it names still imports the bag door', () => {
    /* a stale entry is worse than none: it sends the next reader to a file that
       has nothing to do with the key any more. */
    const stale: string[] = [];
    for (const p of listed()) {
      const path = String(p);
      let body: string;
      try {
        body = noComments(src(path));
      } catch {
        stale.push(p + ' (ไฟล์ไม่มีอยู่จริง)');
        continue;
      }
      if (!/chat\/config'/.test(body))
        stale.push(p + ' (ไม่ได้ import ประตูแล้ว)');
    }
    expect(stale).toEqual([]);
  });
});

describe('⭐ nobody uses the bag without being named there', () => {
  it('⭐ every importer of chat/config appears in the list', () => {
    /* the direction that actually rots: somebody adds a reader and the registry
       still describes the old world. คนใหม่เข้ามาแล้วบัญชีไม่รู้. */
    /* ⚠️ TWO LESSONS, BOTH FROM MUTATIONS THAT SURVIVED A FIRST ATTEMPT:

       1. MATCH BY FUNCTION NAME, NOT BY IMPORT PATH. A file living inside
          `src/modules/chat/` imports the door as `'./config'`, which contains
          no "chat/config" at all — a new consumer there went unnoticed.

       2. STRIP COMMENTS FIRST. `abandon-trigger.rule.ts` and `follow-up/
          index.ts` both NAME the door functions in prose (a design note and the
          removal recipe) while importing nothing. Counting those would force
          the registry to list files that never call it.
       จับด้วยชื่อฟังก์ชัน + ตัดคอมเมนต์ก่อน ไม่งั้นทั้งหลุดและทั้งเกิน. */
    const DOOR =
      /\b(readMemberConfig|writeMemberConfigOnce|writeMemberConfig|clearMemberConfig|memberConfigPath)\b/;
    const files = String(
      execSync("grep -rl 'MemberConfig' --include='*.ts' src || true", {
        encoding: 'utf8',
      }),
    )
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((f) => !f.startsWith('src/modules/chat/config/'));
    const importers = files.filter((f) => DOOR.test(noComments(src(f))));
    const named = listed();
    const missing = importers.filter((f) => !named.includes(f));
    expect(missing).toEqual([]);
  });
});

describe('⭐ every consumer points back at the registry', () => {
  it('⭐ each one carries the pointer note, so a reader finds the rules', () => {
    /* the rules are useless if the person editing a caller never learns they
       exist. Each consumer names the registry right where it imports the door. */
    const without: string[] = [];
    for (const p of listed()) {
      const body = src(String(p));
      if (
        !body.includes('[DOC-20260821-BAGRULES]') ||
        !body.includes('member-config.registry.ts')
      ) {
        without.push(p);
      }
    }
    expect(without).toEqual([]);
  });
});

describe('⭐ every consumer names BOTH ENDS, not just its own half', () => {
  /* Owner's rule: a write must say who takes the value, a clear must say whose
     key it is clearing and on which route, and a read must say where it came
     from. A value with only one end written down is one nobody can safely
     change later. เขียนค่าไว้ต้องบอกว่าใครเอาไป · ล้างค่าต้องบอกว่าล้างของใคร. */

  it('⭐ each consumer carries a BOTH ENDS block', () => {
    const without = listed().filter(
      (p) => !src(String(p)).includes('── BOTH ENDS ──'),
    );
    expect(without).toEqual([]);
  });

  it('⭐ a writer names its readers, or says outright that there are none', () => {
    /* the blank that rots: a writer whose readers were deleted looks identical
       to one that never had any. `request_reg_at` says NOBODY on purpose. */
    const writers = listed().filter((p) =>
      /writeMemberConfig(Once)?\(/.test(noComments(src(String(p)))),
    );
    expect(writers.length).toBeGreaterThan(0);
    const silent = writers.filter((p) => !/WHO TAKES IT/.test(src(String(p))));
    expect(silent).toEqual([]);
  });

  it('⭐ a clearer names whose key it clears AND that the other route exists', () => {
    /* a flag reached by two routes needs a clearer on both; a note that hides
       the sibling is how one of them gets deleted later. */
    const clearers = listed().filter((p) =>
      /clearMemberConfig\(/.test(noComments(src(String(p)))),
    );
    /* 26/08/2026: 2 → 3. [FEAT-20260826-CLOSECLEARFU] added a THIRD clearer,
       `tickets/tickets.service.ts`, and it is the only human-driven one — an
       admin ticking a box while closing a case. The number is pinned rather than
       left open so that a clearer appearing by accident still fails here. */
    expect(clearers.length).toBe(3);
    for (const p of clearers) {
      const body = src(String(p));
      expect(body).toMatch(/WHOSE\?/);
      expect(body).toMatch(/THE OTHER ROUTE HAS ITS OWN CLEARER/);
    }
  });

  it('⭐ a reader names its writer', () => {
    const readers = listed().filter(
      (p) =>
        /readMemberConfig\(/.test(noComments(src(String(p)))) &&
        !/clearMemberConfig\(/.test(noComments(src(String(p)))),
    );
    expect(readers.length).toBeGreaterThan(0);
    const silent = readers.filter(
      (p) => !/WHERE IT CAME FROM/.test(src(String(p))),
    );
    expect(silent).toEqual([]);
  });
});

describe('⭐ the index ledger says who added each one and when', () => {
  /* an index nobody can attribute is one nobody dares drop. */
  const body = () => src(REGISTRY);

  it('⭐ the ledger exists and every indexed key names a commit and a date', () => {
    const from = body().indexOf('WHICH KEYS HAVE AN INDEX');
    expect(from).toBeGreaterThan(-1);
    const block = body().slice(from, body().indexOf('WHO USES THE BAG TODAY'));
    const entries = [
      ...block.matchAll(
        /added\s+(\d{4}-\d{2}-\d{2})\s+·\s+commit\s+([0-9a-f]{7})/g,
      ),
    ];
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  it('⭐ every index the schema declares appears in the ledger', () => {
    /* the direction that rots: somebody adds an index and the ledger does not
       hear about it. */
    const schema = src('src/modules/chat/schemas/member.schema.ts');
    const declared = [
      ...new Set(
        [...schema.matchAll(/\{\s*'(config\.[a-z_.]+)':\s*1/g)].map(
          (m) => m[1] as string,
        ),
      ),
    ];
    expect(declared.length).toBeGreaterThan(0);
    const missing = declared.filter((k) => !body().includes(k + '_1'));
    expect(missing).toEqual([]);
  });
});

describe('⭐ the checklist itself is still there', () => {
  it('the registry carries the add-a-key steps and the measured index rules', () => {
    const body = src(REGISTRY);
    for (const marker of [
      'ADDING A NEW KEY',
      'DOES IT BELONG IN THE BAG AT ALL',
      'PICK THE RIGHT WRITER',
      'DECIDE WHO CLEARS IT',
      'PROJECTION_COVERED',
    ]) {
      expect(body).toContain(marker);
    }
  });

  it('⭐ it still warns that $exists in a query destroys the covered read', () => {
    /* measured: FETCH+20,000 docs with it, PROJECTION_COVERED+0 without. Losing
       this line would let the next key ship a query 50% slower for no reason. */
    expect(src(REGISTRY)).toMatch(/\$exists[\s\S]{0,200}(query|QUERY)/);
  });
});
