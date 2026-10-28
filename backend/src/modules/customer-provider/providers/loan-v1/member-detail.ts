/**
 * [FEAT-20261015-MEMBERDETAIL] The loan site's hand-typed customer card — the old system's
 * rule (legacy-api Ticket Manager): nickname for everyone; name / phone / contract only for a
 * customer the partner does not know. Rule shape: `features/member-detail.ts`.
 */
import type { MemberDetailRule } from '../../features/member-detail';

export const LOAN_V1_MEMBER_DETAIL: MemberDetailRule = {
  thirdSlot: 'contract',
  nickname: true,
  detailOnlyUnregistered: true,
};
