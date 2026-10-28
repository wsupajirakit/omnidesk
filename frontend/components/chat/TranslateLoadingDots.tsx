import React from 'react';

/**
 * [FIX-20260909-LOADINGLOOK] The wait for a translation, in one component.
 * ===========================================================================
 * Owner, 09/09, three times and each time more specific:
 *   1. *"ทำสวยเหมือน ai loading (ทั้ง แปล bubble กับ แปล box)"*
 *   2. *"loading ball effect สีสันสวย ๆ ม่วงเข้ม ม่วงอ่อน ฟ้าเข้ม ฟ้าอ่อน"*
 *   3. *"loading ยังไม่สวยนะ … ที่จุดที่ต้องรอโหลดแปลภาษา"* + a react-loading
 *      screenshot: *"เอาเป็น loading ball"*
 *
 * 🔴 IT IS A TRAIN, NOT A BOUNCE. The first build read "ball effect" as four
 *    dots bouncing in place (`animate-bounce`). The reference picture is the
 *    other animation entirely: balls travelling to the RIGHT through a box that
 *    CLIPS them — which is why the rightmost one in that picture is cut in half.
 *    Nothing here fades; `overflow-hidden` on the track is what makes them
 *    appear and disappear, exactly as in the reference.
 *
 * 🔴 IT LIVES HERE BECAUSE THERE ARE TWO PLACES YOU WAIT, NOT ONE. The picker
 *    modal shows the wait when a bubble is being translated; the composer strip
 *    shows it when a draft is. The strip still had a grey `Loader2` spinner, so
 *    the same action looked like two different features depending on where it
 *    was started. Four colours written twice would have drifted the first time
 *    one of them changed. `translateLoadingDots.value.test.ts` keeps it that way.
 *
 * ⚠️ THE GEOMETRY IS IN BALL-WIDTHS, NOT PIXELS. The keyframe (`index.css`,
 *    `tcBallsRun`) moves `-100% → 600%` of each ball's OWN width, and the track
 *    is six ball-widths long — so one keyframe serves both sizes and a size
 *    added later needs no new CSS. The stagger is a delay per ball: 0.25s of a
 *    1.4s cycle ≈ 125% of a ball width between them, which is the spacing in the
 *    reference.
 *
 * ⚠️ THE BALLS ARE DECORATION — they say "wait", never "still running". Nothing
 *    here can know whether the request died; that is what the 20s deadline in
 *    `aiTranslateService` is for, and both call sites surface its error.
 *
 * revert: inline four `animate-bounce` spans at each call site and drop the
 *         `tcBallsRun` block from index.css.
 */
const BALLS = [
  { c: 'bg-violet-600', d: 0 },      // ม่วงเข้ม
  { c: 'bg-violet-300', d: 250 },    // ม่วงอ่อน
  { c: 'bg-sky-600', d: 500 },       // ฟ้าเข้ม
  { c: 'bg-sky-300', d: 750 },       // ฟ้าอ่อน
];

/** ball diameter in px — the track is six of these wide, per the note above */
const BALL_PX = { sm: 6, md: 12 } as const;

export const TranslateLoadingDots: React.FC<{
  /** `sm` sits on the composer strip beside its label; `md` fills the modal. */
  size?: 'sm' | 'md';
}> = ({ size = 'md' }) => {
  const px = BALL_PX[size];
  return (
    <div
      className="relative overflow-hidden"
      style={{ width: px * 6, height: px }}
      data-testid="translate-loading-dots"
      aria-hidden
    >
      {BALLS.map((b) => (
        <span
          key={b.c}
          className={`tc-balls-run absolute left-0 top-0 rounded-full ${b.c}`}
          style={{ width: px, height: px, animationDelay: `${b.d}ms` }}
        />
      ))}
    </div>
  );
};

export default TranslateLoadingDots;
