import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Loader2, AlertCircle, MessageSquare, Image as ImageIcon, Layout, Clock, Send, Users2, Eye, ExternalLink } from 'lucide-react';
// [FEAT-20260810-MODALSHELL] MOVED OUT of this file: the overlay div, the panel div
// and the whole header block (title + X button) — they now come from the shared
// `form` variant. NOT moved: the nested ConfirmModal, which was a sibling of the
// panel and is passed through `afterPanel` so its DOM position is identical.
import { Modal } from '../common/Modal';
import { BroadcastEntry, BroadcastFormData, HookData, MessageType } from '../../types';
import { checkBroadcastTitle, TITLE_DEFAULT, TITLE_MAX } from '../../utils/broadcastTitle';
/* [FIX-20260825-PREVIEWLIVE] ดึงการ์ดใบที่เลือกอยู่ตรง ๆ — เมธอดมีอยู่แล้ว ไม่ได้สร้างใหม่ */
import { FlexPreviewModal } from '../flex/FlexPreviewModal';
import { flexMessageService } from '../../services/media';
import type { FlexMessageEntry } from '../../types';
/* [FEAT-20260824-BCASTFLEXID] เลือกการ์ดจากคลัง (ไม่กรอก json ดิบ) + ตัวประกอบ payload
   [FEAT-20260824-BCASTREPEAT] ฟอร์มกฎส่งซ้ำ — แยกไฟล์ตาม role เพราะไฟล์นี้เกินเพดาน 400 แล้ว */
import { FlexCardPicker } from './flex/FlexCardPicker';
/* [FEAT-20260907-FLEXMANAGELINK] The way into the card library, plus the dialog
   shown to an admin without the permission. Its own file, in the same role
   folder as FlexCardPicker, because this file is long past the 400-line cap. */
import { FlexManageButton } from './flex/FlexManageButton';
/* [FEAT-20260907-FLEXTOOLROW] the shared theme/size for the flex label row —
   preview uses it here, refresh and จัดการ flex use it inside their own files. */
import { FlexToolButton } from './flex/FlexToolButton';
/* [FEAT-20260907-IMAGEONLYPICKER] the image branch's field, own role folder */
import { BroadcastImageField } from './image/BroadcastImageField';
import { validateMessage } from './messageValidation';
import { buildMessagePayload } from './flex/buildMessagePayload';
import { RepeatRuleForm, type RepeatRule } from './schedule/RepeatRuleForm';
/* [UI-20260828-SCROLLHINT] ป้ายบอกทางว่ายังเลื่อนต่อได้ — ดูเหตุผลที่หัวไฟล์นั้น */
import { ScrollHint } from '../common/ScrollHint';
import { AudienceKeptNotice, AudienceRuleBuilder } from './audience';
import { FormSection } from './form/FormSection';
/* [UI-20260825-WIZARD] ขั้นตอน + แถบเดินขั้น — นิยามอยู่ใน `form/broadcastSteps.ts`
   ไฟล์เดียว ที่นี่แค่เอามาประกอบ ไม่ได้ตัดสินลำดับหรือกลุ่ม error เอง */
import {
  BROADCAST_STEPS,
  LAST_STEP,
  stepErrorCounts,
  firstStepWithError,
  clampStep,
  /* [FEAT-20260907-FLEXPICKREFRESH] the same "is this step visible" formula the
     pane itself uses — one owner, so the two can never disagree */
  isStepVisible,
  errorsOnStep,
} from './form/broadcastSteps';
import {
  BroadcastStepRail,
  BroadcastStepPane,
  BroadcastStepNav,
} from './form/BroadcastStepper';
import { BroadcastSendConsent } from './form/BroadcastSendConsent';
/* [UI-20260903-BCASTTAGFAMILIES] บอกว่าตัวแปรตระกูลไหนใช้ได้กับวิธีส่งที่เลือก
   — Broadcast ใช้ site rule ได้ ใช้ค่ารายคนไม่ได้ · ไฟล์แยก ไม่ inline */
import { BroadcastTagFamilies } from './form/BroadcastTagFamilies';
import { BroadcastCardTypePicker } from './form/BroadcastCardTypePicker';
import { MintButton } from './mint';
import { fromCampaignIso, toCampaignIso } from './campaignTime';
import { broadcastService } from '../../services/messaging/broadcastService';
import { GuardWindowField } from './audience/GuardWindowField';
import type { BroadcastPreview, BroadcastHistoryRow } from '../../types';
import { useI18n } from '../../i18n';
import { webhookService } from '../../services/hook';
import { ConfirmModal } from '../modals';
import { useUnsavedEdits } from './form/useUnsavedEdits';
import { fetchVisibleGroups } from '../../services/admin';
/* [FIX-20260824-PICKERSAME] เจ้าของ 24/08: "บางอันมี select search อันไม่มี อะไรวะ มั่วมาก"
   · "เรื่อง select ด้วยมั่วมาก รวมกันสิ ใน page boardcast"
   ⇒ ทุกช่องเลือกในฟอร์มนี้ต้องมีช่องค้นหาเหมือนกันหมด: เลือกได้ตัวเดียวใช้ combobox
   กลางที่ repo มีอยู่แล้ว (`common/SearchableSelect` — ตัวเดียวกับที่ FlexCardPicker
   ใช้) · เลือกได้หลายตัวใช้ `MultiCheckSelect` ซึ่งเป็นพี่น้องกันคนละ arity
   ⚠️ ห้ามเขียน combobox ตัวที่สาม — ที่มั่วอยู่ทุกวันนี้เพราะแบบนั้นมาแล้วรอบหนึ่ง */
import { SearchableSelect } from '../common/SearchableSelect';
import { MultiCheckSelect, type MultiCheckOption } from './pickers/MultiCheckSelect';
import { MultiCheckGrid } from './pickers/MultiCheckGrid';
import { openNativePicker } from '../common/LogDateRangeFilter';
/* [UI-20260824-BCASTACTIVE] "สีเขียวมันดูยากไป เข้มกว่านี้ light theme" — สถานะ
   "เลือกอยู่" ของทุกการ์ด/ปุ่มในฟอร์มนี้ย้ายไปอยู่ที่เดียว ดูเหตุผลเต็มในไฟล์นั้น */
import { choiceClass } from './pickers/activeChoiceClass';
/* [FIX-20260824-HOOKCASCADE] "ถ้าติ๊ก group แม่ออก hook ลูกต้องออกตาม" */
import { pruneHookIds } from './pickers/pruneHookIds';

interface BroadcastFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: BroadcastFormData) => Promise<void>;
  initialData?: BroadcastEntry;
  mode?: 'create' | 'update' | 'view';
}

const DEFAULT_FORM: BroadcastFormData = {
  name: '',
  hook_ids: [],
  assign_group: null,
  /* [FEAT-20260825-MULTIGROUP] ตัวหลัก — เริ่มว่าง แปลว่ายังไม่ได้เลือกกลุ่ม */
  assign_group_ids: [],
  target: { mode: 'all', group_ids: [] },
  message: { type: 'text', text: '' },
  /* [FIX-20260825-PICKSENDMODE] ⬜ ว่าง = ยังไม่ได้เลือก — ตั้งใจไม่มีค่าเริ่มต้น
     เจ้าของ 25/08: *"create/edit ก็ตาม เราจะไม่ติ๊กการส่งให้ ให้ติ๊กเอง"*
     🔴 ค่าเริ่มต้นเดิมคือ 'draft' ⇒ กดบันทึกรวดเดียวได้โดยไม่เคยมองขั้นนี้เลย
        ซึ่งเป็นขั้นที่ตัดสินว่า "ยิงเลย / ตั้งเวลา / เก็บร่าง" · การเลือกต้องเกิดขึ้นจริง
     ⚠️ `''` ไม่ใช่สถานะที่ BE รู้จัก และไม่มีทางไปถึง BE ได้ เพราะ `validate()`
        กันไว้ก่อนเปิดกล่องยืนยัน */
  status: '',
  scheduled_at: null,
  /* Belt-and-braces, and deliberately NOT load-bearing: the input already
     renders `formData.title_detail ?? ''`, so an undefined here cannot make it
     uncontrolled. Kept because every other field is listed and a gap reads as
     an oversight — but a mutation removing it stays GREEN, on purpose.
     ⚠️ This entry is also unreachable from a fresh create: the type picker
        offers text and image only, so a NEW broadcast can never be flex and
        the title box never renders. A flex job reaches this form by edit or by
        copy (`Broadcasts.tsx:229-237`, which spreads the whole entry).
        สร้างใหม่เลือก flex ไม่ได้ — มาได้ทางแก้ไขหรือคัดลอกเท่านั้น. */
  title_detail: '',
  /* [FEAT-20260823-BCASTSENDKIND] `null` = the sender this job always used —
     the state every campaign saved before 23/08 is in, and the safe default
     for a new one. ค่าเริ่มต้นต้องเป็น "ไม่เปลี่ยนอะไร". */
  /* [FIX-20260824-NOLEGACYPICK] เจ้าของ 24/08: "เอาเฉพาะ boardcast+ multi แบบใหม่
     ที่ใช้ ต้องตั้งได้ทุกอย่าง" — งาน "สร้าง" ใหม่ทุกใบต้องเลือกท่อใหม่เท่านั้น
     ไม่ปล่อยให้ null (=ตัวส่งเดิม) หลุดออกจากฟอร์มนี้อีก ⚠️ ใบที่แก้ไข (edit) ของเก่า
     ไม่โดนกระทบ — initialData.send_kind ?? null (บรรทัดด้านล่าง) ยังอ่านค่าจริงเดิม
     ของ job นั้นเสมอ ไม่ถูกทับด้วยค่านี้ */
  send_kind: 'broadcast',
  /* [FEAT-20260823-BCASTCARDTYPE] `null` = one card for everybody — what every
     campaign has always done, and the safe default for a new one. */
  card_type: null,
  /* [FEAT-2708-GUARDWINDOW] null = ไม่มี guard — ค่าที่งานเก่าทุกใบถือ */
  guard_window_hours: null,
  description: '',
  /* [FEAT-20260825-BCASTDIRECTTICKET] ค่าเริ่มต้น = ไม่ติ๊ก · ฝั่ง BE ก็ไม่มี default
     เหมือนกัน ⇒ งานที่ไม่ได้ขอ จะไม่มีคอลัมน์นี้เลยในฐาน */
  is_direct_ticket: false,
  skip_assist: false,
  /* [FEAT-20260824-BCASTREPEAT] `null` = ส่งครั้งเดียว — สถานะของทุกแคมเปญที่มีอยู่
     ก่อน 24/08 และค่าเริ่มต้นที่ปลอดภัยของใบใหม่ BE อ่าน `=== 'repeat'` เท่านั้น
     ⇒ ไม่มีคีย์นี้ = ยิงครั้งเดียวเหมือนเดิมเป๊ะ */
  schedule: null
};

export const BroadcastFormModal: React.FC<BroadcastFormModalProps> = ({ isOpen, onClose, onSubmit, initialData, mode }) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<BroadcastFormData>(DEFAULT_FORM);
  /* [UI-20260828-DISCARDGUARD] นับรอบการโหลดค่าตั้งต้น — ดู `useUnsavedEdits`
     เพิ่มค่าใน effect ที่โหลดค่าเข้าฟอร์ม ⇒ อยู่ในชุด state update เดียวกับ
     `setFormData` ⇒ ตัวเทียบเห็นค่าตั้งต้นใบใหม่พร้อมกันในรอบ render เดียว */
  const [formSeq, setFormSeq] = useState(0);
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [groups, setGroups] = useState<{ _id: string; group_name: string }[]>([]);
  const [hooksLoading, setHooksLoading] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flexText, setFlexText] = useState('');
  /* [FIX-20260824-PICKERSAME] `isHooksOpen`/`isGroupsOpen` ถูกถอดออก — เมนูเปิด/ปิด
     เป็นเรื่องภายในของ `MultiCheckSelect` แล้ว (มันปิดตัวเองตอนคลิกนอกกล่องด้วย
     ซึ่งของเดิมทำไม่ได้) · ฟอร์มทั้งใบ unmount ตอนปิด (`if (!isOpen) return null`)
     ⇒ เปิดใหม่ได้เมนูที่ปิดอยู่เสมอ ไม่ต้องรีเซ็ตเอง */
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  /* [UI-20260825-SENDCONSENT] ต้องอ่านแล้วติ๊กก่อนถึงจะบันทึกได้
     ⚠️ รีเซ็ตทุกครั้งที่เปิดกล่องยืนยัน — การยืนยันครั้งก่อนต้องไม่นับให้ครั้งนี้ */
  const [consentChecked, setConsentChecked] = useState(false);
  /* [UI-20260825-CONFIRMLASTSTEP] ยังไม่ถึงขั้นสุดท้าย = ยังยืนยันไม่ได้
     เจ้าของ 25/08: *"ถ้ายังไม่ถึง step สุดท้าย ปุ่มยืนยันจะกดไม่ได้ เบลอ ·
     ถ้าพยายามกดให้บอกไปว่าทำไม"*
     🔴 ไม่ใช้ `disabled` เพราะปุ่มที่กดแล้วเงียบไม่ได้บอกอะไรใคร — ทำให้ดูจาง
        แต่ยังกดได้ แล้วอธิบายเหตุผลตอนกด (กติกาเดียวกับช่องติ๊กยืนยัน)
     ⚠️ โหมด "แสดงทุกขั้นตอน" ยกเว้น — คนกางดูทั้งใบแล้วถือว่าเห็นครบทุกขั้น */
  const [stepBlocked, setStepBlocked] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);
  /* [FEAT-20260823-BCASTPREVIEW] Asked for on demand, never on open: it is a
     real round trip that renders the card for every OA, and most edits never
     look at it. เรียกตอนกด ไม่ใช่ตอนเปิดฟอร์ม. */
  /* [FIX-20260825-PREVIEWLIVE] การ์ดที่ดึงสดจาก `flex_id` ที่เลือกอยู่ ณ ตอนกด
     เจ้าของ 25/08: *"เวลากดดูตัวอย่าง ดึง id จริง select เสมอที่เลือกอย่าจำค่าเดิม"*
     + *"พร้อมปุ่ม refresh flex เพื่อดึงอันล่าสุดมาแสดงตัวอย่าง (ทั้ง edit/create)"*
     ⚠️ ของเดิม (`previewBroadcast`) อ่านจาก **แถวที่เซฟแล้ว** ⇒ เปลี่ยนการ์ดในฟอร์ม
        แล้วยังไม่เซฟ กดดูตัวอย่างจะเห็นใบเก่า และใน create ยังไม่มี id ให้ใช้เลย
     ⇒ ตัวนี้อ่านการ์ดตรงจาก `getFlexMessage(flex_id)` ⇒ ใช้ได้ทั้ง create/edit
        และได้ของล่าสุดเสมอ เพราะยิงใหม่ทุกครั้งที่กด ไม่มีการจำ */
  const [cardPreview, setCardPreview] = useState<FlexMessageEntry | undefined>();
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState<string | undefined>();
  /* [FIX-20260825-PREVIEWONEBUTTON] เจ้าของ 25/08: *"กดแล้วมันต้องแสดงทั้งสอง
     ทั้ง json + ภาพ flex จริง · ใช้ปุ่มเดียว แต่ edit มันมีสองปุ่มแยก รวมสะ"*
     รอบก่อนผมโชว์แค่ JSON ดิบ ทั้งที่ `FlexPreviewModal` render การ์ดจริงได้อยู่แล้ว
     ⇒ ปุ่มเดียว เปิดโมดัลที่มีทั้งภาพและ JSON (โมดัลนั้นมีปุ่มคัดลอก JSON ในตัว) */
  const [cardModalOpen, setCardModalOpen] = useState(false);
  /* [FEAT-20260823-BCASTHISTREAD] Same on-demand rule as the preview. */
  const resolvedMode = mode ?? (initialData ? 'update' : 'create');
  const isReadOnly = resolvedMode === 'view';

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    /* [FIX-20260826-STALECONFIRM] เจ้าของแจ้ง 26/08: กด edit (action) ในหน้า broadcast
       แล้ว "หน้ายืนยันมันขึ้นมาบัง"
       ─────────────────────────────────────────────────────────────────────────
       🔴 ต้นเหตุ: `isConfirmOpen` ถูกตั้ง `true` ตอนกดบันทึก แล้ว **ไม่มีใครตั้งกลับ
          เป็น false เลยในเส้นทางสำเร็จ** เพราะ `closeOnConfirm={false}` (ตั้งใจ
          ไม่ให้กล่องปิดเองตอนยังไม่ติ๊กยินยอม) และ `confirmSubmit` ก็ปิด **ฟอร์มทั้งใบ**
          ผ่าน `onClose()` ⇒ ค่า `true` ค้างอยู่ในคอมโพเนนต์
       ⇒ รอบถัดไปที่เปิดฟอร์ม (กด edit) กล่องยืนยันเก่าจึงโผล่ทับทันทีตั้งแต่ยังไม่กดอะไร
       ⚠️ ล้าง `consentChecked`/`consentMissing` ด้วย ไม่งั้นเปิดมาแบบ "ติ๊กไว้แล้ว"
          ซึ่งข้ามด่านยินยอมที่ตั้งใจให้มีไปเลย
       ⚠️ ล้างตอน **เปิด** ไม่ใช่ตอนปิด — ฟอร์ม unmount ตอนปิดอยู่แล้ว
          (`if (!isOpen) return null`) การล้างตอนปิดจึงไม่มีอะไรรับประกัน
       revert: ลบสามบรรทัดนี้ */
    setIsConfirmOpen(false);
    setConsentChecked(false);
    setConsentMissing(false);
    /* [FIX-20260903-REOPENATSTEP1] reopening the form always lands on step 1
       ─────────────────────────────────────────────────────────────────────────
       🔴 ROOT CAUSE: this component does NOT unmount when it closes —
          `if (!isOpen) return null` (:855) sits BELOW every hook, and the parent
          page (`Broadcasts.tsx:1103`) keeps it rendered permanently, flipping
          only the `isOpen` prop.
          ⇒ every `useState`, `stepIndex` included, SURVIVES a close/open cycle.
          ⇒ closing the form on step 6 and opening a NEW one landed straight back
            on step 6, with steps 1-5 never filled in.
       ⚠️ Same family as [FIX-20260826-STALECONFIRM] above (a value outliving the
          round because nothing unmounts). That block fixed `isConfirmOpen`;
          `stepIndex` was missed.
       ⚠️ Cleared on OPEN, like the rest of this block — not on close.
       ⚠️ Touches `stepIndex` ONLY. `showAllSteps` is deliberately left alone:
          the request was "go back to step 1", and expanding/collapsing every
          step is the user's own view preference (toggled from the stepper).
          Resetting it too would change behaviour nobody asked for.
       revert: drop this line */
    setStepIndex(0);
    /* [FIX-20260825-NOHISTORYINFORM] preview/history ของ "งานที่บันทึกแล้ว" ถูกตัด
       ออกจากฟอร์มไปทั้งก้อน จึงไม่มี state ให้ล้างอีก · ที่เหลือคือการ์ดที่เลือกอยู่ */
    setCardPreview(undefined);
    setCardError(undefined);
    setCardModalOpen(false);
    if (initialData) {
      setFormData({
        name: initialData.name || '',
        hook_ids: initialData.hook_ids || [],
        assign_group: initialData.assign_group ?? null,
        /**
         * [FEAT-20260825-MULTIGROUP] 🔴 ขากลับ — จุดที่ field หายเงียบ ๆ ประจำ
         *
         * ถ้าไม่ copy ตรงนี้ ฟอร์มจะเปิดมาว่าง แล้วการเซฟครั้งถัดไปจะ **ทับกลุ่มที่
         * ตั้งไว้ด้วยค่าว่าง** — แอดมินจะรายงานว่า "มันไม่เซฟ" ทั้งที่เซฟแล้วและถูกล้าง
         * (dev-local §5 · เคยเกิดจริงกับ direct_ticket_on_reply)
         *
         * ⚠️ แถวเก่าไม่มี `assign_group_ids` ⇒ ถอยไปใช้ `assign_group` เดี่ยว
         *    เพื่อให้เปิดฟอร์มของแคมเปญเก่าแล้วเห็นกลุ่มเดิมติ๊กอยู่ ไม่ใช่ว่าง
         */
        assign_group_ids: Array.isArray(initialData.assign_group_ids)
          ? initialData.assign_group_ids
          : initialData.assign_group
            ? [String(initialData.assign_group)]
            : [],
        target: initialData.target ?? { mode: 'all', group_ids: [] },
        message: initialData.message || { type: 'text', text: '' },
        /* [FIX-20260825-PICKSENDMODE] ค่าที่งานใบนี้บันทึกไว้คือสิ่งที่ผู้ใช้
           เลือกไว้เอง จึงแสดงตามนั้น · ที่ถอดออกคือ **ค่าเริ่มต้นที่เราใส่ให้**
           (`|| 'draft'`) ⇒ งานเก่าที่ไม่มีสถานะจะเปิดมาแบบยังไม่ได้เลือก
           แทนที่จะถูกทึกทักว่าเป็นฉบับร่าง */
        status: initialData.status || '',
        scheduled_at: initialData.scheduled_at ?? null,
        /* Same list, same trap as `normalizeBroadcast`: this rebuilds the form
           state field by field, so a field missing HERE opens blank on edit
           even when the API returned it correctly. สองที่ต้องตรงกันเสมอ. */
        title_detail: initialData.title_detail ?? '',
        send_kind: initialData.send_kind ?? null,
        card_type: initialData.card_type ?? null,
        /* [FEAT-2708-GUARDWINDOW] ขากลับ — ตกบรรทัดนี้ = เปิด edit แล้วช่องว่าง
           แล้วเซฟถัดไปล้าง guard ของ job (กับดักเดียวกับทุกบรรทัดในบล็อกนี้) */
        guard_window_hours:
          (initialData as { guard_window_hours?: number | null })
            .guard_window_hours ?? null,
        description: initialData.description ?? '',
        /* [FEAT-20260825-BCASTDIRECTTICKET] 🔴 ขากลับ — ขาดบรรทัดนี้ = เปิด edit
           มาแล้วช่องติ๊กว่าง แล้ว save ถัดไปเขียนทับงานที่เคยขอเปิดเคสไว้
           (กับดักเดียวกับที่ `broadcast-payload.util.ts` ฝั่ง BE เตือนไว้) */
        is_direct_ticket: (initialData as { is_direct_ticket?: boolean }).is_direct_ticket === true,
        skip_assist: (initialData as { skip_assist?: boolean }).skip_assist === true,
        /* [FEAT-20260824-BCASTREPEAT] 🔴 ขากลับของกฎส่งซ้ำ ไม่เติมที่นี่ = เปิดฟอร์ม
           มาเห็นว่าง แล้วเซฟครั้งถัดไปเขียนทับรอบที่ตั้งไว้จริง — แคมเปญรายวัน
           กลายเป็นยิงครั้งเดียวแบบเงียบ ๆ */
        schedule: (initialData.schedule as RepeatRule | null) ?? null
      });
      if (initialData.message?.type === 'flex') {
        const raw = initialData.message.flex_json;
        setFlexText(typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}, null, 2));
      } else {
        setFlexText('');
      }
    } else {
      setFormData({ ...DEFAULT_FORM, target: { mode: 'all', group_ids: [] } });
      setFlexText('');
    }
    /* [UI-20260828-DISCARDGUARD] ค่าตั้งต้นเพิ่งถูกวาง ⇒ เริ่มนับ "ผู้ใช้แก้อะไรบ้าง"
       ใหม่ · ต้องอยู่ **นอก** if/else เพราะทั้งสองทางคือการโหลดค่าตั้งต้นเหมือนกัน */
    setFormSeq((n) => n + 1);
  }, [isOpen, initialData]);

  /**
   * [UI-20260828-DISCARDGUARD] กดยกเลิกแล้วงานที่พิมพ์ไว้หายทันที
   *
   * ฟอร์มนี้ยาว 6 ขั้น · ปุ่มยกเลิกเดิมเรียก `onClose` ตรง ๆ ⇒ พลาดไปโดนครั้งเดียว
   * คืองานทั้งใบหายโดยไม่มีอะไรถามสักคำ และไม่มีทางกู้กลับ
   *
   * 🔴 ถามเฉพาะตอนมีอะไรจะเสียจริง ๆ — กล่องที่เด้งทุกครั้งจะถูกกดผ่านจนติดนิสัย
   *    แล้ววันที่มันเด้งเพราะมีงานค้างจริงก็จะโดนกดผ่านไปด้วย
   * ⚠️ โหมดดูอย่างเดียวไม่มีทางมีอะไรค้าง ⇒ `useUnsavedEdits` ตอบ false เอง
   *    ไม่ต้องเช็ค `isReadOnly` ซ้ำที่นี่ให้เป็นเงื่อนไขสองที่ที่ต้องตรงกัน
   */
  const hasUnsavedEdits = useUnsavedEdits(formData, formSeq);
  const requestClose = () => {
    if (hasUnsavedEdits) {
      setIsDiscardOpen(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    // Same rule everywhere: super → all active groups; others → active ∩ their
    // sector groups. Shared helper, no per-form logic to drift.
    setGroupsLoading(true);
    fetchVisibleGroups()
      .then(list => { if (isActive) setGroups(list); })
      .catch(err => { console.error('Failed to load groups', err); if (isActive) setGroups([]); })
      .finally(() => { if (isActive) setGroupsLoading(false); });
    return () => { isActive = false; };
  }, [isOpen]);

  /* [FIX-20260824-HOOKSFROMGROUPS] เจ้าของ 24/08: "ยังไม่เจอ select เลือก hook
     (เจอแค่ group)" · "ui group ติ๊กกี่ตัวก็ได้ / hook จะติ๊กกี่ตัวก็ได้"

     🔴 ตัวเลือก hook มีอยู่แล้ว แต่ถูก **ล็อกไว้** จนกว่าจะเลือก `assign_group`
        และรายชื่อก็โหลดจากกลุ่มเดียวนั้น ⇒ ติ๊กหลายกลุ่มแล้วก็ยังเห็น OA ของ
        กลุ่มแรกกลุ่มเดียว เหมือนตัวเลือกไม่มีอยู่จริง
        ล็อกไว้ + โหลดกลุ่มเดียว = ผู้ใช้เห็นแค่ group ไม่เจอ hook.

     ⇒ โหลดจาก **ทุกกลุ่มที่ติ๊ก** แล้วรวมเป็นชุดเดียว (dedupe ด้วย `_id`)
       `assign_group` ยังเป็นกลุ่มเจ้าของงานเหมือนเดิม แค่ไม่ใช่ตัวจำกัดรายชื่อ
       อีกต่อไป — สองคำถามคนละข้อ: "งานนี้ของกลุ่มไหน" กับ "ยิงไป OA ไหนบ้าง"

     ⚠️ ยิงขนานแล้วรอทั้งหมด: จำนวนกลุ่มที่แอดมินติ๊กเองมีหลักหน่วย ไม่ใช่ลูปที่โต
       ตามข้อมูล · ถ้ากลุ่มไหนล้มก็ข้ามเฉพาะกลุ่มนั้น ไม่ล้มทั้งรายการ
       กลุ่มเดียวพัง ห้ามทำให้เลือก OA ไม่ได้ทั้งหมด. */
  /* [FIX-20260825-OALOADALLGROUPS] 🔴 ต้องเป็น `assign_group_ids` (ทุกกลุ่มที่ติ๊ก)
     ไม่ใช่ `assign_group` ซึ่งเป็น **กลุ่มแรกกลุ่มเดียว**
     เจ้าของแจ้ง 25/08 พร้อมภาพ: ติ๊กไว้ 4 กลุ่ม แต่จอขึ้น "ไม่มี LINE OA ให้เลือก"
     เพราะโหลดรายชื่อจากกลุ่มแรกกลุ่มเดียว และกลุ่มแรกไม่มี OA
     ⚠️ commit b7e4168 แก้ **ขา cascade** (ตอนติ๊กกลุ่มออก) ไปแล้ว แต่ **ขาโหลด**
        ยังค้างอยู่ที่ของเดิม — อาการเดียวกันคนละครึ่ง */
  /* [FEAT-2708-TARGETGROUPCUT] (งาน 5.4) `target.group_ids` เลิกป้อนรายชื่อ OA —
     ปุ่ม "เลือกตามกลุ่มเครือข่าย" ถูกตัดออกจาก step 5 (เจ้าของ: ซ้ำกับ step 3+4)
     · job เก่าที่ยังถือค่านี้: ค่าถูก round-trip ครบผ่าน buildPayload (เทสตรึง)
       แค่ไม่ใช้เปิดรายชื่อ OA อีก — OA ที่เคยติ๊กไว้ยังอยู่ใน hook_ids/payload
     revert: คืน spread `...(formData.target.group_ids || []).map(String)` + dep */
  const groupPickKey = useMemo(
    () =>
      [...(formData.assign_group_ids || []).map(String)]
        .filter(Boolean)
        .sort()
        .join(','),
    [formData.assign_group_ids],
  );

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    const groupIds = groupPickKey ? groupPickKey.split(',') : [];
    if (groupIds.length === 0) {
      setHooks([]);
      setHooksLoading(false);
      return () => {
        isActive = false;
      };
    }
    setHooksLoading(true);
    Promise.all(
      groupIds.map(id =>
        webhookService.getHooksByGroup(id).catch(err => {
          console.error('Failed to load hooks for group', id, err);
          return [] as HookData[];
        }),
      ),
    )
      .then(lists => {
        if (!isActive) return;
        /* Dedupe: one OA can only appear once however many chosen groups hold
           it. ติ๊กสองกลุ่มที่มี OA เดียวกัน ต้องเห็นครั้งเดียว. */
        const seen = new Map<string, HookData>();
        for (const list of lists) {
          for (const hook of list || []) seen.set(String(hook._id), hook);
        }
        setHooks([...seen.values()]);
      })
      .finally(() => {
        if (isActive) setHooksLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [isOpen, groupPickKey]);

  /* [FEAT-20260825-ATTIME] "โหมดนี้ซ้ำอยู่ไหม" ถูกถามหลายที่ในไฟล์นี้ ⇒ คำนวณครั้งเดียว
     ⚠️ เทียบกับ `'repeat'` ตรง ๆ เหมือน BE — ค่าอื่นทุกค่าแปลว่า "ครั้งเดียว" */
  const isRepeatingSchedule = formData.schedule?.mode === 'repeat';

  /**
   * [FEAT-20260825-BCASTFOLD] ช่องไหนอยู่การ์ดใบไหน
   *
   * 🔴 การ์ดพับได้แล้ว ⇒ ถ้าไม่รู้ว่า error อยู่ใบไหน แอดมินจะกดเซฟแล้วเจอแค่
   *    "เซฟไม่ได้" โดยการ์ดที่ผิดยังพับอยู่ · ตารางนี้คือสิ่งที่ทำให้กางถูกใบ
   * ⚠️ คีย์ต้องตรงกับที่ `validate()` ตั้งไว้เป๊ะ — พิมพ์ผิด = ป้ายไม่ขึ้นและไม่กาง
   *    โดยไม่มี error ให้เห็น (เทส `broadcastFoldValidate` ล็อกไว้แล้ว)
   */
  /* [UI-20260825-WIZARD] `SECTION_FIELDS` เดิมถูกแทนด้วยตาราง `BROADCAST_STEPS`
     ⚠️ ของเดิม **เพี้ยนไปแล้วจริง ๆ** หลังการย้ายช่องเมื่อ 24-25/08:
        · `target: ['assign_group','hook_ids']` — สองช่องนั้นย้ายไปการ์ดคนละใบแล้ว
          ⇒ ป้ายแดงขึ้นผิดใบ
        · `section-group` อ่าน `errors.group` ซึ่ง `validate()` ไม่เคยตั้งเลย
     ตอนนี้ลำดับขั้นและกลุ่ม error อยู่ที่ `broadcastSteps.ts` ที่เดียว และมีเทส
     ปักว่าคีย์ทุกตัวที่ `validate()` ตั้งได้ ต้องถูกจองโดยขั้นใดขั้นหนึ่งพอดีหนึ่งขั้น
     revert: เอา `SECTION_FIELDS` + `errorsIn` เดิมกลับมา (ดู git history marker นี้) */
  const [stepIndex, setStepIndex] = useState(0);
  /* [UI-20260828-SCROLLHINT] ตัวที่เลื่อนได้จริงคือ <form> เอง (มี overflow-y-auto)
     ⚠️ ไม่ใช่กล่องแม่ — วัดผิดตัวแล้วลูกศรจะไม่ขึ้นเลยเพราะกล่องแม่ไม่เคยล้น */
  const formScrollRef = useRef<HTMLFormElement>(null);
  /* กาง "ทุกขั้นตอน" ทีเดียว — ทางออกสำหรับคนที่อยากเห็นทั้งฟอร์มแบบเดิม
     และเป็นสิ่งที่ทำให้โหมดดูอย่างเดียวยังอ่านรวดเดียวได้ */
  const [showAllSteps, setShowAllSteps] = useState(false);
  const errorsIn = (sectionId: string): number => errorsOnStep(sectionId, errors);
  /* ยังเดินไม่ถึงขั้นสุดท้าย และไม่ได้กางดูทั้งใบ ⇒ ยังยืนยันไม่ได้ */
  const notAtLastStep = !showAllSteps && stepIndex < LAST_STEP;


  const inputClass = (hasError: boolean, extra: string = '') =>
    `w-full bcast-field bg-primary-500/10 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all ${
      hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-primary-500/30 focus:ring-primary-500'
    } ${extra}`;

  /* [UI-20260825-WIZARD] คืน **แมป error** ไม่ใช่แค่ true/false
     🔴 ทำไม: `setErrors` เป็น state ⇒ ตัวแปร `errors` ในรอบเดียวกันยังเป็นค่าเก่า
        ถ้าเอาไปหา "ขั้นแรกที่ผิด" จะได้ขั้นของรอบก่อน หรือ -1 ตอนกดครั้งแรกสุด
        ⇒ ผู้ใช้ถูกพาไปผิดขั้น หรือไม่ถูกพาไปไหนเลย ทั้งที่ฟอร์มบอกว่าผิด
     ⚠️ ผู้เรียกเดิมใช้ `if (!validate())` ได้เหมือนเดิม — ดูตัวช่วย `hasNoError`
     revert: เปลี่ยนกลับเป็น `(): boolean` แล้วคืน `Object.keys(...).length === 0` */
  /* [FEAT-2708-NOSTEPSKIP] กติกาทั้งหมดของ validate แยกเป็นตัวคำนวณล้วน —
     `validate()` (ทางกดเซฟ) ยัง commit ทั้งก้อนเหมือนเดิมทุกประการ ส่วนด่าน
     กันข้ามขั้น (`tryGoTo`) ใช้ผลคำนวณโดย commit เฉพาะขั้นที่ยืน */
  const computeErrors = (): Record<string, string> => {
    const nextErrors: Record<string, string> = {};
    if (!formData.name.trim()) nextErrors.name = t('broadcast.form_name_required');
    /* [FEAT-20260823-BCASTDESC] 🔴 REQUIRED ON A NEW CAMPAIGN ONLY.
       The backend refuses a create without one, so the form has to say so
       before the save round-trips. It does NOT demand one when editing a
       campaign that predates the column — the backend does not either, and
       blocking a rename on a missing rationale would be its own trap.
       งานใหม่ต้องมี · งานเก่าแก้ได้โดยไม่ต้องเขียนย้อนหลัง. */
    if (resolvedMode === 'create' && !(formData.description ?? '').trim()) {
      nextErrors.description = t('broadcast.form_description_required');
    }
    if ((formData.description ?? '').length > 500) {
      nextErrors.description = t('broadcast.form_description_too_long');
    }
    if (formData.assign_group_ids.length === 0) nextErrors.assign_group = t('broadcast.form_assign_group_required');
    if (!formData.hook_ids.length) nextErrors.hook_ids = t('broadcast.form_hooks_required');
    const type = formData.message.type;
    /* [FIX-20260825-BCASTFLEXIDVALID] กฎย้ายไป messageValidation.ts เพื่อให้ตรึงด้วยเทสได้
       เจ้าของแจ้ง 25/08: เลือก Flex แล้วผูกการ์ดไว้ แต่ยังฟ้อง "กรุณากรอกข้อความ"
       เพราะของเดิมตรวจแต่ `flexText` (JSON ดิบ) ไม่รู้จัก `flex_id` ที่เพิ่มเข้ามาทีหลัง
       รหัสที่คืนมาแมปตรงกับคีย์แปล `broadcast.form_<reason>` ที่มีอยู่แล้วทั้งสามตัว */
    /* ⚠️ แมปตรง ๆ ไม่ต่อสตริง — คีย์จริงคือ `form_message_required` ไม่ใช่
       `form_required` ⇒ การต่อสตริงจะได้คีย์ที่ไม่มีอยู่จริงแล้วขึ้นเป็นชื่อคีย์ดิบบนจอ */
    const MESSAGE_PROBLEM_KEY: Record<string, string> = {
      required: 'broadcast.form_message_required',
      image_https: 'broadcast.form_image_https',
      flex_invalid: 'broadcast.form_flex_invalid',
    };
    const problem = validateMessage(formData.message, flexText);
    if (problem) nextErrors.message = t(MESSAGE_PROBLEM_KEY[problem]);

    /* [FEAT-20260823-BCASTTITLE] Only flex carries an `altText`, so the rule is
       only asked for flex — validating a field the user cannot see would block
       a save with a message pointing at nothing.
       ถามเฉพาะตอนเป็น flex เพราะ text/image ไม่มีช่องนี้. */
    if (type === 'flex') {
      const problem = checkBroadcastTitle(formData.title_detail);
      if (problem) nextErrors.title_detail = t(`broadcast.form_title_${problem.replace('-', '_')}`);
    }

    /* [FIX-20260825-PICKSENDMODE] ต้องเลือกวิธีส่งก่อนเสมอ
       เจ้าของ 25/08: *"ถ้า submit โดยไม่ติ๊กก็ validate เด้งมาที่ step นี้
       แล้วบอกแดงตรงไหน"* ⇒ ตรวจที่นี่ (ไม่ใช่ที่ปุ่ม) เพราะ `firstStepWithError`
       อ่านคีย์ error ตัวนี้เพื่อพาไปยืนที่ขั้น "สถานะการส่ง" ให้เอง */
    if (!formData.status) {
      nextErrors.status = t('broadcast.form_status_required');
    }

    /* [FEAT-2708-GUARDWINDOW] ว่าง = ไม่มี guard ผ่านเสมอ · กรอกแล้วต้อง 1-72
       จำนวนเต็ม (0 ห้าม — เจ้าของขีดไว้) ตรงกับ BE (DTO @Min(1) @Max(72) +
       ensureValidGuardWindow) — ฝั่งใดหลวมกว่า = เซฟไม่ได้โดยไม่มีคำอธิบาย */
    const gw = formData.guard_window_hours;
    if (gw !== null && gw !== undefined) {
      if (!Number.isInteger(gw) || gw < 1 || gw > 72) {
        nextErrors.guard_window_hours = t('broadcast.form_guard_window_range');
      }
    }

    /* [FEAT-20260825-ATTIME] โหมดซ้ำไม่ต้องมีวันที่หลัก — ตรงกับ BE เป๊ะ ๆ
       ถ้าฝั่งใดฝั่งหนึ่งบังคับ อีกฝั่งไม่บังคับ จะกลายเป็นเซฟไม่ได้โดยไม่มีคำอธิบาย */
    if (
      formData.status === 'scheduled' &&
      !formData.scheduled_at &&
      formData.schedule?.mode !== 'repeat'
    ) {
      nextErrors.scheduled_at = t('broadcast.form_schedule_required');
    }

    /* [FIX-20260828-REPEATDAYS] เลือก "ส่งซ้ำ" แล้วต้องเลือกวันอย่างน้อยหนึ่งวัน
       🔴 ไม่เลือกวันเลย = ตารางเวลาที่ไม่มีวันไหนตรงเงื่อนไข ⇒ งานถูกเซฟเรียบร้อย
          สถานะขึ้นว่า scheduled แต่ **ไม่มีวันไหนยิงเลยตลอดกาล** และไม่มีอะไรฟ้อง
          จนกว่าจะมีคนสังเกตว่าลูกค้าไม่เคยได้รับ
       ⚠️ เช็คเฉพาะโหมด repeat — โหมด "ส่งครั้งเดียว" ไม่มีวันในสัปดาห์ให้เลือก
          และต้องไม่โดนด่านนี้ */
    if (formData.schedule?.mode === 'repeat') {
      const days = formData.schedule?.days_of_week;
      if (!Array.isArray(days) || days.length === 0) {
        nextErrors.schedule_days = t('broadcast.form_repeat_days_required');
      }
    }

    return nextErrors;
  };

  const validate = (): Record<string, string> => {
    const nextErrors = computeErrors();
    setErrors(nextErrors);
    return nextErrors;
  };

  /* [FEAT-2708-NOSTEPSKIP] เจ้าของ 27/08: "ห้ามกด ข้าม step" — เดินหน้าได้
     ไกลสุดแค่ **ขั้นแรกที่ยังมี error** (งาน edit ที่ครบแล้วจึง jump อิสระโดย
     ธรรมชาติ ไม่มีโหมดพิเศษ) · ย้อนกลับ/โหมดดู = อิสระเสมอ · โดนจับ = พาไปยืน
     ขั้นที่ติด + commit error เฉพาะขั้นนั้น (commit ทั้งก้อนจะทำ chip ขั้นไกล
     แดงทั้งที่แค่ "ยังเดินไม่ถึง") + แถบสรุปเดิมโชว์
     ⚠️ ไม่แตะ handleSubmit / notAtLastStep / fade — confirmFade ต้องเขียวเดิม
     revert: คืน onNext/onPick 3 จุดเป็น setStepIndex ตรง ๆ + ลบ handler นี้ */
  const tryGoTo = (target: number) => {
    const next = clampStep(target);
    if (isReadOnly || next <= stepIndex) {
      setStepIndex(next);
      return;
    }
    const all = computeErrors();
    const firstBad = firstStepWithError(all);
    const limit = firstBad >= 0 ? firstBad : LAST_STEP;
    const landing = clampStep(Math.min(next, limit));
    if (landing < next) {
      const keys = new Set(BROADCAST_STEPS[landing]?.fields ?? []);
      setErrors(
        Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k))),
      );
      setShowErrorSummary(true);
    }
    setStepIndex(landing);
  };

  /* One place to drop a field's error, instead of the same five-line block
     repeated per handler. เอาซ้ำ ๆ มารวมไว้ที่เดียว. */
  const clearError = (field: string) => {
    setErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  /* [FIX-20260824-PICKERSAME] ติ๊กกี่ตัวก็ได้ — ตัวเลือกทั้งชุดมาจาก
     `MultiCheckSelect` แล้ว ฟอร์มแค่รับ "รายการใหม่ทั้งก้อน" มาเก็บ
     (ของเดิมเป็น toggle ทีละ id ⇒ ปุ่ม "เลือกทั้งหมด" ต้องยิง n ครั้ง
     และ setState แบบ functional ซ้อนกันจนหลุด) รับทั้งก้อน = กดครั้งเดียวจบ. */
  const setHookIds = (next: string[]) => {
    if (isReadOnly) return;
    setFormData(prev => ({ ...prev, hook_ids: next }));
    clearError('hook_ids');
  };

  /* [FEAT-2708-TARGETGROUPCUT] `setTargetGroupIds` (คู่กับ picker ของ step 5)
     ถูกถอดพร้อมปุ่ม — cascade ของกลุ่มเจ้าของงาน (`setAssignGroupIds` ข้างล่าง)
     ยังทำงานเต็มตามเดิม */

  /* [FIX-20260824-HOOKCASCADE] เปลี่ยนกลุ่มเจ้าของงานก็ตัดตามกฎเดียวกัน
     ⚠️ ของเดิมล้าง `hook_ids: []` ทิ้งทั้งหมด ซึ่งผิดตั้งแต่วันที่รายชื่อ OA
        โหลดจากหลายกลุ่ม (`[FIX-20260824-HOOKSFROMGROUPS]`): OA ที่เลือกไว้ผ่าน
        "กลุ่มเป้าหมาย" ไม่ได้เกี่ยวอะไรกับกลุ่มเจ้าของงานเลย แต่โดนล้างไปด้วย
     🔴 `assign_group` ยังเป็น **ค่าเดียว** (string) เหมือนเดิม — BE ใช้ทั้งเรื่อง
        การอ้างเจ้าของและเรื่องสิทธิ์ ⇒ ห้ามทำเป็น multi เด็ดขาด แค่เปลี่ยนมาใช้
        combobox ที่ค้นหาได้เท่านั้น */
  /**
   * [FEAT-20260825-MULTIGROUP] เลือกกลุ่มเว็บได้หลายกลุ่ม
   *
   * 🔴 ส่ง `assign_group_ids` เป็นตัวหลัก และคง `assign_group` (กลุ่มแรก) ไว้ด้วย
   *    เพราะตัวกรองการมองเห็นฝั่ง BE ยังอ่านคีย์เก่าอยู่สำหรับแถวก่อน 25/08
   *    ⇒ ส่งคู่ = ทั้งแถวเก่าและแถวใหม่มองเห็นได้ ไม่ต้อง migrate
   *
   * 🔴 CASCADE: กลุ่มไหนถูกติ๊กออก OA ของกลุ่มนั้นต้องออกตาม ไม่งั้นเกิดบั๊ก
   *    "ส่งเกิน" — OA หายจากจอแต่ id ยังค้างใน `hook_ids` แล้วยิงจริง
   *    (`[FIX-20260824-HOOKCASCADE]` เดิม แค่ตอนนี้ต้องส่งทั้งลิสต์ ไม่ใช่ค่าเดียว)
   */
  const setAssignGroupIds = (next: string[]) => {
    if (isReadOnly) return;
    setFormData(prev => ({
      ...prev,
      assign_group_ids: next,
      /* กลุ่มแรกคือค่าที่ BE เขียนลง `assign_group` — ให้ฝั่งจอตรงกับฝั่งเก็บ */
      assign_group: next[0] ?? null,
      hook_ids: pruneHookIds(prev.hook_ids, hooks, [
        ...next,
        ...(prev.target.group_ids || [])
      ])
    }));
    clearError('assign_group');
  };

  /* The error is cleared on edit rather than re-validated on every keystroke:
     re-checking as they type flags "must not end with a space" the instant
     they type a space between two words. เตือนตอนเซฟ ไม่ใช่ตอนพิมพ์. */
  const handleTitleDetailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnly) return;
    const value = e.target.value;
    setFormData(prev => ({ ...prev, title_detail: value }));
    if (errors.title_detail) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.title_detail;
        return next;
      });
    }
  };

  const handleMessageTypeChange = (type: MessageType) => {
    if (isReadOnly) return;
    setFormData(prev => ({
      ...prev,
      message: {
        type,
        text: type === 'text' ? prev.message.text ?? '' : undefined,
        image_url: type === 'image' ? prev.message.image_url ?? '' : undefined,
        flex_json: type === 'flex' ? prev.message.flex_json ?? {} : undefined
      }
    }));
    /* Mirrors `setFlexText('')` right here: `title_detail` only exists for
       flex, so keeping it after a switch to text/image would save a title the
       admin can no longer see and cannot correct. ช่องที่มองไม่เห็นแล้ว ต้องไม่ค้างอยู่. */
    if (type !== 'flex') {
      setFlexText('');
      setFormData(prev => ({ ...prev, title_detail: '' }));
      setErrors(prev => {
        const next = { ...prev };
        delete next.title_detail;
        return next;
      });
    }
    if (errors.message) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.message;
        return next;
      });
    }
  };

  const handleScheduleMode = (mode: 'send' | 'schedule' | 'draft') => {
    if (isReadOnly) return;
    if (mode === 'send') {
      setFormData(prev => ({ ...prev, status: 'sent', scheduled_at: null }));
    } else if (mode === 'schedule') {
      setFormData(prev => ({ ...prev, status: 'scheduled' }));
    } else {
      setFormData(prev => ({ ...prev, status: 'draft', scheduled_at: null }));
    }
    if (errors.scheduled_at) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.scheduled_at;
        return next;
      });
    }
  };

  /**
   * 🔴 PREVIEWS THE SAVED JOB, NOT THE UNSAVED FORM — and says so.
   *
   * The endpoint renders from what is in the database, so unsaved edits are
   * not in the picture. Pretending otherwise would be the same class of lie
   * the backend's `mirrors` flag exists to prevent, so the button is only
   * offered once the job HAS an id. พรีวิวของที่เซฟแล้ว ไม่ใช่ที่กำลังพิมพ์.
   */
  /* ดึงการ์ดใบที่ "เลือกอยู่ตอนนี้" — ไม่ใช่ใบที่เซฟไว้ และไม่จำค่าเดิม
     ปุ่มเดียวทำหน้าที่ทั้ง "ดูตัวอย่าง" และ "refresh" เพราะมันยิงใหม่ทุกครั้ง */
  const loadSelectedCard = async () => {
    const id = formData.message.flex_id ? String(formData.message.flex_id) : '';
    if (!id) return;
    setCardLoading(true);
    setCardError(undefined);
    try {
      setCardPreview(await flexMessageService.getFlexMessage(id));
      setCardModalOpen(true);   // ปุ่มเดียว = โหลดสดแล้วเปิดดูเลย
    } catch (err) {
      setCardPreview(undefined);
      setCardError(err instanceof Error ? err.message : t('broadcast.preview_failed'));
    } finally {
      setCardLoading(false);
    }
  };

  /* ⚠️ เลือกการ์ดใบใหม่ = ของที่ค้างอยู่บนจอเป็นของใบเก่าทันที ⇒ ล้างทิ้ง
     ไม่งั้นผู้ใช้เห็นใบเก่าค้างแล้วนึกว่าเลือกไม่ติด */
  useEffect(() => {
    setCardPreview(undefined);
    setCardError(undefined);
  }, [formData.message.flex_id]);


  /** Same shape as `handlePreview`: a saved job only, asked for on demand. */

  /**
   * [FEAT-20260825-BCASTFOLD] กดเซฟแล้วไม่ผ่าน ⇒ ต้องบอกทันทีว่าเหลือช่องไหน
   *
   * 🔴 การ์ดพับได้แล้ว ⇒ error ที่อยู่ในการ์ดที่ปิดอยู่จะ **มองไม่เห็นเลย**
   *    เดิมมันพอทนได้เพราะทุกอย่างกางอยู่ตลอด ตอนนี้ไม่ใช่แล้ว
   *    ⇒ เก็บว่าเคยกดเซฟแล้วพลาด แล้วโชว์แถบสรุปด้านบนฟอร์ม
   *    (ตัว `FormSection` จะกางการ์ดที่มี error ให้เองจาก `errorCount`)
   *    เจ้าของ 25/08: *"กดเซฟแล้ว validate modal เด้งเลย ค่าไหนที่ต้องกรอก"*
   */
  const [showErrorSummary, setShowErrorSummary] = React.useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setShowErrorSummary(true);
      /* เลื่อนขึ้นไปให้เห็นแถบสรุป — ฟอร์มยาวเกินกว่าจะเดาว่าเขามองเห็นอยู่
         (guard ไว้เพราะ jsdom ไม่มี scrollTo) */
      /* [UI-20260825-WIZARD] พาไปยืนที่ขั้น **แรก** ที่ผิด — ไม่ใช่ขั้นใกล้สุด
         วิซาร์ดซ่อนขั้นที่ไม่ได้ยืนอยู่ ⇒ ถ้าไม่เด้ง ผู้ใช้จะเห็นแถบสรุปบอกว่าผิด
         แต่หาช่องที่ผิดไม่เจอเลย ซึ่งแย่กว่าไม่มีวิซาร์ด */
      const bad = firstStepWithError(nextErrors);
      if (bad >= 0) setStepIndex(clampStep(bad));
      const body = document.getElementById('broadcast-form');
      if (body && typeof body.scrollTo === 'function') {
        body.scrollTo({ top: 0, behavior: 'smooth' });
      }
      /* [FIX-20260828-REPEATDAYS] พาไปที่ปุ่มวันโดยตรง ไม่ใช่แค่ขึ้นไปอ่านแถบสรุป
         🔴 ปุ่มวันอยู่ล่างสุดของขั้นสุดท้าย · เลื่อนขึ้นบนอย่างเดียวคือพาผู้ใช้
            ออกห่างจากช่องที่ต้องแก้ ⇒ อ่านว่า "ผิด" แล้วต้องไถลงมาหาเองอีกรอบ
         ⚠️ ต้องรอให้ขั้นที่ถูกต้อง render ก่อน (วิซาร์ดซ่อนขั้นที่ไม่ได้ยืนอยู่)
            จึงหน่วงด้วย rAF — ถ้าเรียกทันทีจะยังไม่มี element นั้นใน DOM
         ⚠️ ทุกอย่าง optional-chain เพราะ jsdom ไม่มี `scrollIntoView` และ
            `requestAnimationFrame` อาจไม่มีในบางสภาพแวดล้อมเทส */
      if (nextErrors.schedule_days) {
        const jump = () => {
          const first = document.querySelector<HTMLElement>(
            '[data-testid="repeat-days"] button',
          );
          first?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          first?.focus?.();
        };
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(jump);
        } else {
          jump();
        }
      }
      return;
    }
    /* [UI-20260825-CONFIRMLASTSTEP] กันไว้ก่อนเปิดกล่องยืนยัน — และบอกเหตุผล */
    if (notAtLastStep) {
      setStepBlocked(true);
      return;
    }
    setShowErrorSummary(false);
    setConsentChecked(false);
    setConsentMissing(false);
    setIsConfirmOpen(true);
  };

  /* [FIX-20260825-SENDNOWCLAIMABLE] 🔴 "ส่งทันที" ต้องบันทึกเป็น `scheduled` ไม่ใช่ `sent`
     ต้นเหตุที่วัดได้จริง 25/08: `broadcast-send/claim.ts:29` ⇒ `CLAIMABLE_FROM = ['scheduled']`
     คือ **claim ได้เฉพาะงานสถานะ `scheduled`** · ฟอร์มเดิมบันทึกเป็น `sent` ทันที
     ⇒ พอเรียก `POST /:id/send` ตัว claim เจอ `sent` แล้วปฏิเสธ คืน `not-claimed`
       ซึ่งถูกแปลออกมาเป็น "another process is already running this job"
       (ข้อความชวนเข้าใจผิด — จริง ๆ คือ "สถานะนี้ claim ไม่ได้" ไม่มีใครแย่งจริง)
     ⇒ ฟอร์มประกาศว่า "ส่งแล้ว" ตั้งแต่ยังไม่ได้ส่ง แล้วไปบล็อกการส่งของตัวเอง

     ⚠️ `sent` เป็นสถานะที่ **ตัวส่งเป็นคนเขียนเมื่อส่งจบ** ไม่ใช่สิ่งที่ฟอร์มประกาศล่วงหน้า
        แถวจะอยู่สถานะ `scheduled` แค่ชั่วขณะระหว่าง create กับ send เท่านั้น
     ⚠️ BE บังคับว่า `scheduled` ต้องมี `scheduled_at` (`broadcasts.service.ts:546-551`)
        ⇒ ใส่เวลา ณ ตอนกดให้ ซึ่งตรงกับความหมาย "ส่งทันที" อยู่แล้ว
     ⇒ การแปลงเกิดที่ `pages/messaging/Broadcasts.tsx#submitForm` ซึ่งเป็นจุดเดียว
       ที่รู้ทั้ง "เจตนาว่าจะส่งทันที" และเป็นคนยิง `/send` ต่อ — แปลงที่นี่จะทำให้
       ตัวนั้นแยกไม่ออกระหว่าง "ส่งทันที" กับ "ตั้งเวลา" เพราะสถานะกลายเป็นค่าเดียวกัน
     revert: ดู marker เดียวกันใน Broadcasts.tsx */
  const buildPayload = (): BroadcastFormData => ({
    ...formData,
    assign_group: formData.assign_group ?? null,
    /* [FEAT-20260825-MULTIGROUP] ตัวหลักที่ BE อ่าน — ส่งคู่กับคีย์เก่าเสมอ */
    assign_group_ids: formData.assign_group_ids,
    scheduled_at: formData.status === 'scheduled' ? formData.scheduled_at : null,
    message: buildMessagePayload(formData.message, flexText),
    /* [FEAT-20260824-BCASTREPEAT] `null` = ล้างรอบซ้ำ (กลับเป็นยิงครั้งเดียว)
       ส่งไปเสมอเพราะ BE แยก undefined (ไม่แตะ) กับ null (ล้าง) ออกจากกัน */
    schedule: formData.schedule ?? null
  });

  const confirmSubmit = async () => {
    /* [UI-20260825-SENDCONSENT] 🔴 ประตูจริงอยู่ตรงนี้ ไม่ใช่ที่ปุ่ม
       เจ้าของสั่งว่ากดได้แต่ต้อง *"เด้ง check box แดง ๆ"* ⇒ ปุ่มยืนยันไม่ถูก
       disable · ปิดปุ่มไว้เฉย ๆ จะไม่บอกอะไรคนที่กดแล้วไม่มีอะไรเกิดขึ้นเลย */
    if (!consentChecked) {
      setConsentMissing(true);
      return;
    }
    setLoading(true);
    try {
      const payload = buildPayload();
      await onSubmit(payload);
      /* [FIX-20260903-CLOSECONFIRMTOO] a successful send closes EVERYTHING —
         owner 03/09: dismissing the success alert must not drop the admin back
         onto the confirm dialog.
         🔴 ROOT CAUSE: `closeOnConfirm={false}` is deliberate (the box must not
            close while the consent box is unticked), so NOTHING set
            `isConfirmOpen` back to false on the success path. The old code
            relied on `onClose()` alone, which closes the FORM — but this
            component never unmounts (`if (!isOpen) return null` sits below the
            hooks), so the `true` stayed behind.
         ⇒ closing the "saved" alert revealed the stale confirm dialog.
         ⚠️ Same family as [FIX-20260826-STALECONFIRM], which clears this flag on
            OPEN. That fix handles the NEXT open; this one handles the CURRENT
            success. Both are needed — neither replaces the other.
         ⚠️ Closed BEFORE `onClose()`: they are two different pieces of state —
            the confirm box belongs to this file, the form to the parent page.
         ⚠️ Success path only. If `onSubmit` throws, execution never reaches this
            line and the confirm box stays open to be corrected, which is right.
         revert: drop the setIsConfirmOpen(false) line */
      setIsConfirmOpen(false);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  /* [FIX-20260824-PICKERSAME] ทั้งสามช่องเลือกแปลงรายการของตัวเองเป็น option ชุด
     เดียวกัน `{value,label}` แล้วส่งให้ตัวเลือกกลางเป็นคนวาด/ค้นหา/สรุปข้อความ
     ⇒ สรุปแบบ "A, B +3" ที่เมื่อก่อนก๊อปกันอยู่สองที่ในไฟล์นี้ ย้ายไปอยู่ที่
     `summariseChoices` ที่เดียว ไม่มีทางเพี้ยนกันเองอีก. */
  /* [FEAT-2708-GRIDPICK] (5.3+) เจ้าของ 27/08: แถว OA โชว์โดเมนของ hook ด้วย —
     `domain_name` มากับ endpoint เดิมอยู่แล้ว (เต็ม URL) จอเอาเฉพาะ host พออ่าน */
  const hookDomainHost = (raw: unknown): string | undefined => {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) return undefined;
    try {
      return new URL(v).host;
    } catch {
      return v;
    }
  };
  const hookOptions: MultiCheckOption[] = useMemo(
    () => hooks.map(h => ({
      value: h._id,
      label: h.line_oa_name,
      hint: hookDomainHost((h as { domain_name?: string }).domain_name),
    })),
    [hooks]
  );

  const groupOptions: MultiCheckOption[] = useMemo(
    () => groups.map(g => ({ value: g._id, label: g.group_name })),
    [groups]
  );

  const InputError = ({ error }: { error?: string }) => {
    if (!error) return null;
    return (
      <div className="flex items-center gap-1 mt-1 text-red-400 text-xs animation-fade-in">
        <AlertCircle size={12} />
        <span>{error}</span>
      </div>
    );
  };

  const confirmStatusLabel =
    formData.status === 'sent'
      ? t('broadcast.schedule_send_now')
      : formData.status === 'draft'
        ? t('broadcast.schedule_draft')
        : t('broadcast.status_scheduled');
  const confirmMessage = `${t('broadcast.confirm_status', { status: confirmStatusLabel })}\n${t('broadcast.confirm_message')}`;

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      variant="form"
      /* [FEAT-20260825-BCASTBIG] เจ้าของ 25/08: *"modal ใหญ่"* — กว้างเกือบเต็มจอ
         แทน max-w-6xl (72rem) ที่เหลือขอบว่างสองข้างเยอะบนจอกว้าง
         [FIX-20260825-BCASTSCALE] แล้วเจ้าของบอกกลับ *"modal ใหญ่เกินไป"* ⇒ ถอยมาที่
         80vw · ยังกว้างกว่า max-w-6xl เดิมบนจอใหญ่ แต่ไม่ชนขอบจออีกแล้ว */
      maxWidth="max-w-[80vw]"
      // Stays OUTSIDE the panel, exactly where it was rendered before.
      afterPanel={
        <>
        <ConfirmModal
          isOpen={isConfirmOpen}
          onClose={() => setIsConfirmOpen(false)}
          onConfirm={confirmSubmit}
          title={resolvedMode === 'update' ? t('broadcast.confirm_update_title') : t('broadcast.confirm_create_title')}
          message={confirmMessage}
          type="info"
          cancelLabel={t('common.cancel')}
          /* [UI-20260825-SENDCONSENT] 🔴 ต้องไม่ปิดเองตอนกดยืนยัน
             ค่าปริยายคือปิด ⇒ คนที่ยังไม่ติ๊กจะเห็นกล่องหายไปเฉย ๆ แล้วงานไม่ถูก
             บันทึก ซึ่งแย่กว่าไม่มีตัวกันเลย · ตอนบันทึกสำเร็จ ฟอร์มทั้งใบปิดเอง
             อยู่แล้วผ่าน `onClose()` ใน `confirmSubmit` */
          closeOnConfirm={false}
          /* [FIX-20260903-CLOSEONSENT] "send now" really takes ~3s — measured
             from the log: `/send` answered 201 in 3115ms because it refetches
             site rules first. For that whole time the confirm button has to say
             it is working, instead of looking like the click did nothing.
             ⚠️ Also blocks a double click: pressing twice on a "send now" job
                creates a duplicate campaign AND sends it twice. */
          confirmDisabled={loading}
          confirmLabel={loading ? t('broadcast.confirm_working') : t('common.confirm')}
        >
          <BroadcastSendConsent
            rules={formData.target.rules}
            directTicket={formData.is_direct_ticket === true}
            checked={consentChecked}
            onChange={(next) => {
              setConsentChecked(next);
              if (next) setConsentMissing(false);
            }}
            missing={consentMissing}
          />
        </ConfirmModal>
        {/* [UI-20260828-DISCARDGUARD] ถามก่อนทิ้งงานที่ยังไม่บันทึก
            ⚠️ อยู่ใน `afterPanel` ชุดเดียวกับกล่องยืนยันการบันทึก — สองกล่องนี้
               ไม่มีทางเปิดพร้อมกัน (กล่องหนึ่งมาจากปุ่มบันทึก อีกกล่องมาจากปุ่มยกเลิก)
            ⚠️ `type="warning"` ไม่ใช่ `danger` — งานที่หายคือฉบับร่างในหน้าจอ
               ไม่ใช่ข้อมูลที่ลงฐานไปแล้ว · เก็บสีแดงไว้ให้การลบของจริง */}
        <ConfirmModal
          isOpen={isDiscardOpen}
          onClose={() => setIsDiscardOpen(false)}
          onConfirm={() => {
            setIsDiscardOpen(false);
            onClose();
          }}
          title={t('broadcast.discard_title')}
          message={t('broadcast.discard_message')}
          type="warning"
          confirmLabel={t('broadcast.discard_confirm')}
          cancelLabel={t('broadcast.discard_keep')}
        />
        </>
      }
    >
        <Modal.Header
          title={
            resolvedMode === 'view'
              ? t('broadcast.form_view_title')
              : resolvedMode === 'update'
                ? t('broadcast.form_update_title')
                : t('broadcast.form_create_title')
          }
          onClose={onClose}
          /* [UI-20260825-HEADERBTN] เจ้าของ 25/08: *"header modal button ขอ size
             เดียวกับ footer และเอาปุ่มกากบาทออกไป"*
             ⚠️ `hideClose` เป็น prop ที่ `components/common/Modal.tsx` มีอยู่แล้ว
                ⇒ ไม่ต้องแตะไฟล์นั้น (เป็นของเลนอื่น)
             ⚠️ เอา X ออกแล้ว **ทางปิดยังมีครบ**: ปุ่ม "ยกเลิก" บน header และปุ่ม
                "ยกเลิก" ล่าง ทั้งคู่เรียก `onClose` ตัวเดียวกัน ⇒ ไม่มีทางที่ผู้ใช้
                จะติดอยู่ในโมดัลโดยไม่มีทางออก
             revert: ลบ `hideClose` บรรทัดล่าง */
          hideClose
          /* [UI-20260824-BCASTHEADERACT] เจ้าของ 24/08: "ปุ่มยืนยัน ยกเลิก เพิ่มที่ header ด้วย"
             ═══════════════════════════════════════════════════════════════
             🔴 ทำไมต้องมีสองที่ — ฟอร์มนี้สูงกว่าจอ (สามคอลัมน์ · พรีวิว ·
                ประวัติการส่ง) ปุ่มล่างจึงอยู่ใต้ fold เกือบตลอด ⇒ แอดมินต้อง
                เลื่อนสุดทางทุกครั้งแค่จะกดเซฟ · **ปุ่มล่างยังอยู่ครบ ไม่ได้ย้าย**
                ตามที่สั่ง ("เพิ่มที่ header ด้วย" ไม่ใช่ "ย้ายไป header")

             ⚠️ ขัดกับหมายเหตุบน `actions` ใน `components/common/Modal.tsx`
                ที่เขียนไว้ว่า "อย่าใส่ cancel ตรงนี้ เพราะปุ่ม X ก็ปิดอยู่แล้ว"
                — เจ้าของสั่งตรง ๆ ให้มีทั้งคู่ จึงทำตามคำสั่ง และจดไว้ตรงนี้ว่า
                รู้ตัวว่าขัด ไม่ใช่เผลอ (Modal.tsx เป็นของเลนอื่น ไม่แตะ)

             🔴 `form="broadcast-form"` คือเส้นเดียวที่ทำให้ปุ่มนอก <form> ยิง
                submit ของฟอร์มได้ — header อยู่นอก <form> จริง ๆ (พี่น้องกัน
                ไม่ใช่ลูก) ถ้าลืม attribute นี้ ปุ่มจะกดแล้วเงียบสนิท
                เหมือน GroupFormModal ที่ทำท่าเดียวกันไว้ก่อนแล้ว */
          actions={
            <div className="ml-auto mr-3 flex items-center gap-2">
              {/* [UI-20260825-NAVINHEADER] ปุ่มเดินขั้นบน header ด้วย
                  เจ้าของ 25/08: *"step wizard boardcast ปุ่มต่อไปกับย้อนกลับ เอาขึ้น header ด้วย"*
                  ⚠️ ใช้ `BroadcastStepNav` **ตัวเดียวกับด้านล่าง** ไม่ได้เขียนปุ่มใหม่
                     ⇒ เงื่อนไขปิด/ซ่อน (ขั้นแรกกดย้อนไม่ได้ · ขั้นสุดท้ายไม่มีต่อไป ·
                     โหมดกางทุกขั้นคืน null) เหมือนกันโดยอัตโนมัติ แก้ที่เดียวขยับทั้งสองที่
                  ⚠️ `data-testid` จะซ้ำกับตัวล่าง — ตั้งใจ เพราะมันคือปุ่มเดียวกัน
                     เทสที่ต้องเจาะตัวใดตัวหนึ่งให้ scope ด้วย header/footer
                  revert: ลบบล็อกนี้บล็อกเดียว ตัวล่างไม่ถูกแตะ */}
              {!isReadOnly && (
                <div className="mr-1 flex items-center gap-2" data-testid="wizard-nav-header">
                  <BroadcastStepNav
                    activeIndex={stepIndex}
                    showAll={showAllSteps}
                    onBack={() => setStepIndex((n) => clampStep(n - 1))}
                    onNext={() => tryGoTo(stepIndex + 1)}
                  />
                </div>
              )}
              <button
                type="button"
                name="header_cancel"
                onClick={requestClose}
                className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors"
              >
                {t('common.cancel')}
              </button>
              {/* โหมดดูอย่างเดียวไม่มีอะไรให้ยืนยัน — เงื่อนไขเดียวกับปุ่มล่าง */}
              {!isReadOnly && (
                <button
                  type="submit"
                  form="broadcast-form"
                  name="header_confirm"
                  disabled={loading}
                  title={notAtLastStep ? t('broadcast.confirm_needs_last_step') : undefined}
                  className={`px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2 disabled:opacity-60 ${
                    notAtLastStep ? 'opacity-40' : ''
                  }`}
                >
                  {loading ? <Loader2 className="animate-spin" size={16} /> : <Save size={18} />}
                  {t('common.confirm')}
                </button>
              )}
            </div>
          }
        />

        {/* [FEAT-20260825-BCASTBIG] `bcast-form-lg` scales type and control
            height for everything inside this form — see the block in `index.css`.
            ครอบทั้งฟอร์มจุดเดียว ไม่ไปแตะคลาสทีละอัน */}
        {/* [UI-20260828-SCROLLHINT] ต้องมีชั้นนี้เพราะลูกศรวางแบบ absolute
            ⚠️ `min-h-0` จำเป็นในสาย flex — ขาดไปแล้วลูกศรจะเกาะกล่องที่ไม่เคยล้น
               และไม่โผล่เลยแม้ฟอร์มจะยาวกว่าจอ */}
        <div className="relative flex min-h-0 flex-1 flex-col">
        {/* [FIX-20260903-STEPRAILALWAYS] the step rail stays visible at all times
            🔴 ROOT CAUSE: `<BroadcastStepRail>` used to sit INSIDE the `<form>`,
               which is the element carrying `overflow-y-auto` — the real scroll
               container, per [UI-20260828-SCROLLHINT].
               ⇒ scrolling down to the lower fields scrolled the rail away too
               ⇒ whoever is filling the form loses sight of which step they are
                 on, how many are left, and which ones hold invalid fields —
                 from the navigation control for the whole form.
            ⇒ Moved above the `<form>`, into a layer that does NOT scroll, so it
              stays pinned under the modal header.
            ⚠️ Pure JSX move — all five props and the state they read
               (`stepIndex`, `errors`, `showAllSteps`) are in the same scope as
               before, so chip clicks, step jumps and the red error counts behave
               exactly as they did.
            ⚠️ `shrink-0` stops the rail being squeezed away in the flex column
               once the content grows tall.
            ⚠️ Now OUTSIDE the `<form>`, so it must contain no submit button —
               it does not: every chip is `type="button"` in BroadcastStepper.
            revert: move this block back under `stepBlocked && notAtLastStep`
              inside the <form> */}
        <div className="shrink-0 px-6 pt-6">
          <BroadcastStepRail
            activeIndex={stepIndex}
            errorCounts={stepErrorCounts(errors)}
            showAll={showAllSteps}
            onPick={(i) => tryGoTo(i)}
            onToggleShowAll={() => setShowAllSteps((v) => !v)}
          />
        </div>
        <ScrollHint targetRef={formScrollRef} />
        <form ref={formScrollRef} id="broadcast-form" onSubmit={handleSubmit} className="bcast-form-lg px-6 pb-6 pt-4 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-6">
          {/* [FEAT-20260825-BCASTFOLD] แถบสรุปตอนกดเซฟไม่ผ่าน — ดูเหตุผลที่ handleSubmit
              ⚠️ ลิสต์มาจาก `errors` ตัวจริง ไม่ใช่ลิสต์มือ ⇒ เพิ่ม validate ใหม่เมื่อไหร่
                 มันโผล่เองโดยไม่ต้องมาแก้ตรงนี้ (ลิสต์มือคือจุดที่ field หายเงียบ) */}
          {/* [UI-20260825-WIZARD] แถบขั้นตอน — บอกว่ายืนอยู่ขั้นไหน เหลืออีกกี่ขั้น
              และขั้นไหนมีช่องผิด · กดที่ชิปเพื่อกระโดดไปขั้นนั้นได้
              ⚠️ ป้ายแดงบนชิปมาจาก `errors` ตัวจริงผ่าน `stepErrorCounts` ไม่ใช่
                 ลิสต์มือ ⇒ เพิ่ม validate ใหม่แล้วมันโผล่เองโดยไม่ต้องมาแก้ที่นี่ */}
          {/* [UI-20260825-CONFIRMLASTSTEP] บอกว่าทำไมกดยืนยันไม่ได้
              ⚠️ โผล่เฉพาะตอนพยายามกดจริง ไม่ใช่ขึ้นค้างไว้ตั้งแต่แรก —
                 คำเตือนที่อยู่ตลอดเวลาไม่มีใครอ่าน */}
          {stepBlocked && notAtLastStep && (
            <div
              data-testid="confirm-blocked-reason"
              className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
            >
              {t('broadcast.confirm_needs_last_step')}
            </div>
          )}
          {/* [FIX-20260903-STEPRAILALWAYS] the step rail moved above the <form>,
              into the layer that does not scroll — see the block carrying the
              same marker further up. */}

          {showErrorSummary && Object.keys(errors).length > 0 && (
            <div
              role="alert"
              data-testid="form-error-summary"
              className="rounded-xl border border-red-500/60 bg-red-500/10 px-4 py-3"
            >
              <p className="text-sm font-semibold text-red-400">
                {t('broadcast.form_fix_before_save', {
                  count: String(Object.keys(errors).length)
                })}
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs text-red-300">
                {Object.entries(errors).map(([key, msg]) => (
                  <li key={key} data-testid={`form-error-item-${key}`}>
                    {msg}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* [FIX-20260825-BCASTSCALE] เจ้าของ 25/08: *"font ใหญ่เกินไปลดลง 10%"*
              ใช้ `zoom` เพราะคลาสขนาดตัวอักษรของ Tailwind เป็นค่า rem ตายตัว
              (`text-sm` = 0.875rem) ⇒ ตั้ง font-size ที่พ่อไม่ทำให้ลูกเล็กลงตาม
              ต้องไล่แก้ทีละคลาสหลายสิบจุดซึ่งเป็นหนี้ · `zoom: .9` ย่อทั้งตัวอักษร
              และระยะห่างพร้อมกัน 10% ด้วยบรรทัดเดียว และถอยกลับก็ลบบรรทัดเดียว
              ⚠️ ย่อเฉพาะเนื้อในฟอร์ม — หัวโมดัลกับแถบปุ่มล่างไม่ถูกแตะ
              revert: ลบ style นี้ */}
          {/* [UI-20260825-WIZARDWIDE] โหมดวิซาร์ดใช้พื้นที่เต็มความกว้าง
              ─────────────────────────────────────────────────────────────────
              🔴 โครงสองคอลัมน์ (ซ้าย 2 ส่วน / ขวา 1 ส่วน) ถูกออกแบบไว้ตอนที่
                 การ์ดทั้งหกใบอยู่บนจอพร้อมกัน · พอเป็นวิซาร์ดที่โชว์ทีละใบ
                 การ์ดยังติดอยู่ในคอลัมน์เดิม ⇒ ขั้นที่ 3-6 ไปกองอยู่ในคอลัมน์
                 กว้าง 1 ใน 3 ทางขวา เหลือที่ว่างครึ่งจอทางซ้าย (เจ้าของ 25/08:
                 *"ตำแหน่งมั่ว ไปออกข้างล่างทำไม พื้นที่กว้างเยอะ"*)
              ⇒ วิซาร์ด: ตัวครอบทั้งสองกลายเป็น `contents` ⇒ หายไปจากการจัดวาง
                 การ์ดที่โชว์อยู่จึงเป็นลูกตรงของกล่อง flex และกินเต็มความกว้าง
                 โดยที่ **ลำดับขั้นยังเรียง 1→6 ถูกต้อง** เพราะ DOM เรียงอยู่แล้ว
              ⚠️ `zoom` กลับเป็น 1 เฉพาะโหมดวิซาร์ด — ที่ย่อ 0.9 ไว้ก็เพื่ออัดหก
                 ใบให้ลงจอเดียว ซึ่งไม่ใช่ปัญหาของโหมดทีละใบอีกต่อไป
                 นี่คือ "ขยาย font + element ให้พอดี" ที่เจ้าของขอ ด้วยบรรทัดเดียว
              🔴 โหมด "แสดงทุกขั้นตอน" ได้คลาสและ zoom ชุดเดิมเป๊ะทุกตัวอักษร —
                 เงื่อนไขที่เจ้าของกำกับว่า *"ห้ามกระทบ"* · เทส
                 `broadcastWizardLayout.test.ts` ปักข้อนี้ไว้
              revert: เอา `showAllSteps ?` ทั้งสามจุดออก ให้เหลือคลาสฝั่ง true */}
          <div
            className={showAllSteps ? 'grid grid-cols-1 lg:grid-cols-3 gap-6' : 'flex flex-col gap-6'}
            style={{ zoom: showAllSteps ? 0.9 : 1 }}
          >
            <div className={showAllSteps ? 'lg:col-span-2 flex flex-col gap-6' : 'contents'}>
              <BroadcastStepPane stepId="section-basic" activeIndex={stepIndex} showAll={showAllSteps}>
                <FormSection title={t('broadcast.section_basic')} testId="section-basic" revealOn={showAllSteps || stepIndex === 0} defaultOpen errorCount={errorsIn('section-basic')}>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('broadcast.form_name_label')} <span className="text-red-500">*</span>
                    </label>
                    <input
                      name="name"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      disabled={isReadOnly}
                      className={inputClass(!!errors.name)}
                      placeholder={t('broadcast.form_name_placeholder')}
                    />
                    <InputError error={errors.name} />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t('broadcast.form_description_label')}
                      {resolvedMode === 'create' && <span className="text-red-500"> *</span>}
                    </label>
                    <textarea
                      name="description"
                      value={formData.description ?? ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      disabled={isReadOnly}
                      rows={2}
                      maxLength={500}
                      className={inputClass(!!errors.description)}
                      placeholder={t('broadcast.form_description_placeholder')}
                    />
                    {/* [UI-20260825-HIDEDESCHINT] ซ่อนคำอธิบายใต้ช่อง "แคมเปญนี้ทำเพื่ออะไร"
                        เจ้าของสั่ง 25/08 ให้ซ่อน — ช่องนี้ถูกใช้เป็นเหตุผลของเคสที่เปิดให้
                        ลูกค้าด้วย (`is_direct_ticket`) ⇒ ประโยค "ไม่ถูกส่งไปหาลูกค้า"
                        ไม่จริงเสมอไปแล้ว การซ่อนจึงถูกกว่าการปล่อยข้อความที่อาจทำให้เข้าใจผิด
                        ⚠️ ซ่อนเฉพาะการแสดงผล — คีย์ i18n `broadcast.form_description_hint`
                           ยังอยู่ครบทั้ง 4 ภาษา เผื่อเปลี่ยนใจ
                        revert: ลบคอมเมนต์นี้แล้วเอา <p> บรรทัดล่างกลับมา
                    <p className="mt-1 text-xs text-slate-700">{t('broadcast.form_description_hint')}</p>
                    */}
                    <InputError error={errors.description} />
                  </div>
                </FormSection>
              </BroadcastStepPane>

              <BroadcastStepPane stepId="section-message" activeIndex={stepIndex} showAll={showAllSteps}>
                <FormSection title={t('broadcast.section_message')} testId="section-message" revealOn={showAllSteps || stepIndex === 1} defaultOpen errorCount={errorsIn('section-message')}>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t('broadcast.form_message_type_label')} <span className="text-red-500">*</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleMessageTypeChange('text')}
                        disabled={isReadOnly}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${choiceClass(formData.message.type === 'text')}`}
                      >
                        <MessageSquare size={16} />
                        {t('broadcast.message_text')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMessageTypeChange('image')}
                        disabled={isReadOnly}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${choiceClass(formData.message.type === 'image')}`}
                      >
                        <ImageIcon size={16} />
                        {t('broadcast.message_image')}
                      </button>
                      {/* [FIX-20260824-TARGETHIDDEN] ปุ่ม Flex ถูกลบไปตั้งแต่ commit แรก
                          ของ repo (`e066273` ตอน fork) เหลือไว้แค่คอมเมนต์ — และการ์ด
                          Flex คือ**ทางเดียว**ที่จะไปถึงช่อง "หัวข้อแจ้งเตือน"
                          (`title_detail`, บรรทัด ~591 ครอบด้วย `message.type === 'flex'`)
                          ⇒ ฟีเจอร์ที่ BE ทำเสร็จแล้ว **ไม่มีประตูให้เข้า**
                          ⚠️ ท่อหลังปุ่มยังครบทุกเส้น: `handleMessageTypeChange('flex')`
                          · validation `form_flex_invalid` · placeholder ของ flex
                          ⇒ เอาปุ่มกลับ = ใช้ได้ทันที ไม่ต้องต่อท่อใหม่
                          revert: ลบปุ่มนี้ทิ้ง แล้ว title_detail จะเข้าไม่ถึงอีกครั้ง */}
                      <button
                        type="button"
                        name="message_type_flex"
                        onClick={() => handleMessageTypeChange('flex')}
                        disabled={isReadOnly}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${choiceClass(formData.message.type === 'flex')}`}
                      >
                        <Layout size={16} />
                        {t('broadcast.message_flex')}
                      </button>
                    </div>
                    <InputError error={errors.message} />
                  </div>

                  <div>
                    {/* [FEAT-20260907-FLEXPICKREFRESH] 🔴 THIS LABEL IS SHARED BY ALL
                        THREE message types (text / image / flex) and always has been.
                        the flex branch must name the card it sends. Editing
                        the existing key in place would rename the text and image fields
                        too, which nobody asked for.
                        ⇒ flex gets its own label, carried by `FlexCardPickerHeader`
                          together with the refresh button (the button has to live with
                          the state it drives). The other two keep this label untouched.
                        revert: drop the `!== 'flex'` condition below and the label covers
                                all three again. */}
                    {formData.message.type !== 'flex' && (
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        {t('broadcast.form_message_content_label')} <span className="text-red-500">*</span>
                      </label>
                    )}
                    {formData.message.type === 'text' && (
                      <textarea
                        name="message_text"
                        value={formData.message.text || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, message: { ...prev.message, text: e.target.value } }))}
                        disabled={isReadOnly}
                        rows={5}
                        className={inputClass(!!errors.message)}
                        placeholder={t('broadcast.form_message_text_placeholder')}
                      />
                    )}
                    {/* [FEAT-20260907-IMAGEONLYPICKER] the same <input name="message_image_url">
                        as before, now with an "Attach IMG" button, a preview and a clear
                        control around it — in its own file, because this modal is past the
                        400-line cap and its header forbids new UI here.
                        ⚠️ `image_url` is still the ONLY thing stored, written through the
                           same setState; attaching just fills it in. */}
                    {formData.message.type === 'image' && (
                      <BroadcastImageField
                        value={formData.message.image_url || ''}
                        onChange={(url) => setFormData(prev => ({ ...prev, message: { ...prev.message, image_url: url } }))}
                        disabled={isReadOnly}
                        invalid={!!errors.message}
                        inputClassName={inputClass(!!errors.message)}
                      />
                    )}
                    {formData.message.type === 'flex' && (
                      <>
                        {/* [FEAT-20260824-BCASTFLEXID] เจ้าของ 24/08: "flex id ใช้ส่ง
                            ไม่ใช่ กรอกดิบ" — เลือกการ์ดจากคลัง เก็บแค่ id ลง job
                            🔴 ที่ textarea เดิมเคยอยู่: job ถือสำเนา json ของตัวเอง
                            ⇒ แก้การ์ดที่ต้นทางแล้วแคมเปญเดิมยังส่งของเก่าตลอดไป
                            revert: เอา <textarea name="message_flex"> กลับมาแทนบล็อกนี้ */}
                        <FlexCardPicker
                          value={formData.message.flex_id ?? null}
                          onChange={(flexId) => setFormData(prev => ({
                            ...prev,
                            message: { ...prev.message, flex_id: flexId }
                          }))}
                          disabled={isReadOnly}
                          invalid={!!errors.message}
                          /* [FEAT-20260907-FLEXPICKREFRESH] Is this step on screen? The
                             picker cannot tell: the pane hides with `hidden` and never
                             unmounts. Asked through `isStepVisible`, the same helper the
                             pane uses, so there is never a second visibility formula. */
                          active={isStepVisible('section-message', stepIndex, showAllSteps)}
                          /* [FEAT-20260907-FLEXTOOLROW] shrink these two,
                             bring them up beside "refresh รายการ", one theme and one
                             size, and put จัดการ flex BEFORE ดูตัวอย่าง.
                             🔴 จัดการ flex renders ALWAYS — explicitly asked for. It used
                                to sit inside the `flex_id` gate below, so on a brand new
                                campaign, before any card was chosen, the one button that
                                leads to the card library was not on screen. That is the
                                exact moment somebody needs it.
                             ⚠️ ดูตัวอย่าง STAYS gated on `flex_id`: it renders the SELECTED
                                card, and with nothing selected it would promise something
                                it cannot do. Different rules on purpose.
                             ⚠️ `FlexToolButton`, not a copied className — one file owns
                                the size and theme of all three. */
                          headerActions={
                            <>
                              <FlexManageButton disabled={isReadOnly} />
                              {formData.message.flex_id && (
                                <FlexToolButton
                                  testId="preview-selected-card"
                                  onClick={loadSelectedCard}
                                  disabled={cardLoading}
                                  label={cardLoading ? t('broadcast.preview_loading') : t('broadcast.preview_selected_card')}
                                  icon={<Eye size={13} />}
                                />
                              )}
                            </>
                          }
                        />
                        <p className="mt-1 text-xs text-slate-700">{t('broadcast.form_message_flex_hint')}</p>

                        {/* ⚠️ แคมเปญที่บันทึกก่อน 24/08 ถือ json ดิบไว้ในตัวเอง ยังส่งได้ปกติ
                            (BE อ่าน flex_id ก่อน ไม่มีจึงใช้สำเนาเดิม) แต่ต้องบอกให้เห็น
                            ไม่งั้นแอดมินจะคิดว่าใบนี้ไม่มีการ์ด */}
                        {!formData.message.flex_id && formData.message.flex_json && (
                          <p className="mt-1 text-xs text-amber-700" data-testid="flex-legacy-copy">
                            {t('broadcast.flex_legacy_copy_hint')}
                          </p>
                        )}

                        {/* [FEAT-20260823-BCASTTITLE] The line a recipient reads
                            in their chat list and on their lock screen, before
                            opening anything — the flex `altText`. Rendered only
                            for flex because text and image messages have no such
                            field and LINE uses the content itself. Blank is
                            normal: the backend falls back to "line messages". */}
                        <div className="mt-4">
                          <label className="block text-sm font-medium text-slate-800">
                            {t('broadcast.form_title_label')}
                          </label>
                          <input
                            type="text"
                            name="title_detail"
                            value={formData.title_detail ?? ''}
                            onChange={handleTitleDetailChange}
                            disabled={isReadOnly}
                            maxLength={TITLE_MAX}
                            className={inputClass(!!errors.title_detail)}
                            placeholder={TITLE_DEFAULT}
                          />
                          <p className="mt-1 text-xs text-slate-700">{t('broadcast.form_title_hint')}</p>
                          <InputError error={errors.title_detail} />
                        </div>
                      </>
                    )}
                    <InputError error={errors.message} />

                    {/* [FEAT-20260823-BCASTPREVIEW] Offered only for a SAVED job:
                        the endpoint renders from the stored row, so on a new
                        broadcast there is nothing to render and a button here
                        would promise something it cannot do. */}
                    {/* [FIX-20260825-PREVIEWLIVE] ชุดปุ่มของ "การ์ดที่เลือกอยู่"
                        🔴 อยู่ **นอก** เงื่อนไข `initialData?.id` โดยตั้งใจ — เจ้าของสั่งว่า
                        ต้องมีใน create modal ด้วย ซึ่งยังไม่มี id ให้ใช้
                        ปุ่มเดียวทำทั้ง "ดูตัวอย่าง" และ "refresh" เพราะยิงใหม่ทุกครั้งที่กด
                        revert: ลบบล็อกนี้ + state cardPreview/cardLoading/cardError */}
                    {/* [FEAT-20260907-FLEXTOOLROW] The two BUTTONS that used to live here
                        moved up onto the picker's label row (see `headerActions` above).
                        What stays behind is what is not a button: the error line and the
                        preview modal, both of which only mean anything once a card is
                        selected — so this block keeps its `flex_id` gate.
                        ⚠️ "จัดการ flex message" is NOT gated any more; it renders from the
                           picker's header on every flex campaign, chosen card or not. */}
                    {formData.message.type === 'flex' && formData.message.flex_id && (
                      <div className="mt-2">
                        {cardError && (
                          <p className="mt-2 text-xs text-red-600" data-testid="card-preview-error">{cardError}</p>
                        )}
                        {/* ⚠️ ใช้ตัว render การ์ดของระบบ ไม่ dump JSON เอง —
                            `FlexPreviewModal` แสดง **ภาพการ์ดจริง** และมีปุ่มคัดลอก
                            JSON อยู่ในตัว ⇒ ปุ่มเดียวได้ครบทั้งสองอย่างตามที่สั่ง */}
                        <FlexPreviewModal
                          isOpen={cardModalOpen && !!cardPreview}
                          onClose={() => setCardModalOpen(false)}
                          flexJson={cardPreview?.content_json ?? null}
                        />
                      </div>
                    )}

                    {/* [FIX-20260825-NOHISTORYINFORM] เจ้าของ 25/08: *"เอาประวัติการส่ง
                        ออกจาก modal · งานนี้ยังไม่เคยส่ง คืออะไรมาลอย ๆ อยู่ทำไม
                        label นี้เอาออกไปจาก modal create/edit"*
                        บล็อก "ประวัติการส่ง" + ตัวอย่างของงานที่บันทึกแล้ว ถูกตัดออกทั้งก้อน
                        ⚠️ ประวัติมีที่อยู่ของมันแล้วที่หน้า Broadcasts (แท็บ "ประวัติ")
                           ซึ่งมีทั้งประวัติรายรอบและ LINE API log พร้อมตัวกรองวันที่
                           การเอามาแปะในฟอร์มสร้างงานใหม่ที่ยังไม่เคยส่ง คือ label ลอย ๆ
                        ⚠️ ปุ่ม "ดูตัวอย่าง/refresh การ์ด" กับ "เปิดการ์ด flex" **ไม่ถูกแตะ** —
                           อยู่ด้านบนและใช้ได้ทั้ง create/edit เหมือนเดิม
                        🔴 STALE AS OF 07/09 — the second half of that line no longer
                           holds. "เปิดการ์ด flex" was REMOVED and replaced by
                           `<FlexManageButton>` ([FEAT-20260907-FLEXMANAGELINK]).
                           The preview button is the only one of the pair still
                           there, and it really is untouched.
                        revert: กู้บล็อกจาก git history (marker PREVIEWDEDUPE) */}
                    {/* [UI-20260825-CARDINMSG] ย้ายมาจากคอลัมน์ขวา 25/08
                        เจ้าของ: *"เนื้อหาการ์ด ย้ายไปอยู่ block ข้อความซ้าย เป็นหมวดเดียวกัน"*
                        เหตุผลที่เข้ากัน: มันเลือกว่า "การ์ดที่ส่ง จะเหมือนกันทุกคนหรือ
                        เติมข้อมูลรายคน" ⇒ เป็นคุณสมบัติของ **เนื้อหาที่ส่ง** ไม่ใช่ของ
                        วิธีส่ง ⇒ อยู่กับ "เนื้อหาข้อความ" ตรงกว่าอยู่กับกลุ่ม/OA
                        ⚠️ ย้าย JSX ล้วน — ไม่ได้ย้าย state · บล็อกนี้อ่านแค่
                           `formData.send_kind` / `formData.card_type` / `isReadOnly`
                           ซึ่งอยู่ใน scope เดียวกันทั้งหมด ⇒ พฤติกรรมเดิมทุกอย่าง
                        ⚠️ เงื่อนไข `send_kind === 'multicast'` ติดมาด้วย ไม่ได้ถอด —
                           broadcast ใส่ค่าเฉพาะคนไม่ได้ ยังต้องซ่อนเหมือนเดิม
                        revert: ย้ายบล็อกกลับไปไว้ก่อน `formData.target.mode === 'group'` */}
                  {/* [FEAT-20260823-BCASTCARDTYPE] Offered only for multicast:
                      `/message/broadcast` carries no recipient list, so a card
                      whose body differs per person has nowhere to put the
                      difference. The backend refuses that pair outright, and a
                      picker that could build it would let an admin save a
                      campaign that can never send.
                      broadcast ใส่ค่าเฉพาะคนไม่ได้ ⇒ ไม่เสนอให้เลือก. */}
                  {/* [UI-20260903-CARDTYPETWOPLACES] the JSX that used to sit here
                      inline now lives in `form/BroadcastCardTypePicker.tsx`, because
                      the owner asked for the same picker in a SECOND place (step 5).
                      This call site is the ORIGINAL one and keeps its behaviour
                      exactly: same `multicast` gate, same field, same cost warning.
                      ⚠️ one value, two screens — both instances write
                         `formData.card_type`; this is not a second setting. */}
                  {formData.send_kind === 'multicast' && (
                    <BroadcastCardTypePicker
                      value={formData.card_type ?? null}
                      onChange={next => setFormData(prev => ({ ...prev, card_type: next }))}
                      disabled={isReadOnly}
                      className={inputClass(false)}
                      testId="card-type-picker-message"
                    />
                  )}

                  </div>
                </FormSection>
              </BroadcastStepPane>
            </div>

            <div className={showAllSteps ? 'flex flex-col gap-6' : 'contents'}>
              {/* [FEAT-20260825-BCASTFOLD] พับได้เหมือนการ์ดใบอื่น — เจ้าของสั่ง "ทุก card พับได้" */}
              <BroadcastStepPane stepId="section-group" activeIndex={stepIndex} showAll={showAllSteps}>
                <FormSection
                  title={t('broadcast.form_assign_group_label')}
                  testId="section-group"
                  alwaysOpen
                  revealOn={showAllSteps || stepIndex === 2}
                  errorCount={errorsIn('section-group')}
                  rightAction={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open('#/hook-quota', '_blank');
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-primary-500/40 bg-primary-50/80 text-primary-700 hover:bg-primary-100 hover:border-primary-500/60 dark:bg-primary-950/40 dark:text-primary-300 dark:border-primary-500/30 dark:hover:bg-primary-900/40 transition-all shadow-xs"
                      title={t('broadcast.check_quota_button', 'ตรวจสอบโควต้า')}
                    >
                      <ExternalLink size={13} className="shrink-0" />
                      <span>{t('broadcast.check_quota_button', 'ตรวจสอบโควต้า')}</span>
                    </button>
                  }
                >
                  {/* [FEAT-20260825-MULTIGROUP] เลือกได้หลายกลุ่มแล้ว
                      เจ้าของ 25/08: *"กลุ่มเว็บต้อง multi check เลือกได้หลายกลุ่ม
                      fe be รองรับทำงานจริง"*

                      ⚠️ คอมเมนต์เดิมตรงนี้เขียนว่า "ทำเป็น multi ไม่ได้ ห้ามแตะสัญญา
                         ฝั่ง BE" — **เลิกใช้แล้ว** 25/08 เจ้าของตัดสินให้ทำ และ BE
                         รองรับจริงด้วย `assign_group_ids` (ดู `broadcast.schema.ts`)
                         บันทึกไว้แทนที่จะลบ เพราะคนอ่านทีหลังจะได้รู้ว่ามันเปลี่ยนแล้ว
                         ไม่ใช่ว่ามีคนแอบฝ่าฝืน

                      🔴 `assign_group_ids` คือตัวหลัก · `assign_group` (ค่าเดียว) ยัง
                         ถูกส่งคู่ไปเป็นกลุ่มแรก เพราะตัวกรองการมองเห็นฝั่ง BE ยังอ่านมัน
                         สำหรับแถวเก่า — ไม่ใช่เพราะเรายังใช้มัน */}
                  {/* [FEAT-2708-GRIDPICK] dropdown → ตาราง checkbox กางตลอด —
                      contract ค่าเดิมทุกตัว (setAssignGroupIds + cascade ไม่ถูกแตะ)
                      revert: คืนเป็น MultiCheckSelect ชุด props เดิม */}
                  <div data-testid="assign-group-picker">
                    <MultiCheckGrid
                      testId="assign-group"
                      values={formData.assign_group_ids}
                      options={groupOptions.map(o => ({ value: o.value, label: o.label }))}
                      onChange={setAssignGroupIds}
                      loading={groupsLoading}
                      loadingLabel={t('broadcast.form_assign_group_loading')}
                      emptyLabel={t('broadcast.form_assign_group_empty')}
                      disabled={isReadOnly || groupsLoading}
                    />
                  </div>
                  {!groupsLoading && groups.length === 0 && (
                    <p className="text-xs text-slate-700">{t('broadcast.form_assign_group_empty')}</p>
                  )}
                  <InputError error={errors.assign_group} />
                </FormSection>
              </BroadcastStepPane>

              {/* [FEAT-20260825-BCASTFOLD] พับได้เหมือนการ์ดใบอื่น — เจ้าของสั่ง "ทุก card พับได้" */}
              <BroadcastStepPane stepId="section-oa" activeIndex={stepIndex} showAll={showAllSteps}>
                <FormSection title={t('broadcast.form_hooks_label')} testId="section-oa" alwaysOpen revealOn={showAllSteps || stepIndex === 3} errorCount={errorsIn('section-oa')}>
                  {/* [FIX-20260824-PICKERSAME] 🔴 `disabled={!formData.assign_group}` ถูก
                      ถอดออกที่นี่ — คอมเมนต์ `[FIX-20260824-HOOKSFROMGROUPS]` ด้านบน
                      บอกไว้ว่า "ตัวเลือก hook ถูกล็อกไว้จนกว่าจะเลือก assign_group"
                      คือตัวบั๊ก และแก้ด้วยการโหลดจากทุกกลุ่มที่ติ๊กแล้ว **แต่ตัวล็อก
                      ยังอยู่ในโค้ดจริง** ⇒ ติ๊กเฉพาะ "กลุ่มเป้าหมาย" (ซึ่งโหลด OA มา
                      ครบแล้ว) ปุ่มนี้ก็ยังกดไม่ได้ = เจ้าของยังหา hook ไม่เจอเหมือนเดิม
                      ⚠️ `assign_group` ยังบังคับตอนเซฟอยู่ (`validate()` :~236) — ถอด
                         แค่ "ลำดับการกด" ไม่ได้ถอดกฎ */}
                  {/* [FEAT-2708-GRIDPICK] dropdown → ตาราง checkbox (ดูการ์ดกลุ่มเว็บ) */}
                  <MultiCheckGrid
                    testId="hook-picker"
                    values={formData.hook_ids}
                    onChange={setHookIds}
                    options={hookOptions}
                    loading={hooksLoading}
                    loadingLabel={t('broadcast.form_hooks_loading')}
                    emptyLabel={t('broadcast.form_hooks_empty')}
                    disabled={isReadOnly}
                  />
                  <InputError error={errors.hook_ids} />
                </FormSection>
              </BroadcastStepPane>

              {/* [FIX-20260824-TARGETHIDDEN] 🔴 กล่องนี้เคยมี `hidden` อยู่ในคลาส
                  ═══════════════════════════════════════════════════════════
                  `hidden` ถูกใส่ไว้ตั้งแต่ยุคที่ BE ยังไม่รองรับ target/audience
                  (มีมาก่อน commit ccd0d5e ที่ย้ายไฟล์มา components/campaign)
                  แล้วงานเลน broadcast 23-24/08 **เพิ่ม `send_kind`, `card_type`
                  และตัวสร้างเงื่อนไขผู้รับ เข้ามาข้างในกล่องที่ display:none อยู่แล้ว**
                  ⇒ ของขึ้น production ครบทุกบรรทัด แต่ไม่มีใครเห็นสักช่อง
                  เจ้าของถามเอง 24/08: "ไหนอะ multicast" — มันอยู่ที่บรรทัด 821 นี่เอง

                  ⚠️ ทำไมเทสจับไม่ได้ — `getByTestId`/`getByText` **หา element ที่
                  display:none เจอ** ⇒ เทส DOM 1,240 ตัวเขียวหมดทั้งที่จอว่างเปล่า
                  ⇒ เทสที่คุมเรื่องนี้ต้องใช้ `toBeVisible()` เท่านั้น (ดู
                  `test/broadcastTargetVisible.dom.test.tsx` ที่เพิ่มมาคู่กัน)
                  เขียวไม่ได้แปลว่าคนใช้เห็น.

                  ตอนนี้ BE รองรับครบแล้วทั้งเส้น: DTO รับ `target`/`send_kind`/
                  `card_type` ทั้ง create และ update (`content/dto/broadcast.dto.ts`)
                  และ `normalizeBroadcast` อ่านกลับมาครบ ⇒ เปิดได้จริง ไม่ใช่ของหลอก

                  revert: ใส่ `hidden` กลับหน้า `rounded-xl` — แล้วทุกช่องในกล่องนี้
                  จะหายจากจอทันทีโดยที่เทสยังเขียวเหมือนเดิม */}
              <BroadcastStepPane stepId="section-target" activeIndex={stepIndex} showAll={showAllSteps}>
                <FormSection title={t('broadcast.section_target')} testId="section-target" revealOn={showAllSteps || stepIndex === 4} errorCount={errorsIn('section-target')}>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      /* ตั้งชื่อไว้เพื่อให้เทสจับปุ่มนี้ได้ตรงตัว เหมือน `target_rules` ที่มีอยู่แล้ว */
                      name="target_all"
                      /* [FIX-20260824-TARGETACTIVE] ทิ้ง `rules` ด้วย ไม่ใช่แค่เปลี่ยน mode —
                         ถ้าปล่อยค้าง payload จะพาเงื่อนไขที่แอดมินเลิกใช้แล้วไปยิงจริง
                         เลือก "ส่งทั้งหมด" = ตั้งใจทิ้งเงื่อนไข */
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        target: { mode: 'all', group_ids: [] },
                      }))}
                      disabled={isReadOnly}
                      /* [FIX-20260824-TARGETACTIVE] `rules === undefined` ต่อท้ายด้วย
                         ไม่งั้นปุ่มนี้กับ "ตามเงื่อนไข" สว่างพร้อมกัน เพราะปุ่มนั้น
                         ก็ตั้ง mode:'all' เหมือนกัน */
                      className={`w-full flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-all ${choiceClass(
                        formData.target.mode === 'all' && formData.target.rules === undefined
                      )}`}
                    >
                      <span className="text-sm font-semibold">{t('broadcast.target_all')}</span>
                      <Users2 size={16} />
                    </button>
                    {/* [FEAT-2708-TARGETGROUPCUT] ปุ่ม "เลือกตามกลุ่มเครือข่าย" ถูกตัด
                        (เจ้าของ 27/08: ซ้ำกับ step 3+4 และไม่ใช่ตัวกรองผู้รับ — มันเหมา
                        OA เข้าตอน create เท่านั้น ดู todo10 §4) · job เก่า mode='group'
                        เปิด edit ได้ ค่า round-trip ครบ แค่ไม่มีปุ่มตั้งค่าใหม่
                        revert: คืนปุ่ม + บล็อก picker + spread ใน groupPickKey (tag เดียวกัน) */}
                    <button
                      type="button"
                      name="target_rules"
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        target: {
                          ...prev.target,
                          mode: 'all',
                          match: prev.target.match ?? 'and',
                          rules: prev.target.rules ?? []
                        }
                      }))}
                      disabled={isReadOnly}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-all ${choiceClass(formData.target.rules !== undefined)}`}
                    >
                      <span className="text-sm font-semibold">{t('broadcast.target_rules')}</span>
                      <Users2 size={16} />
                    </button>
                  </div>

                  {/* [FEAT-20260823-BCASTAUDUI] Shown once the admin opts in, and
                      kept visible while any rule exists — hiding a rule that is
                      still stored would send a narrower audience than the screen
                      shows. เงื่อนไขที่ยังอยู่ ต้องมองเห็นเสมอ. */}
                  {/* [FEAT-20260823-BCASTSENDKIND] */}
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {t('broadcast.send_kind_label')}
                    </label>
                    <select
                      name="send_kind"
                      value={formData.send_kind ?? ''}
                      disabled={isReadOnly}
                      onChange={e => setFormData(prev => ({
                        ...prev,
                        /* '' is a real choice: it CLEARS the field and puts the
                           job back on the sender it always used. */
                        send_kind: e.target.value === '' ? null : e.target.value,
                        /* 🔴 CLEARED WITH THE SWITCH. A personal card left behind
                           on a broadcast job is the one pair the backend refuses,
                           and the picker for it is no longer on screen — so the
                           admin could neither see nor fix it.
                           ค่าที่มองไม่เห็นแล้ว ต้องไม่ค้างอยู่. */
                        card_type: e.target.value === 'multicast' ? prev.card_type : null
                      }))}
                      className={inputClass(false)}
                    >
                      {/* [FIX-20260824-NOLEGACYPICK] ตัดตัวเลือก "ตัวส่งเดิม (ไม่เปลี่ยน)"
                          (value="") ออกจากการ "เลือกตั้งใหม่" — เจ้าของ 24/08 ยืนยันไม่ใช้ท่อ
                          เดิมแล้ว ใบเก่าที่เคยบันทึกไว้เป็น legacy ยังทำงานฝั่ง BE เหมือนเดิม
                          ทุกประการ (ดู runbook §7b) การตัดนี้กระทบแค่ "จะเลือกอะไรตอนสร้าง/แก้
                          ใหม่จากฟอร์มนี้" เท่านั้น ไม่แตะพฤติกรรมของ job ที่มีอยู่แล้ว
                          revert: ใส่ <option value=""> กลับ */}
                      <option value="broadcast">{t('broadcast.send_kind_broadcast')}</option>
                      <option value="multicast">{t('broadcast.send_kind_multicast')}</option>
                    </select>
                    <p className="mt-1 text-xs text-slate-700" data-testid="send-kind-hint">{t('broadcast.send_kind_hint')}</p>
                    {/* [UI-20260903-BCASTTAGFAMILIES] ข้อความข้างบนบอกแค่ว่า
                        อะไร "ใช้ไม่ได้" · บล็อกนี้บอกว่าอะไร "ใช้ได้" ซึ่งเป็นครึ่ง
                        ที่หายไปและทำให้แอดมินคิดว่า Broadcast ใส่ตัวแปรไม่ได้เลย
                        ⚠️ อ่านค่าอย่างเดียว ไม่บังคับอะไร — ตัวบังคับอยู่ฝั่ง BE
                        revert: ลบสองบรรทัดนี้ + ไฟล์ BroadcastTagFamilies.tsx */}
                    <BroadcastTagFamilies
                      sendKind={formData.send_kind ?? null}
                      cardType={formData.card_type ?? null}
                    />
                    {/* [UI-20260903-CARDTYPETWOPLACES] SECOND home for the card-content
                        picker — owner 03/09: the step-2 one is right, and step 5 gets
                        one too, shown when Multicast is chosen.
                        WHY IT BELONGS HERE TOO: the send-method select directly above
                        is what CLEARS this value (`card_type: … : null`), and the
                        block above it lists which variables the pair allows. Deciding
                        "same card for everyone / per recipient" without scrolling back
                        to step 2 is the point.
                        ⚠️ SAME FIELD as step 2, not a copy — change it here and step 2
                           shows the change. The identical control is guaranteed by
                           both sites rendering one component.
                        ⚠️ same `multicast` gate as step 2 · a broadcast job is never
                           offered a per-person card (the backend refuses that pair).
                        revert: delete this call site only — step 2 is untouched. */}
                    {formData.send_kind === 'multicast' && (
                      <BroadcastCardTypePicker
                        value={formData.card_type ?? null}
                        onChange={next => setFormData(prev => ({ ...prev, card_type: next }))}
                        disabled={isReadOnly}
                        className={inputClass(false)}
                        testId="card-type-picker-target"
                      />
                    )}
                  </div>

                  {/* [FIX-20260825-CONDMULTICASTONLY] เจ้าของ 25/08: *"ซ่อนเงื่อนไขถ้า broadcast
                      แต่ multicast แสดงเงื่อนไข"* · เหตุผลตรงกับที่โค้ดเขียนไว้เองอยู่แล้ว:
                      `/message/broadcast` ไม่มีรายชื่อผู้รับ LINE กระจายเองทุก follower
                      ⇒ เงื่อนไขไม่มีผลใด ๆ · เดิมแค่ "เตือน" ว่าไม่มีผล ตอนนี้ซ่อนไปเลย
                      ⚠️ ค่าที่ตั้งไว้ไม่ถูกล้าง แค่ไม่แสดง — สลับกลับเป็น multicast แล้วยังอยู่ครบ
                      revert: ลบเงื่อนไข send_kind รอบบล็อกนี้ */}
                  {formData.send_kind === 'multicast' && (
                    <>
                  {/* [FEAT-20260825-BCASTDIRECTTICKET] ยิงถึงใครแล้วเปิดเคสรอให้เลย
                      ⚠️ อยู่ในบล็อก `send_kind === 'multicast'` ที่มีอยู่แล้ว — ไม่ได้
                         สร้างเงื่อนไขซ่อนใหม่ · broadcast ไม่มีรายชื่อผู้รับ จึงไม่มีใคร
                         ให้เปิดเคสให้ · **นี่คือความสะดวก ไม่ใช่ตัวกัน** ตัวบังคับจริง
                         อยู่ฝั่งรัน ซึ่งอ่านเฉพาะคนที่ยิงถึงจริง
                      ⚠️ ค่าไม่ถูกล้างตอนสลับไป broadcast แค่ไม่แสดง — กติกาเดียวกับ
                         เงื่อนไขผู้รับด้านล่าง
                      revert: ลบบล็อกนี้ + สองบรรทัด is_direct_ticket ด้านบน + คีย์ i18n */}
                  <div className="mt-3 rounded-xl border border-dark-700 p-3">
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        name="is_direct_ticket"
                        data-testid="broadcast-direct-ticket"
                        checked={formData.is_direct_ticket === true}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, is_direct_ticket: e.target.checked }))
                        }
                        disabled={isReadOnly}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary-500 cursor-pointer"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-700">
                          {t('broadcast.form_direct_ticket_label')}
                        </span>
                        <span className="mt-1 block text-xs text-slate-700">
                          {t('broadcast.form_direct_ticket_hint')}
                        </span>
                      </span>
                    </label>
                  </div>

                  {/* [FEAT-20260825-BCASTSKIPASSIST] ข้ามคนที่แอดมินกำลังคุยอยู่
                      ⚠️ อยู่ในบล็อก multicast เดียวกับช่องบน ด้วยเหตุผลเดียวกัน:
                         broadcast ไม่ได้เลือกผู้รับจากตัวกรองนี้เลย ⇒ ติ๊กไปก็ไม่มีผล
                      ⚠️ assist เป็นของ "ห้อง" ไม่ใช่ของ "คน" — คนคนเดียวอาจถูกดูแล
                         อยู่ที่ OA หนึ่งและไม่ถูกดูแลที่อีก OA หนึ่ง · งานที่เลือกหลาย OA
                         จะข้ามคนนั้นทั้งใบ (ตัวเลือกที่ปลอดภัยกว่า อธิบายไว้ที่
                         `audience/skip-assist/skip-assist.policy.ts` ฝั่ง BE)
                      revert: ลบบล็อกนี้ + สองบรรทัด skip_assist ด้านบน + คีย์ i18n */}
                  <div className="mt-3 rounded-xl border border-dark-700 p-3">
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        name="skip_assist"
                        data-testid="broadcast-skip-assist"
                        checked={formData.skip_assist === true}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, skip_assist: e.target.checked }))
                        }
                        disabled={isReadOnly}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary-500 cursor-pointer"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-700">
                          {t('broadcast.form_skip_assist_label')}
                        </span>
                        <span className="mt-1 block text-xs text-slate-700">
                          {t('broadcast.form_skip_assist_hint')}
                        </span>
                      </span>
                    </label>
                  </div>

                  {formData.target.rules !== undefined && (
                    <div className="mt-3 rounded-xl border border-dark-700 p-3">
                      {/* [FEAT-20260824-BCASTMINT] ปุ่มกรอกเงื่อนไขให้อัตโนมัติ
                          เจ้าของ 24/08: *"mint ใส่ข้อมูล where member follow up
                          [deposit at] จำไม่ได้ ลืมชื่อคีย์"* — ปุ่มนี้ไม่ได้เพิ่มความสามารถ
                          ใหม่ มันแค่กรอกคีย์ที่กรอกเองได้อยู่แล้วแทนเรา
                          🔴 มันแทนที่ `rules` ทั้งชุด (เจ้าของเลือก "ล้างของเดิมแล้วใส่ใหม่")
                          โมดัลจึงเตือนก่อนเมื่อมีเงื่อนไขค้างอยู่ ดู `mint/mintRules.ts`
                          ฟอร์มไม่รู้จัก mint ตัวไหนเลย รับแค่ `{match, rules}` รูปเดิม
                          ⇒ เพิ่ม mint ใหม่ = แก้ `mint/mint.registry.ts` ไฟล์เดียว */}
                      <MintButton
                        disabled={isReadOnly}
                        existingRuleCount={formData.target.rules?.length ?? 0}
                        onMint={next => setFormData(prev => ({
                          ...prev,
                          target: { ...prev.target, match: next.match, rules: next.rules }
                        }))}
                      />
                      <div className="mt-3">
                      <AudienceRuleBuilder
                        disabled={isReadOnly}
                        match={formData.target.match ?? 'and'}
                        rules={formData.target.rules ?? []}
                        onChange={next => setFormData(prev => ({
                          ...prev,
                          target: { ...prev.target, match: next.match, rules: next.rules }
                        }))}
                      />
                      </div>
                      {/* [FEAT-2708-GUARDWINDOW] ช่องหน้าต่างความสดของ stamp —
                          ตัว field ตัดสินเองว่าโผล่ไหม (rule ต้องอยู่บนคีย์ที่
                          endpoint ติดธง) · ที่นี่กันแค่ multicast เพราะเงื่อนไข
                          ทั้งระบบมีผลจริงเฉพาะท่อนั้น */}
                      {formData.send_kind === 'multicast' && (
                        <GuardWindowField
                          rules={formData.target.rules}
                          value={formData.guard_window_hours}
                          disabled={isReadOnly}
                          error={errors.guard_window_hours}
                          onChange={(v) => {
                            clearError('guard_window_hours');
                            setFormData((prev) => ({
                              ...prev,
                              guard_window_hours: v,
                            }));
                          }}
                        />
                      )}
                      {/* [FIX-20260907-DEADCONDWARN] 🔴 A WARNING USED TO SIT HERE — and
                          it could NEVER render. The outer gate demands
                          `send_kind === 'multicast'` while the warning itself demanded
                          `!== 'multicast'`. It was written 23/08, when the conditions
                          block was still shown for broadcast; `[FIX-20260825-CONDMULTICASTONLY]`
                          then hid the whole block and stranded it inside. No test asserted
                          it rendered, so nobody noticed for two weeks.
                          ⇒ moved OUTSIDE that gate — see `AudienceKeptNotice`.
                          👉 Lesson: hiding a parent block means auditing what inside it
                             still needed to be seen. */}
                    </div>
                  )}
                    </>
                  )}

                  {/* [FIX-20260907-DEADCONDWARN] 🔴 OUTSIDE the multicast gate that
                      closes on the line above — that placement IS the fix. Inside it,
                      a notice about "not multicast" can never render, which is exactly
                      how the 23/08 warning died. The component decides for itself
                      whether to appear (`shouldShowAudienceKept`).
                      ⚠️ `onClear` drops the rules only when the admin presses it. Never
                         clear them automatically: the values are their work, and
                         `[FIX-20260825-CONDMULTICASTONLY]` keeps them on purpose so a
                         switch back to multicast restores everything. */}
                  <AudienceKeptNotice
                    rules={formData.target.rules}
                    sendKind={formData.send_kind ?? null}
                    disabled={isReadOnly}
                    onClear={() =>
                      setFormData(prev => ({
                        ...prev,
                        target: { ...prev.target, rules: [] },
                      }))
                    }
                  />

                </FormSection>
              </BroadcastStepPane>

              {/* [UI-20260825-SENDOPEN] กางไว้เสมอ (พับเองได้)
                  เป็นการ์ดที่ต้องเลือกก่อนกดยืนยันทุกครั้ง — ส่งทันที / ตั้งเวลา /
                  บันทึกร่าง ⇒ พับไว้แล้วผู้ใช้ต้องกดเปิดทุกครั้งที่สร้างงาน
                  ⚠️ modal ตัวนี้ใช้ร่วมกันทั้ง create / edit / copy (Broadcasts.tsx
                     เรียกที่เดียว ต่างกันแค่ `resolvedMode`) ⇒ แก้จุดนี้ครอบครบทั้งสาม
                  ⚠️ `defaultOpen` เป็นแค่ "ค่าเริ่มต้น" — FormSection เก็บสถานะพับ
                     ใน state ของตัวเอง ⇒ ผู้ใช้ยังพับเองได้ตามที่สั่ง
                  revert: ลบ `defaultOpen` ออกจากบรรทัดล่าง */}
              <BroadcastStepPane stepId="section-send" activeIndex={stepIndex} showAll={showAllSteps}>
                <FormSection title={t('broadcast.section_send_status')} testId="section-send" revealOn={showAllSteps || stepIndex === 5} defaultOpen errorCount={errorsIn('section-send')}>
                  {/* [FIX-20260825-PICKSENDMODE] แดงตรงไหน — ตรงนี้
                      ⚠️ กรอบแดงคลุมทั้งสามตัวเลือก ไม่ใช่ตัวใดตัวหนึ่ง เพราะสิ่งที่
                         ขาดคือ "ยังไม่ได้เลือก" ไม่ใช่ "ตัวเลือกนี้ผิด" */}
                  {errors.status && (
                    <div
                      data-testid="send-status-error"
                      className="mb-2 rounded-lg border border-red-500 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300"
                    >
                      {errors.status}
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => handleScheduleMode('send')}
                      disabled={isReadOnly}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-all ${choiceClass(formData.status === 'sent')}`}
                    >
                      <span className="text-sm font-semibold">{t('broadcast.schedule_send_now')}</span>
                      <Send size={16} />
                    </button>
                    {/* [FIX-20260824-TARGETHIDDEN] ปุ่ม "ตั้งเวลา" ถูกลบตั้งแต่ commit
                        แรกของ repo — และนี่คือ**ประตูเดียว**ที่ทำให้ `status` เป็น
                        `'scheduled'` ⇒ ไม่มีปุ่มนี้ = ตัวตั้งเวลาทั้งระบบที่เลน
                        broadcast สร้างไว้ (cron ทุกนาที · `next_run_at` · claim/lease
                        · concurrency 7 ชั้น) **ไม่มีทางถูกสั่งจากหน้าจอเลยแม้แต่ครั้งเดียว**
                        ⚠️ ท่อหลังปุ่มครบอยู่แล้ว: `handleScheduleMode('schedule')` (~:314)
                        · validation `scheduled_at` (~:216) · ส่งขึ้น payload (~:375)
                        revert: ลบปุ่มนี้ + ช่องวันเวลาข้างล่าง แล้วตัวตั้งเวลาจะเงียบอีกครั้ง */}
                    <button
                      type="button"
                      name="schedule_scheduled"
                      onClick={() => handleScheduleMode('schedule')}
                      disabled={isReadOnly}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-all ${choiceClass(formData.status === 'scheduled')}`}
                    >
                      <span className="text-sm font-semibold">{t('broadcast.schedule_scheduled')}</span>
                      <Clock size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleScheduleMode('draft')}
                      disabled={isReadOnly}
                      className={`w-full flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-all ${choiceClass(formData.status === 'draft')}`}
                    >
                      <span className="text-sm font-semibold">{t('broadcast.schedule_draft')}</span>
                      <Save size={16} />
                    </button>
                  </div>
                  {/* [FIX-20260824-TARGETHIDDEN] ช่องวันเวลา — คู่กับปุ่ม "ตั้งเวลา"
                      ข้างบน · โผล่เฉพาะตอนเลือกตั้งเวลา เพราะอีกสองโหมดไม่ใช้ค่านี้
                      (`handleScheduleMode` ล้าง `scheduled_at` ให้เองตอนสลับไป
                      ส่งทันที/ฉบับร่าง ⇒ ค่าค้างไม่หลุดขึ้น payload)
                      ⚠️ `datetime-local` คืนค่าเป็น "เวลาท้องถิ่นของเครื่อง" ไม่มี timezone
                      ต่อท้าย — ปล่อยตามเดิมที่ระบบนี้ใช้อยู่ ห้ามแปลงเองตรงนี้
                      ไม่งั้นจะเลื่อนสองรอบ */}
                  {/* [FEAT-20260825-ATTIME] เจ้าของ 25/08: *"ถ้าทำซ้ำไม่จำเป็นต้องระบุ
                      วันที่หลัก (มีไว้ทำไมงง) ถ้าตั้งแบบไม่ซ้ำค่อยระบุวันที่เวลา"*

                      🔴 โหมดซ้ำมีนาฬิกาของตัวเองแล้ว (`at_time_min` + วันในสัปดาห์)
                         ช่องนี้ไม่ถูกอ่านเลย ⇒ โชว์ไว้ = บังคับกรอกของที่ไม่มีผล
                         BE ก็ยกเว้นให้แล้วเช่นกัน (`broadcasts.service.ts` isRepeatRule) */}
                  {/* [FIX-20260825-REPEATSELFHIDE] 🔴 เดิมเงื่อนไขนี้มี `!isRepeatingSchedule`
                      เจ้าของแจ้ง 25/08: *"กดส่งซ้ำแล้ว กล่องตั้งเวลาไม่มี และปุ่มส่งซ้ำหาย"*
                      ต้นเหตุ: ตัวเลือก "ทำซ้ำ" อยู่ **ข้างใน** บล็อกนี้ ⇒ พอกดเลือก repeat
                      ค่านั้นกลายเป็น true เงื่อนไขเป็นเท็จทันที **บล็อกถอดตัวเองออกจากจอ**
                      พร้อมฟอร์มที่เพิ่งกด — ผู้ใช้เห็นทุกอย่างหายไปเฉย ๆ ทั้ง create และ edit
                      ⇒ ย้ายเงื่อนไขซ่อนลงไปครอบ **เฉพาะช่องวันเวลา** ข้างล่างแทน
                      revert: เอา `&& !isRepeatingSchedule` กลับมาที่บรรทัดนี้ */}
                  {formData.status === 'scheduled' && (
                    <div className="mt-3">
                      {/* ช่องวันเวลาซ่อนตอนทำซ้ำ — รอบแรกมาจากกฎแทน ไม่ได้มาจากช่องนี้ */}
                      {!isRepeatingSchedule && (
                        <>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        {t('broadcast.schedule_at_label')} <span className="text-red-500">*</span>
                      </label>
                      {/* [FIX-20260824-ONETIMEZONE] 🔴 ช่องนี้เคยส่งค่าดิบไม่มี offset
                          แล้วปล่อยให้ BE เติม `+07:00` เอง ส่วนช่องค่าเงื่อนไขปั๊ม offset
                          ของ **เบราว์เซอร์** ⇒ พิมพ์ `15:00` ในหน้าเดียวกันสองช่อง
                          ได้คนละ instant เมื่อเปิดจากคนละโซน (วัดจริง New York ห่าง 11 ชม.)
                          ตอนนี้ทั้งสองช่องผ่าน `campaignTime` ประตูเดียวกัน
                          ⚠️ กล่องแสดงเวลาไทยเสมอ (`fromCampaignIso`) ⇒ ตัวเลขที่เห็น
                             กับความหมายที่เก็บ เป็นโซนเดียวกันแน่นอน */}
                      <input
                        type="datetime-local"
                        onClick={openNativePicker}
                        name="scheduled_at"
                        value={fromCampaignIso(formData.scheduled_at)}
                        disabled={isReadOnly}
                        onChange={e => {
                          const value = toCampaignIso(e.target.value);
                          setFormData(prev => ({ ...prev, scheduled_at: value || null }));
                          if (errors.scheduled_at) {
                            setErrors(prev => {
                              const next = { ...prev };
                              delete next.scheduled_at;
                              return next;
                            });
                          }
                        }}
                        className={inputClass(!!errors.scheduled_at)}
                      />
                      <InputError error={errors.scheduled_at} />
                        </>
                      )}

                      {/* [FEAT-20260824-BCASTREPEAT] เจ้าของ 24/08: "repeat ด้วยต้อง
                          ตั้งค่าได้จริงใ้ชได้จริง รันทุกๆตอนไหน นาที ชั่วโมง วันไหนของวีค จ - อาทิตย์"
                          🔴 อยู่ใต้ช่องวันเวลาเพราะสองค่านี้ทำงานคู่กัน: `scheduled_at`
                          คือ**รอบแรก** (BE เอาไปตั้ง `next_run_at` ให้ตอนเซฟ) ส่วนกฎนี้
                          คือ**รอบถัดไป** ⇒ โผล่เฉพาะตอนเลือก "ตั้งเวลา" เท่านั้น
                          เพราะไม่มีรอบแรก ก็ไม่มีรอบสอง
                          revert: ลบบล็อกนี้ + เลิกส่ง `schedule` ขึ้น payload */}
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          {t('broadcast.repeat_mode_label')}
                        </label>
                        <RepeatRuleForm
                          value={formData.schedule ?? null}
                          onChange={(rule) => setFormData(prev => ({ ...prev, schedule: rule }))}
                          disabled={isReadOnly}
                        />
                        {/* [FIX-20260828-REPEATDAYS] ⚠️ ไม่มี <InputError> ตรงนี้ โดยตั้งใจ
                            `RepeatRuleForm` มีป้ายเตือนของตัวเองอยู่ติดปุ่มวันแล้ว และตั้งแต่
                            28/08 มันใช้ **ข้อความเดียวกัน** (`form_repeat_days_required`)
                            ⇒ ใส่ตรงนี้อีกจะกลายเป็นประโยคเดียวกันสามที่ในจอเดียว
                            ที่เหลือสองที่คือสิ่งที่ตั้งใจ: แถบสรุปด้านบน (คนเพิ่งกดเซฟมองอยู่
                            ตรงนั้น) + ป้ายติดปุ่มวัน (คนที่ถูกพามาถึงตรงนั้น) */}
                      </div>

                      {/* ⚠️ ค่าที่ scheduler เขียนกลับ — อ่านอย่างเดียว ไม่มี DTO ไหนรับ
                          ที่ต้องโชว์เพราะถ้าไม่เห็น "รอบถัดไป" จะแยกไม่ออกว่ากฎที่ตั้งไว้
                          ติดอาวุธจริงหรือเงียบอยู่ */}
                      {initialData?.next_run_at && (
                        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300 font-semibold" data-testid="repeat-next-run">
                          {t('broadcast.repeat_next_run')}: {String(initialData.next_run_at)}
                          {typeof initialData.run_count === 'number'
                            ? ` · ${t('broadcast.repeat_run_count')}: ${initialData.run_count}`
                            : ''}
                        </p>
                      )}
                    </div>
                  )}
                </FormSection>
              </BroadcastStepPane>

            </div>
          </div>

          {/* [UI-20260825-WIZARD] ย้อนกลับ / ต่อไป อยู่แถวเดียวกับปุ่มบันทึก
              ⚠️ ปุ่ม "ยืนยัน" ไม่ได้ถูกซ่อนตามขั้น — เจ้าของสั่งให้เซฟได้ตลอด และ
                 การ validate ยังทำงานตอน submit เหมือนเดิม ⇒ กดเซฟกลางทางแล้ว
                 ผิด จะถูกพากลับไป "ขั้นแรกที่ผิด" ไม่ใช่ปล่อยให้หาเอง (ดู handleSubmit)
              ⚠️ `BroadcastStepNav` คืน null เองตอนกาง "ทุกขั้นตอน" — ไม่มีขั้นให้เดิน */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-dark-700">
            <div className="flex items-center gap-2">
              <BroadcastStepNav
                activeIndex={stepIndex}
                showAll={showAllSteps}
                onBack={() => setStepIndex((i) => clampStep(i - 1))}
                onNext={() => tryGoTo(stepIndex + 1)}
              />
            </div>
            <div className="flex items-center gap-3">
            <button
              type="button"
              name="footer_cancel"
              onClick={requestClose}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors"
            >
              {t('common.cancel')}
            </button>
            {!isReadOnly && (
              /* [FIX-20260827-FOOTERFADE] Owner, 27/08, with a screenshot: the
                 FOOTER confirm looked fully active at step 1/6 while the HEADER
                 confirm was already faded — two buttons, same action, telling
                 the user two different stories. Same affordance as the header
                 ([UI-20260825-CONFIRMLASTSTEP], :844-846): fade + title while
                 the wizard has not reached its last step.
                 ⚠️ Deliberately NOT `disabled` — same rule as the header: a dead
                 button explains nothing; this one stays clickable and
                 handleSubmit (:646) answers WHY it refuses (the amber banner).
                 revert: drop the `title` line and the `notAtLastStep` class. */
              <button
                type="submit"
                disabled={loading}
                title={notAtLastStep ? t('broadcast.confirm_needs_last_step') : undefined}
                className={`px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2 ${
                  notAtLastStep ? 'opacity-40' : ''
                }`}
              >
                {loading && <Loader2 className="animate-spin" size={16} />}
                <Save size={18} />
                {t('common.confirm')}
              </button>
            )}
            </div>
          </div>
        </form>
        </div>
    </Modal>
  );
};
