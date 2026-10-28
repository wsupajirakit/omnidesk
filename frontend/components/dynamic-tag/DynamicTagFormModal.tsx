import React, { useState, useEffect } from 'react';
import { X, Eye, Loader2, ChevronDown, Copy, Check, Users, ShieldAlert, Shield, Key, Terminal, ChevronRight, Hash, Search, Info, Play } from 'lucide-react';
import { useI18n, translateNow } from '../../i18n';
import { DynamicTagEntry, DynamicTagFormData, HookData } from '../../types';
import { DynamicTagPreviewModal } from './DynamicTagPreviewModal';
import { AlertModal } from '../modals';
import { chatService, ChatRoom } from '../../services/chat';
import { webhookService } from '../../services/hook';
import { dynamicTagService } from '../../services/messaging';
// [FIX-20260730-BPDEFAULTS] อ่าน flag acme_category — ใช้ตัวเดียวกับที่
// TicketChat/TicketSupport/HookFormModal ใช้อยู่ (ไม่สร้างแหล่งความจริงที่ 2)
import { configService } from '../../services/admin';
// [FEAT-20260728-TAGSCOPE] เลือก scope ของ tag เป็น "ทั้งกลุ่ม" ได้ (เดิมเฉพาะราย OA)
// ตัวเลือกกลุ่ม/OA ตามสิทธิ์ login เสมอ: perm group = fetchVisibleGroups · perm by OA = filterVisibleHooks
import { fetchVisibleGroups, filterVisibleHooks } from '../../services/admin';
import { SITE_RULES_DATA_EXAMPLE } from '../../config/siteRulesDataExample'; // [FIX-20260803-SRSAMPLE]
import { copyText } from '../../utils/copyText';

const blurMemberId = (uid: string) => {
  if (!uid || uid.length < 8) return uid;
  return `${uid.substring(0, 5)}xxxxx${uid.substring(uid.length - 4)}`;
};

interface DynamicTagFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: DynamicTagFormData) => Promise<void>;
  initialData?: DynamicTagEntry;
  mode: 'create' | 'update' | 'view';
}

const SUB_TYPE_API_OPTIONS = [
  { label: 'Customer Profile', value: 'api/v1/customer', path: 'GET {{url}}/api/v1/customer/{{line_user_id}}' },
  { label: 'Payment History', value: 'api/line/v1/payment_history.php', path: 'POST {{url}}/api/line/v1/payment_history.php' },
  { label: 'Contract Info', value: 'api/line/v1/contract.php', path: 'POST {{url}}/api/line/v1/contract.php' },
  { label: 'All Installments', value: 'api/line/v1/installment.php', path: 'POST {{url}}/api/line/v1/installment.php' },
  { label: 'Current Installment', value: 'api/line/v1/installment_current.php', path: 'POST {{url}}/api/line/v1/installment_current.php' },
];

const SUB_TYPE_SYSTEM_OPTIONS = [
  { label: 'Current Datetime', value: 'current_datetime', path: 'SYSTEM {{current_datetime}}' }
];

interface ComparisonData {
  current: any;
  updated: any;
  currentValue: string;
  updatedValue: string;
}

const PREVIEW_DATA: Record<string, any> = {
  'api/v1/customer': {
    "success": true,
    "status_code": 200,
    "message": "Customer profile retrieved successfully",
    "timestamp": "2026-03-16 13:01:27",
    "data": {
        "customer": {
            "customer_id": 2,
            "customer_number": "NBI001-00002",
            "customer_name": "ธนากร ตัวอย่าง",
            "customer_tel": "0845550018"
        },
        "contract": {
            "contract_number": "PRECT0226-KSN001-0002-09",
            "contract_status": "Pending",
            "contract_total_amount": 37552,
            "down_payment": 7500,
            "principal_amount": 17500
        },
        "product": {
            "device_model": "iPhone 12 Pro 256 GB เขียว",
            "device_imei": "356595102729968",
            "device_serial": "",
            "is_locked": false,
            "device_type": "Sure+",
            "warranty_expire_date": null
        },
        "installment": {
            "total_terms": 8,
            "current_term": 0,
            "installment_amount": 0,
            "payment_status": null,
            "due_date": null,
            "overdue_days": 0,
            "fine_amount": null,
            "unlock_fee": null,
            "total_due_amount": 0,
            "remaining_balance": 0,
            "last_payment_date": null,
            "last_payment_amount": 0
        }
    }
  },
  'api/line/v1/payment_history.php': {
    "status": true,
    "result": "success",
    "message": "Success",
    "total": 0,
    "now": "16 มี.ค. 2569, 12:58 น.",
    "data": {
        "remaining": {
            "contract_id": 16,
            "contract_code": "CT0126-NBI001-0016-01",
            "amount": 60780,
            "paid": 0,
            "balance": 60780,
            "increaseBalance": 33672,
            "processingBalance": 1200,
            "financeBalance": 25908,
            "discount": 0,
            "financeDiscount": 0,
            "increaseDiscount": 0,
            "mulct": 0
        },
        "history": [
            {
                "id": 29,
                "code": "TXRT0226-SRI001-0020-01-1",
                "title": "ชำระค่างวดจากสัญญาเลขที่ CT0226-SRI001-0020-01 ครั้งที่ 1",
                "amount": 1955,
                "installment": 1955,
                "mulct": 0,
                "unlocked": 0,
                "discount": 0,
                "total": 1955,
                "slip": "https://acme.example.com/upload/payment/3lja91772166420.jpg",
                "date": "27 ก.พ. 2569, 06:47 น.",
                "remark": "จบงวด มีค",
                "type": "ชำระปกติ",
                "status": true
            }
        ]
    }
  },
  'api/line/v1/contract.php': {
    "status": true,
    "result": "success",
    "message": "Success",
    "total": 1,
    "data": {
        "member": {
            "id": "2",
            "code": "NBI001-00002",
            "name": "ธนากร ตัวอย่าง",
            "nickname": "Arm",
            "identityNumber": "1279759136348",
            "tel": "0845550018",
            "profile": "",
            "lineUid": "U002e8de17b2b7e74d7fb274a29e33f9a",
            "nationality": "ไทย",
            "isVerify": "1"
        },
        "contract": {
            "id": 16,
            "code": "CT0126-NBI001-0016-02",
            "created": "2026-01-30 14:27:29",
            "approved": "2026-01-30 14:41:21",
            "status": "Active",
            "partner": "NBI001"
        },
        "product": {
            "id": 33,
            "code": "P010129016371-NBI001",
            "brand": "Apple",
            "name": "iPhone 16 Pro Max 256 GB 256GB ดำไทเทเนียม",
            "price": "35,900.00 บาท",
            "color": "ดำไทเทเนียม",
            "storage": "256GB",
            "type": "เครื่องมือ 1",
            "deposit": "10,000.00 บาท",
            "finance": "60,780.00 บาท",
            "finance_per_month": 2159,
            "increase": 2.3,
            "increase_amount": 34880,
            "increase_per_month": 2806,
            "installment_per_month": "5,065.00 บาท",
            "installment_number": "12 งวด",
            "installment_total": "60,780.00 บาท",
            "processing_fee": 100,
            "total": 70780,
            "img": "",
            "imei": "353082801758476",
            "serial": "H4HFKH39X0"
        }
    }
  },
  'api/line/v1/installment.php': {
    "status": true,
    "result": "success",
    "message": "Success",
    "total": 12,
    "now": "16 มี.ค. 2569, 13:10 น.",
    "data": {
        "member": {
            "id": "2",
            "code": "NBI001-00002",
            "name": "ธนากร ตัวอย่าง",
            "nickname": "Arm",
            "identityNumber": "1279759136348",
            "tel": "0845550018",
            "profile": "",
            "lineUid": "U002e8de17b2b7e74d7fb274a29e33f9a",
            "nationality": "ไทย",
            "isVerify": "1"
        },
        "contract": {
            "id": 16,
            "code": "CT0126-NBI001-0016-02",
            "created": "2026-01-30 14:27:29",
            "approved": "2026-01-30 14:41:21",
            "status": "Active",
            "partner": "NBI001",
            "deposit": 10000,
            "finance": 60780,
            "balance_total": 60780,
            "balance_current": 5065
        },
        "product": {
            "id": 33,
            "code": "P010129016371-NBI001",
            "brand": "Apple",
            "name": "iPhone 16 Pro Max 256 GB 256GB ดำไทเทเนียม",
            "price": "35900.00",
            "color": "ดำไทเทเนียม",
            "storage": "256GB",
            "type": "เครื่องมือ 1",
            "deposit": 10000,
            "finance": 25900,
            "finance_per_month": 2159,
            "increase": 2.3,
            "increase_amount": 34880,
            "increase_per_month": 2806,
            "installment_per_month": 5065,
            "installment_number": 12,
            "installment_total": 60780,
            "processing_fee": 100,
            "total": 70780
        },
        "installment": [
            {
                "no": 1,
                "id": 91,
                "code": "TXRT0126-NBI001-0016-01-1",
                "dueDate": "28 ก.พ. 2569",
                "amount": 5065,
                "paid": 0,
                "balance": 5065,
                "discount": 0,
                "mulct": 0,
                "status": "0"
            },
            {
                "no": 2,
                "id": 92,
                "code": "TXRT0126-NBI001-0016-01-2",
                "dueDate": "30 มี.ค. 2569",
                "amount": 5065,
                "paid": 0,
                "balance": 5065,
                "discount": 0,
                "mulct": 0,
                "status": "0"
            }
        ]
    }
  },
  'api/line/v1/installment_current.php': {
    "status": true,
    "result": "success",
    "message": "Success",
    "total": 9,
    "this_time": "16 มี.ค. 2569, 13:11 น.",
    "data": {
        "member": {
            "id": "2",
            "code": "NBI001-00002",
            "name": "ธนากร ตัวอย่าง",
            "nickname": "Arm",
            "identityNumber": "1279759136348",
            "tel": "0845550018",
            "profile": "",
            "lineUid": "U002e8de17b2b7e74d7fb274a29e33f9a",
            "nationality": "ไทย",
            "isVerify": "1"
        },
        "contract": {
            "id": 16,
            "code": "CT0126-NBI001-0016-02",
            "created": "2026-01-30 14:27:29",
            "approved": "2026-01-30 14:41:21",
            "status": "Active",
            "partner": "NBI001",
            "deposit": 10000,
            "finance": 60780,
            "balance_total": 60780,
            "balance_current": 5065
        },
        "product": {
            "id": 33,
            "code": "P010129016371-NBI001",
            "brand": "Apple",
            "name": "iPhone 16 Pro Max 256 GB 256GB ดำไทเทเนียม",
            "price": "35900.00",
            "color": "ดำไทเทเนียม",
            "storage": "256GB",
            "type": "เครื่องมือ 1",
            "deposit": 10000,
            "finance": 25900,
            "finance_per_month": 2159,
            "increase": 2.3,
            "increase_amount": 34880,
            "increase_per_month": 2806,
            "installment_per_month": 5065,
            "installment_number": 12,
            "installment_total": 60780,
            "processing_fee": 100,
            "total": 70780
        },
        "installment": {
            "id": 91,
            "number": "1/12",
            "amount": 5065,
            "status": "ยังไม่ถึงกำหนดชำระ",
            "current_amount": 5065,
            "remain_amount": 0,
            "mulct_amount": 0,
            "locked_amount": 0,
            "due_date": "28 ก.พ. 2569"
        }
    }
  },
  'current_datetime': {
    "current_datetime": "2026-04-10 18:07:44",
    "timestamp": 1744283264000,
    "format": "YYYY-MM-DD HH:mm:ss"
  },
  // ==== [FEAT-20260728-DYNPROFILE] START — เพิ่มตัวอย่าง Shop-API (ตาม shop-api.contract.md + demo-api)
  // ให้แอดมินเห็นโครงสร้าง response ของ hook ที่ชี้ Shop-API ได้โดยไม่ต้อง login เทสสด
  // tag value เขียนแบบ path เช่น finance.credit_balance · promotion.activity_volume.percent · profile.tier.name
  'shop-api/v1/customer': {
    "success": true,
    "source": "live",
    "data": {
      "profile": {
        "member_id": "z_demo-shop_0007",
        "line_user_id": "Uxxxxxxxxxxxxxxxx",
        "web_code": "demo-shop_main",
        "domain": "demo-shopx.com",
        "status": "active",
        "line_of_work": "aff_demo-shop_1",
        "phone": "0812345678",
        "tier": { "code": "gold", "name": "Gold", "level": 3 },
        "registered_at": "2025-11-02T15:31:00+07:00",
        "bank": { "code": "kbank", "name": "กสิกรไทย", "account_no": "xxx-x-x1234-x", "account_name": "สมชาย ใจดี" },
        "truewallet": "0812345678"
      },
      "promotion": {
        "current": { "code": "PROMO_50", "name": "ส่วนลด 50%", "received_at": "2026-07-21T11:00:00+07:00" },
        "activity_volume": { "done": "12000.00", "required": "20000.00", "percent": 60, "unit": "activity_volume" },
        "outstanding": "3500.00",
        "top_products": [{ "rank": 1, "product": "Sweet Bonanza", "provider": "northco", "amount": "800.00" }]
      },
      "finance": {
        "auto_deposit": "enabled",
        "auto_withdraw": "disabled",
        "credit_balance": "1520.75",
        "wallet_pending": "0.00",
        "deposit_total": "85000.00",
        "withdraw_total": "61000.00",
        "recent_deposits": [{ "at": "2026-07-21T09:10:00+07:00", "amount": "500.00", "status": "success", "channel": "bank_transfer", "ref": "DP20260721-0012" }],
        "recent_withdrawals": [{ "at": "2026-07-21T01:44:00+07:00", "amount": "1000.00", "status": "success", "ref": "WD20260720-0431" }]
      },
      "bonus": {
        "cashback": { "pending": "220.50", "claimed_total": "4310.00" },
        "referral": { "pending": "0.00", "claimed_total": "1500.00", "friends_count": 6 }
      },
      "activity": {
        "coins": { "balance": 120 },
        "point_round": { "rounds_available": 2 }
      }
    }
  }
  // ==== [FEAT-20260728-DYNPROFILE] END
};

// ==== [FEAT-20260728-DYNPROFILE] START — เพิ่มใหม่ (เดิม PREVIEW_DATA ถูก declare แต่ไม่มีจุดใช้ = dead)
// เลือกตัวอย่างให้ endpoint ตอนยังไม่ได้เทสสด: path มี shop-api → ตัวอย่าง Shop-API ก่อน (path บอกปลายทางจริง
// แม่นกว่า sub_type ซึ่งสูตร Shop-API แนะนำให้ตั้งเป็น api/v1/customer เพื่อ alias) → แล้วค่อย map ตาม sub_type
const getEndpointSample = (endpoint: any): any | null => {
  if (!endpoint) return null;
  const p = String(endpoint.path || '');
  const key = String(endpoint.key || endpoint.sub_type || '');

  /* [FIX-20260803-SRSAMPLE] เส้น site rules ต้องได้ตัวอย่างของ site rules
     🐛 เดิมเช็คแค่ `p.includes('shop-api')` แล้วคืนตัวอย่าง **ลูกค้า** ทันที
        แต่ทุก endpoint ของ Shop-API มีคำว่า shop-api ในพาธ รวมถึง shop-api/v1/site-rules
        → กด "ตัวอย่าง" บนเส้น SITE_RULES แล้วได้ data.profile ของลูกค้ามาแทน
        หัวข้อเขียน SITE_RULES แต่เนื้อเป็นคนละก้อน · แอดมินก๊อป path จากตรงนั้น
        ไปตั้ง tag = ได้ path ที่ไม่มีอยู่จริงในคำตอบของเส้นนี้
     ⚠️ ต้องเช็ค site rules **ก่อน** shop-api ทั่วไป ไม่งั้นโดนดักไปก่อนเหมือนเดิม
     ⚠️ ดูทั้ง key และ path — role ตั้งไม่ครบทุก tool (เส้น SITE_RULES ของ Shop-API v1
        ไม่ได้ตั้ง role ไว้) จึงเชื่อ role อย่างเดียวไม่ได้
     revert: ลบ 2 บรรทัดของ site rules ออก เหลือ if (p.includes('shop-api')) แบบเดิม */
  const looksSiteRules = /site.?rule/i.test(key) || /site.?rule/i.test(p) || endpoint.role === 'site_rules';
  if (looksSiteRules) return SITE_RULES_SAMPLE;

  if (p.includes('shop-api')) return PREVIEW_DATA['shop-api/v1/customer'];
  if (endpoint.sub_type && PREVIEW_DATA[endpoint.sub_type]) return PREVIEW_DATA[endpoint.sub_type];
  return null;
};
// ==== [FEAT-20260728-DYNPROFILE] END

/* [FIX-20260803-SRSAMPLE] ใช้ก้อนเดียวกับปุ่ม "ตัวอย่าง json" ในฟอร์ม hook
   ซึ่ง generate มาจาก siteRulesSample.json ของ BE — แหล่งเดียวกับที่ตารางแนะนำตัวแปรอ่าน
   ⚠️ ห้ามพิมพ์ตัวอย่างใหม่ที่นี่ ไม่งั้นจะมี 2 ก้อนที่เพี้ยนจากกันได้ */
const SITE_RULES_SAMPLE = JSON.parse(SITE_RULES_DATA_EXAMPLE);

export const DynamicTagFormModal: React.FC<DynamicTagFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  mode
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [formData, setFormData] = useState<DynamicTagFormData>({
    tag: '',
    value: '',
    detail: '',
    status: true,
    type: 'api',
    sub_type: '',
    ref_api_id: '',
    hook_id: ''
  });
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // [FEAT-20260728-DYNPROFILE] แถวที่กำลังเปิดดู "ตัวอย่าง" (ไม่ใช่ผลเทสสด) — เพิ่มใหม่
  const [sampleKey, setSampleKey] = useState<string | null>(null);
  const [thaiError, setThaiError] = useState<{ 
    title: string; 
    message: string | React.ReactNode; 
    type?: 'success' | 'error' | 'warning' | 'info' 
  } | null>(null);

  // API Testing State
  const [testToken, setTestToken] = useState<string>('');
  const [testLineUserId, setTestLineUserId] = useState<string>('');
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [comparison, setComparison] = useState<ComparisonData | null>(null);


  const [showFormScrollArrow, setShowFormScrollArrow] = useState(false);
  const [showPreviewScrollArrow, setShowPreviewScrollArrow] = useState(false);
  const [showGuidanceModal, setShowGuidanceModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; tag: string } | null>(null);
  const formScrollRef = React.useRef<HTMLDivElement>(null);
  const previewScrollRef = React.useRef<HTMLDivElement>(null);


  // Active Member Quick Copy state
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [userSearchText, setUserSearchText] = useState('');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAuthExpanded, setIsAuthExpanded] = useState(false);
  const [isUserToolsExpanded, setIsUserToolsExpanded] = useState(true);
  const [copyConfirm, setCopyConfirm] = useState<{
    isOpen: boolean;
    room: ChatRoom | null;
    hookAlias: string;
    oaName: string;
    acknowledged: boolean;
  }>({ isOpen: false, room: null, hookAlias: '', oaName: '', acknowledged: false });


  // ==== [FEAT-20260728-TAGSCOPE] START — scope ของ tag: 'hook' (เฉพาะ OA, เดิม) | 'group' (ทั้งกลุ่ม)
  // โหมดกลุ่ม: บันทึกด้วย group_id (hook_id = null) · ช่อง OA กลายเป็น "OA สำหรับเทส" (ไม่ถูกบันทึก)
  // เพื่อให้ปุ่ม Login/เทสสด/ตัวเลือก sub_type จาก endpoints ทำงานเหมือนเดิมทุกอย่าง
  const [scopeMode, setScopeMode] = useState<'hook' | 'group'>('hook');
  const [tagGroups, setTagGroups] = useState<{ _id: string; group_name: string }[]>([]);
  // เลือกได้ "หลายกลุ่ม" (ตามสั่ง 2026-07-28) — group_ids
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  // OA รวมจากทุกกลุ่มที่เลือก (ตามสิทธิ์) — แต่ละแถวพก __groupId/__groupName ไว้ทำป้ายบอกที่มา
  const [groupTestHooks, setGroupTestHooks] = useState<any[]>([]);
  // OA ที่ถูกติ๊ก: กลุ่มไหนติ๊กครบ → เข้า group_ids (ทั้งกลุ่ม) · กลุ่มไหนติ๊กบางตัว → เข้า hook_ids
  const [checkedHookIds, setCheckedHookIds] = useState<string[]>([]);
  // Primary Credential Source — hook ที่ใช้ credential ตอนเทส/พรีวิว/Login "ในฟอร์มเท่านั้น"
  // (ตัดสินใจ user แบบ (ก): runtime แชทจริงใช้ credential ของ OA ที่ลูกค้าแชทอยู่ ไม่กระทบ)
  // เลือกได้เฉพาะ OA ที่ติ๊กไว้เท่านั้น
  const [primaryCredId, setPrimaryCredId] = useState('');
  // ==== [FEAT-20260728-TAGSCOPE] END

  useEffect(() => {
    if (isOpen) {
      setIsPreviewOpen(false);
      setSelectedRoomId('');
      // Fetch rooms & hooks for LINE User Quick Copy
      setLoadingUsers(true);
      Promise.all([chatService.listRooms(), webhookService.getAllHooks()])
        .then(([r, h]) => { setRooms(r); setHooks(h); })
        .catch(console.error)
        .finally(() => setLoadingUsers(false));
      // [FEAT-20260728-TAGSCOPE] กลุ่มตามสิทธิ์ login (super=ทุกกลุ่ม, อื่น=กลุ่มตัวเอง, A-Z)
      // สร้างใหม่: default = โหมดกลุ่ม + กลุ่มแรก (ตามสั่ง "กลุ่มขึ้นมาก่อน") · ไม่มีกลุ่ม → โหมด OA ห้ามพัง
      fetchVisibleGroups()
        .then(gs => {
          setTagGroups(gs);
          if (!initialData && gs.length > 0) {
            setScopeMode('group');
            setSelectedGroupIds(prev => prev.length > 0 ? prev : [gs[0]._id]);
          }
        })
        .catch(() => setTagGroups([]));
    }
    if (initialData) {
      setFormData({
        tag: initialData.tag,
        value: initialData.value,
        detail: initialData.detail,
        status: initialData.status,
        type: initialData.type,
        sub_type: initialData.sub_type,
        ref_api_id: initialData.ref_api_id || '',
        hook_id: initialData.hook_id || ''
      });
      // [FEAT-20260728-TAGSCOPE] tag เดิม: group_ids/group_id/hook_ids → เข้าโหมดกลุ่ม
      const hasSubset = Array.isArray(initialData.hook_ids) && initialData.hook_ids.length > 0;
      const initGroups = [
        ...(Array.isArray(initialData.group_ids) ? initialData.group_ids : []),
        ...(initialData.group_id ? [initialData.group_id] : []),
      ];
      setScopeMode(initGroups.length > 0 || hasSubset ? 'group' : 'hook');
      setSelectedGroupIds(initGroups);
      setCheckedHookIds(hasSubset ? [...(initialData.hook_ids as string[])] : []);
      setPrimaryCredId((initialData as any).primary_credential_source || '');
    } else {
      setFormData({
        tag: '',
        value: '',
        detail: '',
        status: true,
        type: 'api',
        sub_type: '',
        ref_api_id: '',
        hook_id: ''
      });
      setScopeMode('hook');   // [FEAT-20260728-TAGSCOPE] ค่าเริ่มก่อนรู้ว่ามีกลุ่มไหม (effect กลุ่มด้านบนจะสลับให้)
      setSelectedGroupIds([]);
      setCheckedHookIds([]);
      setPrimaryCredId('');
    }
  }, [initialData, isOpen]);

  // [FEAT-20260728-TAGSCOPE] tag เดิมแบบ hook_ids ล้วน (ไม่มี group_ids) → เดากลุ่มจาก OA ที่ผูกไว้
  useEffect(() => {
    if (!isOpen || !initialData) return;
    const hasSubset = Array.isArray(initialData.hook_ids) && initialData.hook_ids.length > 0;
    const hasGroups = (Array.isArray(initialData.group_ids) && initialData.group_ids.length > 0) || !!initialData.group_id;
    if (hasSubset && !hasGroups && selectedGroupIds.length === 0 && hooks.length > 0) {
      const gset = new Set<string>();
      (initialData.hook_ids as string[]).forEach(id => {
        const h: any = hooks.find((x: any) => x._id === id);
        if (h?.group) gset.add(String(h.group));
      });
      if (gset.size > 0) setSelectedGroupIds([...gset]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData, hooks]);

  // ==== [FEAT-20260728-TAGSCOPE] START — แก้บัค "OA ไม่ขึ้นหลังเลือกกลุ่ม"
  // เลือกกลุ่มแล้ว → โหลด OA ของกลุ่มนั้น (กรองสิทธิ์ OA ซ้ำ) เป็นตัวเลือก OA สำหรับเทส
  // และ auto เลือกตัวแรกให้ทันที เพื่อให้ปุ่ม Login/เทสสด/sub_type ใช้ได้เลย
  useEffect(() => {
    if (!isOpen || scopeMode !== 'group' || selectedGroupIds.length === 0) { setGroupTestHooks([]); return; }
    let cancelled = false;
    // โหลด OA ของ "ทุกกลุ่มที่เลือก" พร้อมกัน แล้วติดป้ายว่ามาจากกลุ่มไหน
    Promise.all(selectedGroupIds.map(gid =>
      webhookService.getHooksByGroup(gid)
        .then(hs => filterVisibleHooks(hs).map((h: any) => ({
          ...h,
          __groupId: gid,
          __groupName: tagGroups.find(g => g._id === gid)?.group_name || translateNow('pageui.dyntag.group_fallback', 'กลุ่ม'),
        })))
        .catch(() => [] as any[])
    )).then(lists => {
      if (cancelled) return;
      const merged = lists.flat();
      setGroupTestHooks(merged);
      // checkbox: default = ติ๊กครบทุกตัว — ตอนแก้ tag เดิม: คงตามที่บันทึก (group ที่ผูกเต็มกลุ่ม
      // = ทุก OA ของกลุ่มนั้นถูกติ๊ก · hook_ids = เฉพาะตัวใน list)
      setCheckedHookIds(prev => {
        const visIds = merged.map((h: any) => String(h._id));
        if (initialData) {
          const fullGroupIds = new Set([
            ...(Array.isArray(initialData.group_ids) ? initialData.group_ids : []),
            ...(initialData.group_id ? [initialData.group_id] : []),
          ].map(String));
          const fromFull = merged.filter((h: any) => fullGroupIds.has(String(h.__groupId))).map((h: any) => String(h._id));
          const fromSubset = (initialData.hook_ids || []).map(String).filter(id => visIds.includes(id));
          const union = [...new Set([...fromFull, ...fromSubset, ...prev.filter(id => visIds.includes(id))])];
          if (union.length > 0) return union;
        }
        const kept = prev.filter(id => visIds.includes(id));
        return kept.length > 0 ? kept : visIds;
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, scopeMode, selectedGroupIds, tagGroups]);

  // แปลงสิ่งที่ติ๊กเป็น payload: กลุ่มที่ติ๊กครบ → group_ids · ที่เหลือ → hook_ids
  const computeGroupScope = () => {
    if (scopeMode !== 'group') return { group_ids: [], hook_ids: [] };
    const fullGroups = selectedGroupIds.filter(gid => {
      const members = groupTestHooks.filter((h: any) => h.__groupId === gid).map((h: any) => String(h._id));
      return members.length > 0 && members.every(id => checkedHookIds.includes(id));
    });
    const hook_ids = checkedHookIds.filter(id => {
      const g = groupTestHooks.find((h: any) => String(h._id) === id)?.__groupId;
      return !fullGroups.includes(String(g));
    });
    return { group_ids: fullGroups, hook_ids };
  };

  // Primary Credential Source ต้องเป็น OA ที่ติ๊กไว้เท่านั้น — หลุดจากรายการ → เลือกตัวแรกแทน
  // และตัวนี้คือ OA ที่ปุ่ม Login/เทสสด/sub_type ใช้ (กลไกเทสเดิมทั้งหมดอ่าน formData.hook_id)
  useEffect(() => {
    if (scopeMode !== 'group') return;
    const effective = checkedHookIds.includes(primaryCredId) ? primaryCredId : (checkedHookIds[0] || '');
    if (effective !== primaryCredId) setPrimaryCredId(effective);
    setFormData(prev => prev.hook_id === effective ? prev : { ...prev, hook_id: effective });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeMode, checkedHookIds, primaryCredId]);
  // ==== [FEAT-20260728-TAGSCOPE] END

  const checkFormScroll = () => {
    if (formScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = formScrollRef.current;
      setShowFormScrollArrow(scrollTop + clientHeight < scrollHeight - 20);
    }
  };

  const checkPreviewScroll = () => {
    if (previewScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = previewScrollRef.current;
      setShowPreviewScrollArrow(scrollTop + clientHeight < scrollHeight - 20);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        checkFormScroll();
        checkPreviewScroll();
      }, 100);
    }
  }, [isOpen, formData, isPreviewOpen, testResults, expandedKey]);

  // ==== [FIX-20260729-HOOKORDER] START — these MUST stay above the early return
  // 🔒 AUTO track — to_dev_auto branch only
  //
  // Bug: [FIX-20260729-DYTAGTOOL] originally declared these two useState calls
  // and the useEffect further down the file, which put them AFTER
  // `if (!isOpen) return null`. React then saw a different number of hooks
  // depending on whether the modal was open, and threw
  // "Minified React error #310" — the Dynamic Tag page went blank on load.
  //
  // Rules of Hooks: every hook must run on every render, in the same order.
  // Anything conditional belongs INSIDE the hook, not around it — which is why
  // the effect below starts with an `isOpen` check instead of being skipped.
  //
  // ⚠️ อย่าย้ายบล็อกนี้ลงไปใต้ `if (!isOpen) return null` อีก และอย่าเพิ่ม hook
  //    ใหม่ใต้บรรทัดนั้นเด็ดขาด — จะพังแบบเดียวกันและ error จะไม่บอกจุดที่ผิด
  const credHookId = scopeMode === 'group' ? primaryCredId : formData.hook_id;
  const [toolEndpoints, setToolEndpoints] = useState<any[]>([]);
  const [toolSourceName, setToolSourceName] = useState('');

  // ==== [FIX-20260730-BPDEFAULTS] START — ซ่อน "System Defaults" เมื่อไม่ใช่สาย acme
  // 🔒 branch to_dev_custom_adapter
  //
  // ── ปัญหา ───────────────────────────────────────────────────────────
  // ตัวเลือกกลุ่ม "System Defaults" (Customer Profile / Payment History /
  // Contract Info / All Installments / Current Installment) เป็น path ของ
  // **สาย acme เท่านั้น** (api/line/v1/*.php) แต่โผล่ให้ทุกคนเห็นเสมอ
  // → ระบบที่ acme_category = false เลือกไปก็ยิงไม่ได้ (ไม่มี endpoint พวกนี้)
  // กลายเป็นตัวเลือกที่พาไปสู่ tag ที่ตอบ N/A — กับดักเดียวกับบั๊ก sub_type
  //
  // ── ทำไมไม่ลบทิ้งเลย ────────────────────────────────────────────────
  // สาย acme ยังใช้อยู่จริง (acme_category = true) ถ้าลบจะพังทันที
  // จึงซ่อนตามบริบทแทน — คนที่ต้องใช้ยังเห็น คนที่ใช้ไม่ได้ไม่ต้องเห็น
  //
  // ⚠️ hook นี้ต้องอยู่เหนือ `if (!isOpen) return null` ตาม [FIX-20260729-HOOKORDER]
  // อ่านค่าด้วยวิธีเดียวกับ TicketChat/TicketSupport เป๊ะ (ไม่มีมาตรฐานที่ 2)
  // โหลดไม่ได้/ไม่มี key → false = ซ่อน ซึ่งเป็นฝั่งที่ปลอดภัยกว่า
  // (ระบบใหม่เป็นค่าเริ่มต้น · สาย acme ต้องตั้ง flag ไว้อยู่แล้ว)
  // revert: ลบ block นี้ + เงื่อนไข acmeCategory ที่ 3 จุดใน optgroup/options
  const [acmeCategory, setAcmeCategory] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    configService.listConfigs({ limit: 200 }).then((res) => {
      const row = (res.data || []).find((c: any) => c.key === 'acme_category');
      const v = row?.value;
      setAcmeCategory(v === true || v === 1 || v === 'true');
    }).catch(() => { /* อ่านไม่ได้ = ถือว่าไม่ใช่สาย acme → ซ่อน */ });
  }, [isOpen]);
  // ==== [FIX-20260730-BPDEFAULTS] END

  useEffect(() => {
    // The isOpen guard lives here, not around the hook itself.
    if (!isOpen || !credHookId) { setToolEndpoints([]); setToolSourceName(''); return; }
    let cancelled = false;
    (async () => {
      const r = await dynamicTagService.getTagEndpoints(credHookId);
      if (cancelled) return;
      setToolEndpoints(r.endpoints || []);
      setToolSourceName(r.source === 'custom_tool' ? (r.tool_name || 'Custom Tool') : '');
    })();
    return () => { cancelled = true; };
  }, [isOpen, credHookId]);

  // ==== [FIX-20260730-SUBTYPEGATE] START — เติมแหล่งข้อมูลให้เองเมื่อเดาได้แน่นอน
  // 🔒 branch to_dev_custom_adapter
  //
  // ⚠️ อยู่ตรงนี้เพราะกฎใน [FIX-20260729-HOOKORDER] ข้างบน — hook ทุกตัวต้องอยู่
  // เหนือ `if (!isOpen) return null` ไม่งั้น React error #310 หน้าจอขาวทั้งหน้า
  // (เคยพลาดวางไว้ข้างล่างตอนเขียนรอบนี้ แล้วจับได้ก่อน commit)
  //
  // ── เจตนา ───────────────────────────────────────────────────────────
  // ผู้ใช้ก็อป path จากฝั่งขวามาวางใน value อยู่แล้ว → ตอนนั้น "รู้อยู่แล้ว" ว่า
  // มาจาก endpoint ไหน ระบบจึงควรเติมให้ ไม่ใช่ให้มานั่งเลือกซ้ำอีกที
  //
  // ── กติกา: เดาเฉพาะตอนที่ "ไม่มีทางเดาผิด" ─────────────────────────
  //   1. เส้นที่ติ๊ก is_profile → เจ้าของ tool ระบุเองว่านี่คือเส้นโปรไฟล์
  //      (schema บังคับให้มีได้ ≤1 เส้น จึงชี้ขาดได้)
  //   2. มีเส้นอ่านข้อมูลอยู่เส้นเดียว → ไม่มีอะไรให้เลือกผิด
  // นอกนั้น (หลายเส้น ไม่มีธง) → **ไม่เดา** ปล่อยให้เลือกเอง เพราะเดาผิดแล้ว
  // tag จะดึงค่าจากที่ผิดเงียบ ๆ ซึ่งแย่กว่าการให้คนเลือก
  //
  // ── ไม่ผูกกับชื่อ key ใด ๆ (flexible) ───────────────────────────────
  // อ่านจาก endpoint ที่ tool มีจริงตอนนั้น → เพิ่ม/เปลี่ยนชื่อ endpoint ใน
  // Custom Tools แล้วตัวนี้ตามเอง ไม่ต้องแก้โค้ด
  //
  // ⚠️ ห้ามเขียนทับค่าที่มีอยู่แล้วเด็ดขาด (ทั้งตอนสร้างและตอนแก้ tag เดิม)
  // deps ไม่ใส่ formData.sub_type โดยตั้งใจ — ไม่งั้นผู้ใช้ล้างค่าเองแล้วมันจะ
  // เด้งกลับมาทันที = แย่งการควบคุมจากผู้ใช้
  // revert: ลบ block นี้ + autoPickSubType() ด้านล่าง
  useEffect(() => {
    if (!isOpen || mode === 'view') return;
    if (formData.type !== 'api') return;
    if (String(formData.sub_type || '').trim()) return; // มีค่าแล้ว ไม่ยุ่ง

    const list = toolEndpoints.length > 0 ? toolEndpoints : [];
    const readable = list.filter(
      (e: any) => e?.key && e?.purpose !== 'auth' && e?.purpose !== 'write'
    );
    if (readable.length === 0) return;

    const profileLine = readable.find((e: any) => e.is_profile === true);
    const picked = profileLine ? String(profileLine.key)
      : readable.length === 1 ? String(readable[0].key)
      : '';
    if (picked) setFormData((prev) => (prev.sub_type ? prev : { ...prev, sub_type: picked }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, toolEndpoints, formData.type]);
  // ==== [FIX-20260730-SUBTYPEGATE] END
  // ==== [FIX-20260729-HOOKORDER] END

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1) Logic Guard: Calculations (+, -, *, /) must use Customer Profile
    const hasOperator = /[+\-*/]/.test(formData.value);
    /* [FIX-20261014-TAGVALUECASE] the BE computes formulas on ANY source; this OA's own
       custom-tool endpoint keys (the list loaded from /tag-endpoints) qualify too. */
    const isCustomerProfile = formData.sub_type === 'api/v1/customer' ||
      toolEndpoints.some((ep: any) => String(ep?.key ?? '') === formData.sub_type);
    
    if (hasOperator && !isCustomerProfile) {
      setThaiError({
        title: t('pageui.dyntag.formula_title', 'ไม่สามารถใช้สูตรคำนวณกับหมวดนี้ได้'),
        message: t('pageui.dyntag.formula_msg', '⚠️ พบตัวดำเนินการคำนวณ (+, -, *, /) ในช่อง Value\n\nการใช้สูตรคำนวณต้องเลือก Sub Type เป็น \'Customer Profile\' หรือเส้นของ Custom Tool ของ OA นี้ครับ เพราะเป็นเป้าหมายเดียวที่มีข้อมูลตัวเลขดิบที่ระบบสามารถนำมาคำนวณได้\n\nวิธีแก้ไข:\n1. เปลี่ยน Sub Type ให้เป็น \'Customer Profile\'\n2. หรือ ลบตัวดำเนินการคำนวณออก หากต้องการดึงค่าปกติ')
      });
      return;
    }

    // 2) Auto-Fix Prefix: If starts with installment. instead of data. installment.
    let finalValue = formData.value.trim();
    if (formData.type === 'api' && finalValue && !finalValue.startsWith('data.')) {
      finalValue = `data.${finalValue}`;
    }

    // [FEAT-20260728-TAGSCOPE] โหมดกลุ่ม: เลือกกลุ่ม ≥1 + ติ๊ก OA ≥1 (primary ตามมาอัตโนมัติ)
    if (formData.type === 'api' && scopeMode === 'group' && selectedGroupIds.length === 0) {
      setThaiError({ title: t('pageui.dyntag.need_group_title', 'กรุณาเลือกกลุ่ม'), message: t('pageui.dyntag.need_group_msg', 'โหมด "ทั้งกลุ่ม" ต้องเลือกอย่างน้อย 1 กลุ่มก่อนบันทึกครับ') as any, type: 'warning' });
      return;
    }
    if (formData.type === 'api' && scopeMode === 'group' && checkedHookIds.length === 0) {
      setThaiError({ title: t('pageui.dyntag.need_oa_title', 'กรุณาเลือก OA'), message: t('pageui.dyntag.need_oa_msg', 'ต้องติ๊ก OA ที่จะให้ tag มีผลอย่างน้อย 1 ตัว (ติ๊กครบทุกตัวของกลุ่ม = ผูกทั้งกลุ่มนั้น)') as any, type: 'warning' });
      return;
    }

    // ==== [FIX-20260730-SUBTYPEGATE] START — ไม่เลือกแหล่งข้อมูล = บันทึกไม่ได้
    // 🔒 branch to_dev_custom_adapter
    //
    // ── ทำไมต้องบล็อก ──────────────────────────────────────────────────
    // sub_type คือตัวบอกว่า "ไปอ่านค่าจาก endpoint ไหน" ถ้าว่าง ระบบหาแหล่ง
    // ข้อมูลไม่เจอ → tag ตอบ N/A ตลอดกาล **โดยไม่มี error ให้เห็นเลย**
    // (พิสูจน์แล้วกับ tag จริง: value ถูกต้อง แต่ sub_type=null → N/A)
    // เป็นความพังแบบเงียบที่ไล่เหตุยากที่สุด — กันตั้งแต่ตอนบันทึกดีกว่า
    //
    // ข้อความบอก **ทางออก 2 ทาง** ที่ผู้ใช้ทำได้จริง ไม่ใช่แค่บอกว่าผิด
    // revert: ลบ block นี้
    if (formData.type === 'api' && !String(formData.sub_type || '').trim()) {
      // [FIX-20260730-BPDEFAULTS] เคสที่ "ไม่มีตัวเลือกให้เลือกเลย" ต้องไม่กลายเป็น
      // ทางตัน — เกิดได้จริงเมื่อ OA ยังไม่ได้ผูก Custom Tool และไม่ใช่สาย acme
      // (System Defaults ถูกซ่อน) → ต้องบอกว่าให้ไปตั้งค่าที่ไหน ไม่ใช่บอกให้เลือก
      // จากรายการที่ว่างเปล่า
      const noOptions = Object.keys(externalEndpoints).length === 0 && !acmeCategory;
      setThaiError({
        title: noOptions ? t('pageui.dyntag.no_endpoint_title', 'OA นี้ยังไม่มี endpoint ให้เลือก') : t('pageui.dyntag.pick_source_title', 'กรุณาเลือกแหล่งข้อมูล (Sub Type)'),
        message: (noOptions
          ? t('pageui.dyntag.no_endpoint_msg', 'Tag แบบ API ต้องอ่านค่าจาก endpoint แต่ OA ที่เลือกยังไม่มีให้ใช้\n\nวิธีแก้:\n• ไปที่เมนู Custom Tools → สร้าง/ผูก tool ที่มี endpoint กับ OA นี้\n• แล้วกลับมาเลือก endpoint ที่ต้องการอ่านค่า')
          : t('pageui.dyntag.pick_source_msg', 'Tag แบบ API ต้องระบุว่าจะไปอ่านค่าจาก endpoint ไหน ไม่งั้นจะตอบ N/A เสมอ\n\nเลือกได้ 2 ทาง:\n• กดปุ่ม "Choose" ที่ endpoint ฝั่งขวา — ระบบจะตั้งให้อัตโนมัติ\n• หรือเลือกเองจากช่อง Sub Type')) as any,
        type: 'warning',
      });
      return;
    }
    // ==== [FIX-20260730-SUBTYPEGATE] END

    setLoading(true);
    try {
      const payload = {
        ...formData,
        value: finalValue,
        sub_type: String(formData.sub_type || '').replace(/\/+$/, ''),
        // ==== [FEAT-20260728-TAGSCOPE] START — multi-group scope:
        // กลุ่มไหนติ๊กครบทุก OA → เข้า group_ids (ทั้งกลุ่ม — OA ใหม่เข้ากลุ่มได้ผลอัตโนมัติ)
        // กลุ่มไหนติ๊กบางตัว → OA เหล่านั้นเข้า hook_ids · โหมดเฉพาะ OA → hook_id เดี่ยว (เดิม)
        // primary_credential_source = credential ที่ใช้เทส/พรีวิว (แบบ (ก) — runtime ไม่กระทบ)
        hook_id: scopeMode === 'group' ? null : formData.hook_id,
        group_id: null, // เลิกเขียน legacy เดี่ยว — ใช้ group_ids แทน (BE อ่านรวมทั้งสอง)
        ...computeGroupScope(),
        primary_credential_source: scopeMode === 'group' ? (primaryCredId || null) : null,
        // ==== [FEAT-20260728-TAGSCOPE] END
      };

      // Omit tag in create mode as requested
      if (!initialData) {
        delete (payload as any).tag;
      }

      // Omit ref_api_id in all modes as requested
      delete (payload as any).ref_api_id;

      await onSubmit(payload as DynamicTagFormData);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  /* [FIX-20260830-COPYHTTP2] `utils/copyText`, never `navigator.clipboard`
     directly: the Clipboard API exists only in a SECURE CONTEXT, and this
     dashboard is served over plain http — the call was a silent no-op while
     the success UI fired anyway. copyText falls back to execCommand and
     returns whether the copy really happened. */
  const handleCopyTag = async (tag: string) => {
    const wrappedTag = `[[${tag}]]`;
    if (!(await copyText(wrappedTag))) return;
    setToast({ message: 'Tag Copied!', tag: wrappedTag });
    setTimeout(() => setToast(null), 3000);
  };

  const selectedHook = hooks.find(h => h._id === formData.hook_id);

  // ==== [FIX-20260729-DYTAGTOOL] START — Sub Type ต้องเห็น path ของ custom tool ด้วย
  // เดิมอ่านจาก selectedHook.external_endpoints ตรง ๆ (ของเส้น acme เท่านั้น)
  // → OA ที่ย้ายมาใช้ custom tool แล้ว ช่องนี้ว่าง ขึ้น "No external endpoints found"
  //
  // "main OA" = OA ที่ยืม credential มาใช้ตอนพรีวิว (ใช้เฉพาะในฟอร์มนี้ ไม่ใช่ runtime)
  //   โหมดกลุ่ม  → ช่อง PRIMARY CREDENTIAL SOURCE (primaryCredId)
  //   โหมด OA    → OA ที่เลือกอยู่ (formData.hook_id)
  // BE เป็นคน resolve ว่า OA นั้นเป็นสาย custom tool หรือ external_endpoints เดิม
  // [FIX-20260729-HOOKORDER] credHookId / toolEndpoints / toolSourceName and their
  // effect were moved ABOVE `if (!isOpen) return null` — see that block for why.

  // เส้นจาก custom tool มาก่อน ถ้าไม่มีค่อยตกไปใช้ external_endpoints เดิม
  // (OA เส้นเดิมจะได้ผลลัพธ์เท่าเดิมเป๊ะ เพราะ BE คืนรูปเดียวกันจาก hook)
  const rawHookEndpoints = selectedHook?.external_endpoints
    ? (selectedHook.external_endpoints instanceof Map
        ? Object.fromEntries(selectedHook.external_endpoints)
        : selectedHook.external_endpoints)
    : {};

  const externalEndpoints: Record<string, any> = toolEndpoints.length > 0
    ? Object.fromEntries(toolEndpoints.map((e: any) => [e.key, e]))
    : rawHookEndpoints;
  // ==== [FIX-20260729-DYTAGTOOL] END

  // [FIX-20260730-SUBTYPEGATE] ตัวเติม sub_type อัตโนมัติอยู่ **เหนือ**
  // `if (!isOpen) return null` ตามกฎใน [FIX-20260729-HOOKORDER] — ดู marker
  // เดียวกันด้านบนไฟล์ (ห้ามย้ายลงมาตรงนี้ จะเกิด React error #310)

  const currentSubOptionsLabels = formData.type === 'api' ? [
    ...Object.keys(externalEndpoints).map(key => ({ label: key, value: key, group: 'Hook Endpoints' })),
    // [FIX-20260730-BPDEFAULTS] ชุด System Defaults เป็น path ของสาย acme
    // เท่านั้น → ระบบที่ไม่ใช่สายนั้นเลือกไปก็ยิงไม่ได้ ซ่อนไปเลยดีกว่าให้เลือกผิด
    ...(acmeCategory ? SUB_TYPE_API_OPTIONS : [])
      .filter(opt => !Object.keys(externalEndpoints).includes(opt.value))
      .map(opt => ({ ...opt, group: 'System Defaults' }))
  ] : SUB_TYPE_SYSTEM_OPTIONS;

  const selectedSubType = currentSubOptionsLabels.find(opt => opt.value === formData.sub_type);

  const handleLogin = async () => {
    // [FIX-20260729-DYTAGTOOL] เดิมเช็ค formData.hook_id ซึ่ง "โหมดกลุ่ม" เป็นค่าว่าง
    // → ปุ่ม Login ไม่ทำงานเลย · ใช้ credHookId (main OA) แทนให้ครอบทั้ง 2 โหมด
    // และส่ง main OA ไปให้ BE resolve credential (custom tool หรือเส้นเดิม)
    if (!credHookId) {
      setThaiError({
        title: t('pageui.dyntag.cannot_test_title', 'ยังทดสอบไม่ได้'),
        message: t('pageui.dyntag.cannot_test_msg', 'เลือก OA ที่จะใช้เป็นแหล่ง credential ก่อน (ช่อง PRIMARY CREDENTIAL SOURCE)'),
        type: 'warning',
      });
      return;
    }
    setIsLoggingIn(true);
    try {
      const { token } = await dynamicTagService.loginHook(credHookId, credHookId);
      if (token) {
        setTestToken(token);
        setThaiError({
          title: t('pageui.dyntag.login_ok_title', 'Login สำเร็จ'),
          message: (
            <div className="space-y-2">
              <p>{t('pageui.dyntag.login_ok_msg', 'ระบบทำการเชื่อมต่อและรับ Token สำหรับเรียกใช้ API เรียบร้อยแล้วครับ')}</p>
              <div className="p-2 bg-emerald-50 rounded border border-emerald-100 text-[10px] font-mono text-emerald-700 break-all">
                {token.substring(0, 50)}...
              </div>
            </div>
          ) as any,
          type: 'success'
        });
      }
    } catch (err: any) {
      console.error(err);
      setThaiError({
        title: t('pageui.dyntag.login_fail_title', 'Login ไม่สำเร็จ'),
        message: (
          <div className="space-y-4">
            <p>{t('pageui.dyntag.login_fail_msg', 'เกิดปัญหาในการขอสิทธิ์เข้าถึง (JWT Token) จาก Bot ครับ')}</p>
            <p className="p-2 bg-red-50 rounded border border-red-100 text-red-700 text-sm font-bold">{err.message}</p>
            {err.rawResponse && (
              <div className="mt-2">
                <p className="text-[10px] font-black uppercase text-slate-500 mb-1">Response JSON:</p>
                <div className="bg-dark-900 p-0 rounded-lg border border-dark-700 overflow-hidden">
                  <pre className="p-3 overflow-auto max-h-[150px] text-[10px] font-mono text-slate-700 custom-scrollbar">
                    {(() => {
                      try { return JSON.stringify(JSON.parse(err.rawResponse), null, 2); }
                      catch { return err.rawResponse; }
                    })()}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ) as any,
        type: 'error'
      });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleTestEndpoint = async (endpointKey: string) => {
    if (!formData.hook_id || !testLineUserId || !testToken) return;
    
    // Auto-collapse logic: toggling if already expanded, otherwise expand
    setExpandedKey(prev => prev === endpointKey ? null : endpointKey);
    
    // Sync sub_type with tested endpoint
    setFormData(prev => ({ ...prev, sub_type: endpointKey }));

    setIsTesting(endpointKey);
    try {
      const result = await dynamicTagService.testExternalEndpoint(
        formData.hook_id,
        endpointKey,
        testLineUserId,
        testToken
      );

      setTestResults(prev => ({ ...prev, [endpointKey]: result }));
      
      setThaiError({
        title: t('pageui.dyntag.test_ok_title', 'สำเร็จ! เชื่อมต่อ API เรียบร้อย'),
        message: (
          <div className="space-y-3">
            <p>{t('pageui.dyntag.test_ok_a', 'ระบบดึงข้อมูลตัวอย่างจาก')} <strong className="text-emerald-600 underline text-sm">{endpointKey}</strong> {t('pageui.dyntag.test_ok_b', 'สำเร็จแล้วครับ')}</p>
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 text-emerald-800 text-xs font-bold leading-relaxed">
              <span className="opacity-50 inline-block w-20">Sub Type:</span> {endpointKey}
            </div>
            <p className="text-[10px] text-slate-500 mt-2 italic">{t('pageui.dyntag.test_ok_json_hint', '* ท่านสามารถตรวจสอบโครงสร้างข้อมูล JSON ได้ที่พาเนลด้านขวาครับ')}</p>
          </div>
        ) as any,
        type: 'success'
      });
    } catch (err: any) {
      console.error(err);
      setThaiError({
        title: t('pageui.dyntag.test_fail_title', 'เกิดข้อผิดพลาดในการดึงข้อมูล'),
        message: (
          <div className="space-y-4">
            <p className="text-sm">{t('pageui.dyntag.test_fail_a', 'ไม่สามารถเชื่อมต่อหรือดึงข้อมูลจาก API')} <strong className="text-red-600">[{endpointKey}]</strong> {t('pageui.dyntag.test_fail_b', 'ได้ครับ')}</p>
            <div className="p-3 bg-red-50 rounded-lg border border-red-100">
              <p className="text-red-700 text-xs font-bold">{err.message}</p>
            </div>
            {err.rawResponse && (
              <div className="mt-2">
                <p className="text-[10px] font-black uppercase text-slate-500 mb-1">Response JSON (Error):</p>
                <div className="bg-dark-900 p-0 rounded-lg border border-dark-700 overflow-hidden">
                  <pre className="p-3 overflow-auto max-h-[200px] text-[10px] font-mono text-slate-700 custom-scrollbar">
                    {(() => {
                      try { return JSON.stringify(JSON.parse(err.rawResponse), null, 2); }
                      catch { return err.rawResponse; }
                    })()}
                  </pre>
                </div>
              </div>
            )}
            <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
              {t('pageui.dyntag.test_fail_tip', 'คำแนะนำ: ตรวจสอบข้อมูลใน Hook Settings ว่าระบุ Method และ Path ถูกต้อง หรือเซิร์ฟเวอร์ปลายทาง (3rd Party) เปิดใช้งานอยู่หรือไม่')}
            </p>
          </div>
        ) as any,
        type: 'error'
      });
    } finally {
      setIsTesting(null);
    }
  };

  const handleTestComparison = async () => {
    if (!initialData || !formData.hook_id || !testLineUserId || !testToken) return;
    
    // We need to know which endpoint to test. Use sub_type's key.
    // In our case, sub_type values like 'api/v1/customer' map to keys in external_endpoints.
    // Let's assume the labels or values can be mapped.
    const endpointKey = formData.sub_type; 
    
    setLoading(true);
    try {
      const updatedValue = formData.value.startsWith('data.') ? formData.value : `data.${formData.value}`;
      const currentValue = initialData.value;

      const result = await dynamicTagService.testExternalEndpoint(
        formData.hook_id,
        endpointKey,
        testLineUserId,
        testToken
      );

      if (result && result.data) {
        setComparison({
          current: result.data,
          updated: result.data, // In a real scenario, you might have different data, but here we compare based on paths
          currentValue: currentValue,
          updatedValue: updatedValue
        });
        setIsPreviewOpen(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePreview = () => {
    if (isPreviewOpen) {
      setIsPreviewOpen(false);
      return;
    }

    if (!formData.hook_id) {
      setThaiError({
        title: t('pageui.dyntag.need_oa_preview_title', 'กรุณาเลือก OA ก่อนครับ'),
        message: (
          <div className="space-y-3">
            <p className="text-lg font-bold text-slate-800">{t('pageui.dyntag.need_oa_preview_head', '⚠️ ต้องเลือก OA / Bot ก่อนดูพรีวิว')}</p>
            <p className="text-slate-600 leading-relaxed">
              {t('pageui.dyntag.need_oa_preview_body', 'ขออภัยครับ ระบบจำเป็นต้องทราบว่าท่านต้องการดึงข้อมูลจาก OA ตัวไหน เพื่อจำลองการทำงานและตรวจสอบความถูกต้องของ Tag ให้ครับ')}
            </p>
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-xs italic">
              {t('pageui.dyntag.need_oa_preview_note', '* โปรดระบุ OA ในช่องด้านล่างก่อนกดปุ่ม Preview อีกครั้งครับ')}
            </div>
          </div>
        ) as any,
        type: 'warning'
      });
      return;
    }

    setShowGuidanceModal(true);
  };


  return (
    <>
      {/* Value Mapping Guidance Modal */}
      {showGuidanceModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-dark-900/40 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-primary-600 p-8 text-white relative overflow-hidden">
               <div className="absolute -top-6 -right-6 p-8 opacity-10 rotate-12 scale-150 transform">
                  <Terminal size={120} strokeWidth={1} />
               </div>
               <div className="relative z-10">
                  <h3 className="text-2xl font-black uppercase tracking-tighter">Value Guidance</h3>
                  <p className="text-primary-100 text-sm mt-1 font-medium italic">JSON Structure Selection Guide</p>
               </div>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="space-y-4">
                <p className="text-sm text-slate-600 leading-relaxed">
                  {t('pageui.dyntag.guidance_body', 'เมื่อดึงข้อมูลจาก API มาแล้ว **กรุณาระบุเฉพาะชื่อฟิลด์ที่ต้องการ** ตามโครงสร้าง JSON จริงครับ โดยระบบจะทำการเจาะชั้นข้อมูลให้โดยอัตโนมัติ')}
                </p>
                
                <div className="space-y-4 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <div className="space-y-2">
                    <p className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                      👤 Profile (api/v1/customer)
                    </p>
                    <div className="flex flex-wrap gap-1.5 font-mono">
                      <code className="text-[10px] bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-primary-600 font-bold">customer.customer_name</code>
                      <code className="text-[10px] bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-primary-600 font-bold">contract.down_payment</code>
                      <code className="text-[10px] bg-white border border-slate-200 px-2.5 py-1 rounded-lg text-primary-600 font-bold">product.device_model</code>
                    </div>
                  </div>
                </div>


                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="shrink-0 text-blue-500 mt-0.5"><Check size={16} strokeWidth={3} /></div>
                  <p className="text-[11px] text-blue-700 leading-normal font-medium italic">
                    💡 <strong>Tips:</strong> {t('pageui.dyntag.guidance_tip', 'ยึดตามหน้าตา JSON ที่เห็นในหน้าพรีวิวได้เลยครับ บันทึกเฉพาะเส้นทางเข้าถึงฟิลด์ (Dot Notation) เท่านั้น')}
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowGuidanceModal(false);
                  setIsPreviewOpen(true);
                }}
                className="w-full py-4 bg-primary-600 hover:bg-primary-500 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-primary-500/20 hover:shadow-primary-500/40 transition-all active:scale-95 text-sm"
              >
                Continue to Preview
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark-900/60 backdrop-blur-sm">
      <div className={`bg-dark-800 rounded-2xl border border-dark-700 shadow-2xl flex flex-col transition-all duration-300 ease-in-out ${
        isPreviewOpen ? 'max-w-[95vw] w-[95vw] h-[95vh]' : 'max-w-2xl w-full h-[90vh]'
      } relative`}>
        
        {/* Form Level Toast Notification */}
        {toast && (() => {
          const isLineUserCopy = toast.message.includes('Member User ID');
          return (
            <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-[70] text-white px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-6 duration-300 backdrop-blur-md min-w-[280px] max-w-[380px] ${
              isLineUserCopy
                ? 'bg-gradient-to-r from-blue-700 to-indigo-500 border border-blue-400/40'
                : 'bg-emerald-600 border border-emerald-400/30'
            }`}>
              <div className={`p-2.5 rounded-xl shrink-0 ${isLineUserCopy ? 'bg-white/20' : 'bg-white/20'}`}>
                {isLineUserCopy ? <Users size={22} className="text-white" /> : <Check size={20} className="text-white" />}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-black tracking-tight leading-tight">{toast.message}</span>
                <p className="text-[11px] font-mono opacity-90 truncate mt-0.5 font-medium">
                  {toast.tag}
                </p>
              </div>
            </div>
          );
        })()}

        {/* Scroll Indicator Arrow - Form Side */}
        {showFormScrollArrow && (
          <div className={`absolute bottom-[30px] ${isPreviewOpen ? 'left-[20%]' : 'left-1/2'} -translate-x-1/2 z-[55] pointer-events-none flex flex-col items-center animate-bounce`}>
            <div className="bg-primary-500 text-white p-2 rounded-full shadow-lg shadow-primary-500/50">
              <ChevronDown size={24} strokeWidth={3} />
            </div>
            <span className="text-[10px] font-black uppercase text-primary-500 mt-1 bg-white px-2 py-0.5 rounded shadow whitespace-nowrap">Scroll Down (Form)</span>
          </div>
        )}

        {/* Scroll Indicator Arrow - Preview Side */}
        {isPreviewOpen && showPreviewScrollArrow && (
          <div className="absolute bottom-[30px] left-[70%] -translate-x-1/2 z-[55] pointer-events-none flex flex-col items-center animate-bounce">
            <div className="bg-indigo-500 text-white p-2 rounded-full shadow-lg shadow-indigo-500/50">
              <ChevronDown size={24} strokeWidth={3} />
            </div>
            <span className="text-[10px] font-black uppercase text-indigo-500 mt-1 bg-white px-2 py-0.5 rounded shadow whitespace-nowrap">Scroll Down (Preview)</span>
          </div>
        )}

        <div className="flex items-center justify-between p-6 border-b border-dark-700 shrink-0 bg-dark-800 rounded-t-2xl z-10">
          <h3 className="text-xl font-bold text-slate-900">
            {mode === 'view' ? 'View Dynamic Tag' : (initialData ? 'Update' : 'Create')}
          </h3>
          {/* ==== [FEAT-20260729-CLOSEPREVIEW] START — 🔒 สาย AUTO
              ปุ่มปิด preview อยู่ล่างสุดของฟอร์มที่เดียว พอ preview เปิด modal จะกว้าง
              95vw ผู้ใช้ต้องเลื่อนลงไปหาปุ่มเพื่อปิด — เพิ่มปุ่มบน header ให้กดปิดได้
              ทันทีจากทุกโหมด (create / update / view) ปุ่มเดิมล่างฟอร์มยังอยู่
              แสดงเฉพาะตอน preview เปิดอยู่ เพื่อไม่ให้ header รกตอนไม่ได้ใช้
              revert: ลบ block ระหว่าง START/END นี้ */}
          <div className="flex items-center gap-3">
            {isPreviewOpen && (
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                title={t('pageui.dyntag.close_preview', 'ปิด Preview')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-dark-700 hover:bg-red-500/20 text-slate-900 hover:text-red-500 text-xs font-black uppercase tracking-wider transition-all border border-dark-600 hover:border-red-500/40"
              >
                <X size={14} /> Close Preview
              </button>
            )}
            {/* ==== [FEAT-20260729-CLOSEPREVIEW] END */}
            <div className="flex items-center gap-2 border-r border-dark-700 pr-3 mr-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-dark-700 hover:bg-dark-600 text-slate-900 text-sm font-bold transition-all"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const payload = {
                    ...formData,
                    value: formData.value.startsWith('data.') ? formData.value : `data.${formData.value}`,
                    sub_type: String(formData.sub_type || '').replace(/\/+$/, ''),
                    // [FEAT-20260728-TAGSCOPE] พรีวิว payload ให้ตรงกับที่จะบันทึกจริง (multi-group)
                    hook_id: scopeMode === 'group' ? null : formData.hook_id,
                    group_id: null,
                    ...computeGroupScope(),
                    primary_credential_source: scopeMode === 'group' ? (primaryCredId || null) : null
                  };
                  if (!initialData) delete (payload as any).tag;
                  delete (payload as any).ref_api_id;
                  
                  setThaiError({
                    title: "Preview Post Payload",
                    message: (
                      <div className="space-y-4">
                        <p className="text-[10px] font-black uppercase text-slate-500 mb-1">JSON data to be sent to backend:</p>
                        <div className="bg-dark-900 p-0 rounded-lg border border-dark-700 overflow-hidden">
                          <pre className="p-3 overflow-auto max-h-[400px] text-[10px] font-mono text-emerald-500 custom-scrollbar bg-dark-950">
                            {JSON.stringify(payload, null, 2)}
                          </pre>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          {t('pageui.dyntag.payload_hint_a', '💡 นี่คือข้อมูลชุดเดียวกับที่จะถูกส่งไปบันทึกที่ Backend ครับ ท่านสามารถตรวจสอบความถูกต้องของ')} <strong>sub_type</strong> {t('pageui.dyntag.payload_hint_b', 'และ')} <strong>value</strong> {t('pageui.dyntag.payload_hint_c', 'ได้จากตรงนี้ครับ')}
                        </p>
                      </div>
                    ) as any,
                    type: 'info'
                  });
                }}
                className="px-4 py-2 rounded-lg bg-slate-50 border border-slate-200 hover:bg-white text-slate-600 text-sm font-bold transition-all flex items-center gap-2"
              >
                <Terminal size={16} />
                Payload
              </button>
              {mode !== 'view' && (
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="px-6 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-sm font-bold shadow-lg shadow-primary-500/20 transition-all flex items-center gap-2"
                >
                  {loading && <Loader2 className="animate-spin" size={18} />}
                  {initialData ? t('common.save') : t('common.add_new')}
                </button>
              )}

            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-dark-700 text-slate-400 hover:text-red-500 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Form Panel */}
          <div className={`flex flex-col transition-all duration-300 ${isPreviewOpen ? 'w-[40%] border-r border-dark-700' : 'w-full'}`}>
            <div 
              ref={formScrollRef}
              onScroll={checkFormScroll}
              className="flex-1 overflow-y-auto p-6 pr-20 large-scrollbar relative"
            >
              <form onSubmit={handleSubmit}>
                {/* Video Guide Section */}
                <div className="mb-8 p-5 rounded-2xl bg-emerald-50/50 border border-emerald-500/20 flex flex-col sm:flex-row items-center gap-5 transition-all hover:bg-emerald-50 hover:border-emerald-500/40 group relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-emerald-500/10 transition-colors" />
                  <div className="flex-1 z-10">
                    <div className="flex items-center gap-2 mb-2 text-emerald-600">
                      <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-500/20">
                        <Info size={16} className="text-emerald-500" />
                      </div>
                      <span className="text-xs font-black uppercase tracking-wider">{t('pageui.dyntag.manual', 'คู่มือการใช้งาน')}</span>
                    </div>
                    <p className="text-[13px] text-slate-700 leading-relaxed font-black">
                      {t('pageui.dyntag.clip_title', 'คลิป: ตั้งค่า dynamic tags')}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {t('pageui.dyntag.clip_desc', 'ศึกษาขั้นตอนการตั้งค่า API และการใช้งานตัวแปรเสริมเพื่อดึงข้อมูลจากระบบภายนอกอัตโนมัติ')}
                    </p>
                  </div>
                  <a 
                    href="https://drive.google.com/file/d/EXAMPLE_FILE_ID/view?usp=sharing" 
                    target="_blank" 
                    rel="noreferrer"
                    className="flex-shrink-0 w-full sm:w-[160px] aspect-video rounded-xl relative overflow-hidden group/vdo cursor-pointer border-2 border-emerald-500/30 bg-dark-900 shadow-xl hover:shadow-emerald-500/40 transition-all active:scale-95 animate-pulse-slow z-10"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/30 to-dark-900 flex items-center justify-center">
                       <div className="w-12 h-12 rounded-full bg-red-600/90 backdrop-blur-md flex items-center justify-center border border-white/30 group-hover/vdo:scale-110 group-hover/vdo:bg-red-500 transition-all duration-500 shadow-2xl shadow-red-500/40">
                          <Play size={24} className="text-white fill-white ml-1" />
                       </div>
                    </div>
                    <div className="absolute inset-0 bg-emerald-500/20 opacity-0 group-hover/vdo:opacity-100 transition-opacity duration-500" />
                    <div className="absolute bottom-2 right-2 bg-dark-950/80 backdrop-blur-md px-2.5 py-1 rounded-lg flex items-center gap-1.5 border border-white/10">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[9px] font-black uppercase text-white tracking-widest">{t('pageui.dyntag.watch_clip', 'ดูคลิป')}</span>
                    </div>
                  </a>
                </div>
                <div className={`grid gap-6 ${isPreviewOpen ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
                  <div className="space-y-4">
                    {initialData && (
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-sm font-semibold text-slate-700">Tag</label>
                          {formData.tag && (
                            <button
                              type="button"
                              onClick={() => handleCopyTag(formData.tag)}
                              className="text-primary-500 hover:text-primary-600 transition-colors flex items-center gap-1.5 text-xs font-bold"
                              title="Copy Tag"
                            >
                              <Copy size={14} /> Copy
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={`[[${formData.tag}]]`}
                          readOnly
                          disabled
                          className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-3 text-primary-600 font-bold placeholder-slate-500 outline-none transition-all opacity-80 cursor-default"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Value</label>
                      <input
                        type="text"
                        value={formData.value}
                        /* [FIX-20261014-TAGVALUECASE] kept as typed — the BE path reader is
                           case-sensitive and partners use camelCase keys (increaseBalance) */
                        onChange={e => setFormData(prev => ({ ...prev, value: e.target.value }))}
                        disabled={mode === 'view'}
                        placeholder="customer.customer_name"
                        className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-500 focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-50 font-mono text-sm"
                        required
                      />
                    </div>



                    {/* ==== [FEAT-20260728-TAGSCOPE] START — เดิมมีแต่ dropdown "choose OA" ตัวเดียว
                        ใหม่: เลือก scope ก่อน — ทั้งกลุ่ม (ทุก OA ในกลุ่ม) หรือเฉพาะ OA (เดิม) */}
                    <div>
                      <label className="block text-sm font-black text-primary-600 mb-2 uppercase tracking-tight flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
                        {t('pageui.dyntag.scope_label', 'ขอบเขตการใช้ tag')}
                      </label>
                      {/* [FEAT-20260728-TAGSCOPE] สลับ "ทั้งกลุ่ม" ขึ้นก่อนตามสั่ง 2026-07-28
                          ไม่มีกลุ่มตามสิทธิ์ → ปุ่มทั้งกลุ่มกดไม่ได้ (ห้ามพัง) */}
                      <div className="flex rounded-2xl border-2 border-primary-500 overflow-hidden mb-3">
                        {/* update ก็แก้ scope ได้ (ตามสั่ง create+update) — ปิดเฉพาะโหมด view */}
                        <button type="button" disabled={mode === 'view' || tagGroups.length === 0}
                          onClick={() => setScopeMode('group')}
                          className={`flex-1 py-3 text-sm font-black transition-colors ${scopeMode === 'group' ? 'bg-primary-500 text-white' : 'bg-white text-slate-500 hover:bg-primary-50'} disabled:opacity-50`}>
                          {t('pageui.dyntag.scope_group', 'ทั้งกลุ่ม')}
                        </button>
                        <button type="button" disabled={mode === 'view'}
                          onClick={() => setScopeMode('hook')}
                          className={`flex-1 py-3 text-sm font-black transition-colors ${scopeMode === 'hook' ? 'bg-primary-500 text-white' : 'bg-white text-slate-500 hover:bg-primary-50'} disabled:opacity-50`}>
                          {t('pageui.dyntag.scope_hook', 'เฉพาะ OA')}
                        </button>
                      </div>

                      {scopeMode === 'group' && (
                        <div className="mb-3">
                          {/* [FEAT-20260728-TAGSCOPE] เลือกได้หลายกลุ่ม (checkbox) — ตามสิทธิ์ login */}
                          <label className="block text-xs font-black text-primary-600 mb-2 uppercase tracking-tight">
                            {t('pageui.dyntag.pick_groups_count', 'เลือกกลุ่ม (ได้หลายกลุ่ม) — เลือกแล้ว {n}/{total}', { n: selectedGroupIds.length, total: tagGroups.length })}
                          </label>
                          <div className="w-full bg-white border-2 border-primary-500 rounded-2xl shadow-lg shadow-primary-500/10 max-h-36 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                            {tagGroups.map(g => {
                              const gchecked = selectedGroupIds.includes(g._id);
                              return (
                                <label key={g._id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${gchecked ? 'bg-purple-50/60' : 'hover:bg-slate-50'} ${mode === 'view' ? 'pointer-events-none opacity-60' : ''}`}>
                                  <input type="checkbox" checked={gchecked}
                                    onChange={() => setSelectedGroupIds(prev => gchecked ? prev.filter(x => x !== g._id) : [...prev, g._id])}
                                    className="w-4 h-4 accent-purple-600 shrink-0" />
                                  <span className="text-sm font-bold text-slate-800 truncate">👥 {g.group_name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {scopeMode === 'group' ? (
                        <>
                          {/* [FEAT-20260728-TAGSCOPE] checkbox "OA ที่ tag มีผลจริง" (ใช้ได้จริง ไม่ใช่แค่เทส)
                              ติ๊กครบ = บันทึกเป็นทั้งกลุ่ม (group_id) · บางตัว = hook_ids เฉพาะที่ติ๊ก
                              สูง ~5 แถวแล้ว scroll · มีเลือกทั้งหมด/ยกเลิกทั้งหมด ตามสั่ง 2026-07-28 */}
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs font-black text-primary-600 uppercase tracking-tight">OA</label>
                            <div className="flex gap-2">
                              <button type="button" disabled={mode === 'view' || groupTestHooks.length === 0}
                                onClick={() => setCheckedHookIds(groupTestHooks.map((h: any) => String(h._id)))}
                                className="text-[11px] font-black text-primary-600 hover:text-primary-700 underline underline-offset-2 disabled:opacity-40">
                                {t('pageui.dyntag.select_all', 'เลือกทั้งหมด')}
                              </button>
                              <button type="button" disabled={mode === 'view' || checkedHookIds.length === 0}
                                onClick={() => setCheckedHookIds([])}
                                className="text-[11px] font-black text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-40">
                                {t('pageui.dyntag.clear_all', 'ยกเลิกทั้งหมด')}
                              </button>
                            </div>
                          </div>
                          <div className="w-full bg-white border-2 border-primary-500 rounded-2xl shadow-lg shadow-primary-500/10 max-h-44 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
                            {/* [FIX-20260801-TAGSCOPEUI] เดิมขึ้น "ไม่มี OA ในกลุ่มที่เลือก" ทั้งที่บางครั้ง
                                ยังไม่ได้เลือกกลุ่มเลย — คนละสาเหตุกัน แยกข้อความให้ตรง
                                (การกรอง OA ตามกลุ่มที่เลือกทำอยู่แล้วตั้งแต่แรก ไม่ได้แก้ตรรกะ)
                                revert: คืนเป็น div เดิมบรรทัดเดียว */}
                            {groupTestHooks.length === 0 && (
                              <div className="px-4 py-3 text-sm text-slate-400 italic">
                                {selectedGroupIds.length === 0
                                  ? t('pageui.dyntag.pick_group_first', 'เลือกกลุ่มก่อน แล้ว OA ในกลุ่มนั้นจะแสดงขึ้นมา')
                                  : t('pageui.dyntag.no_oa_in_group', 'ไม่มี OA ในกลุ่มที่เลือก (ตามสิทธิ์)')}
                              </div>
                            )}
                            {groupTestHooks.map((h: any) => {
                              const id = String(h._id);
                              const checked = checkedHookIds.includes(id);
                              return (
                                <label key={id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${checked ? 'bg-primary-50/60' : 'hover:bg-slate-50'} ${mode === 'view' ? 'pointer-events-none opacity-60' : ''}`}>
                                  <input type="checkbox" checked={checked}
                                    onChange={() => setCheckedHookIds(prev => checked ? prev.filter(x => x !== id) : [...prev, id])}
                                    className="w-4 h-4 accent-primary-600 shrink-0" />
                                  <span className="text-sm font-bold text-slate-800 truncate flex-1">{h.line_oa_name} <span className="text-slate-400 font-medium">/ {h.alias}</span></span>
                                  {/* [FEAT-20260728-TAGSCOPE] ป้ายบอกว่า OA นี้มาจากกลุ่มไหน (ตามสั่ง) */}
                                  <span /* [FIX-20260801-TAGSCOPEUI] ธีม dark: พื้นป้ายกลายเป็นเข้ม ตัวหนังสือม่วงเลยจมไปกับพื้น
                                     → dark:text-white อย่างเดียว ไม่แตะพื้น/เส้นขอบ (เหมือนที่ทำกับป้ายเทียร์บนการ์ด)
                                     `dark:` ของโปรเจกต์นี้ผูกกับ .theme-dark ดู @custom-variant ใน index.css */
                                  className="shrink-0 text-[10px] font-bold text-purple-700 dark:text-white bg-purple-100 border border-purple-200 px-2 py-0.5 rounded-full">👥 {h.__groupName}</span>
                                </label>
                              );
                            })}
                          </div>
                          <p className="mt-1.5 text-[11px] text-slate-500">
                            {t('pageui.dyntag.ticked_summary', 'ติ๊กแล้ว {n}/{total} — กลุ่มที่ติ๊กครบทุกตัว บันทึกเป็น "ทั้งกลุ่ม" (OA เข้ากลุ่มใหม่ได้ผลอัตโนมัติ) · กลุ่มที่ติ๊กบางตัว บันทึกเฉพาะที่ติ๊ก', { n: checkedHookIds.length, total: groupTestHooks.length })}
                          </p>

                          {/* ==== [FEAT-20260728-TAGSCOPE] Primary Credential Source (เพิ่มใหม่) ====
                              tag ครอบหลาย OA แต่แต่ละ hook มี customer-API credential ของตัวเอง →
                              ต้องเลือกว่าใช้ credential ของ OA ไหนตอน "เทส/พรีวิว/Login ในฟอร์มนี้"
                              (แบบ (ก) ตามที่ user เลือก: runtime แชทจริงยังใช้ credential ของ OA
                              ที่ลูกค้าแชทอยู่ — ไม่กระทบ webhook) · เลือกได้เฉพาะ OA ที่ติ๊กไว้ */}
                          <div className="mt-3">
                            <label className="block text-xs font-black text-amber-600 mb-2 uppercase tracking-tight flex items-center gap-1">
                              🔑 Primary Credential Source <span className="normal-case font-medium text-slate-400">{t('pageui.dyntag.primary_cred_hint', '(ใช้ตอนเทส/พรีวิวในฟอร์ม — เลือกได้เฉพาะ OA ที่ติ๊ก)')}</span>
                            </label>
                            <select
                              value={primaryCredId}
                              onChange={e => setPrimaryCredId(e.target.value)}
                              disabled={mode === 'view' || checkedHookIds.length === 0}
                              className="w-full bg-amber-50/40 border-2 border-amber-400 rounded-2xl px-5 py-3.5 text-slate-900 font-bold shadow-lg shadow-amber-400/10 focus:ring-4 focus:ring-amber-400/20 outline-none transition-all disabled:opacity-50 appearance-none cursor-pointer hover:border-amber-500"
                            >
                              {checkedHookIds.length === 0 && <option value="">{t('pageui.dyntag.tick_oa_first', '— ติ๊ก OA ก่อน —')}</option>}
                              {groupTestHooks.filter((h: any) => checkedHookIds.includes(String(h._id))).map((h: any) => (
                                <option key={h._id} value={String(h._id)}>{h.line_oa_name} / {h.alias} {t('pageui.dyntag.group_paren', '(กลุ่ม {name})', { name: h.__groupName })}</option>
                              ))}
                            </select>
                          </div>
                        </>
                      ) : (
                        <>
                          <label className="block text-xs font-black text-primary-600 mb-2 uppercase tracking-tight">choose OA</label>
                          <select
                            value={formData.hook_id}
                            onChange={e => setFormData(prev => ({ ...prev, hook_id: e.target.value }))}
                            disabled={mode === 'view'}
                            className="w-full bg-white border-2 border-primary-500 rounded-2xl px-5 py-4 text-slate-900 font-bold shadow-lg shadow-primary-500/10 focus:ring-4 focus:ring-primary-500/20 outline-none transition-all disabled:opacity-50 appearance-none cursor-pointer hover:border-primary-600"
                            required={formData.type === 'api' && scopeMode === 'hook'}
                          >
                            <option value="">Select OA</option>
                            {/* โหมด OA เดี่ยว = ทุก OA ตามสิทธิ์ login (filterVisibleHooks) */}
                            {filterVisibleHooks(hooks).map((h: any) => (
                              <option key={h._id} value={h._id}>{h.line_oa_name} / {h.alias}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                    {/* ==== [FEAT-20260728-TAGSCOPE] END */}

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Type</label>
                      <select
                        value={formData.type}
                        onChange={e => {
                          const newType = e.target.value as 'api' | 'system';
                          setFormData(prev => ({ 
                            ...prev, 
                            type: newType,
                            sub_type: '' 
                          }));
                        }}
                        disabled={true}
                        className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none transition-all opacity-70 appearance-none cursor-not-allowed"
                      >
                        <option value="api">API</option>
                      </select>
                    </div>

                    {/* Show Sub Type here ONLY in preview mode to place it immediately after Type */}
                    {isPreviewOpen && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 flex justify-between items-center">
                          Sub Type
                          <button
                            type="button"
                            onClick={() => setIsPreviewOpen(!isPreviewOpen)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all shadow-lg ${
                              isPreviewOpen 
                                ? 'bg-red-500 text-white shadow-red-500/30' 
                                : 'bg-primary-500 text-white shadow-primary-500/30 animate-bounce'
                            } hover:scale-110 active:scale-95`}
                          >
                            {isPreviewOpen ? <X size={12} strokeWidth={3} /> : <Eye size={12} strokeWidth={3} />}
                            {isPreviewOpen ? 'CLOSE PREVIEW' : 'PREVIEW'}
                          </button>
                        </label>
                        <select
                          value={formData.sub_type}
                          onChange={e => {
                            const newVal = e.target.value;
                            setFormData(prev => ({ ...prev, sub_type: newVal }));
                            if (formData.type === 'api' && newVal) {
                              setIsPreviewOpen(true);
                            }
                          }}
                          disabled={mode === 'view'} /* [FIX-20260730-SUBTYPEGATE] เดิมปิดเมื่อ type==='api' ซึ่งกลับด้าน: API เป็นชนิดเดียวที่ *ต้อง* เลือก endpoint แต่กลับเลือกไม่ได้ → sub_type=null → tag ตอบ N/A ตลอด (ในระบบเป็น null 3/3 = ไม่มีใครเลือกได้เลย) · revert: กลับเป็น disabled={mode === 'view' || formData.type === 'api'} */
                          className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed appearance-none cursor-pointer"
                        >
                          <option value="">Select Option</option>
                          {Object.keys(externalEndpoints).length > 0 && (
                            <optgroup label="Hook Endpoints">
                              {Object.keys(externalEndpoints).map(key => (
                                <option key={key} value={key}>{key}</option>
                              ))}
                            </optgroup>
                          )}
                          {/* [FIX-20260730-BPDEFAULTS] ชุดนี้เป็น path ของสาย acme เท่านั้น
                              (api/line/v1/*.php) — ระบบที่ acme_category = false ไม่มี
                              endpoint พวกนี้ เลือกไปก็ได้ tag ที่ตอบ N/A จึงซ่อนทั้งกลุ่ม
                              revert: เอาเงื่อนไข acmeCategory ออก */}
                          {acmeCategory && (
                            <optgroup label="System Defaults">
                              {SUB_TYPE_API_OPTIONS
                                .filter(opt => !Object.keys(externalEndpoints).includes(opt.value))
                                .map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))
                              }
                            </optgroup>
                          )}
                        </select>
                        {/* ==== [FIX-20260730-SUBTYPEGATE] บอกสถานะให้เห็นทันที
                            ยังไม่เลือก = เตือนพร้อมบอกทางออก · เลือกแล้ว = ยืนยันว่าอ่านจากไหน
                            (ช่องนี้ตัดสินว่า tag ได้ค่าจริงหรือ N/A จึงต้องเห็นชัดตลอด)
                            revert: ลบ block นี้ */}
                        {formData.type === 'api' && (
                          !String(formData.sub_type || '').trim() ? (
                            <p className="mt-2 text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                              {t('pageui.dyntag.no_source_a', '⚠️ ยังไม่ได้เลือกแหล่งข้อมูล — tag จะตอบ')} <b>N/A</b> {t('pageui.dyntag.no_source_b', 'เสมอ')}
                              <span className="block font-normal mt-0.5">
                                {t('pageui.dyntag.no_source_c', 'กดปุ่ม')} <b>Choose</b> {t('pageui.dyntag.no_source_d', 'ที่ endpoint ฝั่งขวา (ระบบตั้งให้อัตโนมัติ) หรือเลือกเองจากช่องนี้')}
                              </span>
                            </p>
                          ) : (
                            <p className="mt-2 text-[11px] font-bold text-emerald-700">
                              {t('pageui.dyntag.reads_from', '✓ อ่านค่าจาก')} <code className="px-1 bg-emerald-50 rounded">{formData.sub_type}</code>
                            </p>
                          )
                        )}
                      </div>
                    )}

                    {/* Show Status here ONLY in 2-column mode to balance the UI */}
                    {!isPreviewOpen && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Status</label>
                        <select
                          value={formData.status ? 'true' : 'false'}
                          onChange={e => setFormData(prev => ({ ...prev, status: e.target.value === 'true' }))}
                          disabled={mode === 'view'}
                          className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-50 appearance-none cursor-pointer"
                        >
                          <option value="true">Active</option>
                          <option value="false">Inactive</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    {/* Show Status here ONLY in preview mode to move it down */}
                    {isPreviewOpen && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Status</label>
                        <select
                          value={formData.status ? 'true' : 'false'}
                          onChange={e => setFormData(prev => ({ ...prev, status: e.target.value === 'true' }))}
                          disabled={mode === 'view'}
                          className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-50 appearance-none cursor-pointer"
                        >
                          <option value="true">Active</option>
                          <option value="false">Inactive</option>
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Detail</label>
                      <textarea
                        value={formData.detail}
                        onChange={e => setFormData(prev => ({ ...prev, detail: e.target.value }))}
                        disabled={mode === 'view'}
                        rows={isPreviewOpen ? 3 : 5}
                        className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-500 focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-50 resize-none"
                      />
                    </div>

                    {/* Show Sub Type here ONLY in 2-column mode to balance the UI */}
                    {!isPreviewOpen && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2 flex justify-between items-center">
                          Sub Type
                          <button
                            type="button"
                            onClick={handleTogglePreview}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all shadow-lg ${
                              isPreviewOpen 
                                ? 'bg-red-500 text-white shadow-red-500/30' 
                                : 'bg-primary-500 text-white shadow-primary-500/30 animate-bounce'
                            } hover:scale-110 active:scale-95`}
                          >
                            {isPreviewOpen ? <X size={12} strokeWidth={3} /> : <Eye size={12} strokeWidth={3} />}
                            {isPreviewOpen ? 'CLOSE PREVIEW' : 'PREVIEW'}
                          </button>

                        </label>
                        <select
                          value={formData.sub_type}
                          onChange={e => {
                            const newVal = e.target.value;
                            setFormData(prev => ({ ...prev, sub_type: newVal }));
                            if (formData.type === 'api' && newVal) {
                              setIsPreviewOpen(true);
                            }
                          }}
                          disabled={mode === 'view'} /* [FIX-20260730-SUBTYPEGATE] เดิมปิดเมื่อ type==='api' ซึ่งกลับด้าน: API เป็นชนิดเดียวที่ *ต้อง* เลือก endpoint แต่กลับเลือกไม่ได้ → sub_type=null → tag ตอบ N/A ตลอด (ในระบบเป็น null 3/3 = ไม่มีใครเลือกได้เลย) · revert: กลับเป็น disabled={mode === 'view' || formData.type === 'api'} */
                          className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-primary-500 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed appearance-none cursor-pointer"
                        >
                          <option value="">Select Option</option>
                          {Object.keys(externalEndpoints).length > 0 && (
                            <optgroup label="Hook Endpoints">
                              {Object.keys(externalEndpoints).map(key => (
                                <option key={key} value={key}>{key}</option>
                              ))}
                            </optgroup>
                          )}
                          {/* [FIX-20260730-BPDEFAULTS] ชุดนี้เป็น path ของสาย acme เท่านั้น
                              (api/line/v1/*.php) — ระบบที่ acme_category = false ไม่มี
                              endpoint พวกนี้ เลือกไปก็ได้ tag ที่ตอบ N/A จึงซ่อนทั้งกลุ่ม
                              revert: เอาเงื่อนไข acmeCategory ออก */}
                          {acmeCategory && (
                            <optgroup label="System Defaults">
                              {SUB_TYPE_API_OPTIONS
                                .filter(opt => !Object.keys(externalEndpoints).includes(opt.value))
                                .map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))
                              }
                            </optgroup>
                          )}
                        </select>
                      </div>
                    )}

                  </div>
                </div>

                {/* Financial Calculation Caution Notice */}
                {!isPreviewOpen && (
                  <div className="mt-8 p-4 bg-orange-50 border border-orange-200 rounded-xl flex items-start gap-3">
                    <div className="shrink-0 p-2 bg-orange-100 rounded-lg">
                      <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-orange-800 uppercase tracking-wider">{t('pageui.dyntag.fin_title', 'ข้อแนะนำเรื่องความถูกต้องของข้อมูล (Financial Caution)')}</h4>
                      <p className="text-xs text-orange-700 leading-relaxed font-medium">
                        {t('pageui.dyntag.fin_a', 'สำหรับการคำนวณตัวเลข (เช่น ยอดคงเหลือ หรือ ดอกเบี้ย) **แนะนำให้จัดการจากฝั่ง 3rd party API โดยตรงครับ** เนื่องจากระบบ Webhook ของเราทำหน้าที่เป็น Middleware เพื่อความแม่นยำสูงสุด หากค่าที่ดึงมามีตัวดำเนินการอยู่แล้ว (เช่น')} <span className="underline decoration-orange-300 font-bold">2/12</span>{t('pageui.dyntag.fin_b', ') แล้วนำไปใช้ร่วมกับสูตรอื่น (เช่น')} <span className="underline decoration-orange-300 font-bold">x-2/12</span>{t('pageui.dyntag.fin_c', ') อาจทำให้ฟังก์ชันทำงานผิดพลาดได้ครับ')}
                      </p>
                    </div>
                  </div>
                )}





              </form>
            </div>
          </div>

          {/* Preview Panel */}
          {isPreviewOpen && (
            <div className="w-[60%] flex flex-col bg-slate-50 animate-in slide-in-from-right-4 duration-300 border-l border-dark-700 overflow-hidden bg-dark-900 pr-2 pl-12">
              <div 
                ref={previewScrollRef}
                className="flex-1 overflow-y-auto large-scrollbar pt-6 pb-6 pl-6 pr-24 space-y-8 h-full relative"
                onScroll={checkPreviewScroll}
              >
                
                {/* ─── Active Member Quick Copy ───────────────────────── */}
                {(() => {
                  const hookMap = new Map<string, HookData>(hooks.map(h => [h._id, h]));
                  const currentRoom = rooms.find(r => r._id === selectedRoomId);
                  const currentHook = currentRoom?.hook_id ? hookMap.get(currentRoom.hook_id) : undefined;

                  return (
                    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-green-50 shadow-md overflow-hidden transition-all duration-300">
                      {/* Section Header */}
                      <div className="flex items-center justify-between gap-3 px-5 py-4 bg-emerald-600 text-white cursor-pointer" onClick={() => {
                        const nextState = !isUserToolsExpanded;
                        setIsUserToolsExpanded(nextState);
                        if (nextState) setIsAuthExpanded(false);
                      }}>
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-white/20">
                            <Users size={18} className="text-white" />
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-100">Developer Tool</p>
                            <h4 className="text-base font-extrabold leading-tight tracking-tight">Active Member Quick Copy</h4>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {loadingUsers && (
                            <Loader2 size={16} className="animate-spin text-white/70" />
                          )}
                          <div className="p-1 rounded-md hover:bg-white/20 transition-colors">
                            {isUserToolsExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                          </div>
                        </div>
                      </div>

                      {isUserToolsExpanded && (
                        <div className="px-5 py-6 flex flex-col gap-6 animate-in slide-in-from-top-2 duration-300 min-h-[300px]">
                          {/* Searchable Select dropdown */}
                          <div className="flex flex-col gap-2 relative">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Select Active User</label>
                            
                            <div className="relative">
                              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search className="text-emerald-400" size={16} />
                              </div>
                              <input
                                type="text"
                                placeholder={t('pageui.dyntag.user_search_ph', 'พิมพ์ค้นหาชื่อ User...')}
                                value={userSearchText}
                                onChange={(e) => {
                                  setUserSearchText(e.target.value);
                                  setIsUserMenuOpen(true);
                                }}
                                onFocus={() => setIsUserMenuOpen(true)}
                                className="w-full bg-white border-2 border-emerald-200 rounded-xl py-3 pl-10 pr-3 text-sm font-bold text-slate-800 focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none transition-all placeholder-slate-300"
                              />
                              
                              {isUserMenuOpen && (
                                <div className="absolute z-[100] mt-2 w-full bg-white border-2 border-emerald-200 rounded-xl shadow-2xl max-h-[400px] overflow-y-auto large-scrollbar animate-in fade-in zoom-in-95 duration-200">
                                  {(() => {
                                    const filtered = rooms.filter(room => {
                                      if (formData.hook_id && room.hook_id !== formData.hook_id) {
                                        return false;
                                      }
                                      const hook = room.hook_id ? hookMap.get(room.hook_id) : undefined;
                                      const searchStr = `${room.user_data?.display_name || ''} ${hook?.alias || ''} ${hook?.line_oa_name || ''}`.toLowerCase();
                                      return searchStr.includes(userSearchText.toLowerCase());
                                    });

                                    if (filtered.length === 0) {
                                      return <div className="p-4 text-center text-slate-400 text-xs italic">{t('pageui.dyntag.user_not_found', 'ไม่พบ User ที่ค้นหา')}</div>;
                                    }

                                    return filtered.map(room => {
                                      const hook = room.hook_id ? hookMap.get(room.hook_id) : undefined;
                                      return (
                                        <button
                                          key={room._id}
                                          type="button"
                                          onClick={() => {
                                            setSelectedRoomId(room._id);
                                            setUserSearchText(room.user_data?.display_name || '');
                                            setIsUserMenuOpen(false);
                                          }}
                                          className={`w-full text-left px-4 py-4 hover:bg-emerald-50 transition-colors border-b border-emerald-100 last:border-0 flex flex-col gap-1 ${selectedRoomId === room._id ? 'bg-emerald-50' : ''}`}
                                        >
                                          <div className="flex justify-between items-center">
                                            <span className="text-sm font-black text-slate-800">{room.user_data?.display_name || 'Unknown'}</span>
                                            {selectedRoomId === room._id && <Check size={14} className="text-emerald-500" />}
                                          </div>
                                          <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-tight">
                                            {hook ? `${hook.alias} / ${hook.line_oa_name}` : 'Unknown OA'}
                                          </span>
                                          <code className="text-[9px] text-slate-400 font-mono">{room.line_user_id}</code>
                                        </button>
                                      );
                                    });
                                  })()}
                                </div>
                              )}
                            </div>
                            
                            {isUserMenuOpen && (
                              <div 
                                className="fixed inset-0 z-[90]" 
                                onClick={() => setIsUserMenuOpen(false)} 
                              />
                            )}
                          </div>

                          {/* Selected user card */}
                          {currentRoom ? (
                            <div className="rounded-xl border-2 border-emerald-300 bg-white shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                              {/* OA label banner */}
                              <div className="px-4 py-2 bg-emerald-600 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-100">Linked OA</span>
                                  <span className="text-xs font-black text-white">
                                    {currentHook
                                      ? `${currentHook.alias} · ${currentHook.line_oa_name}`
                                      : 'Unknown OA'
                                    }
                                  </span>
                                </div>
                                <span className="text-[9px] text-emerald-100 font-bold uppercase">Active Session</span>
                              </div>

                              {/* User info */}
                              <div className="px-5 py-4 flex items-center justify-between gap-4">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Display Name</span>
                                  <span className="text-lg font-black text-slate-800 truncate">
                                    {currentRoom.user_data?.display_name || 'Unknown User'}
                                  </span>
                                  <code className="text-[11px] text-slate-500 font-mono mt-0.5">
                                    {blurMemberId(currentRoom.line_user_id)}
                                  </code>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCopyConfirm({
                                      isOpen: true,
                                      room: currentRoom,
                                      hookAlias: currentHook?.alias || 'Unknown',
                                      oaName: currentHook?.line_oa_name || 'Unknown OA',
                                      acknowledged: false
                                    });
                                  }}
                                  className="shrink-0 flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-black shadow-lg shadow-emerald-500/30 transition-all border border-emerald-500"
                                >
                                  <Copy size={14} />
                                  Copy ID
                                </button>
                              </div>
                            </div>
                          ) : !loadingUsers ? (
                            <div className="py-4 text-center">
                              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                                {t('pageui.dyntag.pick_user_to_copy', 'เลือก User เพื่อ Copy Member User ID')}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })()}
                
                {/* 1. Login Section */}
                <div className="p-6 rounded-2xl bg-dark-800 border border-dark-700 shadow-xl overflow-hidden relative group transition-all duration-300">
                  <div className="absolute top-0 left-0 w-1 h-full bg-primary-500"></div>
                  <div className="flex items-center justify-between cursor-pointer" onClick={() => {
                    const nextState = !isAuthExpanded;
                    setIsAuthExpanded(nextState);
                    if (nextState) setIsUserToolsExpanded(false);
                  }}>
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-primary-500/10 text-primary-500">
                        <Key size={20} />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider">Authentication</h4>
                        <p className="text-[11px] text-slate-500 font-medium whitespace-nowrap">Require JWT for External API calls</p>
                      </div>
                    </div>
                    <div className="p-1 rounded-md hover:bg-dark-700 transition-colors">
                      {isAuthExpanded ? <ChevronDown size={20} className="text-slate-400" /> : <ChevronRight size={20} className="text-slate-400" />}
                    </div>
                  </div>
                  
                  {isAuthExpanded && (
                    <div className="mt-8 flex gap-4 animate-in slide-in-from-top-2 duration-300">
                      <button
                        onClick={handleLogin}
                        disabled={isLoggingIn || !formData.hook_id}
                        className="flex-1 py-4 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-black shadow-lg shadow-primary-500/30 transition-all flex items-center justify-center gap-2"
                      >
                        {isLoggingIn ? <Loader2 size={18} className="animate-spin" /> : <Shield size={18} />}
                        Login
                      </button>
                      <div className="flex-[2] relative">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-primary-500">
                          <Users size={18} />
                        </div>
                        <input
                          type="text"
                          value={testLineUserId}
                          onChange={e => setTestLineUserId(e.target.value)}
                          placeholder="Paste Member User ID here..."
                          className="w-full bg-dark-700 border border-dark-600 rounded-xl pl-12 pr-4 py-4 text-slate-900 text-sm font-bold placeholder-slate-500 focus:ring-2 focus:ring-primary-500 outline-none transition-all shadow-inner"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Endpoints Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 px-2">
                    <Terminal size={18} className="text-primary-500" />
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">External Endpoints Preview</h4>
                  </div>
                  
                  <div className="grid gap-4">
                    {Object.entries(externalEndpoints).length > 0 ? (
                      Object.entries(externalEndpoints).map(([key, endpoint]: [string, any]) => (
                        <div key={key} className="rounded-2xl border border-dark-700 bg-dark-800 overflow-hidden hover:border-primary-500/50 transition-all">
                          <div className="p-4 flex items-center justify-between gap-4 border-b border-dark-700">
                            <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                        endpoint.method === 'GET' ? 'bg-blue-500/10 text-blue-500' : 
                                        endpoint.method === 'POST' ? 'bg-emerald-500/10 text-emerald-500' : 
                                        'bg-orange-500/10 text-orange-500'
                                    }`}>
                                        {endpoint.method}
                                    </span>
                                    <span className="text-sm font-bold text-slate-900 truncate">{key}</span>
                                </div>
                                <code className="text-[10px] text-slate-500 font-mono mt-1 truncate">
                                    {endpoint.path}
                                </code>
                            </div>
                            <button
                              onClick={() => {
                                if (expandedKey === key) {
                                  setExpandedKey(null);
                                  return;
                                }

                                if (!testLineUserId) {
                                  setThaiError({
                                    title: t('pageui.dyntag.need_member_title', 'กรุณาระบุ Member User ID'),
                                    message: (
                                      <div className="space-y-4">
                                        <p>{t('pageui.dyntag.need_member_msg', '⚠️ จำเป็นต้องมี Member User ID เพื่อใช้ในการดึงข้อมูลตัวอย่างจาก API ครับ')}</p>
                                        <div className="p-3 bg-red-50 rounded-xl border border-red-100/50 text-red-700 text-[11px] leading-relaxed font-bold">
                                          {t('pageui.dyntag.need_member_tip_a', 'ท่านสามารถเลือกจากเครื่องมือ')} <span className="underline decoration-red-200">Active Member Quick Copy</span> {t('pageui.dyntag.need_member_tip_b', 'ด้านบนเพื่อความสะดวกรวดเร็วครับ')}
                                        </div>
                                      </div>
                                    ) as any,
                                    type: 'error'
                                  });
                                  return;
                                }

                                if (!testToken) {
                                  setThaiError({
                                    title: t('pageui.dyntag.need_login_title', 'กรุณา Login ก่อน'),
                                    message: (
                                      <div className="space-y-4">
                                        <p>{t('pageui.dyntag.need_login_msg', '⚠️ ท่านยังไม่ได้ทำการเชื่อมต่อ (Login) กับ Bot นี้')}</p>
                                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-slate-600 text-[11px] leading-relaxed font-bold">
                                          {t('pageui.dyntag.need_login_tip_a', 'กรุณากดปุ่ม')} <span className="text-primary-600 font-extrabold underline underline-offset-2">Authentication : Login</span> {t('pageui.dyntag.need_login_tip_b', 'ด้านบน เพื่อรับสิทธิ์เรียกใช้งานข้อมูล API ครับ')}
                                        </div>
                                      </div>
                                    ) as any,
                                    type: 'warning'
                                  });
                                  return;
                                }

                                handleTestEndpoint(key);
                              }}
                              disabled={isTesting === key}
                              className={`px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 shrink-0 border shadow-sm ${
                                expandedKey === key 
                                  ? 'bg-rose-600 text-white border-rose-500 hover:bg-rose-500' 
                                  : 'bg-dark-700 hover:bg-dark-600 text-slate-900 border-dark-600'
                              }`}
                            >
                              {isTesting === key ? <Loader2 size={14} className="animate-spin" /> :
                               expandedKey === key ? <X size={14} /> : <ChevronRight size={14} />}
                              {expandedKey === key ? 'Close' : 'Choose'}
                            </button>
                            {/* ==== [FEAT-20260728-DYNPROFILE] START — ปุ่มดูตัวอย่างโครงสร้าง (เพิ่มใหม่)
                                ดูได้โดยไม่ต้องใส่ Member ID / ไม่ต้อง Login — ไม่แตะ flow เทสสดเดิม
                                แสดงเฉพาะตอนยังไม่มีผลเทสสดของแถวนี้ และมีตัวอย่างที่ map ได้ */}
                            {!testResults[key] && getEndpointSample(endpoint) && (
                              <button
                                onClick={() => setSampleKey(prev => prev === key ? null : key)}
                                className={`px-3 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-1 shrink-0 border shadow-sm ${
                                  sampleKey === key
                                    ? 'bg-amber-500 text-white border-amber-400 hover:bg-amber-400'
                                    : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                                }`}
                              >
                                {sampleKey === key ? <X size={13} /> : <ChevronRight size={13} />}
                                {t('pageui.dyntag.sample', 'ตัวอย่าง')}
                              </button>
                            )}
                            {/* ==== [FEAT-20260728-DYNPROFILE] END */}
                          </div>

                          {testResults[key] && expandedKey === key && (
                            <div className="max-h-[600px] overflow-auto custom-scrollbar border-t border-dark-700 bg-white shadow-inner">
                              <DynamicTagPreviewModal
                                isOpen={true}
                                onClose={() => setExpandedKey(null)}
                                title={key}
                                path={endpoint.path}
                                jsonContent={testResults[key].data || testResults[key]}
                                isInline={true}
                              />
                            </div>
                          )}
                          {/* ==== [FEAT-20260728-DYNPROFILE] START — พาเนลตัวอย่าง (เพิ่มใหม่ ไม่แตะพาเนลเทสสดด้านบน) */}
                          {!testResults[key] && sampleKey === key && (
                            <div className="max-h-[600px] overflow-auto custom-scrollbar border-t border-amber-200 bg-white shadow-inner">
                              <div className="px-4 py-2 bg-amber-50 text-amber-700 text-[10px] font-bold border-b border-amber-100">
                                {t('pageui.dyntag.mock_note', '⚠️ ตัวอย่างโครงสร้างข้อมูล (mock) — ไม่ใช่ข้อมูลจริงจาก API · กด Choose เพื่อเทสสดและเลือกใช้งาน')}
                              </div>
                              <DynamicTagPreviewModal
                                isOpen={true}
                                onClose={() => setSampleKey(null)}
                                title={t('pageui.dyntag.sample_title', '{key} (ตัวอย่าง)', { key })}
                                path={endpoint.path}
                                jsonContent={getEndpointSample(endpoint)}
                                isInline={true}
                              />
                            </div>
                          )}
                          {/* ==== [FEAT-20260728-DYNPROFILE] END */}
                        </div>
                      ))
                    ) : (
                        <div className="p-8 rounded-2xl border border-dashed border-dark-700 flex flex-col items-center justify-center text-center">
                            <Hash size={32} className="text-dark-700 mb-3" />
                            <p className="text-sm font-bold text-slate-600">No external endpoints found for this bot.</p>
                            <p className="text-xs text-slate-500 mt-1">Configure endpoints in Hook Settings to enable preview.</p>
                        </div>
                    )}
                  </div>
                </div>



              </div>
            </div>
          )}
        </div>
      </div>
    </div>



      <AlertModal
        isOpen={!!thaiError}
        onClose={() => setThaiError(null)}
        title={thaiError?.title || ''}
        message={thaiError?.message || ''}
        type={thaiError?.type || 'error'}
      />

      {/* ─── Member User ID Copy Confirm Modal ──────────────────────────── */}
      {copyConfirm.isOpen && copyConfirm.room && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border-2 border-emerald-200 animate-in zoom-in-95 duration-200">

            {/* Modal header */}
            <div className="bg-emerald-600 px-6 py-5 flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-white/20 shrink-0">
                <ShieldAlert size={24} className="text-white" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100 mb-0.5">Security Confirmation</p>
                <h3 className="text-lg font-extrabold text-white leading-tight">{t('pageui.dyntag.copy_confirm_title', 'คุณกำลัง Copy Member User ID')}</h3>
              </div>
            </div>

            {/* User info card */}
            <div className="px-6 pt-5 pb-3">
              <div className="rounded-xl border-2 border-slate-100 bg-slate-50 p-4 mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{t('pageui.dyntag.user_info', 'ข้อมูลผู้ใช้')}</p>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 w-24 shrink-0">Display Name</span>
                    <span className="text-sm font-extrabold text-slate-900">
                      {copyConfirm.room.user_data?.display_name || 'Unknown'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 w-24 shrink-0">Member User ID</span>
                    <code className="text-xs font-mono text-emerald-600 font-bold break-all">
                      {blurMemberId(copyConfirm.room.line_user_id)}
                    </code>
                  </div>
                </div>
              </div>

              {/* OA banner */}
              <div className="rounded-xl bg-emerald-50 border-2 border-emerald-200 px-4 py-3 mb-4">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400 mb-1">Linked OA / Bot</p>
                <p className="text-base font-extrabold text-emerald-700">
                  {copyConfirm.hookAlias}
                  <span className="text-sm font-semibold text-emerald-500 ml-2">({copyConfirm.oaName})</span>
                </p>
              </div>

              {/* Acknowledgement checkbox */}
              <label className="flex items-start gap-3 cursor-pointer group mb-5">
                <div className="relative shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={copyConfirm.acknowledged}
                    onChange={e => setCopyConfirm(prev => ({ ...prev, acknowledged: e.target.checked }))}
                    className="sr-only"
                  />
                  <div className={`w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center ${
                    copyConfirm.acknowledged
                      ? 'bg-emerald-600 border-emerald-600'
                      : 'bg-white border-slate-300 group-hover:border-emerald-400'
                  }`}>
                    {copyConfirm.acknowledged && <Check size={13} className="text-white" strokeWidth={3} />}
                  </div>
                </div>
                <span className="text-xs text-slate-700 font-medium leading-relaxed">
                  {t('pageui.dyntag.ack_a', 'ฉันเข้าใจว่า Member User ID นี้')} <strong className="text-emerald-600">{t('pageui.dyntag.ack_b', 'ใช้ได้เฉพาะกับ API')}</strong> {t('pageui.dyntag.ack_c', 'ที่ลิงก์กับ bot')}
                  {' '}<strong className="text-emerald-700">{copyConfirm.hookAlias} ({copyConfirm.oaName})</strong>{' '}
                  {t('pageui.dyntag.ack_d', 'เท่านั้น และจะไม่ทำงานกับ bot ตัวอื่น')}
                </span>
              </label>

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setCopyConfirm({ isOpen: false, room: null, hookAlias: '', oaName: '', acknowledged: false })}
                  className="flex-1 py-2.5 rounded-xl border-2 border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-all"
                >
                  {t('common.cancel', 'ยกเลิก')}
                </button>
                <button
                  type="button"
                  disabled={!copyConfirm.acknowledged}
                  onClick={() => {
                    if (!copyConfirm.room) return;
                    const room = copyConfirm.room;
                    const alias = copyConfirm.hookAlias;
                    /* [FIX-20260830-COPYHTTP2] the whole flow — closing this dialog,
                       moving the accordions, the toast — now waits for a copy that
                       actually happened. A failed copy leaves the dialog open with
                       the id still on screen, so the admin can try again instead of
                       losing it behind a confirmation that lied. */
                    void copyText(room.line_user_id).then((ok) => {
                      if (!ok) {
                        setToast({ message: t('pageui.dyntag.copy_failed', '❌ คัดลอกไม่สำเร็จ'), tag: t('pageui.dyntag.copy_denied', 'เบราว์เซอร์ปฏิเสธการคัดลอก — ลองใหม่อีกครั้ง') });
                        setTimeout(() => setToast(null), 4000);
                        return;
                      }
                      setCopyConfirm({ isOpen: false, room: null, hookAlias: '', oaName: '', acknowledged: false });

                      // Auto-Accordion: Collapse user tool and expand login section
                      setIsUserToolsExpanded(false);
                      setIsAuthExpanded(true);

                      /* reads the captured `room`/`alias`, not `copyConfirm` — the
                         state was just cleared above and this now runs a tick later */
                      setToast({
                        message: '✅ Member User ID Copied!',
                        tag: `${room.user_data?.display_name || 'User'} · ${alias}`
                      });
                      setTimeout(() => setToast(null), 4000);
                    });
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-extrabold shadow-lg shadow-emerald-500/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Copy size={14} />
                  {t('pageui.dyntag.confirm_copy', 'ยืนยัน & Copy')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>



  );
};




