/**
 * [FEAT-20260824-BCASTFLEXID] The card a job sends comes from the library.
 * ===========================================================================
 * Owner, 24/08: *"flex id ใช้ส่ง ไม่ใช่ กรอกดิบ"* · *"flex id > เซฟ job > ตอน job
 * ทำก็ไปดึงมา ทั้งแบบ dynamic + plain card"* · *"ยกเว้น text กรอกดิบ เซฟติด job"* ·
 * *"ส่วนแบบ image ก็ทำงานได้แบบเดิมนั้นแหละ"*
 *
 * Every case below is one of those sentences, kept separate on purpose: the
 * owner asked for the card kinds to be proven apart, not as one happy path.
 * แยกเคส plain / dynamic / text / image ตามที่สั่ง.
 */
import {
  readFlexCardBody,
  FLEX_CARD_BODY_COLUMN,
} from '@/modules/content/broadcast-send/adapters/flex-card.reader';
import {
  flexIdOf,
  resolveSavedCard,
} from '@/modules/content/broadcast-run/saved-card';

/** The card as it sits in the library — the shape a real row has. */
const LIBRARY_CARD = {
  type: 'bubble',
  body: { type: 'box', layout: 'vertical', contents: [] },
};
/** What a job saved BEFORE this feature holds inside itself. */
const OWN_COPY = { type: 'bubble', body: { stale: true } };

const ID = 'a0d00000000000000000002f';

/** A library that holds exactly one card. */
const library = (rows: Record<string, unknown>) => ({
  findById: (id: string) => ({
    lean: () => Promise.resolve((rows[id] as Record<string, unknown>) ?? null),
  }),
});

const loaderFor = (rows: Record<string, unknown>) => (id: string) =>
  readFlexCardBody(library(rows), id);

/** Counts whether the loader was consulted at all. */
function countingLoader(answer: unknown = LIBRARY_CARD) {
  const calls: string[] = [];
  return {
    calls,
    load: (id: string) => {
      calls.push(id);
      return Promise.resolve(answer);
    },
  };
}

describe('flexIdOf — where the reference is read from', () => {
  it('reads a plain string id', () => {
    expect(flexIdOf({ type: 'flex', flex_id: ID })).toBe(ID);
  });

  it('🔴 reads the ObjectId a `.lean()` read hands back', () => {
    /* A lean document does NOT give back a string. Reading only `typeof
       'string'` would make every real send behave as "this job has no card
       reference" and quietly fall through to the stale private copy — the exact
       bug this feature exists to remove, reintroduced by a type check.
       lean คืน ObjectId ไม่ใช่ string ⇒ ต้องรับทั้งสองแบบ. */
    const objectId = { toHexString: () => ID, toString: () => ID };
    expect(flexIdOf({ type: 'flex', flex_id: objectId })).toBe(ID);
  });

  it('an absent, empty or nonsense reference is `undefined`, never a guess', () => {
    expect(flexIdOf({ type: 'flex' })).toBeUndefined();
    expect(flexIdOf({ type: 'flex', flex_id: '   ' })).toBeUndefined();
    expect(flexIdOf({ type: 'flex', flex_id: 42 })).toBeUndefined();
    expect(flexIdOf(undefined)).toBeUndefined();
  });
});

describe('readFlexCardBody — one card out of the library', () => {
  it('returns the body under the column the library actually uses', async () => {
    const body = await readFlexCardBody(
      library({ [ID]: { [FLEX_CARD_BODY_COLUMN]: LIBRARY_CARD } }),
      ID,
    );
    expect(body).toEqual(LIBRARY_CARD);
  });

  it('🔴 a card that is gone is `undefined` — not an empty card', async () => {
    /* The caller turns this into a refusal. Answering `{}` here would ship a
       blank card to real followers. ไม่มีการ์ด ≠ การ์ดเปล่า. */
    expect(await readFlexCardBody(library({}) as never, ID)).toBeUndefined();
  });

  it('🔴 a malformed id is "no such card", not a thrown scheduled run', async () => {
    /* `findById` on a non-ObjectId throws inside Mongoose. An id typed by hand
       or left over from an import would otherwise take a whole cron tick down.
       id พิมพ์ผิดต้องไม่ล้มรอบ cron. */
    const throwing = {
      findById: () => {
        throw new Error('Cast to ObjectId failed');
      },
    };
    expect(
      await readFlexCardBody(throwing as never, 'not-an-id'),
    ).toBeUndefined();
  });

  it('an empty body IS an answer and comes back as written', async () => {
    const body = await readFlexCardBody(
      library({ [ID]: { [FLEX_CARD_BODY_COLUMN]: {} } }),
      ID,
    );
    expect(body).toEqual({});
  });
});

describe('resolveSavedCard — plain card (ทุกคนได้ใบเดียวกัน)', () => {
  it('🔴 sends the LIBRARY card, not the copy stored on the job', async () => {
    /* The whole feature in one assertion: an admin fixed the card at the
       library, and this campaign must ship the fix. แก้ที่ต้นทาง job ต้องตาม. */
    const card = await resolveSavedCard(
      { type: 'flex', flex_id: ID, flex_json: OWN_COPY },
      loaderFor({ [ID]: { [FLEX_CARD_BODY_COLUMN]: LIBRARY_CARD } }),
    );
    expect(card?.flex_json).toEqual(LIBRARY_CARD);
    expect(card?.flex_json).not.toEqual(OWN_COPY);
  });

  it('keeps the rest of the card untouched', async () => {
    const card = await resolveSavedCard(
      { type: 'flex', flex_id: ID, text: 'ignored', image_url: 'ignored' },
      loaderFor({ [ID]: { [FLEX_CARD_BODY_COLUMN]: LIBRARY_CARD } }),
    );
    expect(card).toMatchObject({
      type: 'flex',
      text: 'ignored',
      image_url: 'ignored',
    });
  });
});

describe('resolveSavedCard — dynamic card (ค่าเฉพาะคน)', () => {
  it('🔴 resolves through the SAME path as a plain card', async () => {
    /* A personal card differs in how it is RENDERED, never in where its body
       comes from. Two lookup paths would drift, and the drift would only show
       on the card kind that is hardest to eyeball.
       dynamic กับ plain ต้องดึงการ์ดจากทางเดียวกัน. */
    const dynamicBody = {
      type: 'bubble',
      body: { contents: [{ type: 'text', text: 'สวัสดี {{member.name}}' }] },
    };
    const card = await resolveSavedCard(
      { type: 'flex', flex_id: ID, flex_json: OWN_COPY },
      loaderFor({ [ID]: { [FLEX_CARD_BODY_COLUMN]: dynamicBody } }),
    );
    /* The tag survives untouched — substitution happens later, per recipient,
       and this step must not pre-render anything. */
    expect(JSON.stringify(card?.flex_json)).toContain('{{member.name}}');
  });
});

describe('resolveSavedCard — ข้อความธรรมดา และรูปภาพ ไม่แตะเลย', () => {
  it('🔴 `text` never consults the library — it is typed into the job', async () => {
    /* Owner, 24/08: "ยกเว้น text กรอกดิบ เซฟติด job". A lookup here would be a
       round trip for nothing, and would fail a job whose text is fine. */
    const l = countingLoader();
    const card = await resolveSavedCard(
      { type: 'text', text: 'ส่งตรง ๆ', flex_id: ID },
      l.load,
    );
    expect(card).toMatchObject({ type: 'text', text: 'ส่งตรง ๆ' });
    expect(l.calls).toEqual([]);
  });

  it('🔴 `image` keeps working exactly as before', async () => {
    /* Owner, 24/08: "ส่วนแบบ image ก็ทำงานได้แบบเดิมนั้นแหละ". */
    const l = countingLoader();
    const card = await resolveSavedCard(
      { type: 'image', image_url: 'https://example.test/a.png' },
      l.load,
    );
    expect(card).toMatchObject({
      type: 'image',
      image_url: 'https://example.test/a.png',
    });
    expect(l.calls).toEqual([]);
  });
});

describe('resolveSavedCard — งานเก่าต้องไม่ขยับ (seamless)', () => {
  it('🔴 a job with no `flex_id` sends its own copy, loader untouched', async () => {
    /* Every campaign saved before 24/08 is in this state. If this case ever
       fails, the feature broke every existing job — the thing the owner said
       must not happen ("ห้ามกระทบ กรณีไม่ตั้งหรือไม่เปิด").
       absent ≠ empty · ไม่มี flex_id = งานก่อนฟีเจอร์นี้ ต้องส่งของเดิม. */
    const l = countingLoader();
    const card = await resolveSavedCard(
      { type: 'flex', flex_json: OWN_COPY },
      l.load,
    );
    expect(card?.flex_json).toEqual(OWN_COPY);
    expect(l.calls).toEqual([]);
  });

  it('a message that is not readable at all is still `null`', async () => {
    expect(await resolveSavedCard(undefined, countingLoader().load)).toBeNull();
    expect(await resolveSavedCard({}, countingLoader().load)).toBeNull();
  });
});

describe('resolveSavedCard — การ์ดที่ชี้ไปหายแล้ว', () => {
  it('🔴 REFUSES rather than falling back to the stale copy', async () => {
    /* The dangerous case. An admin deleted the old card and expects the new
       one; falling back would send the very content they removed, to real
       followers, with nothing on screen to say so.
       ชี้การ์ดที่หายไป = ไม่ส่ง ไม่ใช่ส่งของเก่า. */
    const card = await resolveSavedCard(
      { type: 'flex', flex_id: ID, flex_json: OWN_COPY },
      loaderFor({}),
    );
    expect(card).toBeNull();
  });

  it('🔴 refuses on a `null` body too, not just a missing row', async () => {
    const card = await resolveSavedCard(
      { type: 'flex', flex_id: ID, flex_json: OWN_COPY },
      () => Promise.resolve(null),
    );
    expect(card).toBeNull();
  });
});
