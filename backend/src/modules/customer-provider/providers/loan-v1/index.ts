/**
 * ==== [FEAT-20260907-LOANV1PROVIDER] `loan_v1` (installment-loan shape) — the second customer provider ==
 *
 * Selected by `CUSTOMER_PROVIDER=loan_v1` on the loan-site deployment ONLY (the shape is shared by the acme/fastphone OAs — the provider carries the SHAPE name, never an OA name; owner rule 07/09).
 * On every other deployment this entry is dead code: the env is unset there,
 * the resolver lands on `DEFAULT_CUSTOMER_PROVIDER` (shop-api), and no screen
 * moves — that inertness IS the shop-api guarantee (docs/v2.md iron rules 1/5,
 * §12.8b ledger row G3).
 *
 * What it describes: a device-installment partner. The profile blob is
 * `data{customer,contract,product,installment}` (proven live 2026-09-06,
 * §12.0.4b); the panel is 5 `loan_*` kv sections drawn by the dashboard's
 * generic renderers — no front-end file exists for this provider, on purpose.
 *
 * revert: delete `providers/loan-v1/` + this entry's line in
 * `provider-entries.ts`.
 */
import type { CustomerProvider } from '../customer-provider.port';
import { buildLoanV1View } from './build-view';
import { deriveLoanV1Fields } from './derive-fields';
import { LOAN_V1_BASE_TAGS } from './base-tags';
import { LOAN_V1_MEMBER_DETAIL } from './member-detail';
import { LOAN_V1_TICKET_CATEGORIES } from './ticket-categories';
import { LOAN_V1_PATHS } from './field-paths';
import { LOAN_V1_TOOL_MINT } from './tool-mint';
import { LOAN_V1_CUSTOMER_DATA_CACHE } from './customer-data-cache';

/**
 * [FEAT-20261014-PROVFEATURES] 🔴 THE SWITCHES FOR THIS SITE'S SILENT WORLDS — one boolean
 * per world, flipped HERE and nowhere else (owner 14/10/2026: "สินเชื่อ abandon/ลงทะเบียน
 * ต้องเงียบ · อะไรก็ตามที่เงียบ มี flag เปิด ปิดสลับได้ในระดับ code").
 *
 * The loan shape links, reminds and collects UPSTREAM, so none of shop-api's bot worlds exist
 * here. Each constant drives BOTH halves of its world — the screen (`show*` below) and the
 * bot (`features`) — so the panel can never offer what the bot will not do.
 * `true` = the world comes back exactly as shop-api runs it, still subject to every per-hook
 * switch. What each name covers: `../../features/provider-features.ts`.
 */
const LOAN_V1_FEATURES = {
  /* deposit/withdraw notice cards A–F + the stamp a sent notice writes */
  notice: false,
  /* abandon chase levels 1–2 + multicast abandon marks (level-0 cleanup still runs) */
  followUp: false,
  /* the `customer-register` keyword reply, the helper's register buttons, and the
     customer-link routes behind `notReadyRejection` (admin unlink stays) */
  register: false,
  /* payment-tool leg after a slip (the slip card itself still goes out) */
  payment: false,
  /* [FEAT-20261018-SITERULESWORLD] the partner has no site rules: nothing to the AI, no
     panel card, the OA-form option hidden — flip to true (or delete) if it ever gets them */
  siteRules: false,
} as const;

export const loanV1Provider: CustomerProvider = {
  name: 'loan_v1',
  description:
    'loan_v1 — installment-loan API shape (shared by multiple OAs); profile blob data{customer,contract,product,installment}; 5 loan_* kv sections via the generic renderers.',

  /**
   * The installment-loan shape has NO tier concept. An empty list is proven safe: the tier
   * reader falls through to the `member.tier` column and the Mongo projection
   * collapses to `{tier: 1}` (`member-tier-key.util.ts` — dived 06/09,
   * v2.md §3b-G3). Hiding badge+filter removes CONTROLS, never a row.
   */
  tierPaths: [],
  showTierBadge: false,
  showTierFilter: false,

  /* [FEAT-20260907-PROVCONDS] the loan shape's OWN linked-marker: a customer
     container in the blob = a linked, fetched member. The shop-api inline check
     (`data.profile`) stays untouched for shop-api — this only speaks when the
     active provider is loan_v1. */
  hasMemberData: (blob: unknown): boolean => {
    const d = (blob as { data?: { customer?: unknown } } | null)?.data;
    return !!d && typeof d.customer === 'object' && d.customer !== null;
  },
  /* WalletPay is shop-api's payment world — not a loan-site card. */
  showWalletpayCard: LOAN_V1_FEATURES.payment,
  /* The follow-up world (follow-up card · ignore-abandon shield · contacts
     follow filter) is shop-api's; the loan shape has none of it. */
  showFollowUps: LOAN_V1_FEATURES.followUp,
  /* The admin register action opens shop-api's customer-link landing — no such
     flow on a loan site; the "no member data" label itself stays. */
  showRegisterAction: LOAN_V1_FEATURES.register,
  /* [FEAT-20261014-PROVFEATURES] the bot half of the same worlds — see the
     constant above. */
  features: LOAN_V1_FEATURES,
  /* [FEAT-20261014-CALLBACKCONTRACT] the shop's slip callback carries the CONTRACT number, as
     the old system sent it. The value is the tool's own `profile_map.code` (seeded
     `data.contract.contract_number` — src/cli/custom-tool-seed/bundles/loan-v1.bundle.ts), never a path
     typed in code. */
  slipCallbackContract: 'profile_code',
  /* [FEAT-20261014-BASETAGS] old prompts' `[[[total_due_amount]]]` etc. — table in base-tags.ts */
  baseTags: LOAN_V1_BASE_TAGS,
  /* [FEAT-20261014-TICKETCATS] ทวงถาม · อุปกรณ์ · ชำระค่างวด · อื่นๆ — edit in ./ticket-categories.ts */
  ticketCategories: LOAN_V1_TICKET_CATEGORIES,
  /* [FEAT-20261015-MEMBERDETAIL] nickname for all · name/phone/contract while unregistered — ./member-detail.ts */
  memberDetail: LOAN_V1_MEMBER_DETAIL,
  /* [FEAT-20261016-TOOLMINT] mint buttons demo · Acme · Globex — ./tool-mint.ts */
  toolMint: LOAN_V1_TOOL_MINT,
  /* [FEAT-20261016-CUSTCACHE] found 12 h · not found 30 min · others 12 h — ./customer-data-cache.ts */
  customerDataCache: LOAN_V1_CUSTOMER_DATA_CACHE,
  /* [FEAT-20261016-LOGMASK80] owner 16/10: the server log masks name / phone / contract 80% */
  personalLogMaskRatio: 0.8,
  /* [FEAT-20261016-SLIPGUARDLOAN] owner 16/10: SlipGuard beside Swiftcheck (Swiftcheck stays the default) —
     honoured because `payment` is off above; shop-api's switchboard keeps SlipGuard OFF */
  slipProviders: ['slipguard'],
  /* [FEAT-20261014-PROFILEFIRST] an unlinked customer = 1 partner call (404), not 5 */
  prefetchProfileFirst: true,
  /* [FEAT-20261014-SCREENHIDE] device ids never on a screen every admin can open (the same
     rule field-paths.ts keeps for the panel) — the slip-detail raw JSON included */
  screenHiddenPaths: [
    'product.device_imei',
    'product.device_serial',
    'product.imei',
    'product.serial',
  ],
  /* [FEAT-20261014-LOGREDACT] the partner's answers carry a national id, phones, names, the
     LINE uid, a photo URL and device ids (measured in the real captures, BE note §2.1). They
     stay in the answer the bot uses; they no longer land verbatim in the audit log. */
  logRedactPaths: [
    'member.identityNumber',
    'member.name',
    'member.nickname',
    'member.tel',
    'member.lineUid',
    'member.profile',
    'customer.customer_name',
    'customer.customer_tel',
    'product.device_imei',
    'product.device_serial',
    'product.imei',
    'product.serial',
    'history.slip',
  ],

  paths: LOAN_V1_PATHS,
  deriveFields: deriveLoanV1Fields,
  buildView: buildLoanV1View,
};
