import React, { useEffect, useRef, useState } from 'react';
import { Save, Loader2, AlertCircle, X, CheckSquare, Square, ChevronDown, ChevronUp, Info, HelpCircle, Copy, Check, FileJson, Play, Pipette, Palette, Search, Lock, Tag as TagIcon } from 'lucide-react';
import { FlexMessageEntry, FlexMessageFormData, FlexVarGuidelineRow, GroupEntry } from '../../types';
import { useI18n } from '../../i18n';
import { ConfirmModal } from '../modals';
import { DoubleConfirmModal } from '../modals';
import { AlertModal } from '../modals';
import { FlexPreviewModal } from './FlexPreviewModal';
// [FEAT-20260810-PAYSTATEFLEX] slip tag tables (data + payment actions) — data
// only, and the same rows that build the save-time allowlist below.
import { buildSlipGuidelines } from '../../config/flexSlipGuidelines';
import { groupService } from '../../services/admin';
// [FEAT-20260802-FLEXVARAPI] ตารางตัวแปรมาจาก BE แล้ว
import { flexMessageService } from '../../services/media';
import { copyText } from '../../utils/copyText';
// [FEAT-20260905-MEDIAPICKER] Standalone, central media picker button and docked side-panel
import {
  AttachMediaButton,
  DockedMediaPicker,
  MediaPickerModal,
  useMediaPickerDock,
} from '../media-picker';

interface FlexMessageFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: FlexMessageFormData) => Promise<void>;
  initialData?: FlexMessageEntry;
  mode?: 'create' | 'update' | 'view';
  /**
   * [FEAT-20260829-FLEXMENUTYPE] บังคับประเภทตอนสร้าง — ตัวเลือกประเภทจะถูกซ่อน
   * ไม่ส่ง = พฤติกรรมเดิมทุกประการ (เลือกเองได้) แต่ลิสต์จะไม่มี 'menu'
   * ให้เลือก เพราะการ์ดเมนูมีปุ่มเข้าของตัวเอง
   */
  lockedFlexType?: string;
}

// ==== [FEAT-20260801-FLEXTYPE] START — ประเภทของ flex message
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// ผู้ใช้สั่ง "เพิ่ม type ให้เลือก ทั่วไป/สลิป/profile · seamless ไม่กระทบตัวเดิม"
//
// ⚠️ ค่าเริ่มต้น = 'slip' ไม่ใช่ 'normal' (ผู้ใช้เลือกเอง): flex ทั้งระบบตอนนี้เป็น
//    ของสลิปหมด ถ้าตั้งต้นเป็น normal คนสร้าง flex สลิปจะโดน validate ตีกลับทันที
//    เพราะตัวแปรสลิปจะหลุดจาก allowlist · record เก่าไม่มี field นี้ → ตีเป็น slip เช่นกัน
// revert: ลบ FLEX_TYPES / FLEX_TYPE_DEFAULT / PROFILE_GUIDELINES + UI + flex_type ทุกจุด
const FLEX_TYPE_DEFAULT = 'slip';
// [FEAT-20260802-FLEXCUSTOMER] เพิ่ม "ปรับแต่ง" (custom) เป็นตัวที่ 4
//   ใช้ชุดตัวแปรลูกค้าชุดเดียวกับโปรไฟล์ ต่างกันแค่ป้ายให้แอดมินแยกใบออก
//   ⚠️ ต่อท้ายเท่านั้น ห้ามสลับลำดับ/ตัดตัวเดิม — ค่าที่อยู่ใน DB แล้วต้องยังผ่าน normalize
export const FLEX_TYPES: { value: string; label: string; desc: string }[] = [
  // [FEAT-20260802-FLEXTYPELABEL] label = "ไทย (value จริง eng)" ทุกตัว → กระจายไป column/filter/selector
  { value: 'normal', label: 'ทั่วไป (normal)', desc: 'ข้อความทั่วไป ใช้ตัวแปรข้อมูลลูกค้าได้ทั้งชุด' },
  { value: 'slip', label: 'สลิป (slip)', desc: 'การ์ดผลตรวจสลิป ใช้ตัวแปรจากสลิปได้ทั้งหมด' },
  { value: 'profile', label: 'โปรไฟล์ (profile)', desc: 'การ์ดข้อมูลลูกค้า ใช้ตัวแปรข้อมูลลูกค้าได้ทั้งชุด' },
  { value: 'custom', label: 'ปรับแต่ง (custom)', desc: 'การ์ดที่ปรับแต่งเอง ใช้ตัวแปรข้อมูลลูกค้าได้ทั้งชุด' },
  // [FEAT-20260802-FLEXTYPE2] เพิ่ม 2 ประเภทตามที่ผู้ใช้สั่ง
  { value: 'profile-semi-custom', label: 'โปรไฟล์ กึ่งปรับแต่ง (profile-semi-custom)', desc: 'โปรไฟล์แบบปรับแต่งได้บางส่วน ใช้ตัวแปรข้อมูลลูกค้าได้ทั้งชุด' },
  { value: 'template_message', label: 'ข้อความ (template_message)', desc: 'ข้อความสำเร็จรูป' },
  /* [FEAT-20260829-FLEXMENUTYPE] การ์ดของระบบเมนู `[[[menu-*]]]`
     ⚠️ ค่านี้ต้องมีใน FLEX_TYPES ฝั่ง BE ด้วย ไม่งั้น normalizeFlexType จะบังคับเป็น
     'slip' เงียบ ๆ — แอดมินเลือก "เมนู" แล้วได้การ์ดสลิป โดยไม่มี error ให้ใครเห็น
     ⚠️ ไม่มี var guide ปกติ (อยู่ใน FLEX_TYPES_NO_GUIDELINES ข้างล่าง) — สิ่งที่คน
     วาดการ์ดต้องรู้คือ payload postback ไม่ใช่ตัวแปรโปรไฟล์ */
  { value: 'menu', label: 'เมนู (menu)', desc: 'การ์ดของระบบเมนู — ปุ่มใช้ postback ที่ระบบกำหนด ไม่ใช้ตัวแปรโปรไฟล์' },
  // [FEAT-20260810-CUSHELPERTYPE] การ์ดที่ตอบตอน AI ขึ้น tag [[[customer-helper]]]
  //   ใช้ตัวแปร {{cus_land_url}} (ลิงก์เชื่อมต่อข้อมูลที่ mint ให้ลูกค้าคนนั้น) ได้
  //   เฉพาะชนิดนี้ — ชนิดอื่นพิมพ์ tag นี้จะถูกตีกลับตอนเซฟ (ตาราง = allowlist)
  //   ผูกกับ OA ที่หน้า hook ผ่าน flex_customerhelper_id
  //   revert: ลบบรรทัดนี้ + ลบ 'customerhelper' ออกจาก FLEX_TYPES ฝั่ง BE
  { value: 'customerhelper', label: 'ผู้ช่วยลูกค้า (customerhelper)', desc: 'การ์ดขออนุญาตเชื่อมต่อข้อมูล ใช้ {{cus_land_url}} + ตัวแปร site rule/hook ได้' },
];
// [FEAT-20260802-FLEXTYPEHIDE] ซ่อน "ทั่วไป"(normal) ไว้ก่อน
//   ใช้กับ "ตัวเลือกตอนสร้าง/แก้ไข" + "filter หน้า list"
//   ⚠️ ยังคงอยู่ใน FLEX_TYPES เต็ม (normalize + ป้าย column) เพื่อการ์ดเก่าชนิดนี้ยังแสดง/กรองถูก
//   revert: ลบ HIDDEN_FLEX_TYPES/VISIBLE_FLEX_TYPES + ใช้ FLEX_TYPES ตรง ๆ ทั้ง 2 ที่
// [FIX-20260824-UNHIDETEMPLATE] เจ้าของ 24/08: "ให้ไปยกเลิกการซ่อน type นี้ใน flex
//   message create/edit ด้วย หน้า fe มันซ่อนยุ" — เอา 'template_message'
//   (ป้าย "ข้อความ (template_message)") ออกจากรายการซ่อน
//   🔴 ทำไมต้องเป็นตัวนี้: มันเป็นชนิดที่ไม่มีตาราง Variable Mapping
//      (`FLEX_TYPES_NO_GUIDELINES` ข้างล่างระบุไว้เอง) ⇒ เป็นการ์ดข้อความล้วน
//      ซึ่งเป็นชนิดที่แคมเปญ broadcast/multicast เลือกไปผูก `flex_id` ได้
//      ตราบใดที่ซ่อนอยู่ แอดมิน **สร้างการ์ดชนิดนี้ไม่ได้เลย** ⇒ มีตัวเลือกในฟอร์ม
//      แคมเปญแต่ไม่มีของให้เลือก
//   ⚠️ 'normal' ยังซ่อนอยู่ตามเดิม — เจ้าของสั่งมาตัวเดียว ไม่เหมาเปิดทั้งสองตัว
//   revert: ใส่ 'template_message' กลับเข้า array นี้
export const HIDDEN_FLEX_TYPES = ['normal'];
export const VISIBLE_FLEX_TYPES = FLEX_TYPES.filter(t => !HIDDEN_FLEX_TYPES.includes(t.value));
// [FEAT-20260802-FLEXTYPE2] ประเภทที่ "ไม่มี" ตาราง Variable Mapping → ซ่อน panel + ขยาย editor เต็ม
/* [FEAT-20260829-MENUPBGUIDE] 'menu' ถูกเอาออกจากลิสต์นี้แล้ว
   เดิมอยู่ในลิสต์เพราะการ์ดเมนูไม่มีตัวแปรโปรไฟล์/กติกาเว็บให้เล่า และคอมเมนต์เดิม
   เขียนไว้เองว่า "สิ่งที่คนวาดต้องรู้คือ payload ของปุ่ม ซึ่งมาคนละทาง"
   ⇒ ตอนนี้ "คนละทาง" นั้นมาแล้ว: BE ส่ง postback rows ผ่าน endpoint เดิม
   (GET flex-messages/variables?flex_type=menu) ทำให้ตารางมีของจะแสดง
   ⚠️ ถ้าใส่ 'menu' กลับเข้าลิสต์ ตารางจะถูกซ่อนและ effect ที่ดึงข้อมูลจะ return
   ก่อนยิง request ⇒ แอดมินต้องพิมพ์ payload เอง ซึ่งพิมพ์ผิดแล้ว "เงียบ" ปุ่มตาย
   revert: ใส่ 'menu' กลับเข้า array นี้ */
const FLEX_TYPES_NO_GUIDELINES = ['template_message'];

// [FEAT-20260806-FLEXGRANTALL] type ที่ grant ให้ทุก hook อัตโนมัติได้ (มีลิสต์หลายใบใน hook)
//   custom → flex_custom_ids · profile-semi-custom → flex_profile_custom_ids
//   EXCLUDED: profile (ใบเดียว เลือกเอง), slip/normal/template (ไม่มีลิสต์ reply)
const GRANTABLE_FLEX_TYPES = ['custom', 'profile-semi-custom'];
const flexTypeHasGuidelines = (v?: string | null) => !FLEX_TYPES_NO_GUIDELINES.includes(v || '');

// [FEAT-20260802-FLEXGUIDESEARCH] ไฮไลต์ทุกช่วงข้อความที่ตรงคำค้น (case-insensitive)
//   query ต้องเป็น lowercase มาแล้ว · คืน string เดิมถ้าไม่มีคำค้น
function highlightMatch(text: React.ReactNode, query: string): React.ReactNode {
  const t = String(text ?? '');
  if (!query) return t;
  const lower = t.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < t.length) {
    const idx = lower.indexOf(query, i);
    if (idx === -1) { parts.push(t.slice(i)); break; }
    if (idx > i) parts.push(t.slice(i, idx));
    parts.push(<mark key={k++} className="bg-yellow-200 text-slate-900 rounded px-0.5">{t.slice(idx, idx + query.length)}</mark>);
    i = idx + query.length;
  }
  return <>{parts}</>;
}
/** ค่าที่ยอมรับเท่านั้น — ค่าเพี้ยน/ว่าง/ของเก่าที่ไม่มี field → slip (พฤติกรรมเดิม) */
const normalizeFlexType = (v?: string | null) =>
  FLEX_TYPES.some(t => t.value === v) ? (v as string) : FLEX_TYPE_DEFAULT;
// ==== [FEAT-20260801-FLEXTYPE] END

// ==== [FEAT-20260802-FLEXVARS] / [FEAT-20260802-FLEXVARAPI] ตัวแปรของ profile/normal/custom
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// ⭐ ตารางนี้ **ไม่ได้อยู่ในไฟล์นี้แล้ว** — BE เป็นเจ้าของที่เดียว
//    (legacy-api: src/config/flexVarSpec.js) ซึ่งเป็นตัวเดียวกับที่ webhook ใช้แทนค่าจริง
//    ฟอร์มดึงผ่าน GET /api/flex-messages/variables ตอนเปิด modal
//
//    เหตุผล: ตารางนี้ไม่ได้มีไว้ "โชว์" อย่างเดียว — validate เอา tag จากที่นี่ไปทำ
//    allowlist ด้วย ถ้า FE ถือตารางของตัวเองแล้วไม่ตรงกับ BE จะเกิด 2 อาการ
//      • ฟอร์มยอมให้พิมพ์ แต่ webhook ไม่รู้จัก → {{...}} หลุดไปถึงลูกค้า
//      • หรือกลับกัน แอดมินพิมพ์ tag ที่ใช้ได้จริงแต่ฟอร์มตีกลับ
//    เดิมใช้เทสคอยจับ ตอนนี้ไม่มีทางเกิดเพราะมีตารางเดียว
//
// ⚠️ ประเภท slip ยังใช้ SLIP_GUIDELINES ในไฟล์นี้เหมือนเดิม — ตัวแปรสลิปมาคนละเส้น
//    (3rd party API) และมี current_datetime ที่ต้องคำนวณฝั่งเบราว์เซอร์ · เจตนา ไม่ใช่ลืม
// ⚠️ โหลดไม่สำเร็จ = **ไม่บล็อกการเซฟ** (ข้ามการตรวจ tag ไปเลย) เพราะบล็อกแล้ว
//    แอดมินจะเซฟอะไรไม่ได้เลยทั้งที่ของเดิมก็ถูกอยู่ · ฟอร์มขึ้นข้อความบอกแทน
// revert: เอาตารางกลับมาไว้ในไฟล์นี้ + ลบ getVariableGuidelines + endpoint ฝั่ง BE

const DEFAULT_FORM: FlexMessageFormData = {
  name: '',
  content_json: {},
  source_roles: [] as string[], // [FEAT-20260802-FLEXNS] แหล่งข้อมูล (ว่าง = profile)
  group_ids: [],
  // [FEAT-20260801-FLEXTYPE] สร้างใหม่เริ่มที่ slip = เหมือนพฤติกรรมเดิมทุกประการ
  flex_type: FLEX_TYPE_DEFAULT,
  // [FEAT-20260829-FLEXMENUTYPE] ว่าง = ไม่มี sub type · มีความหมายเฉพาะ type menu
  flex_sub_type: '',
  // [FEAT-20260829-FLEXMENUSLUG] ว่างได้ ไม่บังคับ · เก็บเป็น null ที่ BE
  flex_slug: '',
  // [FEAT-20260810-CARDTICKET] off by default — a new card must not start ticketing.
  direct_ticket_on_reply: false,
  direct_ticket_text: ''
};

/**
 * [FIX-20260829-LOCKEDTYPERESET] the ONE place that decides what a brand-new
 * form starts as.
 *
 * 🔴 It exists because a bare `setFormData(DEFAULT_FORM)` reset silently undid
 * the locked type: "เพิ่มเมนู" produced a SLIP card, and nothing reported it.
 * Every create-reset must go through here — `flexMenuLockedType` asserts that no
 * bare reset creeps back in, because a second one would reintroduce the bug
 * while every other test stayed green.
 */
export const createFormFor = (
  lockedFlexType?: string,
): FlexMessageFormData =>
  lockedFlexType
    ? { ...DEFAULT_FORM, flex_type: lockedFlexType }
    : DEFAULT_FORM;

export const FlexMessageFormModal: React.FC<FlexMessageFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  lockedFlexType,
  mode
}) => {
  const { t } = useI18n();
  /* [FEAT-20261022-I18NPAGESEN] FLEX_TYPES stays the data (values, normalize, list filter); its
     label/desc translate at render — key = pageui.flex.type.<value with - as _>.label|desc */
  const ftText = (ft: { value: string; label: string; desc: string }) => {
    const k = ft.value.replace(/-/g, '_');
    return { label: t(`pageui.flex.type.${k}.label`, ft.label), desc: t(`pageui.flex.type.${k}.desc`, ft.desc) };
  };
  const ftFind = (v?: string | null) => FLEX_TYPES.find(ft => ft.value === v);
  const [formData, setFormData] = useState<FlexMessageFormData>(DEFAULT_FORM);
  const [jsonString, setJsonString] = useState('');
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDefaultStep1, setShowDefaultStep1] = useState(false);
  const [showDefaultStep2, setShowDefaultStep2] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isGroupsExpanded, setIsGroupsExpanded] = useState(false);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [isCopyingRaw, setIsCopyingRaw] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  // [FEAT-20260805-FLEXTAGRULE] one-time tag-rule gate on open (create/edit): must
  // acknowledge "use {{ }} from the table, never type/never use [[[ ]]]" to proceed.
  // Shown once per browser session (sessionStorage) so it warns without nagging.
  const [showTagRule, setShowTagRule] = useState(false);
  /* [FEAT-20260802-FLEXTYPEDROPDOWN] select ประเภท flex แบบ custom (single-select + search)
     เดิมเป็น <select> native · เปลี่ยนเป็น dropdown ค้นหาได้ เลือกได้ทีละ 1 ค่า
     typeDropdownOpen = เปิด/ปิด · typeSearch = คำค้น · typeDropdownRef = ตรวจคลิกนอกกล่อง
     revert: ลบ 2 state + ref + effect นี้ แล้วคืน <select> เดิม */
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [typeSearch, setTypeSearch] = useState('');
  const typeDropdownRef = useRef<HTMLDivElement | null>(null);
  const typeSearchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!typeDropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false);
        setTypeSearch('');
      }
    };
    document.addEventListener('mousedown', onDown);
    // โฟกัสช่องค้นหาทันทีที่เปิด เพื่อพิมพ์ได้เลย
    const id = window.setTimeout(() => typeSearchRef.current?.focus(), 0);
    return () => { document.removeEventListener('mousedown', onDown); window.clearTimeout(id); };
  }, [typeDropdownOpen]);
  // ==== [FEAT-20260802-FLEXVARAPI] ตารางตัวแปรจาก BE (ประเภท normal/profile/custom)
  // varRowsError = โหลดไม่สำเร็จ → ข้ามการตรวจ tag ไปเลย ไม่บล็อกการเซฟ
  // [FEAT-20260802-FLEXSRC] ตัวเลือกแหล่งข้อมูล — ตรงกับ role ที่ BE รองรับสเปกตัวแปร
  //   เพิ่ม role ใหม่ = เพิ่ม 1 บรรทัดที่นี่ + สเปกฝั่ง BE (ไม่ต้องแตะที่อื่น)
  const srcOptions = React.useMemo(() => ([
    { value: 'site_rules', label: 'กติกา/ตั้งค่าเว็บ' },
  ]), []);
  // [FEAT-20260802-FLEXNS] ตัวกรองตารางตัวแปรตามแหล่ง (chips) — '' = ทุกแหล่ง
  const [varSourceFilter, setVarSourceFilter] = useState<string>('');
  const [varRows, setVarRows] = useState<FlexVarGuidelineRow[]>([]);
  const [varRowsLoading, setVarRowsLoading] = useState(false);
  const [varRowsError, setVarRowsError] = useState(false);
  // [FIX-20260801-HOOKTYPES] เดิมประกาศ message เป็น string แต่โค้ด 4 จุดใส่ JSX เข้าไป
  // (ข้อความ validate มีหัวข้อ/รายการย่อย ไม่ใช่บรรทัดเดียว) · ใช้งานได้มาตลอด
  // เพราะ AlertModal รับ `string | React.ReactNode` อยู่แล้ว — type ตรงนี้แค่แคบเกินจริง
  // ไม่มีใครฟ้องเพราะโปรเจกต์ยังไม่ได้ติดตั้ง @types/react
  const [showValidationError, setShowValidationError] = useState<{
    isOpen: boolean;
    message: React.ReactNode;
  }>({ isOpen: false, message: '' });
  
  const resolvedMode = mode ?? (initialData ? 'update' : 'create');

  // [FEAT-20260905-MEDIAPICKER] Reusable hook for Central Media Picker (modal + docked panel)
  const mediaPicker = useMediaPickerDock();

  // [FEAT-20260806-FLEXGRANTALL] grant การ์ดให้ทุก hook ในกลุ่ม (ตอน save) · default = ติ๊ก ทุกครั้ง
  const [grantAllHooks, setGrantAllHooks] = useState(true);

  // Real-time clock for Guideline table
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear() + 543; // Buddhist Era
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      setCurrentTime(`${day}/${month}/${year} ${hours}:${minutes}:${seconds}`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // [FEAT-20260805-FLEXTAGRULE] show the tag-rule gate EVERY time the modal opens
  // (create/edit) — no persistence, so the operator re-reads the rule each time.
  useEffect(() => {
    setShowTagRule(isOpen);
  }, [isOpen]);


  useEffect(() => {
    if (!isOpen) return;

    const fetchGroups = async () => {
      setGroupsLoading(true);
      try {
        const res = await groupService.listGroups({ limit: 100, status: true });
        setGroups(res.data);
        
        // Default select all groups if creating new
        if (resolvedMode === 'create' && !initialData) {
          setFormData(prev => ({
            ...prev,
            group_ids: res.data.map((g: any) => g._id)
          }));
        }
      } catch (err) {
        console.error('Failed to load groups', err);
      } finally {
        setGroupsLoading(false);
      }
    };

    fetchGroups();
    setErrors({});
    setIsGroupsExpanded(false);
    setGrantAllHooks(true); // [FEAT-20260806-FLEXGRANTALL] เปิด modal ใหม่ = default ติ๊ก grant ทุกครั้ง
    
    if (initialData) {
      setFormData({
        name: initialData.name,
        content_json: initialData.content_json,
        // [FEAT-20260802-FLEXNS] seamless: source_roles → source_role (เดิม) → []
        source_roles: (initialData as any).source_roles?.length
          ? (initialData as any).source_roles
          : ((initialData as any).source_role ? [(initialData as any).source_role] : []),
        group_ids: initialData.group_ids || [],
        callback_detail: initialData.callback_detail || '',
        callback_tag: initialData.callback_tag || '',
        /* [FEAT-20260810-CARDTICKET] absent on every card saved before this feature
           ⇒ reads as off, so opening an old card and saving it changes nothing. */
        direct_ticket_on_reply:
          (initialData as any).direct_ticket_on_reply === true,
        direct_ticket_text: (initialData as any).direct_ticket_text || '',
        // [FEAT-20260801-FLEXTYPE] ของเก่าไม่มี field นี้ → slip (ตารางตัวแปรเหมือนเดิมเป๊ะ)
        flex_type: normalizeFlexType(initialData.flex_type),
        /* [FEAT-20260829-FLEXMENUTYPE] ต้องโหลดกลับมาด้วย ไม่งั้นเปิดฟอร์มแล้วค่าหาย

           แล้วการเซฟครั้งถัดไปจะทับของจริงด้วยค่าว่าง */

        flex_sub_type: initialData.flex_sub_type ?? '',

        flex_slug: initialData.flex_slug ?? ''
      });
      setJsonString(JSON.stringify(initialData.content_json, null, 2));
    } else {
      /* 🔴 [FIX-20260829-LOCKEDTYPERESET] เดิมรีเซ็ตเป็น DEFAULT_FORM เฉย ๆ ซึ่ง
         `flex_type` = 'slip' ⇒ กด "เพิ่มเมนู" แล้วได้การ์ด slip เพราะ effect ที่
         ตั้งค่า lock รันก่อนบรรทัดนี้ แล้วโดนทับ · เจอจากการกดใช้จริง ไม่ใช่จากเทส
         แก้ที่ต้นเหตุ: การรีเซ็ตต้องเคารพประเภทที่ถูกล็อกมา ไม่ใช่ไปแก้ลำดับ effect
         ซึ่งจะพังอีกทันทีที่มีคนเพิ่ม effect ใหม่ */
      setFormData(createFormFor(lockedFlexType));
      setJsonString('');
    }
  }, [isOpen, initialData, resolvedMode, lockedFlexType]);

  // ==== [FEAT-20260802-FLEXVARAPI] ดึงตารางตัวแปรจาก BE
  // ⚠️ ดึงเฉพาะตอน modal เปิด · ประเภท slip ไม่ต้องดึง (ใช้ชุดในไฟล์นี้)
  // ⚠️ profile กับ normal/custom ได้ชุดไม่เท่ากัน ({{content}} มีเฉพาะ profile)
  //    → ต้องดึงใหม่ทุกครั้งที่สลับประเภท ไม่ใช่ดึงครั้งเดียวตอนเปิด
  // ⚠️ กัน race ตอนสลับประเภทเร็ว ๆ ด้วยธง cancelled — ไม่งั้นผลลัพธ์ของประเภทเก่า
  //    อาจมาถึงทีหลังแล้วทับของใหม่ (แล้ว allowlist จะผิดชุดแบบเงียบ ๆ)
  useEffect(() => {
    if (!isOpen) return;
    const flexType = normalizeFlexType(formData.flex_type);
    // [FEAT-20260802-FLEXTYPE2] slip = ชุดในไฟล์ · ชนิดที่ไม่มีตาราง (template_message) = ไม่ต้องดึงเลย
    // [FIX-20260831-PAYLINKONESOURCE] `slip` is fetched now TOO. Its data tags
    // still come from the local file (the server has no catalogue for them), but
    // its `{{paylink.*}}` rows must come from the server, which owns that list
    // — the local copy went stale the day a tag was added and the card was then
    // refused on save. ตัวแปรปุ่มมีแหล่งเดียว
    if (!flexTypeHasGuidelines(flexType)) { setVarRows([]); setVarRowsError(false); return; }
    let cancelled = false;
    setVarRowsLoading(true);
    setVarRowsError(false);
    flexMessageService.getVariableGuidelines(flexType, ['profile', ...(formData.source_roles || [])])
      .then(rows => { if (!cancelled) setVarRows(rows); })
      .catch(err => {
        if (cancelled) return;
        console.error('load flex variables failed', err);
        setVarRows([]);
        setVarRowsError(true);
      })
      .finally(() => { if (!cancelled) setVarRowsLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, formData.flex_type, formData.source_roles]); // [FEAT-20260802-FLEXNS] เปลี่ยนแหล่ง = โหลดตารางใหม่

  const lineNumbersRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  /* ==== [FEAT-20260801-FLEXTYPE] ตัวแปรของ normal / profile / custom
   * [FEAT-20260802-FLEXVARS] ตารางถูกย้ายออกไปไว้นอก component (บนสุดของไฟล์)
   *   เพราะโตจาก 3 แถวเป็น ~190 แถว — สร้างใหม่ทุก render โดยไม่จำเป็น
   *
   * [FEAT-20260810-PAYSTATEFLEX] ตาราง `slip` ย้ายออกไปที่
   *   `config/flexSlipGuidelines.ts` ตามเหตุผลเดียวกัน และเพื่อให้ตัวแปรกลุ่ม
   *   `{{paylink.*}}` (พฤติกรรมปุ่ม ไม่ใช่ข้อมูล) แยกกลุ่มได้ชัดแทนที่จะ
   *   ยัดต่อท้ายตารางข้อมูล — chip กรองสร้างเองจาก `source_role`
   *
   * ⚠️ ตารางนี้ไม่ได้ใช้แค่ "โชว์" — validate เอา tag จากที่นี่ไปทำ allowlist ด้วย
   *    (ดู allowedTags ข้างล่าง) เปลี่ยน type แล้วตัวแปรนอกชุดจะถูกตีกลับทันที */
  const SLIP_GUIDELINES = React.useMemo(
    () => buildSlipGuidelines(currentTime),
    [currentTime],
  );

  // [FEAT-20260801-FLEXTYPE] slip (และของเก่าที่ไม่มี type) = ชุดเดิมทั้งหมด
  // [FEAT-20260802-FLEXVARS] normal / profile / custom = ชุดตัวแปรข้อมูลลูกค้าทั้งชุด
  //   ⚠️ {{content}} มีเฉพาะ profile — normal/custom ไม่มี (ผู้ใช้สั่ง)
  //      ตารางนี้เป็น allowlist ตอน validate ด้วย → พิมพ์ {{content}} ใน normal/custom
  //      จะถูกตีกลับตั้งแต่ตอนเซฟ ไม่ใช่ไปโผล่ที่ลูกค้า
  const activeFlexType = normalizeFlexType(formData.flex_type);
  // [FEAT-20260802-FLEXVARAPI] slip = ชุดในไฟล์นี้เหมือนเดิม · ที่เหลือมาจาก BE
  /* [FIX-20260831-PAYLINKONESOURCE] slip = this file's DATA rows + the
     server's paylink rows. Everything else is the server's answer as before.
     The merge is what keeps one list of button tags in the product. */
  const guidelines = React.useMemo(
    () =>
      activeFlexType === 'slip'
        ? [
            ...SLIP_GUIDELINES,
            ...varRows.filter((r) => r.tag.startsWith('{{paylink.')),
          ]
        : varRows,
    [activeFlexType, SLIP_GUIDELINES, varRows],
  );
  // [FEAT-20260802-FLEXTYPE2] ประเภทที่ไม่มีตาราง Variable Mapping (เช่น template_message)
  //   → ซ่อน panel แล้วให้ editor กว้างเต็ม (layout dynamic ตามชนิด)
  const showGuidelines = flexTypeHasGuidelines(activeFlexType);
  // [FEAT-20260802-FLEXGUIDESEARCH] คำค้นของตาราง Variable Mapping — กรอง + ไฮไลต์ทั้ง tag และรายละเอียด
  //   ⚠️ ใช้กรอง "การแสดงผล" เท่านั้น · allowlist ตอน validate ยังใช้ guidelines เต็มชุด
  const [guidelineSearch, setGuidelineSearch] = useState('');
  const guidelineQuery = guidelineSearch.trim().toLowerCase();
  // [FEAT-20260802-FLEXNS] กรอง 2 ชั้น: แหล่ง (chips) แล้วค่อยคำค้น
  const guidelinesBySource = varSourceFilter
    ? guidelines.filter((g: any) => (g.source_role || 'profile') === varSourceFilter)
    : guidelines;
  const displayedGuidelines = guidelineQuery
    ? guidelinesBySource.filter(g =>
        [g.tag, g.desc, g.example, g.source].some(f => String(f || '').toLowerCase().includes(guidelineQuery)))
    : guidelinesBySource;
  // นับต่อแหล่ง ไว้โชว์บน chip (แอดมินเห็นว่าแหล่งไหนมีกี่ตัว)
  const guidelineCounts = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of guidelines as any[]) { const k = g.source_role || 'profile'; m[k] = (m[k] || 0) + 1; }
    return m;
  }, [guidelines]);
  // [FEAT-20260802-FLEXGUIDESEARCH] เปิด modal ใหม่ทุกครั้ง = ล้างคำค้นเสมอ (ตาราง + dropdown ประเภท)
  useEffect(() => {
    if (isOpen) {
      setGuidelineSearch('');
      setVarSourceFilter(''); // [FEAT-20260802-FLEXNS] ล้างตัวกรองแหล่งด้วย
      setTypeSearch('');
      setTypeDropdownOpen(false);
    }
  }, [isOpen]);

  const [showColorTool, setShowColorTool] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [isCopiedColor, setIsCopiedColor] = useState(false);

  /* [FIX-20260830-COPYHTTP2] `utils/copyText`, never `navigator.clipboard`
     directly: the Clipboard API exists only in a SECURE CONTEXT, and this
     dashboard is served over plain http — the call was a silent no-op while
     the success UI fired anyway. copyText falls back to execCommand and
     returns whether the copy really happened. */
  const handleCopyColor = async (color: string) => {
    if (!(await copyText(color))) return;
    setIsCopiedColor(true);
    setTimeout(() => setIsCopiedColor(false), 2000);
  };

  const commonColors = [
    '#06C755', // LINE Green
    '#17191B', // Dark
    '#FFFFFF', // White
    '#F2F2F2', // Light Gray
    '#666666', // Gray
    '#FF0000', // Red
    '#00B900', // LINE Brighter
    '#3B5998', // Social Blue
    '#E5E5E5', // Border Gray
    '#FFD700', // Gold
    '#03A9F4', // Sky Blue
    '#FF5722', // Deep Orange
  ];

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    
    if (!formData.name.trim()) {
      nextErrors.name = t('flex.form_name_required');
      setShowValidationError({
        isOpen: true,
        message: t('flex.form_name_required')
      });
      setErrors(nextErrors);
      return false;
    }

    // [FIX-20260804-FLEXNAMEFMT] ชื่อ flex ใช้ได้เฉพาะ a-z A-Z 0-9 (ห้ามว่าง/เว้นวรรค/ไทย/อักขระพิเศษ)
    //   validate() ตัวนี้ใช้ทั้ง create + edit (เรียกที่เดียวก่อน submit) → ครอบทั้งสองโหมด
    //   ห้ามกระทบของเดิม: เช็คนี้อยู่ "หลัง" empty-check และ "ก่อน" json-check เท่านั้น
    //   revert: ลบบล็อก if นี้ + key flex.form_name_invalid ใน th/en.json
    /* [FIX-20260825-FLEXNAMETH] เจ้าของ 25/08: *"อนุญาตให้ตั้งชื่อภาษาไทยหรือ
       เว้นวรรคก็ได้ (ปัจจุบันบล็อกแค่ eng) ปลดออกเลย ให้ตั้งไทย eng 0-9 และเว้นวรรคได้
       (ยกเว้นอักษรพิเศษ)"* + *"ให้ใช้ underscore ได้"*
       ช่วง \u0E00-\u0E7F คือบล็อกอักษรไทยทั้งหมดของ Unicode (รวมสระ วรรณยุกต์ เลขไทย)
       ⚠️ ยังกันอักขระพิเศษเหมือนเดิม — `<>&"'/\` และสัญลักษณ์ทั้งหมดยังไม่ผ่าน
       ⚠️ ตรวจกับ `.trim()` ⇒ ชื่อที่เป็นเว้นวรรคล้วนยังไม่ผ่าน (เป็นค่าว่าง)
       ⚠️ BE ไม่เคยมีข้อจำกัดชื่อเลย (ไม่มี `Matches` ใน dto) ⇒ นี่เป็นกฎฝั่งจอล้วน
          การปลดจึงไม่กระทบสัญญาฝั่งหลังบ้าน
       revert: กลับเป็น /^[a-zA-Z0-9]+$/ ทั้งสองจุดในไฟล์นี้ */
    if (!/^[\u0E00-\u0E7Fa-zA-Z0-9_ ]+$/.test(formData.name.trim())) {
      nextErrors.name = t('flex.form_name_invalid');
      setShowValidationError({
        isOpen: true,
        message: t('flex.form_name_invalid')
      });
      setErrors(nextErrors);
      return false;
    }

    if (!jsonString.trim()) {
      nextErrors.content_json = t('flex.form_json_required');
      setShowValidationError({
        isOpen: true,
        message: t('flex.form_json_required')
      });
      setErrors(nextErrors);
      return false;
    } else {
      try {
        const parsed = JSON.parse(jsonString);

        // [FEAT-20260805-FLEXTAGRULE] 0. Block dynamic tags — [[ / [[[ ... ]] / ]]] are the
        // dynamic-tag syntax and are NOT usable inside a Flex card. Scan every string value,
        // report which text + which line, and refuse to save. ตรวจก่อน tag-format ปกติ.
        const DYNTAG_RE = /\[{2,}|\]{2,}/; // two or more [ or ] in a row
        const findDynTag = (obj: any): string | null => {
          if (typeof obj === 'string') return DYNTAG_RE.test(obj) ? obj : null;
          if (Array.isArray(obj)) {
            for (const it of obj) { const r = findDynTag(it); if (r) return r; }
          } else if (obj && typeof obj === 'object') {
            for (const k in obj) { const r = findDynTag(obj[k]); if (r) return r; }
          }
          return null;
        };
        const dynVal = findDynTag(parsed);
        if (dynVal) {
          const dlines = jsonString.split('\n');
          let dLine = -1;
          for (let i = 0; i < dlines.length; i++) { if (dlines[i].includes(dynVal)) { dLine = i + 1; break; } }
          nextErrors.content_json = t('flex.form_json_tag_format_invalid');
          setShowValidationError({
            isOpen: true,
            message: (
              <div className="flex flex-col gap-4">
                <p className="text-slate-800 font-medium leading-relaxed text-[13px]">
                  {t('pageui.flex.dyn_found_a', 'พบ')} <b>dynamic tag</b> {t('pageui.flex.dyn_found_b', 'ในเนื้อหาการ์ด ซึ่งไม่สามารถใช้งานในการ์ด Flex ได้ กรุณาลบออกก่อนบันทึก')}
                </p>
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
                      {t('pageui.flex.fix_here', 'จุดที่ต้องแก้ไข')} {dLine > 0 ? t('pageui.flex.line_paren', '(บรรทัด {n})', { n: dLine }) : ''}
                    </p>
                  </div>
                  <code className="text-amber-700 font-mono break-all text-xs leading-relaxed block bg-white/50 p-2 rounded border border-amber-100 italic">
                    "{dynVal}"
                  </code>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-[13px] leading-relaxed text-slate-700">
                  {t('pageui.flex.use_vars_only_a', 'กรุณาใช้เฉพาะตัวแปรรูปแบบ')} <code className="text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">{'{'}{'{'} {t('pageui.flex.var_name', 'ชื่อตัวแปร')} {'}'}{'}'}</code> {t('pageui.flex.use_vars_only_b', 'โดยคัดลอกจากตารางตัวแปรเท่านั้น · หลีกเลี่ยงเครื่องหมาย')} <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">[[[ ... ]]]</code>
                </div>
              </div>
            )
          });
          setErrors(nextErrors);
          return false;
        }

        // 1. Check for basic tag format (triple braces etc)
        const checkTagsRecursive = (obj: any): { error: string; value: string } | null => {
          if (typeof obj === 'string') {
            const hasTriple = /\{{3,}/.test(obj) || /\}{3,}/.test(obj);
            const hasSingle = /(^|[^{])\{([^{]|$)/.test(obj) || /(^|[^}])\}([^}]|$)/.test(obj);
            
            if (hasTriple || hasSingle) {
              return { 
                error: t('flex.form_json_tag_format_invalid'), 
                value: obj 
              };
            }
          } else if (Array.isArray(obj)) {
            for (const item of obj) {
              const res = checkTagsRecursive(item);
              if (res) return res;
            }
          } else if (typeof obj === 'object' && obj !== null) {
            for (const key in obj) {
              const res = checkTagsRecursive(obj[key]);
              if (res) return res;
            }
          }
          return null;
        };

        const tagError = checkTagsRecursive(parsed);
        if (tagError) {
          nextErrors.content_json = tagError.error;
          const lines = jsonString.split('\n');
          let errorLineNum = -1;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(tagError.value)) {
              errorLineNum = i + 1;
              break;
            }
          }

          setShowValidationError({
            isOpen: true,
            message: (
              <div className="flex flex-col gap-4">
                <p className="text-slate-800 font-medium leading-relaxed text-[13px]">
                  {t('flex.validation_tag_invalid_title')}
                </p>
                
                <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl shadow-sm">
                   <div className="flex items-center gap-2 mb-2">
                     <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                     <p className="text-[10px] font-bold text-orange-600 uppercase tracking-wider">
                       {t('flex.validation_point_to_check')} {errorLineNum > 0 ? `(${t('flex.validation_line')} ${errorLineNum})` : ''}
                     </p>
                   </div>
                   <code className="text-orange-700 font-mono break-all text-xs leading-relaxed block bg-white/50 p-2 rounded border border-orange-100 italic">
                     "{tagError.value}"
                   </code>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase mt-0.5 shrink-0 whitespace-nowrap">{t('flex.validation_correct_example')}</div>
                      <code className="text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded text-sm">
                        {'{'}{'{'}sender_bank_name{'}'}{'}'}
                      </code>
                    </div>
                    
                    <div className="flex flex-col gap-2">
                       <div className="flex items-start gap-3">
                        <div className="bg-red-500/10 text-red-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase mt-1 shrink-0 whitespace-nowrap">{t('flex.validation_wrong_example')}</div>
                        <div className="flex flex-col gap-2">
                          <code className="text-red-500 font-mono bg-red-50 px-2 py-0.5 rounded text-sm w-fit">
                            {'{'}-{'{'}sender_bank_name {'}'}
                          </code>
                          <code className="text-red-500 font-mono bg-red-50 px-2 py-0.5 rounded text-sm w-fit">
                            {'{'}{'{'}sender_bank_name{'}'}{'}'}{'}'}
                          </code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          });
          setErrors(nextErrors);
          return false;
        }

        // 2. Check for unauthorized tags (not in guideline)
        // [FEAT-20260802-FLEXVARAPI] โหลดตารางจาก BE ไม่สำเร็จ = ข้ามการตรวจนี้ไป
        // ⚠️ เจตนา — ถ้าบล็อก แอดมินจะเซฟอะไรไม่ได้เลยทั้งที่ของเดิมก็ถูกอยู่
        //    (ตรวจรูปแบบ JSON ข้อ 1 ยังทำงานปกติ ไม่ได้ปล่อยผ่านทั้งหมด)
    /* [FIX-20260831-PAYLINKONESOURCE] slip is no longer exempt. It used to
       validate against a purely local table, so a failed fetch changed nothing
       for it — but its `{{paylink.*}}` rows now come from the server, and
       validating a card against a list that failed to load would REJECT a
       correct `{{paylink.retry}}`. Same rule as every other type: a fetch we
       could not make is not evidence the operator typed something wrong. */
    if (varRowsError || guidelines.length === 0) {
      return true;
    }
        /* [REFACTOR-20260804-NSSTANDARD] มาตรฐานเดียว {{แหล่ง.ตัวแปร}} + รับของเดิมด้วย
         *
         * ตารางจาก BE ส่งมา 2 ช่อง:
         *   tag         มาตรฐานใหม่  {{profile.bank_code}} / {{site_rules.dep_min}}
         *   legacy_tag  แบบเดิมที่ยังรับได้  {{bank_code}}  (มีเฉพาะแหล่ง implicit)
         *
         * ⚠️ ต้องรับ legacy ด้วย ไม่ใช่เลือกอย่างเดียว — การ์ดที่เขียนไว้ก่อนหน้า
         *    ใช้แบบไม่มี prefix (ในฐาน local อย่างเดียวมี 51 tag) ถ้าตัดทิ้ง
         *    แอดมินเปิดการ์ดเก่ามาแก้เรื่องอื่นแล้วเซฟไม่ผ่านทันที
         *    webhook แทนค่าได้ทั้ง 2 แบบมาตลอดอยู่แล้ว (ตรวจแล้ว 451 คู่ ค่าตรงกันเป๊ะ)
         * ⚠️ ไม่ฝังกฎ "profile ไม่ต้องมี prefix" ไว้ที่นี่ — BE บอกผ่าน legacy_tag
         *    วันหน้าเปลี่ยนว่าแหล่งไหน implicit ก็ไม่ต้องตามมาแก้ FE
         * ⚠️ tag ที่ไม่อยู่ในทั้ง 2 ช่อง ยังถูกตีกลับเหมือนเดิม — ไม่ได้ปล่อยผ่านมั่ว */
        const allowedTags = guidelines
          .flatMap(g => [g.tag, (g as any).legacy_tag])
          .filter(Boolean) as string[];

        const usedTags: { tag: string; line: number }[] = [];
        
        const extractTagsRecursive = (obj: any) => {
          if (typeof obj === 'string') {
            const matches = obj.match(/\{\{([^}]+)\}\}/g);
            if (matches) {
              const lines = jsonString.split('\n');
               matches.forEach(tag => {
                 let lineNum = -1;
                 for (let i = 0; i < lines.length; i++) {
                   if (lines[i].includes(tag)) {
                     lineNum = i + 1;
                     break;
                   }
                 }
                 usedTags.push({ tag, line: lineNum });
               });
            }
          } else if (Array.isArray(obj)) {
            obj.forEach(item => extractTagsRecursive(item));
          } else if (typeof obj === 'object' && obj !== null) {
            Object.values(obj).forEach(val => extractTagsRecursive(val));
          }
        };

        extractTagsRecursive(parsed);

        for (const item of usedTags) {
          if (!allowedTags.includes(item.tag)) {
            setShowValidationError({
              isOpen: true,
              message: (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle size={20} />
                    <p className="font-bold">{t('flex.validation_tag_not_found_title')}</p>
                  </div>
                  
                  <p className="text-slate-600 text-[13px] leading-relaxed">
                    {t('flex.validation_tag_not_found_desc')}
                  </p>

                  <div className="bg-red-50 border border-red-100 p-4 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-red-500 uppercase">{t('flex.validation_tag_not_found_label')}</span>
                      {item.line > 0 && (
                        <span className="bg-red-200 text-red-700 px-2 py-0.5 rounded-full text-[10px] font-bold">
                          {t('flex.validation_line')} {item.line}
                        </span>
                      )}
                    </div>
                    <code className="text-red-600 font-mono font-bold block bg-white p-2 rounded border border-red-50 shadow-sm text-sm">
                      {item.tag}
                    </code>
                  </div>

                  <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                    <p className="text-[10px] font-bold text-blue-500 uppercase mb-2">{t('flex.validation_instruction')}</p>
                    <p className="text-xs text-blue-700">{t('flex.validation_instruction_desc')}</p>
                  </div>
                </div>
              )
            });
            setErrors({ content_json: `Tag ${item.tag} is not allowed` });
            return false;
          }
        }

      } catch (e: any) {
        nextErrors.content_json = t('flex.form_json_invalid');
        
        // Try to estimate line number from position if possible
        let errorLineNum = -1;
        const posMatch = e.message.match(/position (\d+)/);
        if (posMatch) {
          const pos = parseInt(posMatch[1]);
          errorLineNum = jsonString.substring(0, pos).split('\n').length;
        } else {
           const lineMatch = e.message.match(/line (\d+)/);
           if (lineMatch) errorLineNum = parseInt(lineMatch[1]);
        }

        setShowValidationError({
          isOpen: true,
          message: (
            <div className="flex flex-col gap-3">
               <div className="flex items-center justify-between">
                 <p className="text-red-500 font-bold">{t('flex.form_json_invalid')}</p>
                 {errorLineNum > 0 && (
                   <div className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-bold border border-red-200">
                     {t('pageui.flex.line_n', 'บรรทัดที่ {n}', { n: errorLineNum })}
                   </div>
                 )}
               </div>
               <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 font-mono italic">
                 {e.message}
               </p>
            </div>
          )
        });
        setErrors(nextErrors);
        return false;
      }
    }
    
    setErrors(nextErrors);
    return true;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name } = e.target;
    let { value } = e.target;

    // [FIX-20260805-FLEXNAMEINPUT] ชื่อ flex: กรองตอนพิมพ์เลย รับเฉพาะ a-z A-Z 0-9
    //   (ห้ามว่าง/ไทย/อักขระพิเศษ) — ตัดตัวที่ไม่ผ่านทิ้งทันที ครอบทั้ง create + edit (input เดียว)
    //   ยังคง validate ตอน submit ไว้เป็นชั้นสอง (form_name_invalid) เผื่อ paste/autofill หลุด
    //   revert: ลบ 1 บรรทัดนี้
    /* [FIX-20260825-FLEXNAMETH] คู่กับ validate ข้างบน — ต้องปลดพร้อมกัน
       ไม่งั้นพิมพ์ไทยแล้วตัวอักษรหายทันทีที่พิมพ์ ทั้งที่ validate ยอมรับ */
    if (name === 'name') value = value.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9_ ]/g, '');

    if (name === 'content_json') {
      setJsonString(value);
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
    
    if (errors[name]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const toggleGroup = (groupId: string) => {
    if (resolvedMode === 'view') return;
    setFormData(prev => {
      const next = prev.group_ids.includes(groupId)
        ? prev.group_ids.filter(id => id !== groupId)
        : [...prev.group_ids, groupId];
      return { ...prev, group_ids: next };
    });
  };

  const selectAllGroups = () => {
    if (resolvedMode === 'view') return;
    setFormData(prev => ({
      ...prev,
      group_ids: groups.map(g => g._id)
    }));
  };

  const deselectAllGroups = () => {
    if (resolvedMode === 'view') return;
    setFormData(prev => ({
      ...prev,
      group_ids: []
    }));
  };

  const handleLoadDefaultClick = () => {
     setShowDefaultStep1(true);
  };

  const proceedToStep2 = () => {
     setShowDefaultStep1(false);
     setShowDefaultStep2(true);
  };

  const finalizeLoadDefault = async () => {
    try {
      const response = await fetch('/assets/flex/flex_template_sccuess.json');
      const data = await response.json();
      setJsonString(JSON.stringify(data, null, 2));
      setShowDefaultStep2(false);
    } catch (error) {
      console.error('Failed to load default template', error);
      alert('Failed to load template');
    }
  };

  const handlePreview = () => {
     try {
       JSON.parse(jsonString);
       setIsPreviewOpen(true);
     } catch (e: any) {
        let errorLineNum = -1;
        const posMatch = e.message.match(/position (\d+)/);
        if (posMatch) {
          const pos = parseInt(posMatch[1]);
          errorLineNum = jsonString.substring(0, pos).split('\n').length;
        } else {
           const lineMatch = e.message.match(/line (\d+)/);
           if (lineMatch) errorLineNum = parseInt(lineMatch[1]);
        }

        setShowValidationError({
          isOpen: true,
          message: (
            <div className="flex flex-col gap-3">
               <div className="flex items-center justify-between">
                 <p className="text-red-500 font-bold">{t('flex.form_json_invalid')}</p>
                 {errorLineNum > 0 && (
                   <div className="bg-red-100 text-red-600 px-3 py-1 rounded-full text-xs font-bold border border-red-200">
                     {t('pageui.flex.line_n', 'บรรทัดที่ {n}', { n: errorLineNum })}
                   </div>
                 )}
               </div>
               <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 font-mono italic">
                 {e.message}
               </p>
            </div>
          )
        });
       setErrors(prev => ({ ...prev, content_json: t('flex.form_json_invalid') }));
     }
  };

  const handleCopyRawJson = async () => {
    if (!(await copyText(jsonString))) return;
    setIsCopyingRaw(true);
    setTimeout(() => setIsCopyingRaw(false), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setShowConfirm(true);
  };

  const handleConfirmSave = async () => {
    setLoading(true);
    try {
      const finalType = normalizeFlexType(formData.flex_type);
      const payload: FlexMessageFormData = {
        ...formData,
        content_json: JSON.parse(jsonString),
        /* [FIX-20260902-MENUSRCROLES] a MENU card always declares `site_rules`,
           whether it is a main or a sub — they share `flex_type: 'menu'` and the
           picker above is hidden for both, so nothing here can be chosen by hand.

           WHY IT MATTERS. `source_roles` is what the card is ALLOWED to resolve.
           The variable guide offers `{{site_rules.*}}` for this card type, and the
           renderer reads `source_roles` off the saved row to decide what it may
           fill in. When the two disagree — guide says yes, row says nothing — the
           operator pastes a variable that never gets filled and the customer reads
           the raw `{{site_rules.…}}` on their phone. That happened live on 31/08
           (`sub-register`).

           WHY THE FE HAS TO SEND IT even though the BE forces it on CREATE: the
           BE's UPDATE path copies `source_roles` through as received, so saving an
           edit to a menu card used to write `[]` straight back over the correct
           value. The picker is hidden for menus, so `formData.source_roles` is
           always `[]` here — this line is the only thing standing between an edit
           and that regression.
           ⇒ เมนู (ทั้ง main และ sub) ต้องส่ง site_rules เสมอ ถึงจะซ่อนช่องไว้ก็ตาม

           ⚠️ NORMAL FLEX IS UNTOUCHED. Every other type keeps exactly what the
              operator picked — the ternary fires for `menu` alone, the same shape
              `flex_sub_type` and `flex_slug` use on the next two lines. */
        source_roles:
          finalType === 'menu'
            ? ['site_rules']
            : formData.source_roles || [], // [FEAT-20260802-FLEXNS]
        // [FEAT-20260801-FLEXTYPE] normalize อีกชั้นก่อนส่ง — state เพี้ยนก็ยังได้ slip
        flex_type: finalType,
        // [FEAT-20260829-FLEXMENUTYPE] BE บังคับ null เองถ้า type ไม่ใช่ menu
        flex_sub_type: finalType === 'menu' ? (formData.flex_sub_type || '') : '',
        // [FEAT-20260829-FLEXMENUSLUG] BE บังคับ null ให้ทุก type ที่ไม่ใช่ menu อยู่แล้ว
        flex_slug: finalType === 'menu' ? (formData.flex_slug || '') : '',
        // [FEAT-20260806-FLEXGRANTALL] ส่งเฉพาะ type ที่ grant ได้ + ผู้ใช้กดจริง
        grant_all_hooks: grantAllHooks && GRANTABLE_FLEX_TYPES.includes(finalType),
      };
      await onSubmit(payload);
      onClose();
    } catch (error) {
      console.error('Failed to submit flex message', error);
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  /* [FEAT-20260831-MENUVARSET] Which guide rows are worth copying.
     The menu guide ships two PROSE rows whose "tag" is an explanation in
     brackets — `(ไม่ใส่ postback)` and the byte cap — and handing an operator
     that sentence on the clipboard gives them something that cannot work.
     Decided on the VALUE, never on the card type, so a future guide that adds a
     prose row inherits the rule without touching this file.
     แถวที่เป็นคำอธิบาย ไม่ใช่ของให้คัดลอก */
  const isCopyableTag = (tag: string): boolean =>
    !!tag && !tag.trim().startsWith('(');

  const handleCopyTag = async (tag: string) => {
    if (!(await copyText(tag))) return;
    setCopiedTag(tag);
    setTimeout(() => setCopiedTag(null), 2000);
  };

  if (!isOpen) return null;


  // Map guidelines for replacements in preview
  const previewReplacements: Record<string, string> = {};
  guidelines.forEach(g => {
    previewReplacements[g.tag] = g.example;
  });

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white/45 backdrop-blur overflow-y-auto">
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-7xl my-8 flex flex-col transition-all duration-300">
          <form onSubmit={handleSubmit} className="flex flex-col relative">
            {copiedTag && (
              <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-2xl flex items-center gap-3 border border-slate-700 animate-in fade-in zoom-in slide-in-from-top-6 duration-300">
                <div className="bg-primary-500 p-1 rounded-full">
                  <Check size={14} className="text-white" strokeWidth={3} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 uppercase tracking-tighter leading-none mb-0.5">{t('pageui.flex.copied', 'คัดลอกสำเร็จ')}</span>
                  <span className="text-primary-400">{copiedTag}</span>
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-4 p-5 border-b border-slate-100 bg-white rounded-t-xl">
              <h3 className="text-lg font-bold text-slate-900 shrink-0">
                {resolvedMode === 'create' 
                  ? t('flex.form_create_title') 
                  : resolvedMode === 'view' 
                    ? t('common.view') 
                    : t('flex.form_update_title')}
              </h3>

              <div className="flex-1 max-w-xl relative group">
                <input
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className={`w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm font-bold text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all ${
                    errors.name ? 'border-red-500 ring-1 ring-red-500' : 'hover:border-slate-300'
                  }`}
                  placeholder={t('flex.form_name_placeholder')}
                  disabled={resolvedMode === 'view'}
                />
                {errors.name && (
                  <div className="absolute top-full left-0 flex items-center gap-1 mt-1 text-red-500 text-[10px] font-bold bg-white px-2 py-0.5 rounded-full shadow-sm z-10 border border-red-100">
                    <AlertCircle size={10} />
                    <span>{errors.name}</span>
                  </div>
                )}
              </div>

              {/* ==== [FEAT-20260801-FLEXTYPE] เลือกประเภทของ flex
                   คุมว่าตาราง Variable Mapping จะโชว์ตัวแปรชุดไหน (และ validate ชุดไหน)
                   ⚠️ อยู่บนหัว modal คู่กับชื่อ เพราะต้องเลือกก่อนเขียน JSON
                      ถ้าเลือกทีหลัง ตัวแปรที่พิมพ์ไปแล้วอาจหลุด allowlist
                   ⚠️ โหมด view ปิดไว้เหมือนช่องอื่น
                   revert: ลบ div นี้ทั้งก้อน */}
              {/* [FEAT-20260802-FLEXTYPEDROPDOWN] เดิมเป็น <select> native
                   เปลี่ยนเป็น dropdown ค้นหาได้ · single-select เท่านั้น (เลือกทีละ 1 ค่า)
                   revert: คืน <select> เดิม + ลบ state/ref/effect ที่ประกาศไว้ด้านบน */}
              <div className="shrink-0 relative" ref={typeDropdownRef}>
                {/* [FEAT-20260829-FLEXMENUTYPE] ทางเข้าที่ล็อกประเภทไว้ (ปุ่ม "เพิ่มเมนู")
                    แสดงเป็นป้ายอ่านอย่างเดียว ไม่ใช่ปุ่มกด — คนใช้จะได้เห็นว่ากำลังสร้าง
                    การ์ดประเภทอะไร แต่เปลี่ยนไม่ได้ */}
                {lockedFlexType && !initialData ? (
                  <div className="min-w-[160px] flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-900">
                    <span className="truncate">
                      {(ftFind(lockedFlexType) && ftText(ftFind(lockedFlexType)!).label) ?? lockedFlexType}
                    </span>
                    <span className="ml-auto text-[10px] font-normal text-slate-400">{t('pageui.flex.locked', 'ล็อก')}</span>
                  </div>
                ) : (
                <button
                  type="button"
                  disabled={resolvedMode === 'view'}
                  onClick={() => setTypeDropdownOpen(o => !o)}
                  title={ftFind(activeFlexType) ? ftText(ftFind(activeFlexType)!).desc : undefined}
                  className="min-w-[160px] flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-900 hover:border-slate-300 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all disabled:opacity-60"
                >
                  <span className="truncate">{(ftFind(activeFlexType) && ftText(ftFind(activeFlexType)!).label) ?? activeFlexType}</span>
                  <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${typeDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                )}
                {typeDropdownOpen && resolvedMode !== 'view' && (
                  <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                      <Search size={14} className="text-slate-400 shrink-0" />
                      <input
                        ref={typeSearchRef}
                        value={typeSearch}
                        onChange={(e) => setTypeSearch(e.target.value)}
                        placeholder={t('pageui.flex.type_search_ph', 'ค้นหาประเภท...')}
                        className="w-full text-sm outline-none bg-transparent text-slate-900 placeholder:text-slate-400"
                      />
                    </div>
                    <div className="max-h-72 overflow-y-auto custom-scrollbar py-1">
                      {(() => {
                        const q = typeSearch.trim().toLowerCase();
                        // [FEAT-20260802-FLEXTYPEHIDE] ตัวเลือกตอนสร้าง/แก้ไข = เฉพาะประเภทที่โชว์ (ซ่อน normal/template_message)
                        /* [FEAT-20260829-FLEXMENUTYPE] 'menu' มีปุ่มเข้าของตัวเอง
                           จึงไม่อยู่ในลิสต์ให้เลือกจากทางเข้าปกติ */
                        const base = lockedFlexType
                          ? VISIBLE_FLEX_TYPES
                          : VISIBLE_FLEX_TYPES.filter(ft => ft.value !== 'menu');
                        // the search also matches the label/desc on screen (English UI types English)
                        const list = base.filter(ft => !q
                          || ft.label.toLowerCase().includes(q)
                          || ft.value.toLowerCase().includes(q)
                          || ft.desc.toLowerCase().includes(q)
                          || ftText(ft).label.toLowerCase().includes(q)
                          || ftText(ft).desc.toLowerCase().includes(q));
                        if (list.length === 0) {
                          return <div className="px-3 py-4 text-xs text-slate-400 text-center">{t('pageui.flex.type_not_found', 'ไม่พบประเภทที่ค้นหา')}</div>;
                        }
                        return list.map(ft => {
                          const selected = ft.value === activeFlexType;
                          return (
                            <button
                              type="button"
                              key={ft.value}
                              onClick={() => {
                                setFormData(prev => ({ ...prev, flex_type: ft.value }));
                                setTypeDropdownOpen(false);
                                setTypeSearch('');
                              }}
                              className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${selected ? 'bg-primary-50' : 'hover:bg-slate-50'}`}
                            >
                              <span className={`mt-0.5 shrink-0 ${selected ? 'text-primary-600' : 'text-transparent'}`}><Check size={14} /></span>
                              <span className="min-w-0">
                                <span className={`block text-sm font-bold ${selected ? 'text-primary-700' : 'text-slate-900'}`}>{ftText(ft).label}</span>
                                <span className="block text-[11px] text-slate-400 leading-tight">{ftText(ft).desc}</span>
                              </span>
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                {/* [FEAT-20260829-FLEXMENUTYPE] sub type — โผล่เฉพาะ type menu
                    · ว่าง = ไม่มี sub type (BE บังคับ null ให้ทุก type ที่ไม่ใช่ menu อยู่แล้ว)
                    · ไม่มีค่า default ให้เดา — เลือกผิดข้างเงียบ ๆ แย่กว่าไม่ได้เลือก
                    revert: ลบบล็อกนี้ + flex_sub_type ในฟอร์ม/ตอนเซฟ */}
                {activeFlexType === 'menu' && resolvedMode !== 'view' && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-500 shrink-0">
                      {t('pageui.flex.menu_level', 'ระดับเมนู')}
                    </span>
                    <div className="inline-flex rounded-lg border border-dark-600 bg-dark-800 p-0.5 gap-0.5">
                      {([
                        { value: '', label: 'ไม่ระบุ' },
                        { value: 'main', label: 'หลัก' },
                        { value: 'sub', label: 'ย่อย' },
                      ]).map(o => (
                        <button
                          key={o.value || 'none'}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, flex_sub_type: o.value }))}
                          aria-pressed={(formData.flex_sub_type || '') === o.value}
                          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                            (formData.flex_sub_type || '') === o.value
                              ? 'bg-primary-500 text-white font-semibold'
                              : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          {t(`pageui.flex.menu_level_${o.value || 'none'}`, o.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {resolvedMode !== 'view' && (
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2"
                  >
                    {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={18} />}
                    {t('common.save')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 transition-all"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>

            <div className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[85vh] custom-scrollbar">

              {/* [FEAT-20260802-FLEXTYPE2] layout dynamic: มีตาราง = editor 60% + panel 40%
                   · ไม่มีตาราง (template_message) = editor เต็มความกว้าง ซ่อน panel (ไม่ให้เหลือช่องว่าง) */}
              {/* [FEAT-20260802-FLEXSRC] แถวบนสุด: กลุ่มเครือข่าย (ซ้าย) + แหล่งข้อมูล (ขวา) */}
              <div className="flex flex-col lg:flex-row gap-4 items-start">
                <div className="flex-1 min-w-0">
                  <div className="mt-2 border-t border-slate-100 pt-4">
                    <div 
                      className="flex justify-between items-center cursor-pointer group hover:bg-slate-50 p-3 rounded-xl transition-all"
                      onClick={() => setIsGroupsExpanded(!isGroupsExpanded)}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg transition-colors ${isGroupsExpanded ? 'bg-primary-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                          <CheckSquare size={18} />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 cursor-pointer">
                            {t('flex.form_group_label')}
                            <span className="ml-2 text-[10px] text-slate-400 font-normal">
                              {t('pageui.flex.group_access_count', '(สิทธิ์การใช้งาน: {n} กลุ่ม)', { n: formData.group_ids.length })}
                            </span>
                          </label>
                          <p className="text-[10px] text-slate-400">{t('pageui.flex.group_access_hint', 'กำหนดกลุ่มที่สามารถมองเห็นและใช้งานเทมเพลตนี้')}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        {isGroupsExpanded && resolvedMode !== 'view' && (
                          <div className="flex gap-3 text-[10px] font-semibold uppercase tracking-wider">
                            <button 
                              type="button" 
                              onClick={(e) => { e.stopPropagation(); selectAllGroups(); }}
                              className="text-primary-600 hover:text-primary-500 transition-colors"
                            >
                              {t('common.select_all')}
                            </button>
                            <button 
                              type="button" 
                              onClick={(e) => { e.stopPropagation(); deselectAllGroups(); }}
                              className="text-slate-400 hover:text-slate-300 transition-colors"
                            >
                              {t('common.deselect_all')}
                            </button>
                          </div>
                        )}
                        <span className="text-xs text-primary-500 font-bold bg-primary-50 px-3 py-1 rounded-full group-hover:bg-primary-100 transition-colors">
                          {isGroupsExpanded ? t('pageui.flex.collapse', 'พับเก็บ') : t('pageui.flex.edit_group_access', 'แก้ไขสิทธิ์กลุ่ม')}
                        </span>
                      </div>
                    </div>
    
                    {isGroupsExpanded && (
                      /* [FIX-20260802-GRPBOX] กรอบเดิมใหญ่เกินไป (p-4 + ปุ่ม p-2 + 4 คอลัมน์)
                         ลด padding/gap และเพิ่มคอลัมน์บนจอกว้าง — จำนวนกลุ่มเท่าเดิม แค่แน่นขึ้น */
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1 p-2 bg-slate-50 border border-slate-200 rounded-lg animate-in fade-in slide-in-from-top-2 duration-200">
                        {groupsLoading ? (
                          <div className="col-span-full py-4 text-center">
                            <Loader2 className="animate-spin text-primary-500 mx-auto" size={20} />
                          </div>
                        ) : groups.length === 0 ? (
                          <div className="col-span-full py-4 text-center text-slate-500 text-sm italic">
                            No groups available
                          </div>
                        ) : (
                          groups.map(group => {
                            const isSelected = formData.group_ids.includes(group._id);
                            return (
                              <button
                                key={group._id}
                                type="button"
                                onClick={() => toggleGroup(group._id)}
                                disabled={resolvedMode === 'view'}
                                className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md transition-all text-left ${
                                  isSelected 
                                    ? 'bg-white text-primary-600 ring-1 ring-primary-500/30 shadow-sm border-transparent' 
                                    : 'bg-transparent text-slate-500 hover:bg-white/50 border-transparent'
                                } ${resolvedMode === 'view' ? 'cursor-default' : 'cursor-pointer'}`}
                              >
                                {isSelected ? (
                                  <CheckSquare className="shrink-0 text-primary-500" size={16} />
                                ) : (
                                  <Square className="shrink-0 text-slate-300" size={16} />
                                )}
                                <span className="text-xs truncate font-medium">{group.group_name}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>

              {/* [FEAT-20260806-FLEXGRANTALL] grant การ์ดนี้ให้ทุก hook ในกลุ่ม (ตอน save) —
                  ไม่ต้องไปหน้า edit hook ติ๊ก card เอง. โชว์เฉพาะ type ที่ grant ได้ + เลือกกลุ่มแล้ว */}
              {resolvedMode !== 'view' && GRANTABLE_FLEX_TYPES.includes(activeFlexType) && formData.group_ids.length > 0 && (
                <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer w-fit"
                  title={t('pageui.flex.grant_all_tip', 'ติ๊ก card นี้ให้ทุก hook ในกลุ่มที่เลือกใช้ตอบ (เพิ่มอย่างเดียว ไม่ถอดของเดิม)')}>
                  <input type="checkbox" checked={grantAllHooks} onChange={(e) => setGrantAllHooks(e.target.checked)}
                    className="w-4 h-4 accent-primary-600" />
                  <span className="font-medium">{t('pageui.flex.grant_all', 'grant ทุก OA ในกลุ่ม')}</span>
                </label>
              )}

              {/* [FEAT-20260802-FLEXSRC] แหล่งข้อมูลที่การ์ดจะอ่าน (src_path)
                  · แสดงเมื่อเลือกกลุ่มแล้ว (ต้องรู้กลุ่มก่อนถึงรู้ว่ามี endpoint อะไรให้เลือก)
                  · ค่า = role ของ endpoint ใน custom tool (ไม่ใช่ path — path เปลี่ยนได้)
                  · ไม่เลือก = โปรไฟล์ลูกค้า (พฤติกรรมเดิมทุกประการ)
                  revert: ลบ block นี้ + source_role ใน DEFAULT/load/submit + state */}
              {/* [FEAT-20260829-FLEXMENUTYPE] การ์ดเมนูไม่อ่านตัวแปรจากแหล่งข้อมูล
                  จึงไม่ต้องเลือก — และไม่เลือกก็ไม่พัง: FE ไม่เคยบังคับ และ BE ใส่
                  `profile` ให้เองเมื่อ source_roles ว่าง (resolveSourceRoles) */}
              {activeFlexType !== 'menu' && (
              <div className="w-full lg:w-72 shrink-0">
                <label className="block text-sm font-bold text-slate-700 mb-1">
                  {t('pageui.flex.src_label', 'แหล่งข้อมูล (src_path)')}
                  <span className="ml-2 text-[10px] text-slate-400 font-normal">{t('pageui.flex.optional', 'ไม่บังคับ')}</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {/* [FIX-20260802-NSBASE] profile = แหล่งพื้นฐาน "ติดมาเสมอ ถอดไม่ได้"
                      เดิมเป็นชิปเทา ดูเหมือนยังไม่ถูกเลือก → เข้าใจผิดว่าเลือก 2 แหล่งไม่ได้
                      ตอนนี้เขียวเหมือนชิปที่เลือกแล้ว + ไอคอนล็อกบอกว่าเอาออกไม่ได้ */}
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-primary-500 text-white border border-primary-500 shadow-sm select-none cursor-default"
                    title={t('pageui.flex.src_base_tip', 'แหล่งพื้นฐาน — ติดมาเสมอ เอาออกไม่ได้ · tag ใช้ได้เลยโดยไม่ต้องใส่ชื่อแหล่ง')}>
                    <Lock size={10} /> {t('pageui.flex.src_profile', 'โปรไฟล์ลูกค้า')}
                  </span>
                  {srcOptions.map((o) => {
                    const on = (formData.source_roles || []).includes(o.value);
                    const locked = resolvedMode === 'view' || formData.group_ids.length === 0;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        disabled={locked}
                        onClick={() => setFormData(prev => {
                          const cur = prev.source_roles || [];
                          return { ...prev, source_roles: cur.includes(o.value) ? cur.filter(x => x !== o.value) : [...cur, o.value] };
                        })}
                        title={locked ? t('pageui.flex.pick_group_first', 'เลือกกลุ่มเครือข่ายก่อน') : (on ? t('pageui.flex.src_remove_tip', 'เอาออก — tag จะขึ้นต้นด้วย {src}.', { src: o.value }) : t('pageui.flex.src_add_tip', 'เพิ่ม — tag จะขึ้นต้นด้วย {src}.', { src: o.value }))}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                          on ? 'bg-primary-500 text-white border-primary-500 shadow-sm scale-105' : 'bg-white text-slate-500 border-slate-200 hover:border-primary-400 hover:text-primary-600'}`}
                      >
                        {on && <Check size={11} />} {t(`pageui.flex.src_role.${o.value}`, o.label)}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  {formData.group_ids.length === 0
                    ? t('pageui.flex.src_need_group', 'เลือกกลุ่มเครือข่ายก่อน จึงจะเลือกแหล่งข้อมูลได้')
                    : t('pageui.flex.src_multi_hint', 'เลือกได้มากกว่า 1 · tag ของแหล่งเสริมจะขึ้นต้นด้วยชื่อแหล่ง เช่น {{site_rules.dep_min}}')}
                </p>
              </div>
              )}
              </div>
              <div className="flex flex-col lg:flex-row gap-6">
                <div className={showGuidelines || mediaPicker.isDocked ? 'w-full lg:w-[60%]' : 'w-full'}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-500 flex items-center gap-2">
                      <span>{t('flex.form_json_label')} (JSON Editor) <span className="text-red-500">*</span></span>
                      <HelpCircle size={14} className="text-slate-300" />
                    </label>
                    <div className="flex gap-2">
                      {/* [FEAT-20260905-MEDIAPICKER] Standalone Attach VDO / IMG central media discovery (default to docked side-panel) */}
                      <AttachMediaButton onClick={mediaPicker.openPicker} />
                      <button
                        type="button"
                        onClick={handleLoadDefaultClick}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 transition-all text-[11px] font-bold border border-orange-200 shadow-sm"
                      >
                        <FileJson size={14} />
                        Default Success
                      </button>
                      <button
                        type="button"
                        onClick={handlePreview}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-50 text-pink-600 hover:bg-pink-100 transition-all text-[11px] font-bold border border-pink-200 shadow-sm"
                      >
                        <Play size={14} />
                        Preview Flex
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyRawJson}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all text-[11px] font-bold border border-slate-200 shadow-sm"
                      >
                        {isCopyingRaw ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        {isCopyingRaw ? t('common.copied_title') : t('pageui.flex.copy_raw', 'คัดลอก (Raw)')}
                      </button>
                    </div>
                  </div>
                  <div className="flex bg-dark-900 border border-dark-600 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent transition-all h-[600px]">
                    <div 
                      ref={lineNumbersRef}
                      className="bg-dark-800 text-slate-500 font-mono text-[10px] py-3 px-2 text-right select-none border-r border-dark-700 min-w-[40px] overflow-hidden"
                    >
                      {(jsonString + '\n ').split('\n').map((_, i) => (
                        <div key={i} className="h-[1.25rem] leading-[1.25rem]">{i + 1}</div>
                      ))}
                    </div>
                    <textarea
                      ref={textareaRef}
                      name="content_json"
                      value={jsonString}
                      onChange={handleChange}
                      onScroll={handleScroll}
                      className="w-full bg-transparent border-none p-3 font-mono text-xs resize-none focus:ring-0 outline-none overflow-y-auto custom-scrollbar leading-[1.25rem]"
                      placeholder={t('flex.form_json_placeholder')}
                      disabled={resolvedMode === 'view'}
                    />
                  </div>

                  {errors.content_json && (
                    <div className="flex items-center gap-1 mt-1 text-red-500 text-xs text-slate-400">
                      <AlertCircle size={12} className="text-red-500" />
                      <span>{errors.content_json}</span>
                    </div>
                  )}
                </div>

                {/* [FEAT-20260905-DOCKPANEL] Docked Media Picker side-by-side or Variable Guide */}
                {mediaPicker.isDocked ? (
                  <div className="w-full lg:w-[40%] flex flex-col">
                    <DockedMediaPicker
                      onMaximize={mediaPicker.maximizePanel}
                      onClose={mediaPicker.closeDockedPanel}
                    />
                  </div>
                ) : showGuidelines ? (
                <div className="w-full lg:w-[40%] flex flex-col">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl flex-1 flex flex-col overflow-hidden shadow-inner max-h-[600px]">
                    <div className="p-4 bg-white border-b border-slate-200">
                      <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm mb-2">
                        <Info size={16} className="text-primary-500" />
                        {/* [FEAT-20260829-MENUPBGUIDE] เมนูไม่ได้แม็ปตัวแปร — แถวที่ได้มา
                            คือ payload ของปุ่ม การเรียกมันว่า "Variable Mapping" จะทำให้
                            คนวาดการ์ดไปมองหา {{...}} ที่ไม่มีอยู่จริง */}
                        {activeFlexType === 'menu'
                          ? t('pageui.flex.menu_postback_title', 'Postback ของปุ่มเมนู (คัดลอกไปวางในปุ่มได้เลย)')
                          : 'Template Guidelines (Variable Mapping)'}
                      </div>
                      {/* [FEAT-20260802-FLEXGUIDESEARCH] ค้นหา tag + รายละเอียด แล้วไฮไลต์ผลลัพธ์ */}
                      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-transparent transition-all">
                        <Search size={14} className="text-slate-400 shrink-0" />
                        <input
                          value={guidelineSearch}
                          onChange={(e) => setGuidelineSearch(e.target.value)}
                          placeholder={activeFlexType === 'menu' ? t('pageui.flex.search_payload_ph', 'ค้นหา payload หรือ รายละเอียด...') : t('pageui.flex.search_tag_ph', 'ค้นหา tag หรือ รายละเอียด...')}
                          className="w-full text-xs outline-none bg-transparent text-slate-900 placeholder:text-slate-400"
                        />
                        {guidelineSearch && (
                          <button type="button" onClick={() => setGuidelineSearch('')} className="text-slate-400 hover:text-slate-600 shrink-0" title={t('pageui.flex.clear_search', 'ล้างคำค้น')}>
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="overflow-x-auto flex-1 custom-scrollbar">
                      {/* [FEAT-20260802-FLEXNS] ตัวกรองตามแหล่ง (chips) — โผล่เมื่อมีมากกว่า 1 แหล่ง */}
                      {Object.keys(guidelineCounts).length > 1 && (
                        <div className="flex flex-wrap gap-1.5 px-1 pb-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <button type="button" onClick={() => setVarSourceFilter('')}
                            className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all duration-200 ${!varSourceFilter ? 'bg-primary-500 text-white border-primary-500 scale-105 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-primary-400'}`}>
                            {t('pageui.flex.all_sources', 'ทุกแหล่ง ({n})', { n: guidelines.length })}
                          </button>
                          {Object.entries(guidelineCounts).map(([role, n]) => {
                            const label = (guidelines as any[]).find(g => (g.source_role || 'profile') === role)?.source_label || role;
                            const on = varSourceFilter === role;
                            return (
                              <button key={role} type="button" onClick={() => setVarSourceFilter(on ? '' : role)}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all duration-200 ${on ? 'bg-primary-500 text-white border-primary-500 scale-105 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-primary-400 hover:text-primary-600'}`}>
                                {label} ({n})
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <table className="w-full text-[13px] text-left border-collapse table-fixed">
                        <thead className="sticky top-0 bg-slate-100 text-slate-600 font-bold z-10">
                          <tr>
                            <th className="px-3 py-2 border-b border-slate-200 w-[45%]">Tag JSON</th>
                            <th className="px-3 py-2 border-b border-slate-200 w-[55%]">{t('pageui.flex.col_detail', 'รายละเอียด')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-slate-500">
                          {displayedGuidelines.length === 0 ? (
                            <tr>
                              <td colSpan={2} className="px-3 py-6 text-center text-xs text-slate-400">
                                {guidelineQuery ? t('pageui.flex.no_match', 'ไม่พบ tag/รายละเอียดที่ตรงกับ "{q}"', { q: guidelineSearch.trim() }) : t('pageui.flex.no_vars_for_type', 'ไม่มีตัวแปรสำหรับประเภทนี้')}
                              </td>
                            </tr>
                          ) : displayedGuidelines.map((row, idx) => (
                            <tr key={idx} className="hover:bg-blue-50/50 transition-colors group/row">
                              <td className="px-3 py-4 font-mono text-primary-600 font-bold whitespace-nowrap overflow-hidden text-ellipsis border-transparent">
                                {isCopyableTag(row.tag) ? (
                                  <button
                                    type="button"
                                    onClick={() => handleCopyTag(row.tag)}
                                    className="flex items-center gap-1.5 hover:text-primary-500 transition-colors"
                                    title="Click to copy"
                                  >
                                    {highlightMatch(row.tag, guidelineQuery)}
                                    {/* [FEAT-20260831-MENUVARSET] always visible: it
                                        used to appear only on row hover, so a table
                                        nobody hovers first read as "not clickable". */}
                                    <Copy size={12} className="text-slate-400 transition-colors group-hover/row:text-primary-500" />
                                  </button>
                                ) : (
                                  /* a prose row — shown, never offered as a copy */
                                  <span className="text-slate-500">
                                    {highlightMatch(row.tag, guidelineQuery)}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-4 leading-normal border-transparent">
                                <div className={`font-bold text-slate-700 mb-0.5 ${row.tag === '{{current_datetime}}' ? 'animate-pulse text-primary-600 font-mono' : ''}`}>{highlightMatch(row.example, guidelineQuery)}</div>
                                <div className="text-[11px] mb-0.5">{highlightMatch(row.desc, guidelineQuery)}</div>
                                <div className="text-[10px] italic text-slate-400">{highlightMatch(row.source, guidelineQuery)}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    
                    <div className="p-4 bg-white border-t border-slate-100 text-[10px] text-slate-400">
                      <div className="flex items-start gap-2">
                        <AlertCircle size={14} className="text-primary-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-slate-500 uppercase tracking-tighter mb-1">Instruction:</p>
                          {t('pageui.flex.instruction', 'คลิกที่ **Tag JSON** เพื่อ Copy ไปวางใน Editor ระบบจะดึงข้อมูลจริงมาแสดงผลอัตโนมัติ')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                ) : null}
                {/* [FEAT-20260802-FLEXTYPE2] จบ panel Variable Mapping (ซ่อนเมื่อ template_message) */}
              </div>


              {/* [FEAT-20260829-FLEXMENUSLUG] div ของตัวเอง วางก่อน Callback Configuration
                  · เฉพาะ type menu — ประเภทอื่นไม่เห็นและไม่ได้รับผลใด ๆ
                  · ไม่บังคับกรอก ว่างได้ · ว่าง = null ที่ฐานข้อมูล ไม่มีค่า default
                    ให้เดา เพราะการ์ดที่ไม่เคยตั้งกับการ์ดที่ยังไม่ตั้ง ต้องแยกไม่ออก
                  revert: ลบ div นี้ + flex_slug ใน DEFAULT/load/submit + type */}
              {activeFlexType === 'menu' && (
                <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-6 mt-4 animation-slide-in">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="bg-primary-100 p-1.5 rounded-lg text-primary-600">
                      <TagIcon size={18} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800 uppercase tracking-tight">Menu Slug</h4>
                      <p className="text-[10px] text-slate-400">{t('pageui.flex.slug_hint', 'ชื่อเรียกภายในของการ์ดเมนูใบนี้ (Optional · เว้นว่างได้)')}</p>
                    </div>
                  </div>
                  <input
                    type="text"
                    name="flex_slug"
                    disabled={resolvedMode === 'view'}
                    value={formData.flex_slug || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, flex_slug: e.target.value }))}
                    placeholder={t('pageui.flex.slug_ph', 'เช่น main-deposit หรือ เมนูฝากหลัก')}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all disabled:opacity-60"
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    {t('pageui.flex.slug_free_text', 'เป็นข้อความอิสระ ใช้ให้คนอ่านเข้าใจว่าการ์ดใบนี้คือเมนูอะไร · ไม่กรอกก็ได้')}
                  </p>
                </div>
              )}

              {/* Callback Configuration */}
              <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-6 mt-4 animation-slide-in">
                <div className="flex items-center gap-2 mb-4">
                   <div className="bg-primary-100 p-1.5 rounded-lg text-primary-600">
                     <Pipette size={18} />
                   </div>
                   <div>
                     <h4 className="text-sm font-bold text-slate-800 uppercase tracking-tight">Callback Configuration</h4>
                     <p className="text-[10px] text-slate-400">{t('pageui.flex.callback_hint', 'กำหนดข้อมูล Callback เมื่อมีการตอบโต้กับ Flex Message (Optional)')}</p>
                   </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">
                      {t('flex.form_callback_detail')}
                    </label>
                    <input
                      name="callback_detail"
                      value={formData.callback_detail || ''}
                      onChange={handleChange}
                      disabled={resolvedMode === 'view'}
                      className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                      placeholder={t('pageui.flex.callback_detail_ph', 'e.g. รายละเอียดการตรวจสอบสลิป')}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">
                      {t('flex.form_callback_tag')}
                    </label>
                    <input
                      name="callback_tag"
                      value={formData.callback_tag || ''}
                      onChange={handleChange}
                      disabled={resolvedMode === 'view'}
                      className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                      placeholder="e.g. check_slip_confirmed"
                    />
                  </div>
                </div>

                {/* ==== [FEAT-20260810-CARDTICKET] open a direct ticket on reply ====
                    Shown for `slip` cards only: the flag is read by the payment reply
                    path, which only ever sends cards bound to a payment reply state
                    (Hook → External tab). Offering it on a `profile`/`custom` card
                    would promise behaviour that code cannot deliver.
                    ⚠️ It fires only after the customer's reply is actually delivered,
                    and does nothing at all while unticked — every existing card reads
                    as off. ไม่ติ๊ก = ไม่มีอะไรเกิดขึ้น */}
                {activeFlexType === 'slip' && (
                  <div className="mt-6 pt-6 border-t border-slate-200">
                    <label className="flex items-start gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        name="direct_ticket_on_reply"
                        checked={formData.direct_ticket_on_reply === true}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            direct_ticket_on_reply: e.target.checked,
                          }))
                        }
                        disabled={resolvedMode === 'view'}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-500 focus:ring-primary-500"
                      />
                      <span>
                        <span className="block text-xs font-bold text-slate-700 uppercase">
                          {t('flex.form_direct_ticket')}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {t('flex.form_direct_ticket_hint')}
                        </span>
                      </span>
                    </label>

                    {formData.direct_ticket_on_reply === true && (
                      <div className="mt-3 flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase">
                          {t('flex.form_direct_ticket_text')}
                        </label>
                        <input
                          name="direct_ticket_text"
                          value={formData.direct_ticket_text || ''}
                          onChange={handleChange}
                          disabled={resolvedMode === 'view'}
                          className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                          placeholder={t('pageui.flex.direct_ticket_ph', 'e.g. ลูกค้าโอนผิดบัญชี')}
                        />
                        <p className="text-[10px] text-slate-400">
                          {t('flex.form_direct_ticket_text_hint')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>

      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmSave}
        title={t('common.confirm')}
        message={resolvedMode === 'create' ? t('common.confirm_create_message') : t('common.confirm_update_message')}
        type="info"
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
      />

      <ConfirmModal
        isOpen={showDefaultStep1}
        onClose={() => setShowDefaultStep1(false)}
        onConfirm={proceedToStep2}
        title="Load Default Template (Step 1/2)"
        message="Are you sure you want to load the default template? This will replace your current editor content."
        type="warning"
        confirmLabel="Continue to Verification"
        cancelLabel={t('common.cancel')}
      />

      <DoubleConfirmModal
        isOpen={showDefaultStep2}
        onClose={() => setShowDefaultStep2(false)}
        onConfirm={finalizeLoadDefault}
        title="Final Confirmation (Step 2/2)"
        message="Please verify and check both conditions to proceed with loading the default success template."
        checkbox1Label={t('pageui.flex.default_confirm_1', 'ยืนยันการตั้งค่าเป็น Default (System Template)')}
        checkbox2Label={t('pageui.flex.default_confirm_2', 'ข้อมูลที่พิมพ์ไว้จะหายไปทั้งหมดและกลับไปค่าตั้งต้น')}
        confirmLabel="Confirm and Load Now"
        cancelLabel="Back"
      />

      {/* [FEAT-20260805-FLEXTAGRULE] tag-rule gate — shown on EVERY open (no persistence)
          🔴 [FIX-20260831-TAGRULECANCEL] "ยกเลิก" และปุ่ม X ต้อง **ปิดทั้งฟอร์ม**
             ไม่ใช่ปิดแค่ด่านแล้วเผยฟอร์มที่เปิดรออยู่ข้างหลัง (เจ้าของแจ้ง 31/08:
             "กดยกเลิกต้องปิดสิ ไม่ใช่เปิดฟอร์ม อันนี้บัค (ปุ่ม x ด้วย)")
             ด่านนี้เป็น gate ⇒ ไม่รับกติกา = ไม่เข้าไปออกแบบการ์ด
             `DoubleConfirmModal` ใช้ `onClose` ตัวเดียวกันทั้งปุ่มยกเลิกและปุ่ม X
             (components/modals/DoubleConfirmModal.tsx:68,117) ⇒ แก้ที่เดียวได้ทั้งสองปุ่ม
          ⚠️ วันนี้ `showTagRule` ยังไม่มีใครตั้งเป็น true (ด่านถูกปิดไว้) — แก้ semantics
             ไว้ก่อนเพื่อไม่ให้บั๊กกลับมาตอนเปิดใช้ · ถ้าจะเปิดใช้ ให้ตั้งค่าตอน `isOpen` */}
      <DoubleConfirmModal
        isOpen={showTagRule}
        onClose={() => { setShowTagRule(false); onClose(); }}
        onConfirm={() => setShowTagRule(false)}
        title={t('pageui.flex.tag_rule_title', 'กติกาการใช้ตัวแปรในการ์ด Flex')}
        message={t('pageui.flex.tag_rule_msg', 'กรุณายืนยันก่อนเริ่มออกแบบการ์ด เพื่อป้องกันการใช้ตัวแปรที่ไม่รองรับ')}
        checkbox1Label={t('pageui.flex.tag_rule_1', 'กรุณาคัดลอกชื่อตัวแปรจากตารางเท่านั้น ไม่พิมพ์ชื่อตัวแปรเอง')}
        checkbox2Label={
          <span>
            {t('pageui.flex.tag_rule_2_a', 'ใช้ได้เฉพาะตัวแปรรูปแบบ')}{' '}
            <code className="text-emerald-600 font-extrabold bg-emerald-50 px-1.5 py-0.5 rounded">{'{{ }}'}</code>
            {' '}{t('pageui.flex.tag_rule_2_b', '· ห้ามใช้ dynamic tag')}{' '}
            <code className="text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded">[[[ ]]]</code>
            {' '}{t('pageui.flex.tag_rule_2_c', 'ในการ์ด Flex')}
          </span>
        }
        confirmLabel={t('pageui.flex.tag_rule_ok', 'รับทราบและเริ่มออกแบบ')}
        cancelLabel={t('pageui.flex.close', 'ปิด')}
      />

      {isPreviewOpen && (
        <FlexPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          flexJson={JSON.parse(jsonString)}
          replacements={previewReplacements}
        />
      )}

      <AlertModal
        isOpen={showValidationError.isOpen}
        onClose={() => setShowValidationError(prev => ({ ...prev, isOpen: false }))}
        title={t('common.error_title') || t('hook_form.error_label')}
        message={showValidationError.message}
        type="error"
      />

      {/* [FEAT-20260905-MEDIAPICKER] Central Media Picker Modal with side-panel docking */}
      <MediaPickerModal
        isOpen={mediaPicker.isModalOpen}
        onClose={mediaPicker.closeModal}
        onDock={mediaPicker.dockPanel}
      />

      {/* Color Tool FAB */}
      <div className="fixed bottom-12 right-12 z-[100] flex flex-col items-end gap-4 pointer-events-auto">
          {showColorTool && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 w-80 animate-in fade-in slide-in-from-bottom-8 duration-300 ring-1 ring-black/5">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Pipette size={18} className="text-primary-500" />
                  <span className="text-sm font-bold text-slate-800 uppercase tracking-tight">Flex Color Picker</span>
                </div>
                <button 
                  type="button"
                  onClick={() => setShowColorTool(false)} 
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-600 transition-all group border border-slate-200/50"
                >
                  <span className="text-[10px] font-bold uppercase tracking-tight group-hover:text-slate-700 transition-colors">Close</span>
                  <X size={14} strokeWidth={2.5} />
                </button>
              </div>

              <div className="flex flex-col gap-6">
                {/* Interactive Picker */}
                <div className="flex items-center gap-4 bg-slate-50 p-3 rounded-2xl border border-slate-100 shadow-inner">
                  <div className="relative w-16 h-16 shrink-0 group">
                    <input 
                      type="color" 
                      value={selectedColor}
                      onChange={(e) => setSelectedColor(e.target.value.toUpperCase())}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div 
                      className="w-full h-full rounded-2xl border-4 border-white shadow-lg shadow-black/10 transition-transform group-hover:scale-105" 
                      style={{ backgroundColor: selectedColor }}
                    />
                  </div>
                  <div className="flex-1 flex flex-col overflow-hidden text-left">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 px-1">Custom Color</span>
                    <div 
                      onClick={() => handleCopyColor(selectedColor)}
                      className="flex items-center justify-between p-2 px-3 rounded-xl bg-white border border-slate-200 text-slate-700 font-mono text-sm font-bold cursor-pointer hover:bg-slate-50 hover:border-primary-500 hover:text-primary-600 transition-all group overflow-hidden"
                    >
                      <span className="truncate">{selectedColor}</span>
                      <Copy size={12} className="opacity-40 group-hover:opacity-100 transition-opacity shrink-0 ml-2" />
                    </div>
                  </div>
                </div>

                {/* Common Palettes */}
                <div className="text-left">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2 px-1">
                    <Palette size={12} />
                    Common Palette
                  </p>
                  <div className="grid grid-cols-6 gap-2.5">
                    {commonColors.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          setSelectedColor(color);
                          handleCopyColor(color);
                        }}
                        className="w-8 h-8 rounded-xl ring-2 ring-white shadow-md hover:scale-110 active:scale-95 transition-all duration-200 relative group"
                        style={{ backgroundColor: color }}
                        title={color}
                      >
                        <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 ring-2 ring-primary-500/50 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowColorTool(!showColorTool)}
            className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 hover:scale-105 active:scale-95 ${
              showColorTool ? 'bg-slate-900 text-white shadow-slate-900/40 ring-4 ring-slate-900/10' : 'bg-primary-600 text-white hover:bg-primary-500 shadow-primary-600/40 ring-4 ring-primary-600/10'
            }`}
          >
            {showColorTool ? <X size={28} className="rotate-90 animate-in spin-in duration-300" /> : <Palette size={28} />}
          </button>
      </div>

      {isCopiedColor && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[110] bg-slate-900 text-white px-6 py-3 rounded-2xl text-sm font-bold shadow-2xl flex items-center gap-4 border border-slate-700 animate-in fade-in zoom-in slide-in-from-top-8 duration-300">
          <div className="w-4 h-4 rounded-full ring-2 ring-white/50" style={{ backgroundColor: selectedColor }} />
          <div className="flex flex-col text-left">
            <span className="text-[10px] text-slate-400 uppercase tracking-tighter leading-none mb-0.5">{t('pageui.flex.color_copied', 'คัดลอกรหัสสีสำเร็จ')}</span>
            <span className="text-primary-400 font-mono tracking-wider">{selectedColor}</span>
          </div>
          <div className="bg-primary-500 p-1 rounded-full ml-2">
            <Check size={12} className="text-white" strokeWidth={3} />
          </div>
        </div>
      )}
    </>
  );
};
