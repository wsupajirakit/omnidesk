import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

export interface ChatRoom {
  _id: string;
  line_user_id: string;
  unread_count: number;
  last_message: {
    sender_type: 'bot' | 'customer';
    text: string;
    timestamp: string;
  };
  // ==== [FIX-20260801-HOOKTYPES] ประกาศให้ตรงกับที่ API ส่งมาจริง
  // ยิง GET /api/chat/contacts ดูของจริงแล้ว payload มีครบกว่านี้มาก
  // ที่ประกาศไว้เดิมมีแค่ 6 ฟิลด์ → โค้ดที่อ่าน full_name/phone_number โดนฟ้อง
  // ทั้งที่ค่ามีจริง (ไม่มีใครเห็นมาก่อนเพราะยังไม่ได้ติดตั้ง @types/react)
  // ⚠️ ประกาศเพิ่มอย่างเดียว ไม่ได้เปลี่ยนพฤติกรรม · _id คือ id ของ Member
  user_data?: {
    id: string;
    _id?: string;
    line_user_id?: string;
    display_name?: string;
    nickname?: string;
    full_name?: string;
    phone_number?: string;
    contract_code?: string;
    member_user_id?: string;
    detail?: string;
    status_message?: string;
    picture_url?: string;
    raw_profile_data?: any;
    tier?: any;
    last_synced_at?: string;
    assist_status?: boolean;
    /* [FEAT-20260819-REGSOURCE] how this customer's account link was created:
       'admin' = an admin registered for them · 'system' = they did it themselves
       through the LIFF page · null/absent = registered before we recorded it,
       which is most existing customers and is NEVER backfilled.
       Not to be confused with `raw_profile_data…registered_at` from the site,
       which is when they signed up THERE. คนละอันกับ "สมัครเมื่อ" ของ shop-api. */
    /* DESTINATION 6 of 7 (a) — declared in BOTH this file and
       `ticketService.ts`. Nothing projects or whitelists members on the way out
       of the API, so a new column DOES arrive in the browser; this type is the
       only thing that decides whether the page can see it. Add it to both, or
       one page goes blind while the other works.
       ⚠️ No new column is expected here — a proposed `link_registered_support`
       was dropped 2026-08-21; new registration sources are new VALUES inside
       the existing field, which needs no change on this line at all.
       Chain starts at `omnidesk-api/src/modules/customer-link/registration-stamp.helper.ts`. */
    link_registered_by?: string | null;
    link_registered_at?: string | null;
  };
  hook_id?: string;
  assist_status?: boolean;
  note?: string | null;
  /* [FEAT-20260918-ROOMTRANS] Room translation settings.
     [FIX-20260918-LANGSPLIT] `translate_lang` = the TARGET the operator chose.
     `detected_source_lang` = what the customer writes in, as the vendor reported
     it. Two fields because they are two answers — read-only on this side, the BE
     is the one that writes it. */
  translate_lang?: string | null;
  detected_source_lang?: string | null;
  show_original_text?: boolean;
  /* [FEAT-20260919-SHOWORIGSRC] which side supplies the value above —
     `'all_rooms'` (the operator's account preference) or `'room'`.
     Declared at every layer it crosses; a layer that omits it drops it
     silently. Resolve the pair with `resolveShowOriginalText`. */
  show_original_text_source?: 'all_rooms' | 'room';
  auto_translate?: boolean;
  auto_send_translated?: boolean;
  hook_translate_lang?: string | null;
  hook_auto_translate?: boolean;
  effective_translate_lang?: string | null;
  effective_auto_translate?: boolean;
}

export interface ChatMessage {
  _id: string;
  sender_type: 'bot' | 'customer' | 'admin';
  // [FIX-20260728-VIDEO-PENDING] เพิ่ม 'video_pending' — LINE ยัง transcode
  // วิดีโอไม่เสร็จตอน webhook เข้ามา (BE ลองโหลดครั้งเดียว ไม่ retry ที่นั่น)
  // internal_content_id จะเป็น null สำหรับสถานะนี้เสมอ ดู ChatRoomView.tsx
  // (PendingVideoBubble) และ chatService.retryVideoDownload
  // revert: ลบ 'video_pending' ออกจาก union นี้
  message_type: 'text' | 'image' | 'flex' | 'divider' | 'inline_note' | 'sticker' | 'video' | 'video_pending';
  content: string;
  internal_content_id?: {
    _id: string;
    image_url: string;   // generic media url (image OR video file) — name is historical
    storage_type?: string;
    image_type?: string; // ext, e.g. "jpg" / "mp4"
    media_kind?: 'image' | 'video'; // explicit kind; absent on legacy rows (=image)
    file_size?: number;
    created_at?: string;
  } | null;
  // System messages carry their variant/author here (divider variant, note author).
  metadata?: {
    variant?: 'accept' | 'close' | 'assign' | 'bot' | string;
    actor_name?: string;
    author_name?: string;
    author_id?: string;
    assign_to?: string;
    is_internal?: boolean;
    packageId?: string;   // sticker
    stickerId?: string;   // sticker
    [k: string]: any;
  } | null;
  created_at: string;
  // [FEAT-20260821-QUOTEREPLY] LINE's id-space for quotes. `provider_msg_id` is
  // the message's own LINE id; `quoted_provider_msg_id` names the message THIS
  // one quoted (our quote-replies, or a customer quoting ours); `quote_token` is
  // LINE's handle for quoting THIS message — stored for the future, unused here.
  // All optional: a legacy row carries none and renders exactly as before.
  provider_msg_id?: string;
  quoted_provider_msg_id?: string;
  quote_token?: string;
  /* [FEAT-20260831-QUOTESRC] the quoted message itself, resolved by the BE for the
     page it returned. It exists because this list is TEN messages long: quoting
     anything older left the quote block with nothing on screen to match and it drew
     a neutral stand-in. Present only on bubbles that quote something the room still
     holds — absent otherwise, so a bubble that quotes nothing is byte-identical.
     `id` is OUR `_id`, i.e. the same id-space the jump uses. */
  quoted_preview?: {
    id: string;
    sender_type: string;
    message_type?: string;
    text: string;
    sender_name?: string;
  };
  /* [FEAT-20260908-AITRANSLATE] the same message in another language.
     ─────────────────────────────────────────────────────────────────────────
     🔴 THIS INTERFACE IS THE ONLY GATE. `listMessages` below passes the API
     response straight through — no `map`, no rebuild, no normalizer — and the
     BE reads with `.lean()` and no projection. So the column already ARRIVES in
     the browser; this declaration is the whole of what decides whether the page
     is allowed to see it. (The opposite of the `normalizeFlexMessage` trap: do
     not go hunting for a normalizer to widen, there is none.)

     ⚠️ There is NO twin declaration — `ChatMessage` is declared once, in this
     file (grepped 09/09, unlike `user_data` above, which is declared here AND
     in `ticketService.ts`). One edit is enough; if that ever stops being true,
     both must gain the field or one page goes blind while the other works.

     ⚠️ OPTIONAL, and absent on every message nobody translated — which is every
     row in the database today. A legacy row renders exactly as before; that is
     pinned by `test/chatBubbleCharacterization.dom.test.tsx`.

     `direction` is deliberately NOT a field: derive it — `lang === to` means
     translated after the fact (the customer's words), `lang === from` means
     translated before sending (the admin's). Carrying `from`/`to` costs the
     same bytes and the page never has to ask the audit log what happened. */
  translations?: Array<{
    /** language of `text` */
    lang: string;
    /** the translation */
    text: string;
    /** ┐ what the model was asked to do — rendered as "th → en" */
    from: string | null;
    /** ┘ */
    to: string;
  }>;
}

// ==== [FEAT-20260801-CHATSEARCH] ผลค้นหา + หน้าต่างรอบข้อความเป้าหมาย
// snippet ถูกตัดมาจาก BE แล้ว (รอบคำที่เจอ) — ฝั่งนี้ไม่ต้องตัดเอง
// และ BE ไม่ส่ง content เต็มกลับมา จึงไม่มีทางเผลอเรนเดอร์ข้อความยาวทั้ง 30 รายการ
export interface ChatSearchHit {
  _id: string;
  sender_type: string;
  created_at: string;
  snippet: string;
}
export interface ChatSearchResponse {
  data: ChatSearchHit[];
  scanned_from: string | null;
  /** true = ผลชนเพดาน ยังมีมากกว่านี้ — ต้องบอกผู้ใช้ ไม่ปล่อยให้เข้าใจว่าหมดแล้ว */
  truncated?: boolean;
  limits?: { days: number; max_scan: number };
  min_query?: number;
}
export interface ChatAroundResponse {
  data: ChatMessage[];
  anchor_id: string;
  /** ยังมีข้อความต่ออีกทิศไหน — ใช้ตัดสินว่าจะโชว์ปุ่มโหลดบน/ล่าง */
  has_newer: boolean;
  has_older: boolean;
}

export interface ChatRoomMessagesResponse {
  success: boolean;
  room: {
    id: string;
    line_user_id: string;
    /* [FIX-20260918-LANGSPLIT] target and detected source travel side by side. */
    translate_lang?: string | null;
    detected_source_lang?: string | null;
    show_original_text?: boolean;
    /* [FEAT-20260919-SHOWORIGSRC] which side supplies the value above —
       `'all_rooms'` (the operator's account preference) or `'room'`.
       Declared at every layer it crosses; a layer that omits it drops it
       silently. Resolve the pair with `resolveShowOriginalText`. */
    show_original_text_source?: 'all_rooms' | 'room';
    auto_translate?: boolean;
    auto_send_translated?: boolean;
    hook_translate_lang?: string | null;
    hook_auto_translate?: boolean;
    effective_translate_lang?: string | null;
    effective_auto_translate?: boolean;
    user_data: {
      id: string;
      display_name: string;
      nickname: string;
      picture_url: string;
    };
  };
  data: ChatMessage[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export const chatService = {
  // Full list (no pagination) — used by Contact / TicketSupport.
  listRooms: async (lineBotId?: string, userId?: string): Promise<ChatRoom[]> => {
    const params = new URLSearchParams();
    params.append('line_bot_id', lineBotId || 'all');
    if (userId) params.append('user_id', userId);
    const url = `${API_BASE_URL}/api/chat?${params.toString()}`;
    const res = await authFetch(url);
    const json = await handleApiResponse<{ success: boolean; data: ChatRoom[] }>(res, 'list chat rooms');
    return json.data;
  },

  // Paginated list — used by demo-chat (opt-in via page/limit).
  listRoomsPaged: async (
    lineBotId?: string,
    page = 1,
    limit = 40,
  ): Promise<{ data: ChatRoom[]; meta: { total: number; page: number; limit: number; pages: number } }> => {
    const params = new URLSearchParams();
    params.append('line_bot_id', lineBotId || 'all');
    params.append('page', String(page));
    params.append('limit', String(limit));
    const url = `${API_BASE_URL}/api/chat?${params.toString()}`;
    const res = await authFetch(url);
    const json = await handleApiResponse<{
      success: boolean;
      data: ChatRoom[];
      meta?: { total: number; page: number; limit: number; pages: number };
    }>(res, 'list chat rooms');
    const data = json.data || [];
    const meta = json.meta || { total: data.length, page, limit, pages: 1 };
    return { data, meta };
  },

  /* [FIX-20260902-BOTONESOURCE] REMOVED: `listAllRooms`, which paged this route
     until it had every room for an OA. It was written earlier the same day to get
     past the back end's silent 200-room ceiling, and it worked — but it was
     downloading hundreds of populated rooms so the browser could keep the handful
     with no case. The tickets route now answers WHICH rooms those are, with the
     same rule it uses to count them, so nothing needs the full list any more.
     Kept as a note rather than as unused code: a paging loop nobody calls is a
     thing the next reader has to understand before they can ignore it.
     To bring it back: page `listRoomsPaged` on `meta.pages`, sequentially, with a
     ceiling — and read this note first, because wanting every room is usually the
     sign that the filter belongs on the server. */

  // ==== [FEAT-20260731-CONTACTS] START — เส้นของหน้า Contacts
  // 🔒 งานสาย AUTO — to_dev_auto / to_prod_auto
  //
  // แยกจาก listRooms/listRoomsPaged เพราะ BE เป็นคนละเส้นกัน (`/api/chat/contacts`)
  // เส้นเดิมค้นหาด้วยชื่อ/เบอร์ไม่ได้ — มันใช้ .populate() ซึ่งเป็น query รอบสอง
  // ตอน match ห้องยังไม่รู้จัก field ของลูกค้าเลย · เส้นใหม่ใช้ aggregate + $lookup
  //
  // meta.group_member_total = จำนวนสมาชิกทั้งหมดในขอบเขตที่เลือก **ก่อน** ใช้คำค้น
  // (total หดตามคำค้น แต่ตัวเลขกลุ่มต้องนิ่ง ไม่งั้นผู้ใช้จะงงว่าคนหายไปไหน)
  //
  // revert: ลบเมธอดนี้ + ContactListResult ทิ้ง ไม่มีของเดิมอ้างถึง
  listContacts: async (params: {
    groupId?: string | null;
    hookId?: string | null;
    q?: string;
    tag?: string | null;
    /* [FEAT-20260823-CONTACTFOLLOW] 'deposit' | 'withdraw' | 'both' | 'none'.
       Anything else — including 'all' and undefined — is not sent, and the BE
       treats an unknown value as "no filter" too, so an old server and a new
       client cannot disagree. กรองที่ BE เพราะลิสต์แบ่งหน้าที่ BE */
    follow?: string | null;
    page?: number;
    limit?: number;
  } = {}): Promise<ContactListResult> => {
    const { groupId, hookId, q, tag, follow, page = 1, limit = 20 } = params;
    const qs = new URLSearchParams();
    if (groupId) qs.append('group_id', groupId);
    if (hookId && hookId !== 'all') qs.append('hook_id', hookId);
    if (q && q.trim()) qs.append('q', q.trim());
    if (tag && tag.trim()) qs.append('tag', tag.trim());
    if (follow && follow !== 'all') qs.append('follow', follow);
    qs.append('page', String(page));
    qs.append('limit', String(limit));
    const url = `${API_BASE_URL}/api/chat/contacts?${qs.toString()}`;
    const res = await authFetch(url);
    const json = await handleApiResponse<{
      success: boolean;
      data: ChatRoom[];
      meta?: ContactListResult['meta'];
    }>(res, 'list contacts');
    const data = json.data || [];
    // BE ส่ง meta มาเสมอ — fallback ไว้กันหน้าเว็บพังถ้าเส้นเก่ายังไม่ได้ deploy
    const meta = json.meta || {
      total: data.length, page, limit, pages: 1, group_member_total: data.length,
    };
    return { data, meta };
  },
  // ==== [FEAT-20260731-CONTACTS] END

  /* [FEAT-20260814-PROFILESYNC] one-click LINE profile re-sync (Contact header)
   * BE endpoint already existed: `POST /api/chat/user/sync-profile` calls LINE
   * getProfile and updates the member's display_name / picture_url / nickname /
   * last_synced_at (chat.service.ts:800-885) — zero BE change for this feature.
   * Returns the fresh member fields so the caller can merge them into its rows.
   * revert: ลบเมธอดนี้ + SyncedProfileData ด้านล่าง (marker เดียวกัน) */
  syncUserProfile: async (params: { hookId: string; lineUserId: string }): Promise<{
    success: boolean;
    message?: string;
    data?: SyncedProfileData;
  }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/user/sync-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_id: params.hookId, line_user_id: params.lineUserId }),
    });
    return handleApiResponse(res, 'sync user profile');
  },

  listMessages: async (id: string, page = 1, limit = 10, hookId?: string): Promise<ChatRoomMessagesResponse> => {
    const params = new URLSearchParams();
    params.append('page', String(page));
    params.append('limit', String(limit));
    if (hookId) {
      params.append('hook_id', hookId);
    }
    const res = await authFetch(`${API_BASE_URL}/api/chat/${id}/messages?${params.toString()}`);
    return handleApiResponse<ChatRoomMessagesResponse>(res, 'list chat messages');
  },

  // ==== [FEAT-20260801-CHATSEARCH] START — ค้นหาข้อความในห้อง + กระโดดไปตำแหน่ง
  // เขียนตามแบบ listMessages ด้านบนเป๊ะ (URLSearchParams + authFetch + handleApiResponse)
  // ไม่ได้แตะ listMessages เดิมเลย — 2 ตัวนี้เป็นเส้นเพิ่ม เปิดห้องปกติไม่เรียกทั้งคู่
  // revert: ลบ 2 ฟังก์ชันนี้ + จุดเรียกใน ChatRoomView

  /** ค้นหาข้อความในห้อง — BE จำกัด 7 วัน / 1000 ข้อความ / เฉพาะ text ให้แล้ว */
  searchMessages: async (id: string, q: string, hookId?: string): Promise<ChatSearchResponse> => {
    const params = new URLSearchParams();
    params.append('q', q);
    if (hookId) params.append('hook_id', hookId);
    const res = await authFetch(`${API_BASE_URL}/api/chat/${id}/messages/search?${params.toString()}`);
    return handleApiResponse<ChatSearchResponse>(res, 'search chat messages');
  },

  /** หน้าต่างรอบข้อความเป้าหมาย — ใช้แทนการกด "โหลดเพิ่ม" ซ้ำ ๆ จนถึงตำแหน่ง */
  // [FEAT-20260821-QUOTEJUMP] `by: 'provider'` anchors on LINE's message id —
  // what a quote block holds when the quoted message is outside the loaded window.
  // Default unchanged; `anchor_id` in the response is always OUR _id.
  listMessagesAround: async (id: string, messageId: string, hookId?: string, by: 'id' | 'provider' = 'id'): Promise<ChatAroundResponse> => {
    const params = new URLSearchParams();
    if (hookId) params.append('hook_id', hookId);
    if (by === 'provider') params.append('by', 'provider');
    const qs = params.toString();
    const res = await authFetch(`${API_BASE_URL}/api/chat/${id}/messages/around/${messageId}${qs ? `?${qs}` : ''}`);
    return handleApiResponse<ChatAroundResponse>(res, 'load messages around');
  },
  // ==== [FEAT-20260801-CHATSEARCH] END

  // [FIX-20260728-VIDEO-PENDING] START — ฟังก์ชันนี้เพิ่มใหม่ (เดิมไม่มี)
  // แอดมินกดปุ่ม "โหลดวิดีโอ" สำหรับข้อความ message_type 'video_pending'
  // สำเร็จ → BE เขียนทับ "ข้อความเดิม" (message_type: 'video' + internal_content_id)
  // ไม่สร้างข้อความใหม่ — caller (ChatRoomView) รับ data กลับมา patch เข้า state ตรงจุด
  // ล้มเหลว → success:false, message error, ไม่แก้ข้อความ — กดปุ่มใหม่ได้ไม่จำกัด
  // revert: ลบฟังก์ชันนี้ทิ้ง
  retryVideoDownload: async (messageId: string): Promise<{
    success: boolean;
    message?: string;
    data?: { _id: string; message_type: 'video'; internal_content_id: NonNullable<ChatMessage['internal_content_id']> };
  }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/message/${messageId}/retry-video`, {
      method: 'POST',
    });
    return handleApiResponse(res, 'retry video download');
  },
  // [FIX-20260728-VIDEO-PENDING] END

  // Add an internal admin note into the chat stream (message_type: inline_note).
  // Never sent to the customer. `id` = room _id or line_user_id (+ hookId then).
  createInlineNote: async (id: string, content: string, hookId?: string): Promise<{ success: boolean; data: ChatMessage }> => {
    const qs = hookId ? `?hook_id=${encodeURIComponent(hookId)}` : '';
    const res = await authFetch(`${API_BASE_URL}/api/chat/${id}/inline-note${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return handleApiResponse<{ success: boolean; data: ChatMessage }>(res, 'create inline note');
  },

  // [FEAT-20260918-ROOMTRANS] Get room translation settings
  getRoomTranslateSettings: async (id: string): Promise<{ success: boolean; data: any }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/${id}/translate-settings`, {
      method: 'GET',
    });
    return handleApiResponse(res, 'get room translate settings');
  },

  // [FEAT-20260918-ROOMTRANS] Update room translation settings
  updateRoomTranslateSettings: async (
    id: string,
    data: {
      translate_lang?: string | null;
      show_original_text?: boolean;
      /* [FEAT-20260919-SHOWORIGSRC] which side supplies the value above —
         `'all_rooms'` (the operator's account preference) or `'room'`.
         Declared at every layer it crosses; a layer that omits it drops it
         silently. Resolve the pair with `resolveShowOriginalText`. */
      show_original_text_source?: 'all_rooms' | 'room';
      auto_translate?: boolean;
      auto_send_translated?: boolean;
    },
  ): Promise<{ success: boolean; data: any }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/${id}/translate-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleApiResponse(res, 'update room translate settings');
  },

  // Reply TO the customer (pushes to LINE + logs an outgoing bubble).
  // `id` = room _id or line_user_id (+ hookId then).
  //
  // [FIX-20260728-SENDERR] หมายเหตุสำคัญ — ชื่อ "reply" แต่จริง ๆ คือ PUSH:
  // เส้นทางเต็ม FE → BE → LINE
  //   chatService.sendReply()
  //     → POST {API}/api/chat/:id/reply            (ชื่อ endpoint ฝั่งเรา)
  //     → BE chatRoomController.sendChatReply
  //     → channels/lineSendAdapter.send()
  //     → POST https://api.line.me/v2/bot/message/push   ← LINE PUSH API
  //
  // ทำไมไม่ใช่ LINE Reply API: Reply ต้องใช้ `replyToken` ที่ผูกกับข้อความที่
  // ลูกค้าเพิ่งส่งเข้ามา มีอายุสั้นและใช้ได้ครั้งเดียว — แต่แอดมินตอบเมื่อไหร่ก็ได้
  // (อาจหลายชั่วโมงหลังลูกค้าทัก) จึงต้องใช้ Push ที่ยิงหา user id ได้ตลอดเวลา
  // ผลที่ตามมา: การส่งนี้กินโควตา Push ของ OA และถ้า LINE ล่มจะได้ HTTP 500
  // พร้อม x-line-request-id กลับมา (BE ส่งต่อมาใน field `error` ให้ FE โชว์)
  //
  // [FIX-20260728-PUSHNAME] เปลี่ยน path ให้ตรงความจริงแล้ว
  //   เดิม: `${API_BASE_URL}/api/chat/${id}/reply${qs}`
  //   ใหม่: `${API_BASE_URL}/api/chat/${id}/push${qs}`
  // BE ยังรับ path เดิมอยู่ (ชี้ controller ตัวเดียวกัน) จึง deploy ไม่พร้อมกันก็ไม่พัง
  // ชื่อ "เมธอด" ยังเป็น sendReply เหมือนเดิม — ไม่เปลี่ยนเพราะมองจากมุมแอดมิน
  // = "ตอบลูกค้า" และเปลี่ยนแล้ว diff บานโดยไม่ได้ประโยชน์เพิ่ม
  // revert: เปลี่ยน path กลับเป็น /reply (BE ยังรับอยู่ ไม่ต้องแก้ฝั่ง BE)
  // [FEAT-20260821-QUOTEREPLY] `quoteOf` = the chat_messages `_id` the operator
  // pressed Reply on (useReplyDraft's target). Sent as `quote_of` ONLY when
  // present, so a plain send posts the exact body it always did. The BE turns
  // it into LINE's quoteToken and decides reply-vs-push itself; the response
  // already carries `quoted_provider_msg_id`, so the appended bubble shows
  // its quote without a reload. revert: drop the param and the spread.
  // [FEAT-20260908-AITRANSLATE] `original` = the admin typed something, had it
  // translated in the composer, and is sending the TRANSLATION. `text` is what
  // LINE delivers and what lands in `content`; the original rides along so the
  // BE can store both in the SAME single insert, in the same column the read
  // side uses. Absent on every send nobody translated ⇒ the body is byte-for-byte
  // the one it has always posted, which `chatSendQuoteOf.value.test.ts` pins.
  //
  // 🔴 THE OUTBOUND FIELD-LIST TRAP, AND WHY THESE TWO LINES ARE THE WHOLE POINT
  // (dev-local §14, and the notice-checkbox bug of 23/08 that this repo already
  // shipped once): a field the BE DTO accepts means NOTHING unless the function
  // that BUILDS the body actually puts it in. If the spread below is dropped,
  // the send still succeeds, the customer still receives the translation, and
  // the original is silently lost — no error, no log, nothing red. `pickNotice()`
  // failed in exactly this shape and every test stayed green.
  // ⇒ `test/chatSendOriginal.value.test.ts` asserts the BODY, not the signature.
  //   เพิ่มใน type อย่างเดียว = ไม่มีอะไรถูกส่งจริง.
  //
  // ⚠️ Guarded on `original_text` alone, not on both fields. `original_lang` is
  //    genuinely unknown to this side much of the time — the admin never states
  //    a source language (owner, 09/09) — so requiring it would throw away the
  //    original whenever the BE had not detected one. The text is the thing
  //    worth keeping; the label is optional and stays optional.
  // revert: drop the `original` param and the spread; the body returns to
  //   `{ text, quote_of? }` and the BE simply receives nothing new.
  sendReply: async (
    id: string,
    text: string,
    hookId?: string,
    quoteOf?: string | null,
    original?: {
      original_text?: string;
      original_lang?: string | null;
      /* [FEAT-20260910-OUTBOUNDTARGET] the language the customer receives — the
         one the admin picked. See the spread below for why it is guarded
         separately from the text. */
      translated_lang?: string | null;
    },
  ): Promise<{ success: boolean; data: ChatMessage }> => {
    const qs = hookId ? `?hook_id=${encodeURIComponent(hookId)}` : '';
    const res = await authFetch(`${API_BASE_URL}/api/chat/${id}/push${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        ...(quoteOf ? { quote_of: quoteOf } : {}),
        ...(original?.original_text ? { original_text: original.original_text } : {}),
        ...(original?.original_lang ? { original_lang: original.original_lang } : {}),
        /* [FEAT-20260910-OUTBOUNDTARGET] guarded on ITSELF, like the two above:
           each of the three is separately knowable, and a send that knows two of
           them must not lose them because it lacks the third. */
        ...(original?.translated_lang ? { translated_lang: original.translated_lang } : {}),
      }),
    });
    return handleApiResponse<{ success: boolean; data: ChatMessage }>(res, 'send chat reply');
  },

  // Send 1-5 images (+ optional caption text) to the customer in one request.
  // [FEAT-20260816-MULTIIMG] field `images` (repeated) — the BE merges it with
  // the legacy single `image` field, so this must deploy AFTER the BE half.
  // The BE batches the LINE push itself (≤5 objects per call, owner's overflow
  // split); the FE only hands the files over in order.
  // revert: restore the single-File `sendImage` (field `image`) + its caller.
  sendImages: async (id: string, files: File[], text?: string, hookId?: string): Promise<{ success: boolean; data: ChatMessage }> => {
    const qs = hookId ? `?hook_id=${encodeURIComponent(hookId)}` : '';
    const form = new FormData();
    for (const f of files) form.append('images', f);
    if (text) form.append('text', text);
    // [FIX-20260728-PUSHNAME] เดิม: `.../api/chat/${id}/send-image${qs}`
    // เส้นนี้ก็ยิง LINE Push API เหมือน sendReply — เปลี่ยนชื่อให้เข้าชุดกัน
    // BE ยังรับ /send-image อยู่ · revert: เปลี่ยน path กลับเป็น /send-image
    const res = await authFetch(`${API_BASE_URL}/api/chat/${id}/push-image${qs}`, { method: 'POST', body: form });
    return handleApiResponse<{ success: boolean; data: ChatMessage }>(res, 'send chat image');
  },

  // Send a LINE sticker to the customer.
  sendSticker: async (id: string, packageId: string, stickerId: string, hookId?: string): Promise<{ success: boolean; data: ChatMessage }> => {
    const qs = hookId ? `?hook_id=${encodeURIComponent(hookId)}` : '';
    // [FIX-20260728-PUSHNAME] เดิม: `.../api/chat/${id}/send-sticker${qs}`
    // BE ยังรับ /send-sticker อยู่ · revert: เปลี่ยน path กลับเป็น /send-sticker
    const res = await authFetch(`${API_BASE_URL}/api/chat/${id}/push-sticker${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId, stickerId }),
    });
    return handleApiResponse<{ success: boolean; data: ChatMessage }>(res, 'send chat sticker');
  },

  syncProfile: async (lineUserId: string, hookId?: string): Promise<{ success: boolean; data: any }> => {
    // The user provided port 3000 in the curl, but usually it should be the same as API_BASE_URL.
    // However, I'll follow the user's curl if it differs, or use API_BASE_URL if it's more standard.
    // Given the curl says http://localhost:3000/api/chat/user/sync-profile, I'll try to determine if port 3000 is intended.
    // If API_BASE_URL is localhost:10000, maybe 3000 is the main dashboard backend?
    // Let's use a relative path or a configurable base.
    const res = await authFetch(`${API_BASE_URL}/api/chat/user/sync-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_user_id: lineUserId, hook_id: hookId })
    });
    return handleApiResponse<{ success: boolean; data: any }>(res, 'sync user profile');
  },

  updateAssistStatus: async (roomId: string, status: boolean): Promise<{ success: boolean; data: any }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/user/${roomId}/assist/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assist_status: status })
    });
    return handleApiResponse<{ success: boolean; data: any }>(res, 'update assist status');
  },

  getImageByTag: async (tag: string): Promise<any> => {
    const res = await authFetch(`${API_BASE_URL}/api/image-storage?matching_tag=${tag}`);
    const json = await handleApiResponse<any>(res, 'get image by tag');
    return json;
  },

  patchNote: async (roomId: string, note: string | null): Promise<{ success: boolean; data: any }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/${roomId}/note`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note })
    });
    return handleApiResponse<{ success: boolean; data: any }>(res, 'update chat room note');
  },

  // ── Customer notes (1:many, keyed on the customer/Member) ──────────────
  listNotes: async (roomId: string): Promise<{ success: boolean; data: CustomerNote[] }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/${roomId}/notes?limit=all`);
    return handleApiResponse<{ success: boolean; data: CustomerNote[] }>(res, 'list customer notes');
  },

  createNote: async (roomId: string, content: string): Promise<{ success: boolean; data: CustomerNote }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/${roomId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    return handleApiResponse<{ success: boolean; data: CustomerNote }>(res, 'create customer note');
  },

  updateNote: async (noteId: string, content: string): Promise<{ success: boolean; data: CustomerNote }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    return handleApiResponse<{ success: boolean; data: CustomerNote }>(res, 'update customer note');
  },

  // Soft delete — returns the tombstoned note (content replaced, deleted_at set).
  deleteNote: async (noteId: string): Promise<{ success: boolean; data: CustomerNote }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/notes/${noteId}`, { method: 'DELETE' });
    return handleApiResponse<{ success: boolean; data: CustomerNote }>(res, 'delete customer note');
  },

  // ── Customer tags (1:many, keyed on the customer/Member) ───────────────
  listTags: async (roomId: string): Promise<{ success: boolean; data: CustomerTag[] }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/${roomId}/tags`);
    return handleApiResponse<{ success: boolean; data: CustomerTag[] }>(res, 'list customer tags');
  },

  createTag: async (roomId: string, label: string, color?: string | null): Promise<{ success: boolean; data: CustomerTag }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/${roomId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, color })
    });
    return handleApiResponse<{ success: boolean; data: CustomerTag }>(res, 'create customer tag');
  },

  deleteTag: async (tagId: string): Promise<{ success: boolean }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/tags/${tagId}`, { method: 'DELETE' });
    return handleApiResponse<{ success: boolean }>(res, 'delete customer tag');
  },

  // Global (all-admin) most-used tag labels for the picker preview.
  popularTags: async (limit = 10): Promise<{ success: boolean; data: PopularTag[] }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/tags/popular?limit=${limit}`);
    return handleApiResponse<{ success: boolean; data: PopularTag[] }>(res, 'popular tags');
  },

  // Autocomplete existing labels as the admin types.
  suggestTags: async (q: string): Promise<{ success: boolean; data: PopularTag[] }> => {
    const res = await authFetch(`${API_BASE_URL}/api/chat/tags/suggest?q=${encodeURIComponent(q)}`);
    return handleApiResponse<{ success: boolean; data: PopularTag[] }>(res, 'suggest tags');
  }
};

// [FEAT-20260731-CONTACTS] ผลลัพธ์ของเส้น /api/chat/contacts
// group_member_total นับ "ทั้งกลุ่ม" ไม่หดตามคำค้น — คนละตัวกับ total
// revert: ลบ interface นี้ + เมธอด listContacts
export interface ContactListResult {
  data: ChatRoom[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
    group_member_total: number;
  };
}

/* [FEAT-20260814-PROFILESYNC] fresh member fields returned by
 * POST /api/chat/user/sync-profile — exactly what BE hands back
 * (chat.service.ts:872-884). Merge target: `room.user_data` (drop `id`;
 * the row already carries its own `_id`). revert: same marker. */
export interface SyncedProfileData {
  id?: string;
  line_user_id: string;
  display_name?: string;
  nickname?: string;
  picture_url?: string;
  status_message?: string;
  last_synced_at?: string;
}

// [FEAT-20260801-TAGGROUP] ป้ายมีตัวตนจริงแล้ว (ตาราง tags ฝั่ง BE)
// `_id` = id ของ "นิยามป้าย" — ใช้เป็นค่าของตัวกรอง เพราะชื่อป้ายซ้ำข้ามกลุ่มได้
// BE กรองรายการนี้ตามกลุ่มของคนเรียกให้แล้ว (อ่านจาก User.groups)
export interface PopularTag { _id: string; label: string; color: string | null; use_count: number }

export interface CustomerTag {
  _id: string;          // id ของ "แถวเชื่อม" (ลูกค้าคนนี้ ↔ ป้ายใบนี้) — ใช้ตอนลบ
  member_id: string;
  // [FEAT-20260801-TAGGROUP] id ของนิยามป้าย — ใช้เทียบตอนกรอง (ไม่ใช้ชื่อแล้ว)
  tag_id: string;
  label: string;
  color: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface CustomerNote {
  _id: string;
  member_id: string;
  chat_room_id: string | null;
  hook_id: string | null;
  content: string;
  created_by: string | null;
  created_by_name: string | null;
  created_by_data?: { _id: string; username: string; display_name: string } | null;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;         // soft delete: set → the note is a tombstone
  deleted_by_name?: string | null;
}
