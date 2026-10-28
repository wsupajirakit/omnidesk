/**
 * [PROG-20260905-G16B] The combined-profile fetch and everything derived from it.
 *
 * WHAT IT PRODUCES. Eight values later gates read: the raw profile payload, the block the
 * slip gate inspects, the customer's name / telephone / contract code, the Bangkok time
 * string, whether a profile was found at all, and how long the fetch took.
 *
 * ⚠️ THE RESULT IS MUTATED IN PLACE, NOT BUILT AT THE END — the same property C2 needed.
 * A failure part-way through must leave whatever was already derived, because the gates
 * below treat "undefined" as "the fetch never ran ⇒ fail open", and an all-or-nothing
 * verdict would turn a partial answer into a total one on exactly the error path.
 *
 * ⚠️ THE DIAGNOSTIC LINE IS THE FEATURE, NOT DECORATION. `profileWhy` exists because a
 * real case in July read `ok=false name=N/A` while the upstream had answered 200 with
 * complete data; the actual cause — no endpoint carries the is_profile flag — took a long
 * time to find because the log did not say so. Every branch of it is kept verbatim.
 *
 * Args destructured at the top; the body moved verbatim. Changed since only where tagged
 * (`[FIX-20261014-CUSTOMCIRCUIT]`).
 */

import { isCustomToolCircuitOpen } from '@/modules/external';

import { asString, errText } from '../logging/coerce-mask.util';
/* [FEAT-20261016-LOGMASK80] `m` = the log-only personal mask (loan 80%, shop-api / unbound untouched) */
import { maskPersonalForLog as m } from '../logging/personal-log-mask';

type Doc = Record<string, unknown>;

/* Redeclared rather than imported from the service — importing back would be a cycle. */
/* `errText` is imported, not redeclared — `logging/coerce-mask.util.ts` holds the one
   copy for the whole module. It had grown TWELVE. */

export interface CombinedProfileResult {
  profileData: Doc;
  perfProfileMs: number | undefined;
  profileBlock: Doc | null | undefined;
  customerName: string | undefined;
  customerTel: string | undefined;
  contractCode: string | undefined;
  bangkokTime: string | undefined;
  followUpHasProfile: boolean | undefined;
  /* ⚠️ The NINTH output, and the one a mechanical scan of assignments missed: it is
     written at a shallower indent than the others and read by three later gates
     (:2444, :2611, :2624 before this cut). Recorded because "the block writes eight
     values" was wrong, and a dropped output is a silently disabled feature. */
  profileCircuitOpen: boolean;
}

export interface CombinedProfileArgs {
  hook: Doc | null | undefined;
  userId?: string;
}

export interface CombinedProfileDeps {
  logger: { log: (m: string) => void; error: (m: string) => void };
  usesCustomTool: (hook: Doc | null | undefined) => boolean;
  loadCombinedProfile: (
    userId: string | undefined,
    hook: Doc | null | undefined,
  ) => Promise<Doc>;
  /* The member row is refreshed with the freshly fetched name — part of the same block,
     so the model comes with it rather than the write being left behind in the spine. */
  memberModel: {
    updateOne: (filter: Doc, update: Doc) => { exec: () => Promise<unknown> };
  };
  customTool: {
    getToolForHook: (
      hook: Doc | null | undefined,
    ) => Promise<{ endpoints?: unknown[] } | null>;
    extractProfile: (
      data: Doc,
      tool: unknown,
    ) => { name?: string; phone?: string; code?: string };
  };
}

/**
 * The state a turn starts in: nothing fetched, nothing derived.
 *
 * 🔴 [FIX-20260906-EMPTYPROFILENA] TWO KINDS OF "UNKNOWN" LIVE HERE, and giving both the
 * same value cost a customer-visible reply.
 *
 * The four display fields carry `'N/A'` / `''` because that is what the spine declared
 * before this function existed (`dev`, `webhook.service.ts:1911-1914`) and what the gates
 * still compare against: `missing-profile-reply.step.ts:42` is
 * `ctx.customerName === 'N/A'` — a strict string test. This object is returned by the
 * catch at the bottom of `fetchCombinedProfile`, and the spine assigns every field of it
 * over its own defaults, so `undefined` here **overwrote the spine's `'N/A'`** and the
 * missing-API-data reply stopped firing whenever the fetch THREW (a Mongo or
 * system-config hiccup) rather than merely answering 404. The customer got silence where
 * `dev` sent the OA's `missing_api_data_text`. เขียนทับค่าตั้งต้นของ spine = ด่านที่เทียบ 'N/A' ตายเงียบ
 *
 * The other three stay `undefined` ON PURPOSE — for them `undefined` means "we never
 * found out", which the gates read as "do not know" and fail OPEN:
 *   `perfProfileMs`        the fetch never ran, so there is no duration to report
 *   `profileBlock`         absent ≠ empty; `{}` would claim a profile was returned
 *   `followUpHasProfile`   `false` would say "confirmed unregistered" and arm the chase
 * ห้ามใส่ค่าให้สามตัวนี้ — undefined คือ "ไม่รู้" ซึ่งต่างจาก "รู้ว่าไม่มี"
 */
export function emptyCombinedProfile(): CombinedProfileResult {
  return {
    profileData: {},
    perfProfileMs: undefined,
    profileBlock: undefined,
    customerName: 'N/A',
    customerTel: 'N/A',
    contractCode: 'N/A',
    bangkokTime: '',
    followUpHasProfile: undefined,
    profileCircuitOpen: false,
  };
}

export async function fetchCombinedProfile(
  args: CombinedProfileArgs,
  deps: CombinedProfileDeps,
): Promise<CombinedProfileResult> {
  const { hook, userId } = args;
  const out = emptyCombinedProfile();

  // 0) Pre-fetch profile data — legacy:2654-2795
  try {
    const tProfile = Date.now();
    // [FEAT-20260729-CUSTOOL] ONE fork, chosen by the hook, not by a tag:
    // the OA declares which tool it uses. Every pre-existing hook has
    // custom_tool_status = false, so it takes the else — byte-identical
    // to before the feature existed.
    const useCustomTool = deps.usesCustomTool(hook);
    out.profileData = await deps.loadCombinedProfile(userId, hook);
    out.perfProfileMs = Date.now() - tProfile;
    deps.logger.log(
      `[PERF-20260802-TIMING] profile fetch: ${out.perfProfileMs}ms`,
    );

    if (useCustomTool) {
      // The custom-tool path hardcodes NEITHER the key name NOR the
      // field paths — the profile route is found by its `is_profile`
      // flag and the fields come from that endpoint's profile_map,
      // because no two third parties answer with the same shape.
      const tool = await deps.customTool.getToolForHook(hook);
      const p = deps.customTool.extractProfile(out.profileData, tool);
      out.customerName = p.name;
      out.customerTel = p.phone;
      out.contractCode = p.code;
      const profileEp = (
        (tool?.endpoints ?? []) as { is_profile?: boolean; key?: string }[]
      ).find((e) => e.is_profile);
      out.profileBlock = profileEp?.key
        ? (out.profileData[profileEp.key] as Record<string, unknown>)
        : null;
    } else {
      out.profileBlock = out.profileData['Path : api/v1/customer'] as
        Record<string, unknown> | undefined;
      const data = out.profileBlock?.['data'] as
        Record<string, unknown> | undefined;
      const customerInfo = data?.['customer'] as
        Record<string, unknown> | undefined;
      // [FEAT-20260728-DYNPROFILE] A hook pointed at the Shop-API has no
      // `data.customer` block; the same three values live under
      // `data.profile.*`. A hook that HAS `data.customer` never reaches
      // the fallback, so its values are unchanged.
      const shopapiProfile = data?.['profile'] as
        Record<string, unknown> | undefined;
      const bank = shopapiProfile?.['bank'] as
        Record<string, unknown> | undefined;
      out.customerName =
        (customerInfo?.['customer_name'] as string) ||
        (bank?.['account_name'] as string) ||
        'N/A';
      out.customerTel =
        (customerInfo?.['customer_tel'] as string) ||
        (shopapiProfile?.['phone'] as string) ||
        'N/A';
      const installmentBlock = out.profileData[
        'Path : api/line/v1/installment_current.php'
      ] as Record<string, unknown> | undefined;
      const installmentInfo = (
        installmentBlock?.['data'] as Record<string, unknown> | undefined
      )?.['contract'] as Record<string, unknown> | undefined;
      out.contractCode =
        (installmentInfo?.['code'] as string) ||
        (shopapiProfile?.['member_id'] as string) ||
        'N/A';
    }

    const profileOk = out.profileBlock?.['success'] === true;
    // [FEAT-20260820-FOLLOWUP] carry it down; nothing else reads this.
    out.followUpHasProfile = profileOk;
    out.profileCircuitOpen =
      out.profileBlock?.['message'] ===
        'circuit_open: upstream temporarily unavailable' ||
      /* [FIX-20261014-CUSTOMCIRCUIT] a custom tool's breaker speaks in its own shape
         (503 + data.message) — read through the writer's own test, not a copied string. */
      (useCustomTool && isCustomToolCircuitOpen(out.profileBlock));

    // [FIX-20260729-PROFILEDIAG] the log must name the CAUSE, not just
    // the outcome. A real case on 2026-07-29 read ok=false name=N/A while
    // the upstream had answered 200 with complete data — the actual cause
    // was "no endpoint carries the is_profile flag", which took a long
    // time to find because the line did not say so.
    let profileWhy = '';
    if (!profileOk) {
      const isCustomTool =
        hook?.['custom_tool_status'] === true && !!hook?.['custom_tool_id'];
      if (out.profileCircuitOpen) {
        profileWhy =
          ' | why=circuit_open (ปลายทางล่มติดกันหลายครั้ง ตัดวงจรชั่วคราว)';
      } else if (
        !out.profileData ||
        Object.keys(out.profileData).length === 0
      ) {
        profileWhy = isCustomTool
          ? ' | why=ไม่มีข้อมูลกลับมาเลย (tool ถูกปิด/ยังไม่ผูก tool/ไม่มีเส้น GET ที่เป็น data)'
          : ' | why=ไม่มีข้อมูลกลับมาเลย (ยังไม่ตั้ง external api หรือ endpoint)';
      } else if (!out.profileBlock) {
        profileWhy = isCustomTool
          ? ' | why=ไม่มีเส้นไหนติดธง "เส้นโปรไฟล์" (is_profile) ในหน้า Custom Tools → แก้: ติ๊กธงที่เส้นดึงข้อมูลลูกค้า'
          : ' | why=ไม่พบ block โปรไฟล์ตาม path ที่ตั้งไว้';
      } else {
        const st = out.profileBlock?.['status'];
        const blockData = out.profileBlock?.['data'] as
          Record<string, unknown> | undefined;
        profileWhy =
          st === 404
            ? ' | why=ปลายทางตอบ 404 (ลูกค้ายังไม่ผูกบัญชี — ปกติสำหรับคนที่ยังไม่ลงทะเบียน)'
            : st === 401 || st === 403
              ? ` | why=ปลายทางปฏิเสธสิทธิ์ (${String(st)}) — token/credential ของ tool อาจไม่ถูกต้อง`
              : ` | why=ปลายทางไม่สำเร็จ status=${asString(st) ?? '?'} ${
                  (blockData?.['message'] as string) || ''
                }`.trimEnd();
      }
    }

    deps.logger.log(
      `[PROFILE-CHECK] User: ${userId} | ok=${profileOk}` +
        `${out.profileCircuitOpen ? ' (circuit_open)' : ''} | name=${m(out.customerName)} | ` +
        `tel=${m(out.customerTel)} | contract=${m(out.contractCode)}${profileWhy}`,
    );

    /* [REMOVED-20260820-ABANDON] the abandon detector used to run here — a
     customer who had been sent the registration card, never registered and
     was writing anyway got announced to the dashboard exactly once. The
     owner retired the whole alert on 2026-08-20: no sound, no orange tab,
     no mark on the card, and nothing written to the room.
     The bot-care tab still fills in realtime without it — `message:new`
     already refreshes that list for any customer message while the tab is
     open, and an abandon could only ever follow a customer message.
     ⚠️ The rule, the lookback window and the one-time atomic claim are
     written out in full in `todo/be_todo27_20082026.md`. That note is the
     only place they survive — read it before rebuilding any of this.
     เงื่อนไขเดิมอยู่ใน todo/be_todo27_20082026.md ไฟล์เดียว. */

    /* [FEAT-20260820-FOLLOWUP] the follow-up levels used to be fired here,
     right after the profile check. They moved DOWN to the one place that
     can also act on their verdict — after the customer's message is stored
     and after the registration keyword still gets its chance, but before
     the bot answers anything. Search `[FEAT-20260820-FOLLOWUP] gate`.
     ย้ายลงไปอยู่จุดที่ตัด flow ได้จริง. */

    /* 🔴 THE FIRST OF TWO WRITERS OF THIS FIELD, AND THE FORMATS DIFFER. The second is
       `gates/api-error-trigger.step.ts`, which re-stamps the clock when the profile fetch
       reported an error — using the `th-TH` default, which is day/month/**Buddhist year**
       (`5/9/2569 22:15:30`) against this recipe's `05 September 2026 at 22:15:30`. Both
       land in the same field and both reach an operator, through `assistTurn()` and
       through `telegram-no-answer-notify.ts:107`. So the format depends on whether the
       fetch failed, and the two years are 543 apart.

       ⚠️ Deliberately NOT unified here — picking one changes what operators have been
       reading for months, which is the owner's call. Pinned by
       `z-test/unit/two-writer-locals.spec.ts` so it cannot be missed again.
       สองที่เขียนฟิลด์เดียวกันคนละรูปแบบ · แก้ต้องให้เจ้าของตัดสิน */
    out.bangkokTime = new Date()
      .toLocaleString('en-GB', {
        timeZone: 'Asia/Bangkok',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      .replace(',', '');

    // legacy:2774-2792 — denormalise onto Member. Only real values are
    // written: "N/A" must never overwrite a number an operator has.
    try {
      const updateObj: Record<string, unknown> = {};
      if (out.customerTel && out.customerTel !== 'N/A')
        updateObj['phone_number'] = out.customerTel;
      if (out.contractCode && out.contractCode !== 'N/A')
        updateObj['contract_code'] = out.contractCode;
      if (out.customerName && out.customerName !== 'N/A')
        updateObj['full_name'] = out.customerName;
      if (Object.keys(updateObj).length > 0) {
        await deps.memberModel
          .updateOne({ line_user_id: userId }, { $set: updateObj })
          .exec();
        deps.logger.log(
          /* [FEAT-20261016-LOGMASK80] `m` masks the LOG copy only (loan 80%, shop-api plain) — `updateObj` above keeps the real values */
          `[Webhook] Saved phone_number: ${m(out.customerTel)}, contract_code: ${m(out.contractCode)}, full_name: ${m(out.customerName)} to Member ${userId}`,
        );
      }
    } catch (dbErr) {
      deps.logger.error(
        `[Webhook] Failed to save phone/contract to Member: ${errText(dbErr)}`,
      );
    }
  } catch (profileErr) {
    deps.logger.error(
      `[ASSIST] Global external profile fetch failed: ${errText(profileErr)}`,
    );
  }
  return out;
}
