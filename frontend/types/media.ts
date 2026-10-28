// [REFACTOR-20260808-TYPESPLIT] Content-asset domain: object images, image storage, flex messages.
import type { MessageType, Pagination } from './common';
import type { GroupEntry } from './user';

export interface ObjectCategory {
  id: string;
  // [FIX-20260801-HOOKTYPES] BE ส่งมาทั้ง id และ _id แล้วแต่ endpoint
  // โค้ดอ่านทั้งสองแบบอยู่แล้ว (`x.id || x._id`) · type แค่ไม่เคยพูดถึง
  _id?: string;
  name: string;
  api_key?: string;
  /* [FEAT-20260901-OBJSCOPE] Who may use this category. BE returns ids, and
     absent or [] both mean unrestricted — do NOT render an empty list as
     "nobody". */
  group_providers?: GroupEntry[] | string[];
  hook_ids?: string[];
  /** Absent counts as ON: rows saved before this field carry no key. */
  status?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ObjectCategoryFormData {
  name: string;
  api_key?: string;
  // [FEAT-20260901-OBJSCOPE] Sent as plain id arrays, like the album form.
  group_providers?: string[];
  hook_ids?: string[];
  status?: boolean;
}

export interface ObjectImage {
  id: string;
  // [FIX-20260801-HOOKTYPES] BE ส่งรูปย่อรูปแรกมาให้ในลิสต์ (หน้า ObjectImageList ใช้)
  first_thumb?: string | null;
  _id?: string;
  detail?: string;
  matching_tag?: string[];
  response_type?: MessageType;
  img_path: string;
  storage: 'local' | 'external' | 's3' | 'google_drive';
  file_type?: string;
  categories: ObjectCategory[];
  group_providers: GroupEntry[];
  // [FEAT-20260901-OBJSCOPE] Not populated by BE — ids, for ticking boxes.
  hook_ids?: string[];
  /** Absent counts as ON. */
  status?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ObjectImageFormData {
  image_id?: string;
  detail?: string;
  matching_tag?: string[];
  response_type?: MessageType;
  img_path: string;
  storage: 'local' | 'external' | 's3' | 'google_drive';
  categories: string[];
  group_providers: string[];
  // [FEAT-20260901-OBJSCOPE]
  hook_ids?: string[];
  status?: boolean;
}

export type ObjectCategoryListResponse = ObjectCategory[];
export type ObjectImageListResponse = ObjectImage[];

export interface ImageStorage {
  id: string;
  // [FIX-20260801-HOOKTYPES] ลำดับการแสดงผลของรูปในชุด (ฟอร์มอ่าน/เขียนอยู่แล้ว)
  priority?: number;
  _id?: string;
  object_image_id: string;
  image_url: string;
  origin_path: string | null;
  src_id: string | null;
  storage_type: string;
  image_type: string;
  /**
   * [FEAT-20260904-OBJVIDEO] What this stored file actually is.
   *
   * 🔴 OPTIONAL BECAUSE LEGACY ROWS DO NOT CARRY IT, and absent means IMAGE —
   * the same reading `ChatRoomView.tsx` already uses for chat media. The BE
   * schema says outright that the point of the column is so the UI "never
   * guesses from the extension", so nothing here may fall back to parsing
   * `image_type`.
   *
   * ⚠️ It was missing from this interface while the BE had written it since
   * 25/08 — a column the server sends and the client cannot see is the shape
   * that makes a feature look broken with nothing to grep for.
   */
  media_kind?: 'image' | 'video';
  /**
   * [FEAT-20260904-UPLOADEDBY] WHO uploaded it, as a display name.
   *
   * The server resolves this from `created_by` (an id it has always stored) when
   * the row is read — nothing new is stored and **no id is ever sent**, so there
   * is no id to render here even by accident.
   *
   * ⚠️ `null`/absent is normal, not an error: a legacy row with no uploader, or
   * one whose account has since been deleted. The screen shows a dash.
   */
  created_by_name?: string | null;
  file_size: number;
  detail_link?: string;
  detail_text?: string;
  created_at: string;
  updated_at: string;
}

export interface ImageStorageListResponse {
  data: ImageStorage[];
}

export interface FlexMessageEntry {
  id: string;
  name: string;
  /** [FEAT-20260829-FLEXMENUTYPE] null on every card that is not a menu. */
  flex_sub_type?: string | null;
  /** [FEAT-20260829-FLEXMENUSLUG] optional free text; null when not set. */
  flex_slug?: string | null;
  group_ids: string[];
  content_json: any;
  // [FEAT-20260801-FLEXTYPE] normal | slip | profile · ไม่มี = slip (ของเก่า)
  // [FEAT-20260802-FLEXCUSTOMER] + custom (ป้ายบนจอ = ปรับแต่ง)
  flex_type?: string;
  source_role?: string | null;  // [FEAT-20260802-FLEXSRC] เดิม: แหล่งเดียว (คงไว้เพื่อ backward-compat)
  source_roles?: string[];      // [FEAT-20260802-FLEXNS] ใหม่: เลือกได้หลายแหล่ง (ว่าง = profile)
  // [FEAT-20260802-FLEXTAG] tag อ้างอิงของการ์ด (flex_m00001) · มีเฉพาะประเภท profile
  // ⚠️ อ่านอย่างเดียว — BE เป็นคน gen ให้ ฟอร์มไม่ได้ส่งค่านี้ขึ้นไป
  flex_tag?: string | null;
  /* [FEAT-20260810-CARDTICKET] OPT-IN, per card: once THIS card's reply has been
     delivered, open a direct ticket carrying `direct_ticket_text` as the reason an
     admin reads on the chat divider. Absent/false ⇒ nothing happens.
     ⚠️ Only meaningful on a card bound through a payment reply state
     (Hook → External tab). A Swiftcheck card is sent by another path that never
     reaches this code, so the flag there would do nothing. */
  direct_ticket_on_reply?: boolean;
  direct_ticket_text?: string;
  callback_detail?: string;
  callback_tag?: string;
  created_at: string;
  updated_at: string;
}

export interface FlexMessageFormData {
  /** [FEAT-20260829-FLEXMENUTYPE] `main`/`sub`; '' = none. Menu cards only —
      the server forces null for every other type. */
  flex_sub_type?: string;
  /** [FEAT-20260829-FLEXMENUSLUG] optional free text; '' = not set. Menu only. */
  flex_slug?: string;
  name: string;
  content_json: any;
  group_ids: string[];
  // [FEAT-20260801-FLEXTYPE] normal | slip | profile · ไม่มี = slip (ของเก่า)
  // [FEAT-20260802-FLEXCUSTOMER] + custom (ป้ายบนจอ = ปรับแต่ง)
  flex_type?: string;
  source_role?: string | null;  // [FEAT-20260802-FLEXSRC] เดิม: แหล่งเดียว (คงไว้เพื่อ backward-compat)
  source_roles?: string[];      // [FEAT-20260802-FLEXNS] ใหม่: เลือกได้หลายแหล่ง (ว่าง = profile)
  /* [FEAT-20260810-CARDTICKET] OPT-IN, per card: once THIS card's reply has been
     delivered, open a direct ticket carrying `direct_ticket_text` as the reason an
     admin reads on the chat divider. Absent/false ⇒ nothing happens.
     ⚠️ Only meaningful on a card bound through a payment reply state
     (Hook → External tab). A Swiftcheck card is sent by another path that never
     reaches this code, so the flag there would do nothing. */
  direct_ticket_on_reply?: boolean;
  direct_ticket_text?: string;
  callback_detail?: string;
  callback_tag?: string;
  // [FEAT-20260806-FLEXGRANTALL] transient (ไม่เก็บใน flex): true = auto ติ๊ก card นี้ให้ทุก hook
  // ในกลุ่มของ flex (custom → flex_custom_ids · profile-semi-custom → flex_profile_custom_ids).
  grant_all_hooks?: boolean;
}

// [FEAT-20260802-FLEXVARAPI] 1 แถวในตาราง Template Guidelines · BE เป็นคนสร้าง
// tag มีวงเล็บครบมาแล้ว เช่น "{{phone}}" · example = ผลลัพธ์จริงจากบัญชีตัวอย่าง
export interface FlexVarGuidelineRow {
  tag: string;
  desc: string;
  source: string;
  example: string;
}

export interface FlexMessageListResponse {
  data: FlexMessageEntry[];
  pagination: Pagination;
}
