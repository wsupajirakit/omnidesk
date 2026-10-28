/**
 * [FEAT-20260824-BCASTTRANSCRIPT] A campaign's copy in the customer's chat.
 *
 * Removable as a unit: delete this folder and the one call site in
 * `new-send.service.ts`. Nothing in the send path reads what it writes, so the
 * send behaves identically without it. ถอดทั้งโฟลเดอร์ได้ การส่งไม่กระทบ.
 */
export * from './campaign-tag';
export * from './transcript.writer';
/* [FIX-20260828-TRANSCRIPTVARS] การตัดสินว่าอะไรถูกบันทึกลงห้องแชท */
export * from './transcript-content';
