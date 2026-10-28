import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { actorLabel } from '@/modules/tickets';

/**
 * ==== [FIX-20260814-DIVIDERNAME] the divider actor shows the DISPLAY NAME ====
 *
 * Owner, 14/08 (reading a live transcript): the parenthesis after the actor was
 * showing `superadmin` — "วงเล็บข้างหลังเป็น rolename หรอ … จริง ๆ ต้องเป็น
 * username (displayname)". Verified against the local dev DB before any code
 * was touched:
 *
 *   chat_messages : content "รับเคส โดย dev (superadmin)"
 *                   metadata.actor_name "dev (superadmin)"
 *   users         : username "dev" · display_name "Developer"
 *   roles         : _id 6a676b31… → name "superadmin"
 *
 * So the parenthesis carried the ROLE. The helper's own documentation disagreed
 * with its code in three places (`ticket-divider.helper.ts:28-29`, `:76`, `:83`
 * all state `dev (Developer)`), which is what makes this a slip at implementation
 * time rather than a decision: the second argument was meant to be the display
 * name. `auth.displayName` was already carried end to end
 * (`auth.service.ts:188` → JWT → `jwt-auth.guard.ts:77`) and every other writer
 * in the codebase already spells it `displayName || username`
 * (e.g. `chat.service.ts:590`, `tickets.service.ts:1343`) — the ticket divider
 * was the only place that reached for the role instead.
 *
 * เลิกโชว์ role ในห้องแชท — role เป็นข้อมูลสิทธิ์ ไม่ควรอยู่ในบทสนทนา.
 *
 * RED-FIRST: the display-name case below fails on the pre-fix tree (it renders
 * `dev (superadmin)`); the fallback/blank cases pass on both trees and pin the
 * behaviour that must not move.
 *
 * revert: delete this file. No prod import.
 */

describe('[FIX-20260814-DIVIDERNAME] actorLabel — what goes in the parenthesis', () => {
  it('uses the DISPLAY NAME, never the role (the live bug: "dev (superadmin)")', () => {
    // exactly the values the local DB holds for this user
    expect(actorLabel('dev', 'Developer')).toBe('dev (Developer)');
    // and the role must never be able to reach the label through this helper
    expect(actorLabel('dev', 'Developer')).not.toContain('superadmin');
  });

  it('falls back to the bare username when there is no display name', () => {
    expect(actorLabel('dev', '')).toBe('dev');
    expect(actorLabel('dev', null)).toBe('dev');
    expect(actorLabel('dev', undefined)).toBe('dev');
  });

  it('returns empty when the username itself is missing — the caller decides', () => {
    // Deliberate: substituting "ระบบ" would claim nobody acted when someone did.
    expect(actorLabel('', 'Developer')).toBe('');
    expect(actorLabel(null, 'Developer')).toBe('');
    expect(actorLabel(undefined, undefined)).toBe('');
  });

  it('trims, so a padded value cannot produce "dev ( )"', () => {
    expect(actorLabel('  dev  ', '  Developer  ')).toBe('dev (Developer)');
    expect(actorLabel('dev', '   ')).toBe('dev');
  });

  it('collapses when both values are the same — never "dev (dev)"', () => {
    // The call site falls back to `displayName || username`, so an operator with
    // no display name would otherwise be rendered twice.
    expect(actorLabel('dev', 'dev')).toBe('dev');
    expect(actorLabel('  dev ', 'dev  ')).toBe('dev');
  });
});

/**
 * The helper is pure, so a green suite above proves nothing about what the
 * CALLER hands it — and the caller is where the bug actually lived
 * (`actorLabel(auth?.username, auth?.roleName)`). Pinned on the source so that
 * re-introducing the role at the call site fails here, not in production.
 * เทส helper อย่างเดียวไม่พอ — ต้องล็อกจุดเรียกด้วย.
 */
describe('[FIX-20260814-DIVIDERNAME] the call site passes the display name', () => {
  const SERVICE_SRC = readFileSync(
    resolve(__dirname, '../../src/modules/tickets/tickets.service.ts'),
    'utf8',
  );
  /** Source with comments stripped — the prose below explains the old bug and
   *  would otherwise trip the "no roleName" assertion on its own explanation. */
  const code = SERVICE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(
    /^\s*\/\/.*$/gm,
    '',
  );

  it('builds the divider actor from displayName (with a username fallback)', () => {
    // whitespace-tolerant: prettier may wrap the call across lines
    expect(code).toMatch(
      /actorLabel\(\s*auth\?\.username\s*,\s*auth\?\.displayName\s*\|\|\s*auth\?\.username\s*,?\s*\)/,
    );
  });

  it('never feeds roleName into the divider label again', () => {
    expect(code).not.toMatch(/actorLabel\([^)]*roleName/);
  });

  it('leaves the permission checks that legitimately read roleName alone', () => {
    // `:867` and `:1249` decide scope, not display — they must survive untouched.
    expect(code).toMatch(
      /const roleName = \(auth\?\.roleName \|\| ''\)\.toLowerCase\(\)/,
    );
  });
});
