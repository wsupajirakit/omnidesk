/**
 * [FEAT-20260820-FIRSTTICKET] when this customer first had a case, ever
 * ===========================================================================
 * Owner, 2026-08-20: "first_ticket_at = นับหมดไม่ว่าจะเกิดจากอะไร" ·
 * "ต้อง seamless นะ stg ยังไม่เคยมีต้องทำงานได้ปกติ" · "no debt".
 *
 * ⚠️ WHY ONE SEAM AND NOT FOUR. Tickets are created in four places — the assist
 * marker, an admin pressing "open case" (and `openTicketBySystem` behind it),
 * the REST route, and the payment runner. All four go through
 * `ticketModel.create()`, so `TicketSchema`'s save hook sees every one. Stamping
 * at the four call sites instead would be four things to keep in step; a fifth
 * writer added next year would silently miss the stamp.
 * ทางเดียวคุมได้ทุกทาง · เพิ่มทางที่ 5 วันหน้าก็ยังถูกนับ.
 *
 * Proof this seam really is universal, taken from the live database rather than
 * from reading the code: `channel_type` is written ONLY by that hook, and it was
 * present on every ticket row (43/43) at the time this was built.
 */
import {
  FIRST_TICKET_AT_FIELD,
  stampFirstTicketAt,
} from '@/modules/tickets/schemas/first-ticket-stamp';

/** A member model that records what it was asked to do. */
const modelWith = (modifiedCount: number) => {
  const updateOne = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue({ modifiedCount }),
  });
  return { model: { updateOne } as never, updateOne };
};

describe('what it writes', () => {
  it('⭐ stamps the member the ticket belongs to, with a date', async () => {
    const { model, updateOne } = modelWith(1);
    const at = new Date('2026-08-20T09:00:00Z');
    await expect(
      stampFirstTicketAt('m1', at, { memberModel: model, warn: jest.fn() }),
    ).resolves.toBe(true);
    const [filter, update] = updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter._id).toBe('m1');
    expect(update.$set[FIRST_TICKET_AT_FIELD]).toBe(at);
  });

  it('⭐ FIRST WRITER WINS — the filter refuses a member already stamped', async () => {
    /* "first" has to be enforced in the query, not by reading then writing: four
       creation paths can race, and two tickets in one request are normal.
       บังคับที่ filter ไม่ใช่อ่านก่อนเขียน · สองใบพร้อมกันเป็นเรื่องปกติ. */
    const { model, updateOne } = modelWith(1);
    await stampFirstTicketAt('m1', new Date(), {
      memberModel: model,
      warn: jest.fn(),
    });
    const [filter] = updateOne.mock.calls[0] as [Record<string, unknown>];
    expect(filter.$or).toEqual([
      { [FIRST_TICKET_AT_FIELD]: { $exists: false } },
      { [FIRST_TICKET_AT_FIELD]: null },
    ]);
  });

  it('a member already stamped is a no-op, reported as false', async () => {
    const { model } = modelWith(0);
    await expect(
      stampFirstTicketAt('m1', new Date(), {
        memberModel: model,
        warn: jest.fn(),
      }),
    ).resolves.toBe(false);
  });

  it('it writes ONE field and nothing else', async () => {
    /* a `$set` that grew a second key would be a silent schema change. */
    const { model, updateOne } = modelWith(1);
    await stampFirstTicketAt('m1', new Date(), {
      memberModel: model,
      warn: jest.fn(),
    });
    const [, update] = updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(Object.keys(update)).toEqual(['$set']);
    expect(Object.keys(update.$set)).toEqual([FIRST_TICKET_AT_FIELD]);
  });
});

describe('seamless — an existing database is untouched', () => {
  it('⭐ nothing is written for a member with no id on the ticket', async () => {
    /* a ticket that cannot name its member must not write to a random document. */
    const { model, updateOne } = modelWith(1);
    for (const id of [null, undefined, '']) {
      await expect(
        stampFirstTicketAt(id, new Date(), {
          memberModel: model,
          warn: jest.fn(),
        }),
      ).resolves.toBe(false);
    }
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('⭐ every member alive today keeps working with no value at all', async () => {
    /* The field is absent on every existing row and is never backfilled. The
       stamp is additive: `modifiedCount: 0` means the member was already stamped,
       never that something broke. No migration, no default, no read anywhere
       depends on it existing. ของเดิมไม่ต้องแก้ ไม่ต้อง migrate. */
    const { model, updateOne } = modelWith(0);
    await expect(
      stampFirstTicketAt('legacy-member', new Date(), {
        memberModel: model,
        warn: jest.fn(),
      }),
    ).resolves.toBe(false);
    const [, update] = updateOne.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(update.$unset).toBeUndefined();
    expect(update.$setOnInsert).toBeUndefined();
  });

  it('it never upserts — a ticket must not create a member', async () => {
    const { model, updateOne } = modelWith(1);
    await stampFirstTicketAt('m1', new Date(), {
      memberModel: model,
      warn: jest.fn(),
    });
    const opts = updateOne.mock.calls[0][2] as
      Record<string, unknown> | undefined;
    expect(opts?.upsert).not.toBe(true);
  });
});

describe('it can never break a ticket', () => {
  it('⭐ a database failure is swallowed and reported once', async () => {
    /* The ticket is already written by the time this runs. Losing a stamp must
       not turn a saved case into an error for the customer or the admin.
       จดไม่ได้ก็ต้องไม่ทำให้เคสพัง. */
    const warn = jest.fn();
    const model = {
      updateOne: () => {
        throw new Error('mongo down');
      },
    } as never;
    await expect(
      stampFirstTicketAt('m1', new Date(), { memberModel: model, warn }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a rejected promise is swallowed too', async () => {
    const warn = jest.fn();
    const model = {
      updateOne: () => ({
        exec: () => Promise.reject(new Error('write conflict')),
      }),
    } as never;
    await expect(
      stampFirstTicketAt('m1', new Date(), { memberModel: model, warn }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('works without a warn function at all', async () => {
    const model = {
      updateOne: () => {
        throw new Error('boom');
      },
    } as never;
    await expect(
      stampFirstTicketAt('m1', new Date(), { memberModel: model }),
    ).resolves.toBe(false);
  });
});

describe('the hook that calls it — wiring, read from the source', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  const src = (rel: string) =>
    fs.readFileSync(`${process.cwd()}/${rel}`, 'utf8');
  const schema = src('src/modules/tickets/schemas/ticket.schema.ts');

  it('⭐ stamps in post(save), never in pre — the ticket must exist first', () => {
    /* a stamp written in `pre` survives a failed save, marking a member as
       having had a case that was never stored. จดก่อนเซฟ = จดของที่ไม่มีจริง. */
    const postAt = schema.indexOf("TicketSchema.post('save'");
    expect(postAt).toBeGreaterThan(-1);
    const stampAt = schema.indexOf('stampFirstTicketAt(');
    expect(stampAt).toBeGreaterThan(postAt);
    // and the pre hook does not call it
    const preBlock = schema.slice(
      schema.indexOf("TicketSchema.pre('save'"),
      postAt,
    );
    expect(preBlock).not.toContain('stampFirstTicketAt(');
  });

  it('⭐ only on a NEW ticket — an edit must not restamp', () => {
    /* `post('save')` fires on every save, including an update to a ticket years
       old. Without this guard the "first" date would move.
       แก้ตั๋วเก่าแล้ว post ก็ยิง · ไม่กันไว้ วันที่จะเลื่อน. */
    expect(schema).toContain('this.$locals.wasNew = this.isNew;');
    const post = schema.slice(schema.indexOf("TicketSchema.post('save'"));
    expect(post.slice(0, 300)).toContain('if (!this.$locals.wasNew) return;');
  });

  it('⭐ reads the mirrored member field, so all four paths are covered', () => {
    /* the creation paths set `line_user_id` or `chat_user_id`; the pre hook
       mirrors them, so reading either after mirroring covers every path. */
    const post = schema.slice(schema.indexOf("TicketSchema.post('save'"));
    expect(post).toContain("'chat_user_id'");
    expect(post).toContain("'line_user_id'");
  });

  it('⭐ the model() lookup is INSIDE the try, not just the write', () => {
    /* `model('Member')` throws MissingSchemaError when that model is not
       registered, and a post-save hook that throws rejects the create() that
       triggered it — so an unregistered model would break EVERY ticket
       creation. Caught by running it for real; no unit test reached it, because
       the helper's own try/catch is too late (the lookup happens while building
       its arguments). หาไม่เจอด้วยเทส · เจอตอนยิงจริง. */
    const post = schema.slice(schema.indexOf("TicketSchema.post('save'"));
    /* ⚠️ comments are stripped FIRST. The block comment inside this hook
       explains the trap and therefore contains the words `model('Member')` and
       `try` itself — searching the raw text finds those instead of the code and
       the case passes or fails for the wrong reason. A first version of this
       test did exactly that. ตัดคอมเมนต์ก่อน ไม่งั้นเจอคำในคำอธิบาย. */
    const body = post
      .slice(0, post.indexOf('\n});'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const tryAt = body.indexOf('try {');
    const modelAt = body.indexOf("model('Member')");
    expect(tryAt).toBeGreaterThan(-1);
    expect(modelAt).toBeGreaterThan(tryAt);
    expect(body).toContain('} catch {');
  });

  it('it is fired and forgotten — a ticket never waits on the stamp', () => {
    const post = schema.slice(schema.indexOf("TicketSchema.post('save'"));
    expect(post).toContain('void stampFirstTicketAt(');
    expect(post).not.toContain('await stampFirstTicketAt(');
  });

  it('the member field has NO schema default, so absent means never', () => {
    /* a `default: null` would put the key on every document and make the partial
       index hold the whole collection. ใส่ default แล้ว index จะกลายเป็นทั้ง collection. */
    const member = src('src/modules/chat/schemas/member.schema.ts');
    const block = member.slice(
      member.indexOf('first_ticket_at?: Date;') - 200,
      member.indexOf('first_ticket_at?: Date;'),
    );
    expect(block).toContain('@Prop({ type: Date })');
    expect(block).not.toContain('default: null');
  });

  it('and its index is partial on $exists, matching the field', () => {
    const member = src('src/modules/chat/schemas/member.schema.ts');
    expect(member).toContain(
      'partialFilterExpression: { first_ticket_at: { $exists: true } }',
    );
  });
});
