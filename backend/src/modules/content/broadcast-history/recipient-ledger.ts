/**
 * [FEAT-20260822-BCASTLEDGER] The seam for recording WHO — off by default.
 * ===========================================================================
 * เจ้าของ 22/08: "เจอใครบ้าง อันนี้ไม่ต้องเก็บ มันจะยาวไป (แต่เผื่อไว้กลับมาเปลี่ยนใจ)"
 * และ "log ต้องสามารถเพิ่มได้ในอนาคต: เป้าหมายที่เจอ / ที่ส่งจริง / ที่เหลือไม่ส่ง".
 *
 * So the history row always carries the COUNTS, and the ID LISTS are a separate,
 * switchable concern that writes somewhere else. Turning one on later changes
 * no existing row and no existing reader — it only starts filling a side table.
 *
 * 🔴 WHY THE LISTS MUST NEVER GO INLINE IN THE HISTORY ROW
 * 100,000 LINE ids is ~4-6 MB. Inline, every history read drags that along, and
 * a document that grows without a fixed ceiling is exactly what this repo's own
 * rule says to keep out of a row (`chat/config/member-config.registry.ts:10-18`).
 * ⇒ side collection, its own TTL, fetched only when someone asks. ห้ามฝังในแถว.
 *
 * revert: delete this file with the rest of `broadcast-history/`.
 */

/** The three lists the owner may want later. Each is independently switchable. */
export type RecipientListKind =
  /** Everyone the audience rules selected. */
  | 'matched'
  /** Everyone LINE accepted. */
  | 'sent'
  /** Selected but never sent — stopped early, over the ceiling, chunk failed. */
  | 'unsent';

export const RECIPIENT_LIST_KINDS: readonly RecipientListKind[] = [
  'matched',
  'sent',
  'unsent',
];

/**
 * 🎯 ALL OFF. Flip one here to start capturing that list.
 *
 * ⚠️ Flipping one on is a DATA decision, not a code preference: it starts
 * storing customer identifiers, so it needs the same approval as any other
 * schema change (dev-local §3). เปิดเมื่อไหร่ = เก็บข้อมูลลูกค้าเพิ่ม ต้องขออนุมัติ.
 */
export const RECIPIENT_CAPTURE: Readonly<Record<RecipientListKind, boolean>> = {
  matched: false,
  sent: false,
  unsent: false,
};

export function isCapturing(kind: RecipientListKind): boolean {
  return RECIPIENT_CAPTURE[kind] === true;
}

export interface RecipientBatch {
  readonly runId: string;
  readonly hookId: string;
  readonly kind: RecipientListKind;
  /** A chunk's worth at a time — never the whole run in one array. */
  readonly ids: readonly string[];
}

/**
 * Implementations: `NoopRecipientLedger` (today) · a Mongo-backed one if a
 * switch above is ever turned on.
 *
 * ⚠️ Must never throw: a ledger failure is a lost note, not a lost campaign.
 */
export interface RecipientLedger {
  record(batch: RecipientBatch): Promise<void>;
}

/**
 * The only implementation today. It is not a placeholder to be replaced later —
 * it is what "we decided not to store this" looks like in code, and it stays as
 * the implementation whenever every switch is off.
 */
export class NoopRecipientLedger implements RecipientLedger {
  // The batch is accepted and dropped on purpose — the signature must match the
  // interface so a real ledger can replace this one without touching a caller.
  record(_batch: RecipientBatch): Promise<void> {
    void _batch;
    return Promise.resolve();
  }
}

/**
 * What a reader needs to know about a history row: which lists exist for it.
 *
 * Stored ON the row so a row written while capture was off can never be mistaken
 * for a run that reached nobody. บอกให้ชัดว่า "ไม่ได้เก็บ" ไม่ใช่ "ไม่มีใคร".
 */
export interface RecipientCaptureFlags {
  readonly matched: boolean;
  readonly sent: boolean;
  readonly unsent: boolean;
}

export function currentCaptureFlags(): RecipientCaptureFlags {
  return {
    matched: isCapturing('matched'),
    sent: isCapturing('sent'),
    unsent: isCapturing('unsent'),
  };
}
