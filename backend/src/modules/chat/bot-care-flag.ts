/**
 * [FEAT-20260820-BOTCAREQUIET] Is this row one the bot is handling alone?
 * ===========================================================================
 * Owner, repeatedly: "กลุ่มบอทดูแล ไม่ต้องมีเสียง" · "ทุกแบบที่เข้ามาใน บอทดูแล =
 * ไม่ต้องมีเสียง" · and, on finding it still chiming, "เฉพาะบอทดูแล ห้ามกระทบตัวอื่น
 * เด็ดขาด".
 *
 * WHY THIS LIVES ON THE SERVER. The dashboard's chime fires app-wide from a
 * single websocket subscription that receives one event and nothing else — no
 * ticket list, no room, no tab. It cannot work out which tab a message belongs
 * to, so the server answers the question and ships the answer with the event.
 * เสียงอยู่ระดับแอป เห็นแค่ event ⇒ เซิร์ฟเวอร์ต้องตอบมาให้.
 *
 * ⚠️ THE DEFINITION IS THE DASHBOARD'S, COPIED EXACTLY — do not simplify it.
 * `botTabRows()` + `isBotModeTicket()` in `omnidesk-console` decide the tabs:
 *
 *     บอทดูแล  = no case still OPEN   AND  the room is not held by an admin
 *     ปิดเคส   = the case is closed   BUT  the admin still holds the room
 *     รอรับเคส = job_status 0   ·  กำลังคุย = job_status 1
 *
 * So BOTH halves are required. Answering only "has no open case" would silence
 * ปิดเคส as well, because a customer whose cases are all closed while an admin
 * still holds the room lives there — and the owner ruled that out in as many
 * words. ปิดเคสแล้วแต่แอดมินยังถือห้อง = คนละแท็บ ⇒ ต้องยังดัง.
 *
 * ⚠️ AND `assist_status` ALONE IS NOT ENOUGH EITHER — `[FIX-20260819-ORPHANQUIET]`
 * shipped exactly that and was reverted: a case WAITING to be picked up has
 * `assist_status: false` too, so it silenced the customers most in need of a
 * person. `job_status: 0` counts as OPEN here, which is what prevents that.
 *
 * ⚠️ UNKNOWN IS LOUD. Every failure — no member, a dead query, a thrown model —
 * answers `false`, which chimes. An extra chime is a nuisance; a customer whose
 * message arrives in silence is a person left waiting. ไม่รู้ = ดังไว้ก่อน.
 *
 * revert: delete this file and the key it fills in `chat-history.service.ts`'s
 * `message:new` payload. The dashboard sees no key and chimes for everything,
 * which is the behaviour from before 2026-08-20.
 */

/** The key on the `message:new` payload. Exported so it cannot be mistyped. */
export const BOT_CARE_EVENT_KEY = 'bot_care';

/**
 * `0` = รอรับเคส, `1` = กำลังคุย. Both mean a case is still open; `2` is closed.
 * Same numbers `tickets.service.ts` and the dashboard's tabs use.
 */
export const OPEN_JOB_STATUSES = [0, 1] as const;

interface CountingModel {
  countDocuments(filter: Record<string, unknown>): { exec(): Promise<number> };
}

/**
 * True when the message belongs to a row the บอทดูแล tab owns.
 *
 * `memberId` is the member's `_id` — the value `chat_rooms.user_id` holds and
 * the value tickets store in `chat_user_id`/`line_user_id` (verified on live
 * rows: both ticket columns carry the same member ObjectId, NOT the LINE id).
 */
export async function isBotCareRow(
  input: { memberId?: unknown; assistOn?: unknown },
  deps: { ticketModel: CountingModel },
): Promise<boolean> {
  const memberId = input?.memberId;
  if (memberId === null || memberId === undefined || memberId === '') {
    return false;
  }
  /* Checked first and deliberately: an admin holding the room settles it without
     a query, so the ปิดเคส rows this must not touch cost nothing at all. */
  if (input?.assistOn === true) return false;

  try {
    const open = await deps.ticketModel
      .countDocuments({
        $or: [{ chat_user_id: memberId }, { line_user_id: memberId }],
        job_status: { $in: [...OPEN_JOB_STATUSES] },
      })
      .exec();
    return Number(open) === 0;
  } catch {
    /* swallowed on purpose — see "UNKNOWN IS LOUD" in the header. */
    return false;
  }
}
