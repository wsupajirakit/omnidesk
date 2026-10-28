import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * [PROG-20260905-TWOWRITER] Turn values that TWO different places write — pinned, because
 * one of them writes a different thing than the other and nothing said so.
 * ===========================================================================================
 * The dive that produced this file asked a narrow question: which values of a turn are
 * written from more than one site? Most answers were benign (a value refined as the turn
 * learns more). One was not.
 *
 * 🔴 `bangkokTime` IS WRITTEN IN TWO FORMATS, AND BOTH REACH AN OPERATOR'S SCREEN.
 *
 *   · `room-bootstrap/combined-profile.ts` — `en-GB`, spelled month, 24-hour, comma
 *     stripped:                                  `05 September 2026 at 22:15:30`
 *   · `gates/api-error-trigger.step.ts`    — `th-TH` default format, which is
 *     day/month/**BUDDHIST year**:                `5/9/2569 22:15:30`
 *
 *   Both land in the same field, and that field is read by `assistTurn()` (the ticket and
 *   the assist notification) and by `telegram-no-answer-notify.ts:107`, which sends
 *   `- เวลา: ${args.bangkokTime}` to an operator's Telegram.
 *
 *   ⇒ THE SAME MESSAGE SHOWS A DIFFERENT DATE FORMAT DEPENDING ON WHETHER THE PROFILE
 *     FETCH FAILED, and one of the two is in the Buddhist era. An operator comparing two
 *     tickets is comparing `2026` against `2569`.
 *     ฟิลด์เดียว สองรูปแบบ · ปี ค.ศ. กับ ปี พ.ศ. ปนกันในข้อความเดียวกัน
 *
 * ✅ THE OWNER WAS ASKED AND DECIDED, 05/09: **LEAVE BOTH FORMATS AS THEY ARE.**
 *
 * So this is a SETTLED question, not an open one, and the difference matters to whoever
 * reads this next. Do not re-raise it as a defect and do not "tidy" it into one format:
 * that is a change the owner has already declined, and it would rewrite what operators
 * have been reading for months. If it is ever revisited, it needs a fresh decision — the
 * three options put to the owner were en-GB everywhere, th-TH everywhere, or one new
 * unambiguous format at both sites. ถามแล้ว เจ้าของสั่งไม่แก้ · อย่าไปแก้เอง
 *
 * ⚠️ THE FILE STAYS ANYWAY, and that is the point of it. The divergence is now IMPOSSIBLE
 * TO KEEP MISSING: anyone who unifies the format — deliberately or by accident, while
 * touching either writer — gets a named red telling them exactly what they changed and
 * who reads it. A characterization test, not an approval.
 * ตรึงพฤติกรรมปัจจุบัน ไม่ใช่รับรองว่าถูก
 */
describe('[PROG-20260905-TWOWRITER] values written by two different sites', () => {
  const ROOT = join(__dirname, '../..');
  const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

  describe('🔴 bangkokTime — two writers, two formats, one reader', () => {
    it('writer 1 (the profile fetch) still uses en-GB with a spelled month', () => {
      const src = read(
        'src/modules/webhook/room-bootstrap/combined-profile.ts',
      );
      expect(src).toContain("toLocaleString('en-GB'");
      expect(src).toContain("month: 'long'");
      expect(src).toContain('hour12: false');
    });

    it('writer 2 (the api-error trigger) still uses the th-TH default', () => {
      const src = read('src/modules/webhook/gates/api-error-trigger.step.ts');
      expect(src).toContain("toLocaleString('th-TH'");
      /* No `month`/`hour12` options — that is exactly why it comes out in the Buddhist
         era. Stated as an assertion so "someone added options later" is a named change. */
      expect(src).not.toContain("month: 'long'");
    });

    it('⭐ THE TWO REALLY DO DISAGREE — run them and compare', () => {
      /* The proof, not the claim. A fixed instant through both recipes, so the difference
         is demonstrated rather than asserted from reading the source. */
      const at = new Date('2026-09-05T15:15:30Z');
      const fromProfile = at
        .toLocaleString('en-GB', {
          timeZone: 'Asia/Bangkok',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
        .replace(',', '');
      const fromApiError = at.toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
      });

      expect(fromProfile).not.toBe(fromApiError);
      expect(fromProfile).toContain('2026');
      // the Buddhist year — 543 ahead, and this is the half an operator sees on a failure
      expect(fromApiError).toContain('2569');
    });

    it('and an operator really is the one who sees it', () => {
      /* If nothing read it, the divergence would be harmless and this file would be
         noise. It is not: the value is interpolated into the Telegram page. */
      const notify = read(
        'src/modules/webhook/assist/telegram-no-answer-notify.ts',
      );
      expect(notify).toContain('${args.bangkokTime}');
    });
  });
});
