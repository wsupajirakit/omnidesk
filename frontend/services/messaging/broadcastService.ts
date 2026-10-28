import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { AudienceSourceInfo, BroadcastEntry, BroadcastFormData, BroadcastListResponse, BroadcastHistoryPage, BroadcastHistoryRow, BroadcastPreview, BroadcastRunDetail, BroadcastRunLogEntry, BroadcastRunRow } from '../../types';

/* [FIX-20260825-SCHEDULEWAYBACK] export เพื่อให้ "ทางกลับ" ตรึงด้วยเทสได้จริง
   บั๊ก `schedule` ตกหายรอดมาได้เพราะไม่มีเทสไหนแตะฟังก์ชันนี้เลย ทั้งที่คอมเมนต์
   ในไฟล์เตือนกับดักนี้ไว้ถึงสามจุด — คำเตือนอย่างเดียวไม่พอ ต้องมีตัววัด */
export const normalizeBroadcast = (raw: any): BroadcastEntry => ({
  id: raw?.id ?? raw?._id ?? '',
  name: raw?.name ?? '',
  hook_ids: raw?.hook_ids ?? [],
  assign_group:
    raw?.assign_group?.id ??
    raw?.assign_group?._id ??
    raw?.assign_group ??
    raw?.assign_group_id ??
    null,
  /**
   * [FEAT-20260825-MULTIGROUP] 🔴 ต้อง copy ที่นี่ ไม่งั้นหายเงียบ
   *
   * `normalizeBroadcast` สร้าง object **ทีละ field** ⇒ อะไรที่ไม่ได้เขียนไว้ตรงนี้
   * จะไม่ไปถึงฟอร์มเลย · อาการคือเปิดฟอร์มมาแล้วกลุ่มว่าง แล้วการเซฟครั้งถัดไป
   * ทับกลุ่มที่ตั้งไว้ด้วยค่าว่าง ⇒ แอดมินรายงานว่า "มันไม่เซฟ" ทั้งที่เซฟแล้วและถูกล้าง
   * (dev-local §5 · เคยเกิดจริงกับ `direct_ticket_on_reply` มาแล้ว)
   *
   * ⚠️ แถวเก่าไม่มีคีย์นี้ ⇒ ถอยไปสร้างลิสต์จาก `assign_group` เดี่ยว เพื่อให้เปิด
   *    แคมเปญเก่าแล้วเห็นกลุ่มเดิมติ๊กอยู่ ไม่ใช่ว่างเปล่า
   */
  assign_group_ids: Array.isArray(raw?.assign_group_ids)
    ? raw.assign_group_ids.map((g: any) => String(g?.id ?? g?._id ?? g))
    : undefined,
  /* `match`/`rules` ride along inside `target` — the backend stores them
     there, so copying the object whole is what keeps them. */
  target: raw?.target ?? { mode: 'all', group_ids: [] },
  message: raw?.message ?? { type: 'text', text: '' },
  status: raw?.status ?? 'draft',
  scheduled_at: raw?.scheduled_at ?? null,
  sent_at: raw?.sent_at ?? null,
  /* 🔴 [FEAT-20260823-BCASTTITLE] THE WAY BACK. This function rebuilds the row
     field by field, so anything not named here is gone before the form sees
     it — the box opens blank and the next save writes that blank over a title
     that WAS stored correctly. The write direction looked perfect while this
     line was missing. เพิ่ม column ใหม่เมื่อไหร่ ต้องเพิ่มที่นี่ด้วยเสมอ. */
  title_detail: raw?.title_detail ?? null,
  /* Same way-back rule: missing here and the form re-opens with the choice
     blank, then the next save clears a deliberate switch. */
  /* 🔴 [FIX-20260825-SCHEDULEWAYBACK] กฎ "ทางกลับ" ข้อเดียวกับด้านบน และรอบนี้
     มันหลุดจริงทั้งที่ไฟล์นี้เตือนไว้ถึงสามจุด
     เจ้าของแจ้ง 25/08: *"form ไม่เซฟ กด edit แล้วต้องมาแก้ไขใหม่ทุกครั้ง"*
     ต้นเหตุ: ฟอร์มส่ง `schedule` ขึ้นไปครบ (`buildPayload`) · BE รับครบ
     (`broadcast.dto.ts:250,361`) · schema เก็บครบ (`broadcast.schema.ts:401`) ·
     read service ไม่มี projection ⇒ **ของมาถึง FE แล้ว** แต่ฟังก์ชันนี้ประกอบ
     object ใหม่ทีละ field และไม่มีบรรทัดนี้ ⇒ ตกหายก่อนถึงฟอร์ม
     ⇒ เปิด edit มาแล้วรอบส่งซ้ำว่างเปล่า และการเซฟครั้งถัดไป **ทับของจริงด้วย null**
     revert: ลบบรรทัดนี้ แล้วอาการเดิมกลับมาทันที */
  schedule: raw?.schedule ?? null,
  send_kind: raw?.send_kind ?? null,
  /* [FEAT-2708-GUARDWINDOW] ขากลับ — ตกบรรทัดนี้ = เปิดฟอร์มว่างแล้วเซฟทับ */
  guard_window_hours: raw?.guard_window_hours ?? null,
  card_type: raw?.card_type ?? null,
  description: raw?.description ?? null,
  /* [FEAT-20260825-BCASTDIRECTTICKET] กติกาขากลับเดียวกับทุกบรรทัดที่นี่ —
     ขาดไป ช่องติ๊กจะกลับมาว่างทุกครั้งที่เปิด edit แล้ว save ถัดไปเขียนทับ
     ⚠️ `=== true` ไม่ใช่ `?? null` — จอวาด checkbox และ `null` จะทำให้มันกลาย
        เป็นสถานะกึ่งกลาง */
  is_direct_ticket: raw?.is_direct_ticket === true,
  /* [FEAT-20260825-BCASTSKIPASSIST] กฎ "ขากลับ" ข้อเดียวกับบรรทัดบน — ตกตรงนี้
     ฟอร์มจะเปิดมาไม่ติ๊ก แล้วเซฟทับงานที่ตั้งใจให้ข้าม โดยไม่มี error ที่ไหนเลย */
  skip_assist: raw?.skip_assist === true,
  created_by: raw?.created_by,
  updated_by: raw?.updated_by,
  /* Same way-back rule as every other column here: missing from this list and
     the name is gone before any screen sees it. */
  created_by_name: raw?.created_by_name ?? null,
  updated_by_name: raw?.updated_by_name ?? null,
  created_at: raw?.created_at,
  updated_at: raw?.updated_at
});

/**
 * [FEAT-20260823-BCASTAUDFE] One audience source, rebuilt field by field.
 *
 * 🔴 THE SAME TRAP AS `normalizeBroadcast` DIRECTLY ABOVE — and it is written
 * out here because that one has now cost this feature twice. Anything not
 * named on this list is dropped, silently, and the caller sees a healthy-looking
 * object with a missing field. `requires_hook_scope` is the one to watch: the
 * backend calls it `scope_by_hook` internally, so copying the internal name
 * would read `undefined` for every row with no error to trace.
 * ชื่อบนสาย ≠ ชื่อในโค้ด BE — ต้องใช้ชื่อบนสาย.
 */
const normalizeAudienceSource = (raw: any): AudienceSourceInfo => ({
  key: raw?.key ?? '',
  label_th: raw?.label_th ?? '',
  label_en: raw?.label_en ?? '',
  type: raw?.type ?? 'string',
  ops: Array.isArray(raw?.ops) ? raw.ops : [],
  requires_hook_scope: raw?.requires_hook_scope === true,
  /* Default TRUE — an un-indexed field is the one worth warning about, so a
     missing flag must not read as "fast". ไม่รู้ = อย่าเพิ่งบอกว่าเร็ว. */
  indexed: raw?.indexed !== false,
  ...(raw?.deprecated === true ? { deprecated: true } : {}),
  /* [FEAT-2708-GUARDWINDOW] absent = not governed (มาตรฐานเดียวกับ deprecated) */
  ...(raw?.guard_window === true ? { guard_window: true } : {}),
});

export const broadcastService = {
  /**
   * 🔌 THE AUDIENCE SEAM — every field a broadcast may select members by.
   *
   * ⚠️ ALWAYS READ, NEVER HARD-CODED. The backend adds a field by adding one
   *    entry to its registry and changes nothing else; a list copied into this
   *    repo would go stale the first time that happens, and the form would
   *    either hide a new field or offer a retired one.
   *
   * ⚠️ RETIRED SOURCES ARE FILTERED OUT HERE, not at the call site. A source
   *    marked `deprecated` still has live jobs referencing it, so it must keep
   *    RENDERING on a saved job — it just must never be OFFERED as a new
   *    choice. เลิกใช้ = ไม่เสนอให้เลือกใหม่ แต่ของเดิมยังต้องอ่านออก.
   */
  /**
   * [FEAT-20260823-BCASTPREVIEW] What this campaign would send, without sending.
   *
   * 🔴 `mirrors` IS NOT DECORATION. `'legacy'` means the running backend does
   *    NOT substitute variables and ignores `title_detail` — the card comes
   *    back with its `{{braces}}` intact because that is what the customer
   *    would receive. Showing that result without showing the label would
   *    read as a rendering bug rather than a configuration state.
   *    ต้องโชว์ป้ายด้วย ไม่งั้นแอดมินจะนึกว่าระบบพัง.
   *
   * ⚠️ NOT normalised field by field, deliberately: `message` is a LINE
   *    message object of arbitrary depth and rebuilding it here would drop
   *    whatever this file forgot — the exact defect that cost this feature
   *    twice already. It is passed to the renderer as it arrived.
   */
  /**
   * [FEAT-20260823-BCASTHISTREAD] Every run of one job, newest first.
   *
   * 🔴 `images_replaced` is COPIED ONLY WHEN PRESENT. The backend omits it
   *    when nothing looked at the pictures, and `?? 0` here would turn "never
   *    measured" into "measured, all fine" — the exact lie the omission exists
   *    to prevent. This is the third layer that has to resist writing that
   *    `??`, so it is spelled out at each one. ห้ามเติม 0 ให้ค่าที่ไม่มี.
   */
  /* [FIX-20260825-SENDNOW] 🔴 กด "ส่งทันที" ไม่เคยยิงจริง — ต่อเข้าท่อที่มีอยู่แล้ว
     เจ้าของแจ้ง 25/08: *"กดส่งทันทีไม่เห็นส่งเลย ไม่ได้ผล ไม่มีประวัติด้วย"*

     ท่อฝั่ง BE ครบอยู่แล้วทั้งเส้น ไม่ได้ขาดอะไร:
       POST /api/broadcasts/:id/send        (broadcasts.controller.ts:197)
         → sendBroadcastNow                  ตรวจสิทธิ์ + guard OA/กลุ่ม
         → newSendPort.send | dispatchBroadcast
         → broadcast-send/sinks/inline.sink  ใช้ LinePushDispatcher (`@/infra/line`)
                                             = core push ตัวเดียวกับที่ระบบใช้ทั้งหมด
     ที่ขาดคือ **ฝั่ง FE ไม่เคยเรียก endpoint นี้เลยแม้แต่บรรทัดเดียว** (grep ทั้ง repo)
     การเซฟด้วย `status: 'sent'` แค่เขียนแถว — `broadcasts.service.ts:333` คืน
     `{ data, results: [] }` เฉย ๆ ⇒ สถานะขึ้นว่าส่งแล้ว แต่ไม่มีข้อความออกและไม่มีประวัติ

     ⚠️ ไม่ได้สร้างท่อใหม่ และไม่แตะ BE เลย — เรียกของเดิมให้ถูกทางเท่านั้น
     ⚠️ revert (แก้ 25/08 — ของเดิมชี้ผิดไฟล์): ลบเมธอดนี้ + จุดเรียกที่
        `pages/messaging/Broadcasts.tsx#submitForm` **ไม่ใช่** BroadcastFormModal
        ฟอร์มไม่รู้จัก id ของแถวใหม่ จึงไม่เคยเป็นคนเรียก */
  /* ⚠️⚠️ HOW TO VERIFY THIS IS ACTUALLY WIRED — read before "proving" anything.
     Two verification mistakes were made on 25/08 while chasing this exact call,
     and both came from trusting a COUNT instead of reading what matched:

       1. `grep -c "/send" server.log` returned 3 and was reported as "fired 3
          times". Those three lines were `Mapped {/api/broadcasts/:id/send, POST}`
          printed at BOOT. A route being mapped is not a request.
          ⇒ print the matching lines; never conclude from `-c` alone.

       2. `grep -c sendBroadcastNow dist/assets/index-*.js` returned 0 and was
          reported as "the code is not in the bundle". Wrong twice over: this
          module is code-split into `Broadcast-*.js`, and MINIFICATION RENAMES
          IDENTIFIERS — so grepping a function name can never prove absence.
          ⇒ grep a STRING LITERAL that survives minification, e.g. the path
            below (the /api/broadcasts/<id>/send path), and grep every chunk.

     The honest check, both halves:
       shipped? grep the literal path /api/broadcasts/ plus /send across
                ALL of dist/assets (it is code-split, not in the entry chunk)
       called?  grep the server log for a line whose url field is
                /api/broadcasts/<id>/send — a Mapped{...} line is NOT a call */
  sendBroadcastNow: async (id: string): Promise<unknown> => {
    const response = await authFetch(
      `${API_BASE_URL}/api/broadcasts/${id}/send`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );
    return handleApiResponse<unknown>(response, 'send broadcast');
  },

  getBroadcastHistory: async (
    id: string,
    params: { page?: number; limit?: number } = {}
  ): Promise<BroadcastHistoryPage> => {
    const search = new URLSearchParams();
    search.append('page', String(params.page ?? 1));
    search.append('limit', String(params.limit ?? 25));
    const response = await authFetch(
      `${API_BASE_URL}/api/broadcasts/${id}/history?${search.toString()}`,
      { method: 'GET' }
    );
    const parsed = await handleApiResponse<any>(response, 'broadcast history');
    const rows: BroadcastHistoryRow[] = Array.isArray(parsed?.data)
      ? parsed.data.map((r: any) => ({
          run_id: r?.run_id ?? '',
          hook_id: r?.hook_id ?? null,
          hook_alias: r?.hook_alias ?? '',
          send_kind: r?.send_kind,
          card_type: r?.card_type,
          matched: r?.matched ?? 0,
          targeted: r?.targeted ?? 0,
          sent: r?.sent ?? 0,
          failed: r?.failed ?? 0,
          unsent: r?.unsent ?? 0,
          requests_planned: r?.requests_planned ?? 0,
          requests_made: r?.requests_made ?? 0,
          chunks_planned: r?.chunks_planned ?? 0,
          chunks_done: r?.chunks_done ?? 0,
          // 🔴 spread, never `?? 0` — see the docblock above
          ...(typeof r?.images_replaced === 'number'
            ? { images_replaced: r.images_replaced }
            : {}),
          status: r?.status ?? 'unknown',
          stop_reason: r?.stop_reason,
          error_message: r?.error_message,
          triggered_by: r?.triggered_by,
          triggered_by_name: r?.triggered_by_name,
          started_at: r?.started_at ?? null,
          finished_at: r?.finished_at ?? null,
          site_rules_age_days: r?.site_rules_age_days
        }))
      : [];
    return {
      data: rows,
      meta: {
        total: parsed?.meta?.total ?? rows.length,
        page: parsed?.meta?.page ?? 1,
        limit: parsed?.meta?.limit ?? 25
      }
    };
  },

  /**
   * [FEAT-20260824-RUNDETAIL] ONE round: what the campaign decided, and what
   * LINE answered — the two side by side.
   *
   * Owner 24/08: *"ต้องแสดงทั้ง history + webhook log จะได้ครบ แต่ว่าทำเป็น modal กดดู"*.
   *
   * 🔴 THE RESPONSE IS NOT WRAPPED. `broadcastRunDetail` in the controller
   *    returns the service result directly, unlike `previewBroadcast` which
   *    wraps in `{ data }`. Reading `parsed?.data` here would be `undefined`
   *    forever, with a 200 and an empty modal. ตัวนี้ไม่มี data ห่อ.
   *
   * 🔴 THREE FIELDS ARE COPIED ONLY WHEN PRESENT, and each one is a different
   *    fact from its "empty" twin. This is the LAST layer that can destroy the
   *    distinction — the backend went out of its way to preserve it:
   *      · `images_replaced` — absent = nobody looked · 0 = looked, none broken
   *      · `unknown_tags`    — absent = nothing rendered · [] = all tags resolved
   *      · `settings_snapshot` — absent = round predates the capture ·
   *                              present = these were the conditions
   *    A `?? 0` / `?? []` / `?? {}` anywhere below is the bug, not the safety.
   *    ห้ามเติมค่าให้ของที่ไม่มี — คนละความหมายกับของว่าง.
   *
   * ⚠️ `logsExpired` and `logsError` stay SEPARATE all the way to the screen.
   *    Expired = the read worked and the 45-day TTL had already taken the rows;
   *    error = the read failed. Collapsing them makes an old-but-successful
   *    round read as a failure. log หมดอายุ ≠ อ่าน log ไม่ได้.
   *
   * ⚠️ Timestamps are handed on AS ISO STRINGS. No offset is added anywhere on
   *    this path — the browser renders the viewer's zone, which is correct.
   *    See `docs/TIME-RULE.md` in the API repo.
   */
  getBroadcastRunDetail: async (id: string, runId: string): Promise<BroadcastRunDetail> => {
    const response = await authFetch(
      `${API_BASE_URL}/api/broadcasts/${id}/history/${encodeURIComponent(runId)}`,
      { method: 'GET' }
    );
    const parsed = await handleApiResponse<any>(response, 'broadcast run detail');

    const rows: BroadcastRunRow[] = Array.isArray(parsed?.rows)
      ? parsed.rows.map((r: any) => ({
          run_id: r?.run_id ?? '',
          hook_id: r?.hook_id ?? null,
          hook_alias: r?.hook_alias ?? '',
          send_kind: r?.send_kind,
          card_type: r?.card_type,
          matched: r?.matched ?? 0,
          targeted: r?.targeted ?? 0,
          sent: r?.sent ?? 0,
          failed: r?.failed ?? 0,
          unsent: r?.unsent ?? 0,
          requests_planned: r?.requests_planned ?? 0,
          requests_made: r?.requests_made ?? 0,
          chunks_planned: r?.chunks_planned ?? 0,
          chunks_done: r?.chunks_done ?? 0,
          // 🔴 spread, never `?? 0` — see the docblock
          ...(typeof r?.images_replaced === 'number'
            ? { images_replaced: r.images_replaced }
            : {}),
          /* 🔴 An ARRAY check, not truthiness: `[]` is the "rendered, all fine"
             answer and a truthy test would drop it back to "never measured". */
          ...(Array.isArray(r?.unknown_tags)
            ? { unknown_tags: r.unknown_tags.map((tag: unknown) => String(tag)) }
            : {}),
          /* 🔴 Copied WHOLE and only when present. Field-by-field rebuilding
             would drop any key the backend adds later — the exact defect that
             `normalizeBroadcast` above records having cost this feature twice. */
          ...(r?.settings_snapshot && typeof r.settings_snapshot === 'object'
            ? { settings_snapshot: r.settings_snapshot }
            : {}),
          ...(typeof r?.broadcast_id === 'string' ? { broadcast_id: r.broadcast_id } : {}),
          ...(typeof r?.broadcast_name === 'string' ? { broadcast_name: r.broadcast_name } : {}),
          status: r?.status ?? 'unknown',
          stop_reason: r?.stop_reason,
          error_message: r?.error_message,
          triggered_by: r?.triggered_by,
          triggered_by_name: r?.triggered_by_name,
          started_at: r?.started_at ?? null,
          finished_at: r?.finished_at ?? null,
          site_rules_age_days: r?.site_rules_age_days
        }))
      : [];

    const logs: BroadcastRunLogEntry[] = Array.isArray(parsed?.logs)
      ? parsed.logs.map((l: any) => ({
          hook_id: l?.hook_id ?? null,
          hook_alias: l?.hook_alias ?? '',
          action_type: l?.action_type,
          endpoint: l?.endpoint,
          method: l?.method,
          status: l?.status,
          ...(typeof l?.status_code === 'number' ? { status_code: l.status_code } : {}),
          error_message: l?.error_message,
          // absent retries = the log predates the counter, not "zero retries"
          ...(typeof l?.retries === 'number' ? { retries: l.retries } : {}),
          created_at: l?.created_at ?? null
        }))
      : [];

    return {
      run_id: parsed?.run_id ?? runId,
      rows,
      logs,
      /* Taken from the wire, NOT inferred from `logs.length` here. The backend
         is the only place that knows an empty list came from a successful read
         rather than a failed one. อย่าเดาเอง ใช้ค่าที่ BE ส่งมา. */
      logsExpired: parsed?.logsExpired === true,
      // Spread: absent means the read did not fail, and must stay absent.
      ...(typeof parsed?.logsError === 'string' && parsed.logsError !== ''
        ? { logsError: parsed.logsError }
        : {})
    };
  },

  previewBroadcast: async (id: string): Promise<BroadcastPreview> => {
    const response = await authFetch(`${API_BASE_URL}/api/broadcasts/${id}/preview`, {
      method: 'POST'
    });
    const parsed = await handleApiResponse<any>(response, 'preview broadcast');
    const raw = parsed?.data ?? parsed;
    return {
      ...(typeof raw?.truncatedToHooks === 'number'
        ? { truncatedToHooks: raw.truncatedToHooks }
        : {}),
      mirrors: raw?.mirrors === 'new' ? 'new' : 'legacy',
      cards: Array.isArray(raw?.cards)
        ? raw.cards.map((c: any) => ({
            hook_id: c?.hook_id ?? '',
            hook_name: c?.hook_name ?? '',
            message: c?.message ?? null,
            unknownTags: Array.isArray(c?.unknownTags) ? c.unknownTags : []
          }))
        : []
    };
  },

  getAudienceSources: async (): Promise<AudienceSourceInfo[]> => {
    const response = await authFetch(`${API_BASE_URL}/api/broadcasts/audience-sources`, {
      method: 'GET'
    });
    const parsed = await handleApiResponse<any>(response, 'list audience sources');
    const rows = Array.isArray(parsed?.data) ? parsed.data : [];
    return rows.map(normalizeAudienceSource).filter((s: AudienceSourceInfo) => !s.deprecated);
  },

  /* [FEAT-20260828-JOBSEARCH] `search` — ชื่อแคมเปญ หรือ id ของงาน
     ⚠️ ขั้นต่ำ 4 ตัวอักษรบังคับจริงที่ BE (`broadcasts-read.service.ts`)
        ฝั่งนี้แค่ไม่ยิงคำที่สั้นกว่านั้น เพื่อไม่ให้ยิงถี่ ๆ ระหว่างพิมพ์ */
  listBroadcasts: async (params: { page?: number; limit?: number; status?: string; sort?: string; search?: string } = {}): Promise<BroadcastListResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.append('page', String(params.page ?? 1));
    searchParams.append('limit', String(params.limit ?? 10));
    if (params.status) {
      searchParams.append('status', params.status);
    }
    if (params.sort) {
      searchParams.append('sort', params.sort);
    }
    const needle = (params.search ?? '').trim();
    if (needle.length >= 4) {
      searchParams.append('search', needle);
    }

    const response = await authFetch(`${API_BASE_URL}/api/broadcasts?${searchParams.toString()}`, {
      method: 'GET'
    });

    const parsed = await handleApiResponse<any>(response, 'list broadcasts');
    const data = Array.isArray(parsed?.data) ? parsed.data.map(normalizeBroadcast) : [];
    const total = parsed?.meta?.total ?? parsed?.pagination?.total ?? data.length;
    const limit = parsed?.meta?.limit ?? parsed?.pagination?.limit ?? params.limit ?? 10;
    return {
      data,
      pagination: {
        page: parsed?.meta?.page ?? parsed?.pagination?.page ?? params.page ?? 1,
        limit,
        total,
        total_pages: limit ? Math.ceil(total / limit) : 1
      }
    };
  },

  createBroadcast: async (data: BroadcastFormData): Promise<BroadcastEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/broadcasts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const parsed = await handleApiResponse<any>(response, 'create broadcast');
    /* [FIX-20260825-CREATEENVELOPE] 🔴 THE SHAPE CHANGES WITH `status`.
       `broadcasts.service.ts:333` returns `{ data: sanitized, results: [] }`
       when the job was saved as `sent`, and the bare document otherwise.
       Normalising the envelope produced `id: ''`, so the caller's
       `if (status === 'sent' && savedId)` was false and the follow-up
       `POST /:id/send` NEVER FIRED — the campaign saved, said "sent", and no
       message ever left. Measured 25/08 from the server log: create present,
       /send absent, `broadcasts_histories` empty.
       ⚠️ Unwrap only when the envelope is actually there — a bare document has
          no `data` key and must keep flowing through untouched.
       รูปคำตอบเปลี่ยนตามสถานะ ⇒ ต้องแกะซองก่อน ไม่งั้น id หายเงียบ. */
    return normalizeBroadcast(parsed?.data ?? parsed);
  },

  updateBroadcast: async (id: string, data: Partial<BroadcastFormData>): Promise<BroadcastEntry> => {
    const response = await authFetch(`${API_BASE_URL}/api/broadcasts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const parsed = await handleApiResponse<any>(response, 'update broadcast');
    return normalizeBroadcast(parsed);
  },

  deleteBroadcast: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/broadcasts/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to delete: ${response.statusText}`);
    }
  }
};
