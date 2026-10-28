/**
 * [FEAT-20260820-BOTCAREQUIET] the event says whether this row is a bot-care row
 * ===========================================================================
 * Owner, repeatedly across 2026-08-19/20: "กลุ่มบอทดูแล ไม่ต้องมีเสียง" ·
 * "ทุกแบบที่เข้ามาใน บอทดูแล = ไม่ต้องมีเสียง" · "ทำไมมีเสียงในบอทดูแล" ·
 * "เฉพาะบอทดูแล **ห้ามกระทบตัวอื่นเด็ดขาด**".
 *
 * WHY THE DASHBOARD CANNOT DECIDE THIS ALONE. The chime fires app-wide from one
 * websocket subscription with nothing but the event in hand — no ticket list, no
 * room. So the fact has to ride along on the event.
 * เสียงอยู่ระดับแอป มีแค่ event ⇒ ต้องแนบข้อเท็จจริงมากับ event.
 *
 * ⚠️ WHY TWO CONDITIONS AND NOT JUST "no open case" — this is the whole reason
 * the earlier attempt was wrong. The dashboard's own tab rule is
 * `botTabRows()` + `isBotModeTicket()` (`omnidesk-console`):
 *
 *   บอทดูแล = no ACTIVE case  AND  the room is not held by an admin
 *   ปิดเคส  = case closed     BUT  the admin still holds the room
 *
 * A customer whose cases are all closed while an admin still holds the room sits
 * in ปิดเคส, NOT in บอทดูแล. Publishing only "has no open case" would have
 * silenced that tab too — which the owner forbade in those exact words.
 * ปิดเคสแล้วแต่แอดมินยังถือห้อง = อยู่แท็บปิดเคส ⇒ ต้องยังดัง.
 *
 * ⚠️ AND WHY NOT `assist_status` ALONE — `[FIX-20260819-ORPHANQUIET]` tried that
 * and was reverted: a case WAITING to be picked up (รอรับเคส) also has
 * `assist_status: false`, so that rule silenced the customers most in need of a
 * person. `job_status: 0` counts as OPEN here, which is what keeps them loud.
 *
 * revert: delete `src/modules/chat/bot-care-flag.ts`, drop the key from the
 * `message:new` payload, and delete this file. The chime goes back to firing for
 * every row in every tab.
 */
import { isBotCareRow, BOT_CARE_EVENT_KEY } from '@/modules/chat/bot-care-flag';

const model = (openCases: number) => ({
  countDocuments: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(openCases),
  }),
});

const ask = (
  input: { memberId?: unknown; assistOn?: unknown },
  openCases = 0,
  m = model(openCases),
): Promise<boolean> => isBotCareRow(input, { ticketModel: m });

describe('⭐ who counts as a bot-care row', () => {
  it('never had a case + bot room → yes (the orphan the owner reported)', async () => {
    await expect(ask({ memberId: 'm1', assistOn: false }, 0)).resolves.toBe(
      true,
    );
  });

  it('every case closed + bot room → yes', async () => {
    await expect(ask({ memberId: 'm1', assistOn: false }, 0)).resolves.toBe(
      true,
    );
  });

  it('⭐ a case still open → NO, whatever the room says', async () => {
    /* covers รอรับเคส (job_status 0) and กำลังคุย (1) — both keep chiming. */
    for (const assistOn of [true, false, undefined, null]) {
      await expect(ask({ memberId: 'm1', assistOn }, 2)).resolves.toBe(false);
    }
  });

  it('⭐ room held by an admin → NO, even with every case closed', async () => {
    /* this is the ปิดเคส row the owner said must not be touched. */
    await expect(ask({ memberId: 'm1', assistOn: true }, 0)).resolves.toBe(
      false,
    );
  });

  it('⭐ and it does not even ASK when the admin holds the room', async () => {
    /* the cheap check runs first, so a held room costs no query at all. */
    const m = model(0);
    await ask({ memberId: 'm1', assistOn: true }, 0, m);
    expect(m.countDocuments).not.toHaveBeenCalled();
  });

  it('a room flag that is not exactly `true` is treated as "bot"', async () => {
    /* `assist_status` is a boolean with a default, but an older row can be
       missing it; absent must not mean "an admin is here". */
    for (const assistOn of [false, undefined, null, 0, '']) {
      await expect(ask({ memberId: 'm1', assistOn }, 0)).resolves.toBe(true);
    }
  });
});

describe('⭐ it asks the right question of the right column', () => {
  it('only OPEN cases count — 0 and 1, never 2', async () => {
    const m = model(0);
    await ask({ memberId: 'm1', assistOn: false }, 0, m);
    const filter = m.countDocuments.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(filter['job_status']).toEqual({ $in: [0, 1] });
  });

  it('the customer is looked up under BOTH column names', async () => {
    /* tickets carry the member as `chat_user_id` or `line_user_id` depending on
       which path created them — verified on live rows, where both hold the same
       member ObjectId. ไม่ใช่ LINE id · เป็น _id ของ member. */
    const m = model(0);
    await ask({ memberId: 'm1', assistOn: false }, 0, m);
    const filter = m.countDocuments.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(filter['$or'])).toContain('chat_user_id');
    expect(JSON.stringify(filter['$or'])).toContain('line_user_id');
  });
});

describe('⭐ unknown is LOUD — never silently swallowed', () => {
  it('a database failure answers false, so the chime still fires', async () => {
    /* being too loud is recoverable; dropping a customer who needs a person is
       not. ไม่รู้ = ดังไว้ก่อน. */
    const boom = {
      countDocuments: () => {
        throw new Error('mongo down');
      },
    };
    await expect(
      isBotCareRow({ memberId: 'm1', assistOn: false }, { ticketModel: boom }),
    ).resolves.toBe(false);
  });

  it('a rejected query answers false too', async () => {
    const m = {
      countDocuments: () => ({ exec: () => Promise.reject(new Error('x')) }),
    };
    await expect(
      isBotCareRow({ memberId: 'm1', assistOn: false }, { ticketModel: m }),
    ).resolves.toBe(false);
  });

  it('no member id answers false — nothing can be established', async () => {
    for (const memberId of [null, undefined, '']) {
      await expect(ask({ memberId, assistOn: false }, 0)).resolves.toBe(false);
    }
  });
});

describe('⭐ the model comes off the live connection, not the global registry', () => {
  /* MEASURED, NOT GUESSED. The first wiring used `mongoose.model('Ticket')` and
     every event published `bot_care: false` — the global registry threw
     `Schema hasn't been registered for model "Ticket"`, because Nest registers
     models on ITS OWN connection. The catch swallowed it, so the feature looked
     wired and silently did nothing; only a live redis capture showed it.
     This pins the door that actually works, since the failure is invisible.
     global registry ใช้ไม่ได้ · ต้องหยิบจาก connection ของ Nest */
  const src = require('node:fs')
    .readFileSync(
      require('node:path').join(
        process.cwd(),
        'src/modules/chat/chat-history.service.ts',
      ),
      'utf8',
    )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '') as string;

  it('reads it from an injected model’s connection', () => {
    expect(src).toContain("this.chatRoomModel.db.models['Ticket']");
  });

  it('never reaches for the global mongoose registry', () => {
    expect(src).not.toMatch(/\bmongooseModel\(/);
    expect(src).not.toMatch(/[^.]\bmodel\('Ticket'\)/);
  });

  it('skips the count when the model is not on the connection — silence is never assumed', () => {
    /* no model → `botCare` stays false → the chime fires. Same rule as every
       other unknown in this feature. */
    expect(src).toMatch(/if \(ticketModel\) \{/);
  });
});

describe('the key both sides agree on', () => {
  it('is exported, so the publisher cannot spell it differently', () => {
    expect(BOT_CARE_EVENT_KEY).toBe('bot_care');
  });
});
