import { translateNow } from '../../i18n';
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';
import { Pagination } from '../../types';
// [FIX-20260902-BOTONESOURCE] the shape `getNoCaseRooms` returns. Imported from
// chatService on purpose: the server hands back the SAME room shape `/api/chat`
// does, and sharing the type is what keeps that promise checkable.
import type { ChatRoom } from './chatService';

export interface TicketEntry {
  _id: string;
  chat_msg_id: string | null;
  category: string | null;
  need_detail: string | null;
  chat_status: 'bot' | 'admin' | null;
  job_status: number; // 0 = รอรับงาน, 1 = รับงานแล้ว/กำลังดำเนินการ, 2 = จบงานแล้ว
  assigned_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  line_user_id: string | null;
  line_user_data: {
    _id: string;
    // [FIX-20260801-HOOKTYPES] บาง endpoint ส่ง id แทน _id — โค้ดอ่าน `_id || id` อยู่แล้ว
    id?: string;
    line_user_id: string;
    display_name: string;
    nickname: string;
    picture_url: string | null;
    phone_number: string | null;
    contract_code: string | null;
    full_name: string | null;
    detail?: string | null;
    // ==== [FIX-20260729-TICKETTYPE] fields the API already returns
    // These are read all over TicketChat (the acme_category=false branch of
    // the customer info panel) but were never declared, which is where 18 of the
    // 19 standing tsc errors came from. Declaring them changes no behaviour —
    // the values were always arriving, TypeScript just could not see them.
    // All optional: a customer who never linked an account has none of them.
    domain?: string | null;
    agent?: string | null;
    agent_code?: string | null;
    bank_name?: string | null;
    bank_account?: string | null;
    account_name?: string | null;
    true_wallet?: string | null;
    raw_profile_data?: any;
    // [FEAT-20260801-MEMBERTIER] ระดับสมาชิกที่ BE แยกออกมาเก็บเป็น column ของ Member
    // รูปที่ BE เขียนลงไป: { code, name, level, raw, updated_at }
    // เป็น any เพราะ 3rd party แต่ละเจ้าส่งรูปไม่เหมือนกัน (object/สตริง/ตัวเลข)
    // BE ปรับให้เป็นรูปเดียวแล้วแต่ยังแนบ `raw` ของเดิมไว้ — ดู extractTier ฝั่ง BE
    // ไม่มี tier (ลูกค้าที่ยังไม่เคยดึงโปรไฟล์ / tool ที่ไม่ส่ง tier) = null
    tier?: any;
    /* [FEAT-20260819-REGSOURCE] how this customer's account link was created:
       'admin' = an admin registered for them · 'system' = they did it themselves
       through the LIFF page · null/absent = registered before we recorded it,
       which is most existing customers and is NEVER backfilled.
       Not to be confused with `raw_profile_data…registered_at` from the site,
       which is when they signed up THERE. คนละอันกับ "สมัครเมื่อ" ของ shop-api. */
    /* DESTINATION 6 of 7 (b) — the twin of the declaration in
       `chatService.ts`. Same rule: a new column must land in both.
       ⚠️ No new column is expected — a proposed `link_registered_support` was
       dropped 2026-08-21; new sources are new VALUES in the existing field.
       Chain starts at `omnidesk-api/src/modules/customer-link/registration-stamp.helper.ts`. */
    link_registered_by?: string | null;
    link_registered_at?: string | null;
    // ==== [FIX-20260729-TICKETTYPE] END
  } | null;
  admin_user_id: string | null;
  // [FIX-20260801-HOOKTYPES] role/email ไม่ได้มาทุก endpoint — event ทาง WS
  // และ object ที่ประกอบตอนรับงาน/โอนงาน มีแค่ id + ชื่อ · โค้ดไม่เคยอ่าน 2 ฟิลด์นี้
  // จากก้อนพวกนั้นอยู่แล้ว · ทำให้ optional เพื่อให้ type ตรงกับของจริง
  admin_user_data: {
    _id: string;
    username: string;
    display_name: string;
    role?: string;
    email?: string | null;
    // [FIX-20260729-TICKETTYPE] some endpoints serialise the id as `id` rather
    // than `_id`; TicketSupport reads both. Optional because most rows only
    // carry `_id`.
    id?: string;
  } | null;
  // [FIX-20260729-TICKETTYPE] assist state travels either flattened onto the
  // ticket or nested under the room, depending on which endpoint produced the
  // row. TicketChat already handles both — the type just never said so.
  assist_status?: boolean | null;
  chat_room_id?: string | null;
  // [FIX-20260801-HOOKTYPES] บาง endpoint populate ผู้ใช้มาที่ชื่อนี้แทน line_user_data
  // (หน้า /legacy-ticket อ่านเป็น fallback ของชื่อที่จะแสดง) · type ไม่เคยประกาศ
  chat_user_id?: { _id?: string; display_name?: string; [k: string]: any } | null;
  chat_room_data?: {
    _id: string;
    assist_status?: boolean | null;
  } | null;
  line_oa_hook_id: string | null;
  hook_id?: string | null;   // channel-neutral alias (some rows carry this instead)
  line_oa_hook_data: {
    line_oa_name: string;
  } | null;
  // Customer tags (chips on list cards), batched by the ticket-list endpoint.
  // [FEAT-20260801-TAGGROUP] `_id` = แถวเชื่อม · `tag_id` = นิยามป้าย
  // ตัวกรองเทียบด้วย tag_id เพราะชื่อป้ายซ้ำข้ามกลุ่มได้แล้ว
  // [FIX-20260801-HOOKTYPES] tag_id ไม่ได้ติดมาทุกทาง (ก้อนที่มาจาก WS มีแค่ label+สี)
  customer_tags?: { _id: string; tag_id?: string; label: string; color?: string | null }[];
  attached_files?: {
    _id: string;
    image_url: string;
    created_at: string;
  }[] | null;
  assign_histories?: {
    _id: string;
    chat_room_id: string;
    ticket_id: string;
    action: 'accept' | 'edit' | 'close' | 'assign' | string | null;
    detail: string | null;
    assign_to: {
      _id: string;
      username: string;
      display_name: string;
      email: string | null;
      role: string;
    } | null;
    changed_by_id: {
      _id: string;
      username: string;
      display_name: string;
      email: string | null;
      role: string;
    } | null;
    created_at: string;
  }[] | null;
}

export interface TicketListResponse {
  success: boolean;
  data: TicketEntry[];
  pagination?: Pagination;
}

export const ticketService = {
  listTickets: async (params: {
    job_status?: number | string;
    category?: string;
    line_user_id?: string;
    admin_user_id?: string;
    page?: number;
    limit?: number | string;
  } = {}): Promise<TicketListResponse> => {
    const searchParams = new URLSearchParams();
    if (params.job_status !== undefined && params.job_status !== '') {
      searchParams.append('job_status', String(params.job_status));
    }
    if (params.category && params.category !== 'ทั้งหมด') {
      searchParams.append('category', params.category);
    }
    if (params.line_user_id) {
      searchParams.append('line_user_id', params.line_user_id);
    }
    if (params.admin_user_id) {
      searchParams.append('admin_user_id', params.admin_user_id);
    }
    if (params.page !== undefined) {
      searchParams.append('page', String(params.page));
    }
    if (params.limit !== undefined) {
      searchParams.append('limit', String(params.limit));
    }

    const response = await authFetch(`${API_BASE_URL}/api/tickets?${searchParams.toString()}`, {
      method: 'GET'
    });

    return handleApiResponse<TicketListResponse>(response, 'list tickets');
  },

  // ==== [FIX-20260728-REALTIME-SCALE] START — เพิ่มใหม่ (เดิมไม่มี)
  // ดึงตั๋วใบเดียวสำหรับ patch เข้า list ตอนได้ WS event แทนการ refetch ทั้งกลุ่ม
  // ผูกกับ GET /api/tickets/:id (ticketController.getTicketById) ที่มีอยู่แล้ว
  // — ไม่ได้สร้าง endpoint ใหม่ ไม่ได้แตะสูตร query ฝั่ง BE
  // revert: ลบเมธอดนี้ทิ้ง (ผู้เรียกอยู่ใน TicketSupport.tsx marker เดียวกัน)
  getTicketById: async (id: string): Promise<TicketEntry | null> => {
    const res = await authFetch(`${API_BASE_URL}/api/tickets/${id}`);
    const json = await handleApiResponse<{ success: boolean; data: TicketEntry }>(res, 'get ticket by id');
    return json?.success ? json.data : null;
  },
  // ==== [FIX-20260728-REALTIME-SCALE] END

  // ==== [FEAT-20260728-DYNPROFILE] START — เพิ่มใหม่ (เดิมไม่มี) 🔒 สาย AUTO to_dev_auto เท่านั้น
  // panel ขวาหน้า ticket (acme_category = false) ดึง raw profile Shop-API ที่ webhook
  // เก็บไว้ใน Member.raw_profile_data — endpoint BE: GET /api/line-users/:memberId/raw-profile
  // คืน body ดิบ {success, source, data:{profile,promotion,finance,bonus,activity}} หรือ null
  // revert: ลบเมธอดนี้ (ผู้เรียกอยู่ใน TicketChat.tsx marker เดียวกัน)
  // [FEAT-20260803-PROFILEAT] แนบ "เวลาที่ดึงสำเร็จล่าสุด" ติดไปกับก้อนข้อมูล
  //   WHY not change the return shape: every caller treats the resolved value AS the
  //   profile payload (`rawProfile?.data?.profile`, `rawProfile?.profile`). Wrapping it in
  //   `{ data, updatedAt }` would have meant touching each of those reads — more diff, more
  //   places to get wrong — for a field that is pure decoration on the card header.
  //   → แปะเป็น key ที่ขึ้นต้นด้วย _ (ชัดว่าเป็นของฝั่งเราเติม ไม่ใช่ของปลายทาง)
  //   🔴 data เป็น null ต้องคืน null เหมือนเดิมเป๊ะ — spread แล้วจะได้ {} ซึ่ง truthy
  //      = การ์ดจะเข้าใจผิดว่า "มีโปรไฟล์แล้ว" ทั้งที่ยังไม่ผูกบัญชี
  getRawProfile: async (memberId: string): Promise<any | null> => {
    const res = await authFetch(`${API_BASE_URL}/api/line-users/${memberId}/raw-profile`);
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json?.success) return null;
    const data = json.data ?? null;
    if (data === null || typeof data !== 'object') return data;
    return {
      ...data,
      /* 🔴 [FIX-20260906-VIEWTHROUGH] `view` MUST travel with the blob.
         This function returned `json.data` alone, so the provider's `view` — the
         thing the whole panel now draws from — was read off the wire and thrown
         away one line before the component asked for it. `ProfilePanel` does
         `readPanelValues(rawProfile?.view)`, got `undefined`, and every value
         resolved through the provider rendered as `-`: เครดิตคงเหลือ, เงินค้าง
         ในกระเป๋า, ยอดฝากรวม, ประวัติฝาก, สินค้าที่ซื้อล่าสุด, โบนัส, กิจกรรม — a
         customer with 11,664.92 credit and 12,000 in deposits showed an empty
         panel while the BE answer carried all of it.
         It looked like a BE fault and was not: the response has always had
         `view`; this line is where it stopped.
         ⚠️ The `data === null` early return above is UNTOUCHED — an unlinked
         customer must still return `null` exactly as before (see the note on
         this function), and there is no view to carry in that case anyway.
         BE ส่งมาครบ แต่ตรงนี้ทิ้ง — ต้องส่งต่อ */
      view: json.view ?? null,
      /* [FEAT-20260907-PROVCONDS] provider condition stamps MUST travel with
         the blob, same lesson as VIEWTHROUGH above: this function rebuilds the
         object, so any key not carried here dies on this line. Absent on the
         wire (shop-api declares no conditions) stays null = legacy rules apply. */
      has_member_data: json.has_member_data ?? null,
      show_walletpay_card: json.show_walletpay_card ?? null,
      show_register_action: json.show_register_action ?? null,
      _profile_data_updated_at: json.profile_data_updated_at ?? null,
    };
  },

  // ==== [FEAT-20260802-SITERULESPANEL] site rules ของ OA (การ์ด "ข้อมูลเว็บ" ใน panel ขวา)
  //   BE หาเส้นด้วย role = site_rules · cache อยู่ที่ Redis ตาม cache_ttl_sec ของ endpoint
  //   คืนทั้งก้อน (data + domain_name + cached_at) เพราะการ์ดต้องโชว์เวลาและชื่อเว็บด้วย
  //   ล้มเหลว → คืน null (การ์ดจะไม่แสดง) · ไม่โยน error
  getHookSiteRules: async (hookId: string): Promise<any | null> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/hooks/${hookId}/site-rules`);
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch { return null; }
  },
  refreshHookSiteRules: async (hookId: string): Promise<any | null> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/hooks/${hookId}/site-rules/refresh`, { method: 'POST' });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch { return null; }
  },
  // ==== [FEAT-20260802-SITERULESPANEL] END

  // [FEAT-20260802-CLEARRAWPROFILE] ลบเฉพาะ raw_profile_data ที่เราเก็บไว้
  //   ไม่ยิง unlink ปลายทาง (เจตนา — ดู marker เดียวกันที่ PersonalPanel/BE)
  clearRawProfile: async (memberId: string): Promise<boolean> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/line-users/${memberId}/raw-profile`, { method: 'DELETE' });
      if (!res.ok) return false;
      const json = await res.json().catch(() => null);
      return json?.success === true;
    } catch { return false; }
  },
  // ==== [FEAT-20260728-DYNPROFILE] END

  // ==== [FEAT-20260801-MANUALREFRESH] START — ปุ่ม refresh ยิงไปหา 3rd party จริง
  // 🔒 สาย AUTO — to_dev_auto / to_prod_auto
  // getRawProfile ด้านบนอ่านจาก DB ของเราอย่างเดียว (ค่าจะสดตอน webhook ทำงาน)
  // เส้นนี้สั่งให้ BE ยิงไปถามปลายทางใหม่แล้วเขียนทับ raw_profile_data ก่อนคืนค่า
  // POST เพราะมี side effect · BE มีเบรกกันกดรัวของตัวเอง (10 วิ ผูกกับตัวลูกค้า)
  // ⚠️ ล้มเหลวคืน null เฉยๆ ไม่โยน error — ผู้เรียกจะ reload ของเดิมต่อได้ตามปกติ
  //    (ผู้ใช้สั่งไว้ว่าหน้าบ้านต้องไม่เห็นความต่างเวลาเราไม่ได้ยิงจริง)
  // revert: ลบเมธอดนี้ + จุดเรียกใน TicketChat.tsx marker เดียวกัน
  // [FEAT-20260824-CLAIMPROFILE] `trigger` เป็นค่าปิดค่าเดียว ('case_taken') —
  // BE ใช้มันเป็นเหตุผลเดียวที่ยอมให้ข้าม cooldown 10 วิ · ไม่ส่ง = พฤติกรรมเดิมทุกอย่าง
  // (ปุ่ม refresh มือไม่ต้องแก้อะไรเลย และยังติด cooldown เหมือนเดิม)
  // [FEAT-20260825-CHATOPENFRESH] 'chat_opened' เข้ามาเป็นค่าที่สอง — "แค่คลิกการ์ด"
  //   เจ้าของสั่ง 25/08: คลิกการ์ดเฉย ๆ (ไม่รับเคส ไม่เปิดเคส) ก็ต้องได้ของสด
  //   BE แยก `request_meta.source` เป็น 'chat_opened' คนละตัวกับ 'manual_refresh'
  //   ⇒ ตรวจย้อนหลังได้ว่าการดึงรอบนั้นมาจากการคลิกการ์ด ไม่ใช่ปุ่ม refresh มือ
  //   ⚠️ ยังเป็น "ค่าปิด" อยู่ (ยูเนียน 2 ค่า) ไม่ใช่ string เปล่า — BE มี @IsIn คุมอีกชั้น
  //   revert: เอา | 'chat_opened' ออก แล้วลบจุดเรียกใน PersonalPanel marker เดียวกัน
  refreshRawProfile: async (memberId: string, hookId: string, trigger?: 'case_taken' | 'chat_opened'): Promise<any | null> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/line-users/${memberId}/raw-profile/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trigger ? { hook_id: hookId, trigger } : { hook_id: hookId }),
      });
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      // [FEAT-20260803-PROFILEAT] แนบเวลาแบบเดียวกับ getRawProfile (กติกาเดียว 2 ทางเข้า)
      if (!json?.success) return null;
      const data = json.data ?? null;
      if (data === null || typeof data !== 'object') return data;
      /* [FIX-20260906-VIEWTHROUGH] the same rule as `getRawProfile` above, and it
         has to be here too: this is the OTHER way a panel obtains a profile (the
         refresh button and the case-taken trigger). Fixing only the read path
         would leave the panel correct until someone pressed refresh, and then
         blank again — the worst shape of the same bug, because it looks
         intermittent. กติกาเดียว สองทางเข้า */
      return {
        ...data,
        view: json.view ?? null,
        /* [FEAT-20260907-PROVCONDS] same carry as the read path — one rule,
           both entrances, or the panel flickers after a refresh. */
        has_member_data: json.has_member_data ?? null,
        show_walletpay_card: json.show_walletpay_card ?? null,
        show_register_action: json.show_register_action ?? null,
        _profile_data_updated_at: json.profile_data_updated_at ?? null,
      };
    } catch {
      return null;
    }
  },
  // ==== [FEAT-20260801-MANUALREFRESH] END

  // ==== [FEAT-20260729-CLINKEDIT] START — ปุ่มแก้ไข/ถอน/ลงทะเบียนให้ลูกค้า (แอดมิน)
  // 🔒 branch to_dev_custom_adapter
  // 3 เส้นนี้แยก prefix /customer-link/admin/* ฝั่ง BE (JWT + ticket.manage)
  // — เส้นลูกค้าเดิม (/token /resolve /match) ไม่ถูกแตะเลย
  // revert: ลบ block นี้ + จุดเรียกใน TicketChat.tsx marker เดียวกัน

  /** ขอ URL หน้า landing สำหรับแอดมิน — mode 'edit' (แก้การผูก) | 'register' (ลงทะเบียนแทน)
   *  คืน { ok, url?, error? } — error.message พร้อมโชว์ผู้ใช้ได้เลย (BE ส่งภาษาคน) */
  getAdminLinkUrl: async (
    hookId: string, channelUserId: string, mode: 'edit' | 'register'
  ): Promise<{ ok: boolean; url?: string; expiresInMs?: number; error?: string }> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/customer-link/admin/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hook_id: hookId, channel_user_id: channelUserId, mode }),
      });
      const json = await res.json().catch(() => null);
      if (json?.success && json?.data?.url) {
        return { ok: true, url: json.data.url, expiresInMs: json.data.expires_in_ms };
      }
      return { ok: false, error: json?.error?.message || translateNow('ticketui.panel.link_failed', 'ขอลิงก์ไม่สำเร็จ') };
    } catch {
      return { ok: false, error: translateNow('ticketui.panel.server_unreachable', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้') };
    }
  },

  /** ถอนการผูกบัญชี — ยิง unlink ปลายทาง + BE ล้าง raw profile/เบอร์/ชื่อจริง ให้เอง */
  adminUnlinkCustomer: async (
    hookId: string, channelUserId: string, phoneNumber: string
  ): Promise<{ ok: boolean; note?: string; error?: string }> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/customer-link/admin/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hook_id: hookId, channel_user_id: channelUserId, phone_number: phoneNumber }),
      });
      const json = await res.json().catch(() => null);
      if (json?.success) return { ok: true, note: json?.data?.note };
      return { ok: false, error: json?.error?.message || translateNow('ticketui.panel.unlink_failed', 'ถอนการผูกไม่สำเร็จ') };
    } catch {
      return { ok: false, error: translateNow('ticketui.panel.server_unreachable', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้') };
    }
  },
  // ==== [FEAT-20260729-CLINKEDIT] END

  // ==== [FEAT-20260801-LINKCAPS] START — OA นี้ทำอะไรได้บ้าง (อ่านอย่างเดียว)
  // ใช้ซ่อนปุ่ม "แก้ไข/ถอนการผูก" เมื่อ tool ของ OA ไม่มีเส้นนั้นจริง
  // (Shop-API ตัวจริงไม่มีทั้งคู่ — ยิงทดสอบแล้วปลายทางตอบ 404 ทุก method)
  //
  // ⚠️ ถามไม่สำเร็จ → คืน null แล้วให้ฝั่งจอ **โชว์ปุ่มไว้ก่อน** เพื่อไม่ให้
  //    ของที่เคยใช้ได้หายไปเพราะเส้นนี้ล่มหรือ BE ยังไม่ได้ deploy
  // revert: ลบเมธอดนี้ + จุดเรียกใน TicketChat.tsx (marker เดียวกัน)
  getLinkCapabilities: async (
    hookId: string
  ): Promise<{ has_tool: boolean; profile: boolean; link: boolean; edit: boolean; unlink: boolean } | null> => {
    try {
      const res = await authFetch(
        `${API_BASE_URL}/customer-link/admin/capabilities?hook_id=${encodeURIComponent(hookId)}`
      );
      const json = await res.json().catch(() => null);
      if (json?.success && json?.data) return json.data;
      return null;
    } catch {
      return null;
    }
  },
  // ==== [FEAT-20260801-LINKCAPS] END

  listTicketsByHook: async (hookId: string, params: {
    job_status?: number | string;
    category?: string;
    /* [FIX-20260827-TKTMEMBERPARAM] both take the member's Mongo `_id` — NOT the
       LINE "Uxxx…" id, despite the legacy name. The BE now answers 400 to a
       non-ObjectId instead of silently dropping the filter (which, with
       `limit:'all'`, meant an unbounded fetch). `member_id` is the honest name;
       `line_user_id` is the legacy alias kept for shipped callers.
       📖 omnidesk-api/todo/task/27082026/todo1_27082026_tickets-line-user-id-fix.md */
    member_id?: string;
    /* [FIX-20260827-CHANNELUSERPARAM] the customer's EXTERNAL id on their
       channel (LINE's `Uxxx…` today) — channel-neutral name, resolved to the
       member server-side. Unknown id ⇒ empty list, never unfiltered.
       📖 omnidesk-api/todo/task/27082026/todo5_27082026_floatup-identity-contexts.md */
    channel_user_id?: string;
    line_user_id?: string;
    admin_user_id?: string;
    page?: number;
    limit?: number | string;
    search?: string;
    start_date?: string;
    end_date?: string;
    // [FEAT-20260808-DATESCOPE] optional last-N-days scope (2|3|4|5|7). OMITTED
    // (undefined) → BE returns the current unbounded result — request byte-identical
    // to today. revert: drop this field + the append below.
    within_days?: number;
    // [PERF-20260821-TICKETCURSOR] keyset paging. PRESENT (even '') = cursor mode; absent = legacy.
    cursor?: string;
    /* [PERF-20260822-TKTIDSFETCH] ดึงเฉพาะตั๋วที่ระบุ ผ่านเส้นทางเดียวกับลิสต์เต็ม
       BE เอาไป AND กับ filter เดิม ⇒ narrow ได้อย่างเดียว ไม่มีทาง widen
       ไม่ใส่ = คำขอเหมือนเดิมทุกตัวอักษร */
    ids?: string[];
  } = {}): Promise<TicketListResponse> => {
    const searchParams = new URLSearchParams();
    if (params.job_status !== undefined && params.job_status !== '') {
      searchParams.append('job_status', String(params.job_status));
    }
    if (params.category && params.category !== 'ทั้งหมด') {
      searchParams.append('category', params.category);
    }
    if (params.member_id) {
      searchParams.append('member_id', params.member_id);
    }
    if (params.channel_user_id) {
      searchParams.append('channel_user_id', params.channel_user_id);
    }
    if (params.line_user_id) {
      searchParams.append('line_user_id', params.line_user_id);
    }
    if (params.admin_user_id) {
      searchParams.append('admin_user_id', params.admin_user_id);
    }
    if (params.page !== undefined) {
      searchParams.append('page', String(params.page));
    }
    if (params.limit !== undefined) {
      searchParams.append('limit', String(params.limit));
    }
    if (params.search && params.search.trim()) {
      searchParams.append('search', params.search.trim());
    }
    if (params.start_date) {
      searchParams.append('start_date', params.start_date);
    }
    if (params.end_date) {
      searchParams.append('end_date', params.end_date);
    }
    // [FEAT-20260808-DATESCOPE] append only when a scope is set; "ทั้งหมด" omits it.
    if (params.within_days !== undefined) {
      searchParams.append('within_days', String(params.within_days));
    }
    // [PERF-20260821-TICKETCURSOR] the KEY must be present for cursor mode, even when empty.
    if (params.cursor !== undefined) {
      searchParams.append('cursor', params.cursor);
    }
    // [PERF-20260822-TKTIDSFETCH] ว่าง = ไม่ใส่ param เลย ⇒ ไม่แตะคำขอเดิม
    if (params.ids && params.ids.length > 0) {
      searchParams.append('ids', params.ids.join(','));
    }

    const response = await authFetch(`${API_BASE_URL}/api/tickets/hook/${hookId}?${searchParams.toString()}`, {
      method: 'GET'
    });

    return handleApiResponse<TicketListResponse>(response, 'list tickets by hook');
  },

  getTicketMeta: async (hookId: string): Promise<{ success: boolean; total: number; last_updated: string | null }> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets/hook/${hookId}/meta`, { method: 'GET' });
    return handleApiResponse(response, 'get ticket meta');
  },

  listTicketsByGroup: async (groupId: string, params: {
    job_status?: number | string;
    category?: string;
    // [FIX-20260827-TKTMEMBERPARAM] same pair as listTicketsByHook — see there.
    member_id?: string;
    /* [FIX-20260827-CHANNELUSERPARAM] the customer's EXTERNAL id on their
       channel (LINE's `Uxxx…` today) — channel-neutral name, resolved to the
       member server-side. Unknown id ⇒ empty list, never unfiltered.
       📖 omnidesk-api/todo/task/27082026/todo5_27082026_floatup-identity-contexts.md */
    channel_user_id?: string;
    line_user_id?: string;
    admin_user_id?: string;
    page?: number;
    limit?: number | string;
    search?: string;
    start_date?: string;
    end_date?: string;
    // [FEAT-20260808-DATESCOPE] optional last-N-days scope (2|3|4|5|7). See listTicketsByHook.
    within_days?: number;
    // [PERF-20260821-TICKETCURSOR] keyset paging. PRESENT (even '') = cursor mode; absent = legacy.
    cursor?: string;
    /* [PERF-20260822-TKTIDSFETCH] ดึงเฉพาะตั๋วที่ระบุ ผ่านเส้นทางเดียวกับลิสต์เต็ม
       BE เอาไป AND กับ filter เดิม ⇒ narrow ได้อย่างเดียว ไม่มีทาง widen
       ไม่ใส่ = คำขอเหมือนเดิมทุกตัวอักษร */
    ids?: string[];
  } = {}): Promise<TicketListResponse> => {
    const searchParams = new URLSearchParams();
    if (params.job_status !== undefined && params.job_status !== '') {
      searchParams.append('job_status', String(params.job_status));
    }
    if (params.category && params.category !== 'ทั้งหมด') {
      searchParams.append('category', params.category);
    }
    if (params.member_id) {
      searchParams.append('member_id', params.member_id);
    }
    if (params.channel_user_id) {
      searchParams.append('channel_user_id', params.channel_user_id);
    }
    if (params.line_user_id) {
      searchParams.append('line_user_id', params.line_user_id);
    }
    if (params.admin_user_id) {
      searchParams.append('admin_user_id', params.admin_user_id);
    }
    if (params.page !== undefined) {
      searchParams.append('page', String(params.page));
    }
    if (params.limit !== undefined) {
      searchParams.append('limit', String(params.limit));
    }
    if (params.search && params.search.trim()) {
      searchParams.append('search', params.search.trim());
    }
    if (params.start_date) {
      searchParams.append('start_date', params.start_date);
    }
    if (params.end_date) {
      searchParams.append('end_date', params.end_date);
    }
    // [FEAT-20260808-DATESCOPE] append only when a scope is set; "ทั้งหมด" omits it.
    if (params.within_days !== undefined) {
      searchParams.append('within_days', String(params.within_days));
    }
    // [PERF-20260821-TICKETCURSOR] the KEY must be present for cursor mode, even when empty.
    if (params.cursor !== undefined) {
      searchParams.append('cursor', params.cursor);
    }
    // [PERF-20260822-TKTIDSFETCH] ว่าง = ไม่ใส่ param เลย ⇒ ไม่แตะคำขอเดิม
    if (params.ids && params.ids.length > 0) {
      searchParams.append('ids', params.ids.join(','));
    }

    const response = await authFetch(`${API_BASE_URL}/api/tickets/group/${groupId}?${searchParams.toString()}`, {
      method: 'GET'
    });

    return handleApiResponse<TicketListResponse>(response, 'list tickets by group');
  },

  // [FEAT-20260808-DATESCOPE] optional `within_days` keeps the group-tab "waiting"
  // count consistent with the scoped list. Omitted → today's unbounded meta.
  getTicketMetaByGroup: async (groupId: string, within_days?: number): Promise<{ success: boolean; total: number; waiting?: number; last_updated: string | null }> => {
    const qs = within_days !== undefined ? `?within_days=${within_days}` : '';
    const response = await authFetch(`${API_BASE_URL}/api/tickets/group/${groupId}/meta${qs}`, { method: 'GET' });
    return handleApiResponse(response, 'get ticket meta by group');
  },

  // Phase 5 (5a): fetch meta for MANY groups in one request (replaces N per-group
  // calls). Returns the raw Response so the caller can detect a 404 (BE too old)
  // and fall back to per-group calls — keeping FE/BE deploys independent.
  // [FEAT-20260808-DATESCOPE] optional `within_days` scopes the batch counts too;
  // omitted → today's unbounded batch (query string byte-identical to before).
  getTicketMetaBatchRaw: async (groupIds: string[], within_days?: number): Promise<Response> => {
    const qs = encodeURIComponent(groupIds.join(','));
    const scope = within_days !== undefined ? `&within_days=${within_days}` : '';
    return authFetch(`${API_BASE_URL}/api/tickets/meta/batch?groups=${qs}${scope}`, { method: 'GET' });
  },

  getTicket: async (id: string): Promise<{ success: boolean; data: TicketEntry }> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets/${id}`, {
      method: 'GET'
    });
    return handleApiResponse<{ success: boolean; data: TicketEntry }>(response, 'get ticket');
  },

  createTicket: async (data: Partial<TicketEntry>): Promise<{ success: boolean; data: TicketEntry }> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleApiResponse<{ success: boolean; data: TicketEntry }>(response, 'create ticket');
  },

  updateTicket: async (id: string, data: Partial<{
    job_status: number;
    admin_user_id: string | null;
    assigned_at: string | Date | null;
    resolved_at: string | Date | null;
    chat_status: string | null;
  }>): Promise<{ success: boolean; data: TicketEntry }> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleApiResponse<{ success: boolean; data: TicketEntry }>(response, 'update ticket');
  },

  // [FEAT-20260817-REOPENBYADMIN] reopen a CLOSED case as a NEW ticket owned by
  // the presser. The whole reopen (claim + create + divider + history) is one
  // BE block; the response carries room_id for the tc:assist-changed dispatch.
  reopenTicketByAdmin: async (ticketId: string): Promise<{ success: boolean; data?: TicketEntry; room_id?: string }> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets/reopen-by-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticketId })
    });
    return handleApiResponse<{ success: boolean; data?: TicketEntry; room_id?: string }>(response, 'reopen ticket by admin');
  },

  /**
   * [FEAT-20260819-OPENFROMROOM] Open the FIRST case for a conversation that never
   * had one — the rows the bot-care tab surfaces from chat_rooms.
   *
   * A sibling of `reopenTicketByAdmin`, not a reuse of it: there is no earlier
   * ticket here, so the BE route, the divider variant and the history action all
   * carry their own name. The BE runs the SAME claim → ticket → divider → history
   * steps, so the resulting case is a normal one in every other respect.
   * ไม่ใช่ reopen — ไม่มีตั๋วเดิมให้เปิดซ้ำ.
   */
  /**
   * [FIX-20260819-EVERTICKETED] Member ids on this OA that have EVER had a case.
   *
   * The lists this page loads are date-scoped, so they cannot tell "no case ever"
   * from "no case lately" — and marking a long-quiet customer as never-escalated
   * is exactly the bug this answers. Ids only, no window, no pagination.
   */
  /**
   * [FEAT-20260820-BOTCOUNTBE] How many customers on this OA have a room and no
   * case at all — the half of the บอทดูแล badge this page cannot see for itself.
   *
   * The rooms behind those rows are fetched only while that tab is open (see
   * `TicketChat.tsx`, deliberately never a background poll), so from any other
   * tab the badge was missing them and read low. The server can answer without
   * shipping a single room. ป้ายขาดครึ่งเมื่ออยู่แท็บอื่น · ให้ BE ตอบเป็นตัวเลขแทน.
   *
   * ⚠️ Failure answers 0 rather than throwing: a badge must never be able to
   * break the page it decorates. ล้มก็คืน 0 · ป้ายพังไม่ได้ทำหน้าเว็บพัง.
   */
  /* [FIX-20260829-BOTBADGEWINDOW] `withinDays` — the SAME ⚙️ window that filters
     the rows on the บอทดูแล tab (`services/chat/orphanRooms.ts`). Without it the
     badge read one number from another tab and a smaller one on its own, because
     the server counted rooms of any age while the rows dropped the old ones.
     Omitted = unbounded, which is what this call did before. */
  getNoCaseRoomCount: async (
    hookId: string,
    withinDays?: number,
  ): Promise<number> => {
    try {
      const q =
        typeof withinDays === 'number' &&
        Number.isFinite(withinDays) &&
        withinDays > 0
          ? `?within_days=${withinDays}`
          : '';
      const res = await authFetch(
        `${API_BASE_URL}/api/tickets/hook/${hookId}/no-case-room-count${q}`,
      );
      if (!res.ok) return 0;
      const json = await res.json().catch(() => null);
      const n = json?.data?.count;
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
    } catch { return 0; }
  },

  /**
   * [FIX-20260902-BOTONESOURCE] The บอทดูแล tab's rooms, decided by the server.
   *
   * The sibling above answers HOW MANY and this answers WHICH, from one rule
   * inside the service — so the tab can stop counting for itself. It had to: a
   * browser can only count what it managed to load, so the same badge read 29
   * from one tab and 28 from its own, and two operators looking at the same OA at
   * the same moment could see different numbers. A number that depends on who is
   * looking is not a number.
   *
   * ⚠️ This REPLACES both `getNoCaseRoomCount` and the tab's own room download in
   *    one call — the count is now `rows.length`. It is not an extra request.
   * ⚠️ The payload is small BY THE FILTER: these are the customers with no case at
   *    all. That is why it is safe to ask for on every tab, where fetching every
   *    room never was.
   * ⚠️ `[]` on any failure, never a throw. This feeds a badge and a list; neither
   *    may be able to break the page. An empty list reads as "nothing waiting",
   *    which is the honest thing to show when we could not find out.
   *
   * revert: delete this, restore the `getNoCaseRoomCount` call and the tab-only
   * room fetch; the badge goes back to disagreeing with itself.
   */
  getNoCaseRooms: async (
    hookId: string,
    withinDays?: number,
  ): Promise<ChatRoom[]> => {
    try {
      const q =
        typeof withinDays === 'number' &&
        Number.isFinite(withinDays) &&
        withinDays > 0
          ? `?within_days=${withinDays}`
          : '';
      const res = await authFetch(
        `${API_BASE_URL}/api/tickets/hook/${hookId}/no-case-rooms${q}`,
      );
      if (!res.ok) return [];
      const json = await res.json().catch(() => null);
      return Array.isArray(json?.data) ? (json.data as ChatRoom[]) : [];
    } catch { return []; }
  },

  listTicketedMembers: async (hookId: string): Promise<string[]> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets/hook/${hookId}/ticketed-members`);
    const json = await handleApiResponse<{ success: boolean; data: string[] }>(response, 'list ticketed members');
    return json.data ?? [];
  },

  openTicketFromRoom: async (
    roomId: string,
    choices?: { category?: string; need_detail?: string },
  ): Promise<{ success: boolean; data?: TicketEntry; room_id?: string }> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets/open-from-room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: roomId,
        // Omitted rather than sent empty: the BE decides the defaults, and it is
        // the only place that knows what the collection really stores.
        ...(choices?.category ? { category: choices.category } : {}),
        ...(choices?.need_detail?.trim() ? { need_detail: choices.need_detail.trim() } : {}),
      }),
    });
    return handleApiResponse<{ success: boolean; data?: TicketEntry; room_id?: string }>(
      response,
      'open ticket from room',
    );
  },

  updateTicketMinimal: async (id: string, data: Partial<{
    job_status: number;
    admin_user_id: string | null;
    assigned_at: string | Date | null;
    resolved_at: string | Date | null;
    chat_status: string | null;
    /* [FIX-20260823-CLAIMCAS] เจ้าของเคสที่ผู้กด "เห็นบนจอตอนกด" — เงื่อนไข ไม่ใช่ข้อมูล
       BE เอาไปใส่ในฟิลเตอร์ของคำสั่งเขียนเดียวกัน ⇒ สองคนกดพร้อมกันมีคนเดียวที่ได้
       `''` = เห็นว่ายังไม่มีใครถือ · **ไม่ส่ง = พฤติกรรมเดิมทุกบรรทัด**
       (ผู้เรียกอื่นทั้งหมดไม่ส่ง จึงไม่มีอะไรเปลี่ยนสำหรับพวกเขา) */
    expected_admin_user_id: string;
    /* [FEAT-20260826-CLOSECLEARFU] "เลิกตามการสมัครของลูกค้าคนนี้" — เงื่อนไข ไม่ใช่ข้อมูล
       ส่งเฉพาะตอนแอดมินติ๊กช่อง "หยุดตาม" ในกล่องยืนยันปิดเคส · BE ตัดสินด้วย
       `=== true` แล้ว `$unset` สองคีย์ของ member นั้น จากนั้นเขียน audit ว่าใครสั่ง
       **ไม่ส่ง = พฤติกรรมเดิมทุกบรรทัด** ⇒ ผู้เรียกอื่นทั้งหมดไม่รู้สึกอะไร
       ⚠️ ต้องประกาศทั้งที่นี่และใน `UpdateTicketDto` ฝั่ง BE — BE เปิด
          `forbidNonWhitelisted` ⇒ คีย์ที่ BE ยังไม่รู้จักทำให้ปิดเคส 400 ทั้งระบบ
          จึงต้อง deploy BE ก่อน FE เสมอ */
    clear_follow_up: boolean;
    /* [FEAT-20260827-PATCHAFTERCLOSE] "patch after close ticket" — คำตอบของแต่ละ
       section ในกล่องยืนยันปิดเคส · เงื่อนไข ไม่ใช่ข้อมูลของ ticket
         registration 'stop'     ⇒ BE ตั้ง `members.ignore_abandon_assist = true`
         deposit/withdraw 'unfollow' ⇒ BE ล้าง stamp `notice_*_at` ใบนั้น
       🔴 **section ไหนไม่ขึ้น = ไม่ส่ง key นั้น = BE ไม่ทำอะไร** และถ้าไม่มี section
          ไหนขึ้นเลย ก็ไม่ส่งทั้งก้อน ⇒ payload เท่าเดิมทุกไบต์ = ปิดเคสปกติ
       ⚠️ deploy BE ก่อน FE เสมอ — `forbidNonWhitelisted` ทำให้คีย์ที่ BE ยังไม่รู้จัก
          กลายเป็น 400 คือปิดเคสไม่ได้ทั้งระบบ */
    patch_after_close: {
      registration?: 'stop' | 'keep';
      deposit?: 'follow' | 'unfollow';
      withdraw?: 'follow' | 'unfollow';
    };
  }>): Promise<{ success: boolean; data: any }> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets/${id}?minimal=true`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return handleApiResponse<{ success: boolean; data: any }>(response, 'update ticket minimal');
  },

  deleteTicket: async (id: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to delete ticket: ${response.statusText}`);
    }
  },

  patchNickname: async (lineUserId: string, nickname: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/line-users/${lineUserId}/nickname`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any)?.message || 'Failed to update nickname');
    }
  },

  patchDetail: async (lineUserId: string, detail: string): Promise<void> => {
    const response = await authFetch(`${API_BASE_URL}/api/line-users/${lineUserId}/detail`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ detail })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any)?.message || 'Failed to update detail');
    }
  },

  clearTickets: async (hookId: string, clearWaiting: boolean, clearProcessing: boolean): Promise<{ success: boolean, message: string, ticketsClosed: number, roomsReset: number }> => {
    const response = await authFetch(`${API_BASE_URL}/api/tickets/hook/${hookId}/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clear_waiting: clearWaiting,
        clear_processing: clearProcessing
      })
    });
    return handleApiResponse(response, 'clear tickets');
  }
};

/* [PERF-20260821-TICKETCURSOR] The ended ("ปิดเคส") tab pages by cursor.
   ===========================================================================
   WHY: `limit=all` on this tab shipped 2.7 MB on 20/08 and grows with history.
   The BE (omnidesk-api 57cf85b) pages by keyset when the request carries `cursor`;
   without it the BE is byte-identical to before, which is the kill switch here:
   `localStorage.TC_LIST_PAGING = 'false'` → this function returns today's exact
   params and the page behaves as it always did. Same pattern as TC_WS_PATCH.
   WHY ONLY THE ENDED TAB: the active tabs re-sort cards by "who wrote last" and
   need every row in memory for that; the ended tab does not reorder on events.
   Realtime is untouched either way — `ticket:updated` still patches rows that
   are loaded, and a closed ticket that is not loaded yet is simply on a later page.
   revert: delete this block + the `cursor` param; TicketChat goes back to `all`. */
export const CLOSED_PAGE_SIZE = 100;

export function closedListPagingEnabled(): boolean {
  try { return localStorage.getItem('TC_LIST_PAGING') !== 'false'; } catch { return true; }
}

/* [FEAT-20261019-CATFILTER] `categoryLabel` set ⇒ the full fetch, the same rule the open tabs
   follow (`activeListParams`): a category is a client-side MATCH (aliases, null ⇒ อื่นๆ) that no
   exact-match server param can express, so a paged list would filter only the loaded rows.
   Absent / '' ⇒ byte-identical to before (shop-api never sets one — it has no category filter). */
export function closedListParams(
  input: { cursor: string; withinDays: number | undefined; search: string | undefined; categoryLabel?: string },
  pagingEnabled: boolean = closedListPagingEnabled(),
): { job_status: number; limit: number | string; cursor?: string; within_days: number | undefined; search: string | undefined } {
  return pagingEnabled && !input.categoryLabel
    ? { job_status: 2, limit: CLOSED_PAGE_SIZE, cursor: input.cursor, within_days: input.withinDays, search: input.search }
    : { job_status: 2, limit: 'all', within_days: input.withinDays, search: input.search };
}
