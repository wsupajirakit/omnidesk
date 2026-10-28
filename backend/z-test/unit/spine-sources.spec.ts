import { join } from 'path';

import {
  SPINE_ROLE_DIRS,
  spineCodeOnly,
  spineSource,
} from '../lib/spine-sources';

const ROOT = join(__dirname, '../..');

/**
 * [PROG-20260905-SPINESRC] The shared reader is about to back a dozen source-text fences,
 * so its own properties are pinned first — including the one that makes it safe to widen a
 * pin at all: a rule that holds NOWHERE must still fail.
 */
describe('[PROG-20260905-SPINESRC] the spine source reader', () => {
  it('always includes the service itself', () => {
    expect(spineSource(ROOT, [])).toContain('processLockedEvent');
  });

  it('includes a role directory when asked, and not when it is not', () => {
    const withHookReply = spineSource(ROOT, ['hook-reply']);
    const withoutIt = spineSource(ROOT, []);
    expect(withHookReply.length).toBeGreaterThan(withoutIt.length);
    expect(withHookReply).toContain('replyOutOfHours');
    expect(withoutIt).not.toContain('export async function replyOutOfHours');
  });

  it('STILL FAILS for text that exists nowhere — widening is not weakening', () => {
    // Without this, "read more files" would slide into "always pass".
    expect(spineSource(ROOT)).not.toContain('aRuleThatWasDeletedOnPurpose');
  });

  it('treats a role directory that does not exist yet as empty, not as an error', () => {
    expect(() => spineSource(ROOT, ['not-created-yet'])).not.toThrow();
  });

  it('is stable between calls, so a diff means a real change', () => {
    expect(spineSource(ROOT)).toBe(spineSource(ROOT));
  });

  it('strips comments in the codeOnly form, so a rule cannot be satisfied by prose', () => {
    const code = spineCodeOnly(ROOT, []);
    expect(code).not.toMatch(/\/\*\s*\[PROG-20260905/);
    expect(code).toContain('processLockedEvent');
  });

  it('names every role directory the program has created so far', () => {
    // A directory missing from this list is a hole in every fence built on it.
    for (const d of [
      'hook-reply',
      'assist',
      'non-text',
      'post-send',
      'ticket',
      'logging',
      // [PROG-20260905-LADDER] the ladder steps. It held `follow-up-flow.ts` since SP23
      // and was missing from the list the whole time.
      'gates',
    ]) {
      expect(SPINE_ROLE_DIRS).toContain(d);
    }
  });
});
