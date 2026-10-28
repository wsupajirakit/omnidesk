/**
 * [FIX-20260828-SENDIMGSHAPE] One image sent from the console must come back
 * describing the stored image, not just naming it.
 * ===========================================================================
 * Owner, 28/08, testing on the real stack: sending TWO images worked, sending
 * ONE showed the literal text "[image]".
 *
 * Why the two differ, and why the fix belongs here rather than on the console:
 * a multi-image send makes the console refetch the transcript, so those rows
 * arrive through `listMessages`, which populates `internal_content_id`. A
 * single-image send appends THIS response straight into the transcript to avoid
 * a blink ([FIX-20260728-NOBLINK]). `create()` returns the raw ObjectId, so that
 * one bubble had no `image_url`, fell through to the text bubble, and rendered
 * its `content` — the placeholder "[image]". Two endpoints described the same
 * message two different ways; only one of them was usable.
 *
 * What this pins: the send response carries the populated image, and the
 * populate is BEST-EFFORT — by the time it runs the file is stored and LINE has
 * already accepted the push, so a read failure must never turn a delivered image
 * into a failed send.
 */
import { Types } from 'mongoose';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const STORAGE = {
  _id: new Types.ObjectId(),
  image_url: '/uploads/images/chat_1787852926239_demo.jpg',
  media_kind: 'image',
  storage_type: 'dashboard',
};

/** The row as `create()` hands it back: the ref is an id, nothing more. */
const RAW_ROW = {
  _id: new Types.ObjectId(),
  message_type: 'image',
  content: '[image]',
  internal_content_id: STORAGE._id,
};
/** The row as the list endpoint describes it. */
const POPULATED_ROW = { ...RAW_ROW, internal_content_id: STORAGE };

/**
 * The shape of the read-back the service performs. Kept as a tiny stand-in so
 * this stays a unit test of the CONTRACT; the wiring itself is exercised by the
 * media suites that boot the module.
 */
const readBackChain = (result: unknown, throws = false) => ({
  findById: () => ({
    populate: (path: string) => {
      expect(path).toBe('internal_content_id');
      return {
        lean: async () => {
          if (throws) throw new Error('mongo said no');
          return result;
        },
      };
    },
  }),
});

/** Mirrors the tail of `sendChatImage`: read back, fall back, never throw. */
const respond = async (
  model: ReturnType<typeof readBackChain>,
  imgMsg: unknown,
) => {
  let populated: unknown = null;
  try {
    populated = imgMsg
      ? await model.findById().populate('internal_content_id').lean()
      : null;
  } catch {
    populated = null;
  }
  return { success: true, data: populated ?? imgMsg };
};

describe('[SENDIMGSHAPE] the single-image send response', () => {
  it('⭐⭐⭐ carries the populated image, so the console can render it without refetching', async () => {
    const res = await respond(readBackChain(POPULATED_ROW), RAW_ROW);
    const icid = (res.data as typeof POPULATED_ROW).internal_content_id;
    expect(icid.image_url).toBe(STORAGE.image_url);
    /* the bug, stated as an assertion: an id alone is what the console cannot use */
    expect(typeof icid).toBe('object');
  });

  it('⭐⭐ a failed read-back still reports success — the image was already delivered', async () => {
    const res = await respond(readBackChain(null, true), RAW_ROW);
    expect(res.success).toBe(true);
    /* falls back to the raw row rather than erroring: the console refetches on
       its own and recovers the picture; a thrown error would tell the admin the
       send failed when LINE already has it */
    expect(res.data).toBe(RAW_ROW);
  });

  it('⭐ no bubble at all (no files) returns whatever the caller had, without throwing', async () => {
    const res = await respond(readBackChain(POPULATED_ROW), undefined);
    expect(res.success).toBe(true);
    expect(res.data).toBeUndefined();
  });
});

/**
 * The cases above model the contract; this one holds them to the real file.
 * Without it they would keep passing after someone deletes the read-back, which
 * is exactly the regression they exist to prevent.
 */
describe('[SENDIMGSHAPE] the service really does it', () => {
  const SRC = readFileSync(
    resolve(__dirname, '../../src/modules/chat/chat-media.service.ts'),
    'utf8',
  );

  it('⭐⭐ `sendChatImage` reads the row back with the ref populated before returning', () => {
    const tail = SRC.slice(SRC.indexOf('[FIX-20260828-SENDIMGSHAPE]'));
    expect(tail).toMatch(/findById\(/);
    expect(tail).toMatch(/\.populate\('internal_content_id'\)/);
    expect(tail).toMatch(/data: populated \?\? imgMsg/);
  });

  it('⭐⭐ the read-back is wrapped, so it cannot fail a send that already reached LINE', () => {
    const tail = SRC.slice(SRC.indexOf('[FIX-20260828-SENDIMGSHAPE]'));
    const tryAt = tail.indexOf('try {');
    const findAt = tail.indexOf('findById(');
    expect(tryAt).toBeGreaterThan(-1);
    expect(findAt).toBeGreaterThan(tryAt);
    expect(tail.slice(0, tail.indexOf('return {'))).toMatch(/catch/);
  });
});
