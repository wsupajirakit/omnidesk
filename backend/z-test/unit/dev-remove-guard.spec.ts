/**
 * [TEST-20260820-DEVREMOVE] the only real lock on the profile-wipe tool
 * ===========================================================================
 * Owner, 2026-08-20: "การซ่อนปุ่ม remove ห้ามให้ inspect แก้ไข html เองได้" ·
 * "ทำให้ป้องกันระดับ be ด้วย" · "fe รอบนี้ให้เห็นแค่ username = dev คนเดียว".
 *
 * The dashboard hides the button. That is decoration — devtools unhides it and
 * `curl` never saw it. These cases pin the server-side answer, which is the one
 * that decides. ซ่อนปุ่มไม่ใช่การป้องกัน · เทสชุดนี้คุมด่านจริง.
 */
import {
  DEV_REMOVE_DEFAULT_USERNAMES,
  assertDevRemoveAllowed,
  devRemoveUsernames,
} from '@/modules/chat/dev-remove.guard';

const user = (username: string) => ({ username }) as never;

describe('who is allowed', () => {
  it('⭐ dev passes', () => {
    expect(() => assertDevRemoveAllowed(user('dev'), {})).not.toThrow();
  });

  it('⭐ every other account is refused — admin and superadmin included', () => {
    /* the point of the tool: it is not a privilege level, it is one account.
       ไม่ใช่เรื่องยศ · เป็นเรื่องบัญชีตัวไหน. */
    for (const u of [
      'admin',
      'su',
      'superadmin',
      'operator',
      'ticket',
      'dev2',
    ]) {
      expect(() => assertDevRemoveAllowed(user(u), {})).toThrow(
        /developer testing tool/,
      );
    }
  });

  it('no session at all is refused', () => {
    expect(() => assertDevRemoveAllowed(undefined, {})).toThrow();
    expect(() => assertDevRemoveAllowed(user(''), {})).toThrow();
  });

  it('case and whitespace do not matter', () => {
    for (const u of ['DEV', ' Dev ', 'dEv']) {
      expect(() => assertDevRemoveAllowed(user(u), {})).not.toThrow();
    }
  });
});

describe('the switch — how it is turned off for production', () => {
  it('⭐ EMPTY STRING refuses everyone, dev included', () => {
    /* this is the production setting. If it ever stops refusing `dev`, a real
       customer's profile can be wiped from a shipped build.
       ตั้งว่าง = ต้องปิดสนิทจริง ๆ แม้แต่ dev. */
    const env = { DEV_REMOVE_USERNAMES: '' } as never;
    expect(devRemoveUsernames(env)).toEqual([]);
    for (const u of ['dev', 'admin', 'su']) {
      expect(() => assertDevRemoveAllowed(user(u), env)).toThrow();
    }
  });

  it('⭐ ABSENT is NOT the same as empty — it falls back to dev', () => {
    /* the distinction the whole switch rests on. A bug that treated `undefined`
       as `''` would make the tool look broken on a dev machine; one that treated
       `''` as absent would leave it ON in production.
       ไม่ตั้ง ≠ ตั้งว่าง · สลับกันเมื่อไหร่พังคนละทาง. */
    expect(devRemoveUsernames({})).toEqual([...DEV_REMOVE_DEFAULT_USERNAMES]);
    expect(devRemoveUsernames({ DEV_REMOVE_USERNAMES: '' })).toEqual([]);
  });

  it('a widened list is honoured, comma separated and untrimmed', () => {
    const env = { DEV_REMOVE_USERNAMES: ' dev , DEV2 ,, ' } as never;
    expect(devRemoveUsernames(env)).toEqual(['dev', 'dev2']);
    expect(() => assertDevRemoveAllowed(user('dev2'), env)).not.toThrow();
  });

  it('the default is exactly one account', () => {
    expect([...DEV_REMOVE_DEFAULT_USERNAMES]).toEqual(['dev']);
  });
});

describe('it is wired into the route that matters', () => {
  const read = (rel: string) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('node:fs') as typeof import('node:fs')).readFileSync(
      `${process.cwd()}/${rel}`,
      'utf8',
    );

  it('⭐ clearRawProfile asks the guard BEFORE it looks anything up', () => {
    /* order matters: a refusal must not depend on the target existing, and must
       not leak whether it does. ปฏิเสธก่อน ไม่ต้องรู้ว่ามี member นั้นจริงไหม. */
    const svc = read('src/modules/chat/members.service.ts');
    const body = svc.slice(
      svc.indexOf('public async clearRawProfile('),
      svc.indexOf('return { success: true, cleared:'),
    );
    const guardAt = body.indexOf('assertDevRemoveAllowed(auth)');
    const scopeAt = body.indexOf('ensureMemberInScope');
    const writeAt = body.indexOf('updateOne');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(scopeAt);
    expect(guardAt).toBeLessThan(writeAt);
  });

  it('the env var is declared, so a typo is caught at boot', () => {
    expect(read('src/config/env.schema.ts')).toContain('DEV_REMOVE_USERNAMES');
  });
});
