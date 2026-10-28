/**
 * ==== [FEAT-20260811-PAYRESPEXAMPLES] Central spec: real provider responses per
 * reply state — served to the dashboard, decided by NOBODY. ====
 *
 * WHAT THIS IS: the verbatim provider bodies (walletpay / topup) that produce each
 * payment `ReplyState`, ONE place, typed against the state set. The hook-modal
 * "eye" guide renders these so an admin choosing a card sees the real thing.
 *
 * ⚠️ DISPLAY DATA ONLY — nothing in the BE reads this map to make a decision.
 * The classifiers (`_classifyTopup` / `_classifyWalletpay`) have their own logic
 * and their own captures in comments; this file exists so the FE does not have
 * to hardcode response bodies (it did once — that bloated the FE and drifted).
 * ไฟล์นี้ไว้ให้ FE โหลดโชว์อย่างเดียว BE ไม่ได้ใช้ตัดสินอะไรทั้งสิ้น.
 *
 * SOURCES (all real, none invented):
 *   · live captures 2026-08-11 from api.walletpay.example.com
 *     (log_error/walletpay-real-response.md — the canonical capture log)
 *   · owner-supplied provider captures dated 2026-08-09 (the three 200 shapes)
 *   · topup CUSTOMER_NOT_LINKED verified live 2026-08-09
 * A state with NO real capture yet keeps an empty array — the guide then says
 * "no capture yet" instead of showing an invented sample. ห้ามแต่งตัวอย่างเอง.
 *
 * HOW TO ADD A CAPTURE: paste the verbatim body as a STRING (json.raw), stamp
 * `label` with the provider + date, and note partial captures in the label.
 * The Record<ReplyState, …> type makes a NEW state a compile error here, so the
 * guide can never silently miss one.
 */
import { type ReplyState } from './payment-runner.service';

export interface ReplyStateResponseExample {
  /** e.g. "walletpay 200 (2026-08-11)" — provider + date (+ "partial" when so). */
  label: string;
  /** Verbatim body as captured. String, not object — no reformatting drift. */
  raw: string;
}

export const PAYMENT_REPLY_STATE_RESPONSE_EXAMPLES: Record<
  ReplyState,
  ReplyStateResponseExample[]
> = {
  // topup process-wallet — no live capture yet (contract only).
  topup_success: [],
  walletpay_success: [
    {
      label: 'walletpay 200 (2026-08-09, owner-supplied)',
      raw: '{"refId":"00000000-0000-4000-8000-000000000019","uploadResult":[{"imageId":"109535","evidenceId":"5045543","matchResult":{"status":"matched","message":"[AUTOMATCH] Matched and confirmed transaction ID [9414611] extRefId [WOGG01TH2680867GEY]","bankExpectId":884213,"transactionId":9414611,"confirmed":true}}],"messageType":"SINGLE_MATCHED","message":"Slip matched and auto-confirmed."}',
    },
  ],
  matched_pending: [
    {
      label: 'walletpay 200 (2026-08-09, owner-supplied · partial)',
      raw: '{"matchResult":{"message":"(… extRefId WOGG01TH2680867GEY, status: PROCESSING)","bankExpectId":884213,"transactionId":9414611,"confirmed":false}}',
    },
  ],
  no_match_retry: [
    {
      label: 'walletpay 200 (2026-08-11, live)',
      raw: '{"refId":"00000000-0000-4000-8000-000000000020","uploadResult":[{"imageId":"120776","evidenceId":"5149261","matchResult":{"status":"invalid_destination","message":"[เลขบัญชี] error เลขบัญชีผู้รับไม่อยู่ใน whitelist ปลายทาง [xxx-x-x6917-x]"}}],"messageType":"SINGLE_NOT_MATCHED","message":"Slip uploaded successfully. Waiting for admin to confirm."}',
    },
    {
      label: 'walletpay 200 (2026-08-09, owner-supplied)',
      raw: '{"refId":"00000000-0000-4000-8000-000000000019","uploadResult":[{"imageId":"109540","evidenceId":"5045550","matchResult":{"status":"no_match","message":"ไม่พบรายการที่ตรงกัน (amount 500.00, receiver x-1570)"}}],"messageType":"SINGLE_NOT_MATCHED","message":"Slip uploaded successfully. Waiting for admin to confirm."}',
    },
  ],
  statement_not_found: [
    // The topup answer on THIS path (owner-requested example, 2026-08-11):
    // account-not-match does NOT stop the run — it falls through to the
    // statement gate, and when no amount matches the run ends on this state.
    // Verbatim from the live webhook run 6a7abb01… (slip 360 THB, 13:02).
    {
      label:
        'topup 200 account-not-match — ตกไปด่าน statement (2026-08-11, live)',
      raw: '{"data":{"phone_number":"0955550010","slip_status":{"img_url":"https://cdn.example.com/cdn-cgi/image/f=auto/3rd/slip/2026_08_11-AZ_van5uTvBsMIdyHt8Byw-slip.jpg","message":"บัญชีผู้รับไม่ตรงบัญชีระบบ","status":"account-not-match"},"payload":{"agent_id":"00000000-0000-4000-8000-000000000001","image_url":"https://cdn.example.com/cdn-cgi/image/f=auto/3rd/slip/2026_08_11-AZ_van5uTvBsMIdyHt8Byw-slip.jpg","payload":{"data":{"amountInSlip":360,"isDuplicate":false,"rawSlip":{"amount":{"amount":360,"local":{"amount":360,"currency":"764"}},"countryCode":"TH","date":"2026-08-07T20:29:34+07:00","fee":0,"payload":"0041000600000101030040220016219202934APP115015102TH9104FA2C","receiver":{"account":{"name":{"en":"MISSKESINEE D","th":"น.ส.เกศินี แ"},"proxy":{"account":"x-xxxx-xxxx7-13-2","type":"NATID"}},"merchantId":""},"ref1":"","ref2":"","ref3":"","sender":{"account":{"bank":{"account":"xxx-x-x1001-x","type":"BANKAC"},"name":{"en":"MRS. PIYAWAN K","th":"นาง ปิยวรรณ แ"}},"bank":{"id":"004","name":"ธนาคารกสิกรไทย","short":"KBANK"}},"transRef":"016219202934APP11501"}},"message":"Bank slip verified successfully","success":true},"user_id":"00000000-0000-4000-8000-000000000021"}},"success":true}',
    },
    {
      label: 'walletpay 400 (2026-08-11, live)',
      raw: '{"code":4000,"message":"Invalid refId"}',
    },
    {
      label: 'walletpay 404 (2026-08-11, live)',
      raw: '{"code":4040,"message":"PayIn transaction not found"}',
    },
    {
      label: 'walletpay 400 (2026-08-11, live)',
      raw: '{"code":4001,"message":"Missing slip file (field name: slip)"}',
    },
  ],
  not_linked: [
    {
      label: 'topup 404 (2026-08-09, live)',
      raw: '{"error":{"code":"CUSTOMER_NOT_LINKED","message":"LINE นี้ยังไม่ผูกบัญชี"},"success":false}',
    },
  ],
  member_not_match: [
    // topup answers 200 with data.slip_status.status = "member-not-match" —
    // confirmed from the live flow 2026-08-10, full body not captured yet.
  ],

  /* [FEAT-20260823-TOPUPDUP] ยังไม่มี raw ตัวอย่างจริงของเคสนี้เก็บไว้ —
     ปล่อยว่างเหมือน member_not_match/review (หน้าเว็บจะซ่อนบล็อก raw ไปเอง)
     เก็บได้เมื่อไหร่ค่อยใส่ ไม่กระทบอะไรถ้ายังว่าง */
  topup_duplicate: [],
  review: [
    // Multi-source ending (timeout / unreadable / exhausted) — the exhausted
    // walk's bodies are the no_match_retry captures above; a timeout has none.
  ],
};
