import type { LineMessage } from '../line-push.types';

/**
 * ==== [FEAT-20260820-LINEPUSHADAPTERS] candidate F — customer-link push ====
 *
 * Parity with customer-link.service.ts:179-183 (`pushLinkedNotice`) and :399
 * (`notifyAlreadyRegistered`): both are a single text push. WHICH text —
 * `customer_link_success_text` from the hook vs the const default — is a
 * hook-aware decision and stays with the caller (`linkedNoticeText`, :152-158);
 * the core and this adapter know nobody. การเลือกข้อความอยู่ฝั่งผู้เรียกเสมอ.
 * revert: delete `src/infra/line/` entirely (no runtime importers yet).
 */

export function buildLinkedNoticeMessage(noticeText: string): LineMessage {
  return { type: 'text', text: noticeText };
}
