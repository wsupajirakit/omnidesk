/**
 * [FEAT-20261015-MEMBERDETAIL] How the panel's hand-typed customer card behaves on a site —
 * a provider fact, read by the screen through `GET /api/customer-provider/member-detail`.
 * ===========================================================================
 * Owner 15/10/2026: on loan an admin must be able to edit the name and the contract of a
 * customer the partner does not know, and a nickname for everyone · "ห้ามกระทบ x api".
 * That is the old system's rule (legacy-api Ticket Manager, read 15/10): nickname always;
 * name / phone / contract only while the customer is unregistered.
 *
 * NOTHING NEW IS STORED. The card writes the fields the member already has, through the
 * routes that already exist: `Member.detail` ("name|phone|<third slot>") via
 * `PATCH /api/line-users/:id/detail`, `Member.nickname` via `PATCH …/:id/nickname`.
 * Registered = the provider's own `hasMemberData` verdict, which the raw-profile answer
 * already carries as `has_member_data`.
 *
 * 🔴 ABSENT = TODAY. A provider that declares nothing (shop-api) answers null on the route
 *    and the card keeps its current fields, labels and visibility.
 *
 * The Thai labels are the screen's business (FE `components/profile-panel/member-detail/`);
 * the BE names only what the slots hold.
 *
 * revert: delete this file, `memberDetail` on the port + loan_v1, the accessor in
 *         `active-provider.ts` and the route in `customer-provider.controller.ts`.
 */
export interface MemberDetailRule {
  /** what the third slot of `Member.detail` holds on this site */
  readonly thirdSlot: 'contract';
  /** an editable nickname for every customer, registered or not */
  readonly nickname: boolean;
  /** name / phone / third slot editable only while the partner does not know the customer */
  readonly detailOnlyUnregistered: boolean;
}

/** The route's wire shape (snake_case, like every other provider switch the screen reads). */
export interface MemberDetailWire {
  third_slot: MemberDetailRule['thirdSlot'];
  nickname: boolean;
  detail_only_unregistered: boolean;
}

export const memberDetailWire = (
  rule: MemberDetailRule | null,
): MemberDetailWire | null =>
  rule
    ? {
        third_slot: rule.thirdSlot,
        nickname: rule.nickname,
        detail_only_unregistered: rule.detailOnlyUnregistered,
      }
    : null;
