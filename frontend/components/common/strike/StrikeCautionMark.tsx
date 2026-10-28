import React from 'react';

/**
 * [FEAT-20260826-STRIKESUSPEND] The red `!` that says the bot has gone silent.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * Owner, 26/08: *"ถ้าใครที่ strike ครบ avatar จะมี caution คล่อมแดงๆ เลย · `!`
 * ตรงกลาง avatar สีแดงเด่นๆ"* and, when it first came out too timid,
 * *"icon ! ที่ avatar ต้องแดง เด้ง ใหญ่กว่า avatar"*.
 *
 * ⚠️ IT IS NOT THE SHIELD, and it must never be confused with it. Owner:
 * *"ไม่ใช่โล่นะ ตัวนั้นไม่เกี่ยว ยังอยุ่ที่เดิม"*. `IgnoreAbandonShield` sits at
 * the avatar's bottom-right, is present for everyone, and is a button. This is a
 * centred overlay, appears only while locked, and is not clickable at all — the
 * click belongs to the avatar underneath it (`pointer-events-none` below is what
 * makes that true, and is load-bearing rather than cosmetic).
 *
 * ⚠️ IT ALSO DOES NOT TOUCH THE RING. `avatarRingClass` encodes orphan-room and
 * is asserted byte-for-byte by `test/orphanRooms.value.test.ts`; this renders as
 * a SIBLING inside the `div.relative` that already exists, exactly as the shield
 * does, so not one character of the `<img>` line changes. ห้ามแตะบรรทัด img
 *
 * WHY BIGGER THAN THE AVATAR: it is deliberately louder than everything around
 * it. A locked customer means the bot is silently dropping their messages, and
 * an admin who does not notice will read the empty conversation as "they stopped
 * replying". Being subtle here is the failure mode.
 *
 * revert: delete this file and the one block that renders it in `TicketChat.tsx`.
 */
interface Props {
  /** Render nothing at all when false — an absent mark is the normal state. */
  suspended: boolean;
  /** Screen-reader text; the glyph itself carries no meaning to a reader. */
  label: string;
}

export const StrikeCautionMark: React.FC<Props> = ({ suspended, label }) => {
  if (!suspended) return null;

  return (
    <span
      data-testid="strike-caution-mark"
      title={label}
      aria-label={label}
      role="img"
      /* `pointer-events-none` is REQUIRED, not decoration: this sits on top of
         the avatar, which is the thing the admin clicks to open the modal.
         Without it the mark would swallow that click — and it appears exactly
         for the customers whose stats an admin most wants to open.
         ครอบ avatar อยู่ ⇒ ต้องให้คลิกทะลุ ไม่งั้นบังปุ่มตัวเอง */
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
    >
      <span className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-rose-600/90 text-[40px] font-black leading-none text-white shadow-[0_0_0_3px_rgba(255,255,255,0.95),0_0_18px_4px_rgba(225,29,72,0.65)] animate-pulse">
        !
      </span>
    </span>
  );
};

export default StrikeCautionMark;
