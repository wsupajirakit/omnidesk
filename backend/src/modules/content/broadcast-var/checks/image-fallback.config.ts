/**
 * [FEAT-20260822-BCASTIMGFALLBACK] The picture a broken image URL falls back to.
 * ===========================================================================
 * 🎯 เปลี่ยนภาพสำรองที่นี่ที่เดียว — ไม่มีที่อื่นถือสำเนา.
 *
 * A plain const by the owner's instruction ("ภาพ = const", 22/08): no env, no
 * per-OA override, no database value. Reading the code tells you exactly what
 * every environment will send. Changing it costs a deploy, which is the right
 * price for something that should almost never change.
 *
 * Same shape the original uses for its own fallback
 * (`webhook/flex/flex-image-fallback.util.ts:23`) — we copy the pattern but
 * keep our OWN value, so the reply path is untouched. 🔒 ห้ามแก้ original.
 *
 * VERIFIED 2026-08-22 with a real request:
 *   HTTP/2 200 · content-type: image/jpeg · content-length 13,740 · no redirect
 *   129 characters, well inside LINE's 2,000 limit.
 *
 * ⚠️ It is a third-party image host. If the file is ever removed the URL keeps
 *    its SHAPE — https, a real host, no unresolved variable — so the shape
 *    check still passes and LINE still accepts the message; the customer simply
 *    sees an empty frame. That failure is invisible offline, which is why the
 *    liveness checker exists and why the fallback itself must be included in it.
 *    A spec asserts the URL passes our own shape check, which is the part that
 *    CAN be tested without a network. รูปหายแต่ url ยังถูกรูป = เช็คแบบ offline ไม่เจอ.
 *
 * revert: delete this file with the rest of `checks/`.
 */

export const BROADCAST_FALLBACK_IMAGE_URL =
  'https://i.ibb.co/GQgSG0fk/multimedia-communication-image-placeholder-' +
  'photography-landscape-image-comics-picture-photo-gallery.jpg';
