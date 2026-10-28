/**
 * [FEAT-20260823-BCASTPREVIEW] The preview must not send, and must not lie.
 * ===========================================================================
 * TWO PROPERTIES, and they fail in opposite directions:
 *
 *   1. IT CANNOT SEND. Not "does not today" — the service is built without a
 *      dispatcher and without a token, so there is no line of code that could.
 *      A preview that can send is a campaign fired by a curious click.
 *   2. IT SHOWS WHAT WILL ACTUALLY BE SENT. The first draft of this service
 *      reported `mirrors: 'legacy'` and then rendered with the NEW builder —
 *      substituted values on screen, raw braces on the wire. An admin acts on
 *      a preview, so a pretty lie is worse than an ugly truth.
 *      พรีวิวสวยกว่าของจริง = แอดมินเชื่อแล้วยิงออกไป.
 */
import { BroadcastPreviewService, usesNewSendPath } from '@/modules/content';

const HOOK_A = {
  _id: 'hookA',
  line_oa_name: 'OA Alpha',
  domain_name: 'alpha.example',
  company_name: 'Alpha Co',
  description: 'the alpha OA',
};
const HOOK_B = {
  _id: 'hookB',
  line_oa_name: 'OA Beta',
  domain_name: 'beta.example',
  company_name: 'Beta Co',
  description: 'the beta OA',
};

const chain = (rows: unknown) => ({
  select: () => chain(rows),
  lean: () => chain(rows),
  exec: () => Promise.resolve(rows),
});

const JOB = {
  _id: 'a0d000000000000000000012',
  hook_ids: ['hookA', 'hookB'],
  message: {
    type: 'text',
    text: 'เว็บ {{hook_domain}} สวัสดี {{member.display_name}}',
  },
};

function build(
  job: Record<string, unknown> | null = JOB,
  hooks = [HOOK_A, HOOK_B],
) {
  const broadcastModel = { findOne: () => chain(job) };
  /* 🔴 THE FAKE HONOURS `$in`, like Mongo does. A fake that returns everything
     regardless of the filter cannot tell a BOUNDED QUERY from an unbounded one
     — the cap would look broken while it worked, or worse, look fine while the
     real query dragged every row across the network.
     fake ที่ไม่สน filter = พิสูจน์เรื่องเพดานไม่ได้เลย. */
  const hookModel = {
    find: (f?: { _id?: { $in?: unknown[] } }) => {
      const ids = f?._id?.$in;
      return chain(
        Array.isArray(ids) ? hooks.filter((h) => ids.includes(h._id)) : hooks,
      );
    },
  };
  const translate = { translate: () => null };
  /* [FEAT-20260824-BCASTFLEXID] No card library rows by default: every case in
     this file uses a job with an inline `flex_json` and no `flex_id`, so the
     loader must never be consulted. `null` proves it — if a case starts needing
     a body, it says so by failing here rather than quietly passing.
     ค่าเริ่มต้นคือ "ไม่มีการ์ด" ⇒ เคสไหนแอบต้องใช้จะฟ้องทันที. */
  const flexModel = { findById: () => ({ lean: () => Promise.resolve(null) }) };
  return new BroadcastPreviewService(
    broadcastModel as never,
    hookModel as never,
    /* [FEAT-20260824-BCASTFLEXID] The card library. `findById(...).lean()`
       answering `null` = "no such card", which is what a job pointing at a
       deleted card must see. */
    flexModel as never,
    translate as never,
  );
}

const ID = 'a0d000000000000000000012';

describe('preview — it cannot send', () => {
  it('🔴 the service takes no dispatcher and no token reader', () => {
    /* Structural, not a promise: `BroadcastPreviewService` has four
       constructor parameters and none of them can reach LINE. A future
       parameter that could would make this count wrong, which is the point.
       ส่งไม่ได้เพราะไม่มีทางไปถึง ไม่ใช่เพราะเลือกจะไม่ไป.

       ⚠️ WENT FROM 3 TO 4 ON 24/08 and that is the guard doing its job — it
       went red and forced this note. The fourth is the FlexMessage model
       ([FEAT-20260824-BCASTFLEXID]): a Mongoose model for the card library,
       which holds no token, no HTTP client and no dispatcher. It can read a
       card body and nothing else. เพิ่มพารามิเตอร์ = ต้องมาอธิบายที่นี่ทุกครั้ง. */
    expect(BroadcastPreviewService.length).toBe(4);
  });

  it('🔴 reads only — never claims, writes or releases the job', async () => {
    const writes: string[] = [];
    const trap = new Proxy(
      { findOne: () => chain(JOB) },
      {
        get(t, prop: string) {
          if (prop !== 'findOne') writes.push(prop);
          return (t as Record<string, unknown>)[prop];
        },
      },
    );
    const svc = new BroadcastPreviewService(
      trap as never,
      { find: () => chain([HOOK_A]) } as never,
      { findById: () => ({ lean: () => Promise.resolve(null) }) } as never,
      { translate: () => null } as never,
    );
    /* No flag argument — the REAL default is used, so this also proves the
       production call path reads nothing it should not. */
    await svc.previewBroadcast(ID);
    // `runBroadcast` would have called findOneAndUpdate three times by now.
    expect(writes).toEqual([]);
  });
});

describe('preview — it mirrors the sender that is actually running', () => {
  it('🔴 with NO argument it follows the real flag, whatever it is', async () => {
    /* Production calls it with one argument. If the default ever stopped
       reading `usesNewSendPath()`, every case below would still pass while the
       real endpoint answered the wrong shape — so the default itself is pinned
       against the switch the sender asks. ค่าเริ่มต้นต้องตามตัวส่งเสมอ. */
    const out = await build().previewBroadcast(ID);
    expect(out.mirrors).toBe(usesNewSendPath() ? 'new' : 'legacy');
  });

  it('🔴 legacy flag ⇒ legacy shape: raw braces, hard-coded altText', async () => {
    /* This is what a customer receives TODAY. Showing substituted values here
       would tell an admin the campaign is ready when it is not. */
    const SENDS_NEW = false;
    const out = await build().previewBroadcast(ID, undefined, SENDS_NEW);

    expect(out.mirrors).toBe('legacy');
    expect(out.cards[0]?.message).toMatchObject({
      type: 'text',
      text: 'เว็บ {{hook_domain}} สวัสดี {{member.display_name}}',
    });
  });

  it('🔴 new path ⇒ the OA’s real values, and N/A where nothing can fill', async () => {
    const SENDS_NEW = true;
    const out = await build().previewBroadcast(ID, undefined, SENDS_NEW);

    expect(out.mirrors).toBe('new');
    expect(out.cards[0]?.message['text']).toBe('เว็บ alpha.example สวัสดี N/A');
    // …and no braces survived to the customer.
    expect(String(out.cards[0]?.message['text'])).not.toContain('{{');
  });

  it('🔴 one card PER OA — values differ, so one card cannot serve both', async () => {
    const SENDS_NEW = true;
    const out = await build().previewBroadcast(ID, undefined, SENDS_NEW);

    expect(out.cards).toHaveLength(2);
    expect(out.cards[0]?.message['text']).toContain('alpha.example');
    expect(out.cards[1]?.message['text']).toContain('beta.example');
    expect(out.cards[1]?.hook_name).toBe('OA Beta');
  });

  it('legacy shows every OA the SAME card — because legacy sends one', async () => {
    const SENDS_NEW = false;
    const out = await build().previewBroadcast(ID, undefined, SENDS_NEW);
    expect(out.cards[0]?.message).toEqual(out.cards[1]?.message);
  });
});

describe('preview — the tags an admin would otherwise never hear about', () => {
  it('🔴 reports a tag nothing could fill', async () => {
    /* `unknownTags` is collected on every real send and displayed nowhere.
       This endpoint is the only place an admin learns that a card needs
       multicast. ที่เดียวที่แอดมินจะรู้. */
    const SENDS_NEW = true;
    const job = {
      ...JOB,
      message: { type: 'text', text: 'ยอด {{profile.no_such_thing}}' },
    };
    const out = await build(job).previewBroadcast(ID, undefined, SENDS_NEW);
    expect(out.cards[0]?.unknownTags).toContain('profile.no_such_thing');
  });

  it('a card with no tags reports none', async () => {
    const SENDS_NEW = true;
    const job = { ...JOB, message: { type: 'text', text: 'สวัสดีครับ' } };
    const out = await build(job).previewBroadcast(ID, undefined, SENDS_NEW);
    expect(out.cards[0]?.unknownTags).toEqual([]);
  });

  it('legacy reports none — it has no substitution step to fail at', async () => {
    const SENDS_NEW = false;
    const out = await build().previewBroadcast(ID, undefined, SENDS_NEW);
    expect(out.cards[0]?.unknownTags).toEqual([]);
  });
});

describe('preview — it never works harder than the send would', () => {
  it('🔴 caps the OAs it renders at the same ceiling the send enforces', async () => {
    /* `maxHooks` is checked at RUN time (`run-plan.ts:192`) and nowhere at save
       time, so a job can carry far more OAs than one run may reach. Rendering
       all of them would be the heaviest possible answer to a question whose
       real answer is "this job cannot run". พรีวิวต้องไม่หนักกว่าตอนส่ง. */
    const many = Array.from({ length: 30 }, (_, i) => ({
      _id: `hook${i}`,
      line_oa_name: `OA ${i}`,
      domain_name: `oa${i}.example`,
      company_name: `Co ${i}`,
      description: `d${i}`,
    }));
    const svc = build({ ...JOB, hook_ids: many.map((h) => h._id) }, many);
    const out = await svc.previewBroadcast(ID, undefined, true);

    expect(out.cards.length).toBeLessThanOrEqual(20);
  });

  it('🔴 and SAYS it capped — a short list must not read as "all your OAs"', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      _id: `hook${i}`,
      line_oa_name: `OA ${i}`,
      domain_name: `oa${i}.example`,
      company_name: `Co ${i}`,
      description: `d${i}`,
    }));
    const svc = build({ ...JOB, hook_ids: many.map((h) => h._id) }, many);
    const out = await svc.previewBroadcast(ID, undefined, true);

    expect(out.truncatedToHooks).toBe(20);
  });

  it('a job within the ceiling carries no truncation note at all', async () => {
    const out = await build().previewBroadcast(ID, undefined, true);
    expect(out).not.toHaveProperty('truncatedToHooks');
  });
});

describe('preview — refusals are readable', () => {
  it('a malformed id is refused before any read', async () => {
    await expect(build().previewBroadcast('not-an-id')).rejects.toThrow(
      /Invalid broadcast identifier/,
    );
  });

  it('a missing job is a 404, not an empty preview', async () => {
    await expect(build(null).previewBroadcast(ID)).rejects.toThrow(
      /not found/i,
    );
  });

  it('a job with no message says so instead of rendering nothing', async () => {
    await expect(
      build({ ...JOB, message: undefined }).previewBroadcast(ID),
    ).rejects.toThrow(/no message/);
  });
});
