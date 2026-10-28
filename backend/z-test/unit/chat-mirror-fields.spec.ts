/**
 * The dual-write mirror hooks, checked against legacy's own rule.
 *
 * These fill `channel_user_id` and `member_user_id` from `line_user_id` (and
 * back) on every write. The port had the columns and the unique index on
 * `{channel_user_id, hook_id}` but not the hooks, which meant the second
 * customer on any hook would have collided on that index.
 *
 * The last case reaches into legacy's compiled schema and asserts it still
 * declares both hook kinds — so if legacy ever drops one, this goes red rather
 * than leaving us mirroring something legacy no longer does.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { mirrorPair, mirrorUpdatePair } from '@/modules/chat';

/*
 * [FIX-20260812-LEGACYOPTIONAL] the legacy checkout is OPTIONAL.
 *
 * This file used to `require()` the legacy model at module scope, which runs the
 * moment Jest loads the file — before any `describe.skip` can take effect. On a
 * machine without `legacy-api` beside this repo (CI, a fresh clone, a container)
 * the whole suite failed to run, taking its six pure unit tests down with it for
 * a reason unrelated to the code under test.
 *
 * Now the path is only checked here; the require happens inside the one test that
 * needs it, and that test is skipped when the checkout is absent. The other six
 * tests never touched legacy and now always run.
 *
 * Matches the pattern the parity suites in this folder already use.
 */
const LEGACY_ROOM = resolve(
  __dirname,
  '../../../legacy-api/src/models/chat/chatRoomModel.js',
);
const legacyAvailable = existsSync(LEGACY_ROOM);
const itIfLegacy = legacyAvailable ? it : it.skip;

describe('mirror hooks vs legacy', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['old only', { line_user_id: 'U1' }],
    ['new only', { channel_user_id: 'U2' }],
    ['both', { line_user_id: 'U3', channel_user_id: 'U4' }],
    ['neither', { hook_id: 'h' }],
    ['old empty string', { line_user_id: '' }],
    ['new null', { channel_user_id: null }],
  ];
  it.each(cases)('mirrorPair: %s', (_n, input) => {
    const ours = { ...input };
    mirrorPair(ours, 'line_user_id', 'channel_user_id');
    // Legacy's rule, restated: whichever is defined wins, old first.
    const want = { ...input };
    const hasOld = want['line_user_id'] !== undefined;
    const hasNew = want['channel_user_id'] !== undefined;
    if (hasOld && !hasNew) want['channel_user_id'] = want['line_user_id'];
    else if (hasNew && !hasOld) want['line_user_id'] = want['channel_user_id'];
    expect(ours).toEqual(want);
  });

  it('upsert filter branch completes the counterpart on insert only', () => {
    const q = { line_user_id: 'U9', hook_id: 'h' };
    const u: {
      $set?: Record<string, unknown>;
      $setOnInsert?: Record<string, unknown>;
    } = {
      $set: { display_name: 'x' },
    };
    mirrorUpdatePair(q, u, true, 'line_user_id', 'member_user_id');
    expect(u.$setOnInsert).toEqual({ member_user_id: 'U9' });
  });

  it('does nothing when not an upsert', () => {
    const u: {
      $set?: Record<string, unknown>;
      $setOnInsert?: Record<string, unknown>;
    } = {
      $set: { display_name: 'x' },
    };
    mirrorUpdatePair(
      { line_user_id: 'U9' },
      u,
      false,
      'line_user_id',
      'member_user_id',
    );
    expect(u.$setOnInsert).toBeUndefined();
  });

  itIfLegacy(
    'the ChatRoom model legacy exports still declares both hook kinds',
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const legacyRoom = require(LEGACY_ROOM) as {
        schema: { s: { hooks: { _pres: Map<string, unknown[]> } } };
      };
      const hooks = legacyRoom.schema.s.hooks._pres;
      expect(hooks.has('validate')).toBe(true);
      expect(hooks.has('findOneAndUpdate')).toBe(true);
    },
  );
});
