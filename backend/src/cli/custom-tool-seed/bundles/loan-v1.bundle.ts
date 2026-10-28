/**
 * [FEAT-20261014-TOOLSEED] loan_v1 seed bundle — the custom tool + 15 dynamic tags.
 *
 * MOVED here from `docs/loan-v1-tool-config-snapshot.json` + `docs/loan-v1-dyntags-snapshot.json`
 * (14/10/2026, converted by script and proven value-for-value equal before the JSON was
 * removed). Under `src/` so it compiles into `dist/` and ships with the image — the Dockerfile
 * never copied `docs/`, so the old CLI could not find its snapshot inside a container.
 *
 * Provenance: the tool config ported 1:1 from the fastphone OA's real configuration and
 * proven live against the demo host on 06/09/2026; every tag resolves on the partner's real
 * answers (`z-test/unit/loan-v1-fixture-guard.spec.ts`). `tool.base_url` is the CAPTURE host.
 * No credentials here — they come from the environment when the CLI runs.
 */
import type { SeedBundle } from '../seed-bundle.types';

export const LOAN_V1_SEED_BUNDLE: SeedBundle = {
  id: 'loan_v1',
  description:
    'loan_v1 installment-loan API (acme / fastphone OAs) — 1 tool, 6 endpoints, 15 dynamic tags',
  tagMarker: 'acme-migrated',
  tool: {
    name: 'acme',
    base_url: 'https://acme.example.com',
    auth_type: 'jwt_login',
    timeout_ms: 4000,
    endpoints: [
      {
        key: 'LOGIN',
        method: 'POST',
        path: 'api/v1/auth/login',
        purpose: 'auth',
        require_jwt: false,
        request_type: 'json',
        payload: {
          username: '{{username}}',
          password: '{{password}}',
        },
        is_login: true,
        is_profile: false,
        token_path: 'data.access_token',
        result_rules: [],
      },
      {
        key: 'CUSTOMER_PROFILE',
        method: 'GET',
        path: 'api/v1/customer/{{line_user_id}}',
        purpose: 'data',
        require_jwt: true,
        request_type: 'json',
        payload: {},
        is_login: false,
        is_profile: true,
        token_path: '',
        profile_map: {
          name: 'data.customer.customer_name',
          phone: 'data.customer.customer_tel',
          code: 'data.contract.contract_number',
          tier: '',
        },
        result_rules: [
          {
            path: '',
            op: 'eq',
            value: '',
            http_codes: '404',
            action: 'fail',
            failure_type: 'business',
            error_code: 'LOAN_NOT_LINKED',
            message_path: '',
          },
          {
            path: 'success',
            op: 'eq',
            value: 'false',
            http_codes: '',
            action: 'fail',
            failure_type: 'business',
            error_code: 'LOAN_PROFILE_FAIL',
            message_path: 'message',
          },
          {
            path: 'success',
            op: 'eq',
            value: 'true',
            http_codes: '',
            action: 'success',
            failure_type: '',
            error_code: '',
            message_path: '',
          },
        ],
      },
      {
        key: 'INSTALLMENT_CURRENT',
        method: 'POST',
        path: 'api/line/v1/installment_current.php',
        purpose: 'data',
        require_jwt: true,
        request_type: 'form-data',
        payload: {
          userid: '{{lineuserid}}',
        },
        is_profile: false,
        token_path: '',
        result_rules: [
          {
            path: 'status',
            op: 'eq',
            value: 'false',
            http_codes: '',
            action: 'fail',
            failure_type: 'business',
            error_code: 'LOAN_NOT_FOUND',
            message_path: 'message',
          },
          {
            path: 'status',
            op: 'eq',
            value: 'true',
            http_codes: '',
            action: 'success',
            failure_type: '',
            error_code: '',
            message_path: '',
          },
        ],
      },
      {
        key: 'PAYMENT_HISTORY',
        method: 'POST',
        path: 'api/line/v1/payment_history.php',
        purpose: 'data',
        require_jwt: true,
        request_type: 'form-data',
        payload: {
          userid: '{{lineuserid}}',
        },
        is_profile: false,
        token_path: '',
        result_rules: [
          {
            path: 'status',
            op: 'eq',
            value: 'false',
            http_codes: '',
            action: 'fail',
            failure_type: 'business',
            error_code: 'LOAN_NOT_FOUND',
            message_path: 'message',
          },
          {
            path: 'status',
            op: 'eq',
            value: 'true',
            http_codes: '',
            action: 'success',
            failure_type: '',
            error_code: '',
            message_path: '',
          },
        ],
      },
      {
        key: 'CONTRACT_INFO',
        method: 'POST',
        path: 'api/line/v1/contract.php',
        purpose: 'data',
        require_jwt: true,
        request_type: 'form-data',
        payload: {
          userid: '{{lineuserid}}',
        },
        is_profile: false,
        token_path: '',
        result_rules: [
          {
            path: 'status',
            op: 'eq',
            value: 'false',
            http_codes: '',
            action: 'fail',
            failure_type: 'business',
            error_code: 'LOAN_NOT_FOUND',
            message_path: 'message',
          },
          {
            path: 'status',
            op: 'eq',
            value: 'true',
            http_codes: '',
            action: 'success',
            failure_type: '',
            error_code: '',
            message_path: '',
          },
        ],
      },
      {
        key: 'ALL_INSTALLMENTS',
        method: 'POST',
        path: 'api/line/v1/installment.php',
        purpose: 'data',
        require_jwt: true,
        request_type: 'form-data',
        payload: {
          userid: '{{lineuserid}}',
        },
        is_profile: false,
        token_path: '',
        result_rules: [
          {
            path: 'status',
            op: 'eq',
            value: 'false',
            http_codes: '',
            action: 'fail',
            failure_type: 'business',
            error_code: 'LOAN_NOT_FOUND',
            message_path: 'message',
          },
          {
            path: 'status',
            op: 'eq',
            value: 'true',
            http_codes: '',
            action: 'success',
            failure_type: '',
            error_code: '',
            message_path: '',
          },
        ],
      },
    ],
  },
  /* [FIX-20261019-TAGDETAIL] owner 19/10/2026: the `detail` of 11 tags named something their path
     does not hold (e.g. "Installment Amount" on the total payable, "เลขที่สัญญา" on the customer
     code). Rewritten from the partner's REAL answers — `z-test/fixtures/loan-v1-endpoints.ts` + three
     live INSTALLMENT_CURRENT answers: amount = current_amount + remain_amount + mulct_amount +
     locked_amount (remain = carried-over arrears, current = this instalment). Only `detail` moved;
     names, sub_type and value are unchanged (pinned by loan-v1-tag-details.spec.ts). Already-minted
     rows keep their old text until edited (runbook). */
  /* [NOTE-20261018-DUPTAGS] Two pairs below read the SAME value, on purpose — keep both:
       ins_x_9000006 + ins_x_9000019 → INSTALLMENT_CURRENT · data.installment.amount
       ins_x_9000022 + ins_x_9000023 → INSTALLMENT_CURRENT · data.installment.current_amount
     They came over 1:1 from the fastphone OA's real configuration, and each NAME may already be
     quoted in an OA's Training Document or prompt — removing one would silently turn that
     marker into plain text the customer reads. Owner 18/10/2026: keep, note only. If they are
     ever merged, search every hook's training documents for the retired name first. */
  tags: [
    {
      tag: 'ins_x_9000004',
      sub_type: 'CUSTOMER_PROFILE',
      value: 'data.installment.due_date',
      detail:
        'วันครบกำหนดชำระงวดนี้ (รูปแบบ ปปปป-ดด-วว เช่น 2026-09-05) [acme-migrated · sub_type เดิม: CUSTOMER_PROFILE]',
    },
    {
      tag: 'ins_x_9000005',
      sub_type: 'INSTALLMENT_CURRENT',
      value: 'data.installment.due_date',
      detail:
        'วันครบกำหนดชำระงวดนี้ (รูปแบบไทย เช่น 5 ก.ย. 2569) [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php]',
    },
    {
      tag: 'ins_x_9000006',
      sub_type: 'INSTALLMENT_CURRENT',
      value: 'data.installment.amount',
      detail:
        'ยอดรวมทั้งหมดที่ต้องชำระตอนนี้ (= ค่างวดงวดนี้ + ยอดค้างชำระยกมา + ค่าปรับ + ค่าปลดล็อก) [acme-migrated · sub_type เดิม: INSTALLMENT_CURRENT]',
    },
    {
      tag: 'ins_x_9000007',
      sub_type: 'CUSTOMER_PROFILE',
      value: 'data.installment.total_terms',
      detail:
        'จำนวนงวดทั้งหมดในสัญญา (เช่น 12) [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php] | FIX-28/08: sub_type เดิมชี้ php แต่ path นี้มีเฉพาะใน profile ⇒ ของเดิมได้ N/A มาตลอด',
    },
    {
      tag: 'ins_x_9000008',
      sub_type: 'CUSTOMER_PROFILE',
      value: 'data.customer.customer_number',
      detail:
        'รหัสลูกค้า (เช่น CUST-000001 — ไม่ใช่เลขที่สัญญา) [acme-migrated · sub_type เดิม: CUSTOMER_PROFILE]',
    },
    {
      tag: 'ins_x_9000009',
      sub_type: 'INSTALLMENT_CURRENT',
      value: 'data.installment.status',
      detail:
        'สถานะการชำระงวดนี้ (เช่น ยังไม่ถึงกำหนดชำระ / เกินกำหนดชำระเงิน — API ส่งมาเป็น HTML) [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php]',
    },
    {
      tag: 'ins_x_9000014',
      sub_type: 'CUSTOMER_PROFILE',
      value: 'data.product.device_type',
      detail:
        'ประเภทเครื่อง (มือ1 / มือ2 / Sure+) [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php] | FIX-28/08: sub_type เดิมชี้ php แต่ path นี้มีเฉพาะใน profile ⇒ ของเดิมได้ N/A มาตลอด',
    },
    {
      tag: 'ins_x_9000015',
      sub_type: 'CUSTOMER_PROFILE',
      value: 'data.product.is_locked',
      detail:
        'สถานะการล็อกเครื่อง [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php] | FIX-28/08: sub_type เดิมชี้ php แต่ path นี้มีเฉพาะใน profile ⇒ ของเดิมได้ N/A มาตลอด',
    },
    {
      tag: 'ins_x_9000016',
      sub_type: 'CUSTOMER_PROFILE',
      value: 'data.contract.down_payment',
      detail:
        'เงินดาวน์ [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php] | FIX-28/08: sub_type เดิมชี้ php แต่ path นี้มีเฉพาะใน profile ⇒ ของเดิมได้ N/A มาตลอด',
    },
    {
      tag: 'ins_x_9000017',
      sub_type: 'CUSTOMER_PROFILE',
      value: 'data.installment.overdue_days',
      detail:
        'จำนวนวันที่เลยกำหนดชำระ (เช่น 2) [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php] | FIX-28/08: sub_type เดิมชี้ php แต่ path นี้มีเฉพาะใน profile ⇒ ของเดิมได้ N/A มาตลอด',
    },
    {
      tag: 'ins_x_9000018',
      sub_type: 'INSTALLMENT_CURRENT',
      value: 'data.installment.remain_amount',
      detail:
        'ยอดค้างชำระยกมาจากงวดก่อน (ไม่รวมงวดนี้) [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php]',
    },
    {
      tag: 'ins_x_9000019',
      sub_type: 'INSTALLMENT_CURRENT',
      value: 'data.installment.amount',
      detail:
        'ยอดรวมทั้งหมดที่ต้องชำระตอนนี้ (อ่านค่าเดียวกับ ins_x_9000006) [acme-migrated · sub_type เดิม: INSTALLMENT_CURRENT]',
    },
    {
      tag: 'ins_x_9000021',
      sub_type: 'INSTALLMENT_CURRENT',
      value: 'data.installment.mulct_amount',
      detail:
        'ค่าปรับกรณีชำระล่าช้า [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php]',
    },
    {
      tag: 'ins_x_9000022',
      sub_type: 'INSTALLMENT_CURRENT',
      value: 'data.installment.current_amount',
      detail:
        'ค่างวดของงวดนี้ (ไม่รวมยอดค้างชำระยกมา ค่าปรับ ค่าปลดล็อก) [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php]',
    },
    {
      tag: 'ins_x_9000023',
      sub_type: 'INSTALLMENT_CURRENT',
      value: 'data.installment.current_amount',
      detail:
        'ค่างวดของงวดนี้ (อ่านค่าเดียวกับ ins_x_9000022 · ยอดรวมทั้งหมดคือ ins_x_9000006) [acme-migrated · sub_type เดิม: api/line/v1/installment_current.php]',
    },
  ],
};
