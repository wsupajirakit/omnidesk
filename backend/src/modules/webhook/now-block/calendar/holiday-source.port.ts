/**
 * [FEAT-20260902-NOWBLOCK] The holiday seam — where the dates COME FROM.
 * ===========================================================================
 * The table is hardcoded today, and that is the decision, not a shortcut: a
 * calendar that lives in code is edited in one place, reviewed like code, and
 * cannot be half-populated by a failed migration. The owner's instruction on
 * 02/09/2026 was explicit — fix it in code, in its own easy-to-edit place, and
 * leave a way to load it from somewhere else later.
 *
 * This port IS that way. A future "read the calendar from Mongo / from a hook
 * column / from a config service" becomes a second implementation of this
 * interface plus one line where the source is chosen — no logic anywhere else
 * changes, and no caller learns where the dates came from.
 * ฟิกในโค้ดวันนี้ · แต่ท่อเปิดไว้แล้ว วันเปลี่ยนไปโหลดไม่ต้องแตะตรรกะ
 *
 * The shape follows the ports this repo already uses for exactly this purpose —
 * `menu/sources/definition-source.port.ts`, `menu/renderers/stored-card.port.ts`,
 * `menu-press/stores/menu-press.store.port.ts`. Same idea: name the capability,
 * not the storage.
 *
 * ⚠️ SYNCHRONOUS ON PURPOSE. This is read while a customer's reply is being
 * assembled. An async source would put an I/O wait on that path and would force
 * every caller above to become async for a lookup that is a hash hit today. A
 * future database-backed source should load into memory at boot (or cache with
 * its own refresh) and still answer synchronously here.
 *
 * revert: delete the `now-block/` folder.
 */

/** A calendar the block can ask two questions of. Nothing else. */
export interface HolidaySource {
  /**
   * The holiday's name for a Bangkok calendar day (`YYYY-MM-DD`), or `null` when
   * that day is an ordinary working day.
   *
   * ⚠️ `null` means "not a holiday", NOT "unknown". A source that cannot answer
   * must say so through `lastCoveredDate()` rather than by returning `null` for
   * dates it has never heard of — otherwise an expired calendar reports every
   * holiday as a working day and nothing anywhere notices.
   */
  lookup(dateIso: string): string | null;

  /**
   * The last Bangkok day this source can speak for, as `YYYY-MM-DD`, or `null`
   * if it is open-ended.
   *
   * THIS IS THE ROT GUARD'S INPUT. A hardcoded table silently expires: from the
   * first day past its coverage every holiday reads as a normal working day, with
   * no error, no log line and no failing test. A spec compares this value against
   * the real current date and goes red while there is still time to append rows,
   * so the failure arrives on a developer's screen instead of in a customer's chat.
   * ตารางหมดอายุแบบเงียบ ๆ = ต้องมีตัวจับ ไม่ใช่แค่โน้ตเตือน
   */
  lastCoveredDate(): string | null;
}
