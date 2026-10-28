/**
 * [FEAT-20261015-MEMBERDETAIL] How the active customer provider wants the panel's hand-typed
 * customer card to behave.
 *
 * `GET /api/customer-provider/member-detail` → `data.member_detail`:
 *   loan_v1 → { third_slot: 'contract', nickname: true, detail_only_unregistered: true }
 *   shop-api (declares nothing) → null.
 * null — and any failure — means "today's card". Caching rule: `./providerAnswer.ts`.
 * BE source of the shape: omnidesk-api `customer-provider/features/member-detail.ts`.
 */
import { providerAnswer } from './providerAnswer';

export interface MemberDetailRule {
  /** what the third slot of `Member.detail` holds on this site (label: the card's catalog) */
  thirdSlot: string;
  /** an editable nickname for every customer */
  nickname: boolean;
  /** name / phone / third slot editable only while the partner does not know the customer */
  detailOnlyUnregistered: boolean;
}

const answer = providerAnswer<MemberDetailRule>(
  '/api/customer-provider/member-detail',
  (data) => {
    const r = (data as { member_detail?: Record<string, unknown> | null } | null)?.member_detail;
    if (!r || typeof r !== 'object' || typeof r.third_slot !== 'string') return null;
    return {
      thirdSlot: r.third_slot,
      nickname: r.nickname === true,
      detailOnlyUnregistered: r.detail_only_unregistered === true,
    };
  },
);

export const fetchProviderMemberDetail = (): Promise<MemberDetailRule | null> => answer.get();

/** Test seam: forget the answer so a spec can ask again. */
export const resetProviderMemberDetail = (): void => answer.reset();
