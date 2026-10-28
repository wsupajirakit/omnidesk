import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Search, RefreshCw, Loader2, X, ChevronLeft, Users,
  Phone, User as UserIcon, MessageSquare,
  // [FEAT-20260802-CONTACTCOPY] toast ยืนยันคัดลอก (ปุ่ม Copy ย้ายไป ContactHeaderInfo)
  Check,
} from 'lucide-react';
import { chatService, ChatRoom, PopularTag } from '../../services/chat';
import { webhookService } from '../../services/hook';
import { HookData } from '../../types';
import { fetchVisibleGroups, filterVisibleHooks, VisibleGroup } from '../../services/admin';
import { SearchableSelect, SelOpt } from '../../components/member';
import { CustomerTags, CustomerNotes, FollowUpCard } from '../../components/member';
// [FEAT-20260801-CONTACTTABS] แผง "ข้อมูลส่วนตัว" — คอมโพเนนต์ตัวเดียวกับ panel ขวา
// ของหน้า ticket (ย้ายออกมาเป็นไฟล์กลางแล้ว ไม่ได้ก็อปมาอีกชุด)
// [FEAT-20260802-CONTACTOA] + LineLogoIcon — ใช้โลโก้ตัวเดียวกับหน้า ticket/แผงขวา
import { PersonalPanelNarrow } from '../../components/profile-panel';
import { LineLogoIcon } from '../../components/common';
import { useTicketWS } from '../../services/chat';
/* [FEAT-20260814-CONTACTCHAT] คอมโพเนนต์เดียวกับหน้า ticket — ไม่ได้ก็อปโค้ดมาอีกชุด
   ตัวมันเองไม่มีทางส่งข้อความ (ช่องพิมพ์อยู่คนละคอมโพเนนต์) ดูหมายเหตุที่จุดเรียกใช้ */
import { ChatRoomView } from '../../components/chat';
/* [FEAT-20260814-CONTACTPAGE] page's own pieces — see each file's header note */
import { ContactHeaderInfo, ContactPaginationBar } from '../../components/contact';
// [FIX-20260814-CUSTOMERNAME] one shared name resolver for every page
import { customerName } from '../../components/common';
import type { SyncedProfileData } from '../../services/chat';
import { copyText } from '../../utils/copyText';
import { useI18n, translateNow } from '../../i18n';

/**
 * ==== [FEAT-20260731-CONTACTS] START — เขียนหน้านี้ใหม่ทั้งหน้า
 * 🔒 งานสาย AUTO — to_dev_auto / to_prod_auto เท่านั้น
 *
 * หน้า Contacts: เลือกกลุ่ม → กรอง OA → ค้นหา → เลือกลูกค้า → ดู/แก้ tag + note
 *
 * ของเดิมในไฟล์นี้ใช้งานจริงไม่ได้ ถูกรื้อทิ้งทั้งหมด:
 *   - ช่องค้นหา (spotlight) **ไม่มีทางเปิดได้** — `isSpotlightOpen` ไม่เคยถูก set true
 *   - `searchValue` ไม่เคยถูกเอาไปกรองอะไรเลย เป็น state ตาย
 *   - แถว "Placeholder User" ปลอมที่ hardcode ไว้กลางลิสต์
 *   - `imageModalUrl` ไม่มีทางถูก set · `showProfileMobile` ถูก set แค่ false
 *   - `isFilterOpen` / `isTagsOpen` ประกาศแล้วไม่มีใครใช้
 *   - โหลดห้องทั้งหมดรวดเดียว ไม่มีแบ่งหน้า (11,000+ ห้องบน prod)
 *   - import 10 ตัวที่ไม่ได้ใช้
 *
 * ใช้ของกลางร่วมกับหน้า Ticket Chat ทั้งหมด ไม่ก็อปโค้ดมาชุดที่สอง:
 *   `CustomerTags` · `CustomerNotes` · `SearchableSelect`
 *   → แก้ที่ไฟล์กลางที่เดียว ติดทั้งสองหน้าเสมอ
 *
 * REALTIME: ฟัง WS event ที่ BE ยิงมา (customer:tags_updated / notes_updated)
 * แล้วรีเฟรชเฉพาะห้องที่กำลังเปิดอยู่ · ไม่ยิง refetch ทั้งลิสต์ทุกครั้ง
 *
 * revert: `git checkout <commit ก่อนหน้า> -- pages/Contact.tsx`
 * ==== [FEAT-20260731-CONTACTS] END
 */

// [FEAT-20260814-CONTACTPAGE] per-page is user-adjustable now (10/20/50/100,
// options live in ContactPaginationBar). 20 stays the default = old behaviour.
const DEFAULT_PAGE_SIZE = 20;
const AVATAR_FALLBACK = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';

const phoneOf = (r: ChatRoom): string => (r.user_data as any)?.phone_number || '';
// [FEAT-20260802-CONTACTCOPY] LINE user id — เก็บได้ 2 ที่ เอาตัวที่มีค่าจริง
const lineIdOf = (r: ChatRoom): string =>
  String((r.user_data as any)?.line_user_id || r.line_user_id || '');

/* ชื่อที่เอาไว้โชว์ — [FIX-20260814-CUSTOMERNAME] เดิมไล่ field เองในไฟล์นี้
   (`full_name || display_name || nickname || …`) ตอนนี้ใช้ helper กลางตัวเดียว
   กับหน้า ticket/แชท ⇒ ค่า "Unknown" ที่ BE เขียนไว้ถูกข้ามเหมือนกันทุกหน้า
   ⚠️ ลำดับต่างจากหน้า ticket โดยเจตนา: หน้านี้เป็นสมุดรายชื่อ ให้ชื่อจริงมาก่อน
      (`preferFullName`) · ห้องแชทให้ชื่อเรียกที่แอดมินตั้งมาก่อน — ผลลัพธ์ของ
      หน้านี้จึงเท่าเดิมทุกเคส */
const displayNameOf = (r: ChatRoom): string =>
  customerName({ ...(r.user_data as any), line_user_id: lineIdOf(r) }, translateNow('pageui.contact.unknown_name', '(ไม่ทราบชื่อ)'), {
    preferFullName: true,
  });

export const Contact: React.FC = () => {
  const { t } = useI18n();
  // ── ตัวกรอง ─────────────────────────────────────────────────────────
  const [groups, setGroups] = useState<VisibleGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string>('');
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [hookId, setHookId] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('');
  /* [FEAT-20260823-CONTACTFOLLOW] กรองตาม stamp ติดตามฝาก/ถอนที่ลูกค้าถืออยู่
     '' = ไม่กรอง · ค่าที่เหลือส่งไปให้ BE ตัดสิน (ดู FOLLOW_OPTS ใต้ tagOpts) */
  const [followFilter, setFollowFilter] = useState<string>('');
  /* [FEAT-20260907-PROVCONDS] follow-up world switch off THIS page's own
     envelope (`show_follow_ups` on listContacts). Default ON = today.
     §6.5: hiding the follow FILTER must also LET GO of its value — the same
     stuck-filter rule utils/tierSwitches.ts documents for the tier filter. */
  const [showFollowUps, setShowFollowUps] = useState(true);
  const [showRegisterAction, setShowRegisterAction] = useState(true);
  const [showWalletpayCard, setShowWalletpayCard] = useState(true);
  const [popularTags, setPopularTags] = useState<PopularTag[]>([]);

  // ── ค้นหา ───────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');   // ค่าที่ยิงจริง (หลัง debounce)

  // ── ลิสต์ ───────────────────────────────────────────────────────────
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [page, setPage] = useState(1);
  // [FEAT-20260814-CONTACTPAGE] rows per page — changing it recreates fetchPage
  // → the reset-to-page-1 effect refires, same path every filter already takes.
  const [perPage, setPerPage] = useState(DEFAULT_PAGE_SIZE);
  const [meta, setMeta] = useState({ total: 0, pages: 0, group_member_total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ChatRoom | null>(null);
  // [FEAT-20260801-CONTACTTABS] แท็บฝั่งขวา — ใช้ชื่อค่าชุดเดียวกับหน้า ticket
  // เริ่มที่ 'personal' เหมือนกัน เพื่อให้สองหน้าเปิดมาเห็นอย่างเดียวกัน
  /* [FEAT-20260814-CONTACTCHAT] 'chat' = a READ-ONLY transcript tab.
     Owner, 14/08: "หน้า contact ปรับให้แสดง chat ตรงกลางด้วย เหมือน ticket แสดงอย่างเดียว
     + search แต่ไม่มีส่งค่านะ" — view + search only, nothing may be sent. */
  const [rightTab, setRightTab] = useState<'personal' | 'operations' | 'chat'>('personal');
  const [showPanelMobile, setShowPanelMobile] = useState(false);
  // บังคับให้การ์ด tag/note โหลดใหม่เมื่อมีคนอื่นแก้ (เปลี่ยน key = remount)
  const [cardNonce, setCardNonce] = useState(0);

  // ==== [FEAT-20260802-CONTACTCOPY] คัดลอก LINE user id + toast ยืนยัน
  // ⚠️ clipboard ใช้ไม่ได้บน http (ไม่ใช่ secure context) → ต้องกัน throw
  //    ไม่งั้นแค่กดปุ่มคัดลอกแล้วทั้งหน้าค้าง (บทเรียนเดียวกับหน้า flex message)
  // revert: ลบ state นี้ + copyLineId + ปุ่ม + กล่อง toast (marker เดียวกัน)
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const copyLineId = useCallback((id: string) => {
    if (!id) return;
    /* [FIX-20260830-COPYHTTP2] the try/catch hid an API that simply is not there
       on http — nothing was copied and the toast said otherwise. */
    void copyText(id).then((ok) => {
      if (!ok) return;
      setCopyToast(id);
      setTimeout(() => setCopyToast(null), 2500);
    });
  }, []);

  // ── โหลดกลุ่ม + OA ครั้งเดียวตอนเปิดหน้า ────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [gs, hs] = await Promise.all([
          fetchVisibleGroups(),
          webhookService.getAllHooks().then(filterVisibleHooks).catch(() => [] as HookData[]),
        ]);
        if (!alive) return;
        setGroups(gs);
        setHooks(hs);
        // [FEAT-20260802-CONTACTALL] เปิดหน้ามา default = "ทั้งหมด" (activeGroupId = '')
        //   เดิมเลือกกลุ่มแรกให้อัตโนมัติ เพราะยังไม่มีตัวเลือก "ทั้งหมด" — ถ้าไม่เลือกให้
        //   ผู้ใช้จะเจอหน้าว่างแล้วไม่รู้ว่าต้องกดอะไร · ตอนนี้มี "ทั้งหมด" แล้ว
        //   ค่าว่างจึงไม่ใช่ "ยังไม่ได้เลือก" แต่แปลว่า "ทุกกลุ่มที่มีสิทธิ์" = เห็นข้อมูลทันที
        //   ⚠️ ไม่ต้อง setActiveGroupId เลย — state เริ่มต้นเป็น '' อยู่แล้ว
      } catch (e) {
        console.error('load groups/hooks failed', e);
      } finally {
        // ⚠️ ต้อง set ทั้งใน finally ไม่ใช่แค่ทาง success — ไม่งั้นถ้าโหลดพัง
        // หน้าจะค้างอยู่สถานะ "ยังไม่โหลด" ตลอดกาล แล้วไม่ยอมยิงหาลิสต์เลย
        // (บทเรียนเดียวกับ [FIX-20260731-GROUPRACE] ในหน้า ticket)
        if (alive) setGroupsLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  // แท็กยอดนิยม — ใช้เป็นตัวเลือกใน dropdown กรองแท็ก
  useEffect(() => {
    chatService.popularTags(30)
      .then((r) => setPopularTags(r.data || []))
      .catch(() => setPopularTags([]));
  }, []);

  // ── debounce ช่องค้นหา ──────────────────────────────────────────────
  // ยิงทุกตัวอักษร = ถล่ม BE ด้วย regex ที่สแกน index · 350ms พอให้พิมพ์จบคำ
  useEffect(() => {
    const id = setTimeout(() => setQuery(searchInput.trim()), 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // OA ที่เลือกได้ = เฉพาะที่อยู่ในกลุ่มที่เลือกอยู่
  // [FEAT-20260802-CONTACTALL] เลือก "ทั้งหมด" (activeGroupId = '') = ไม่กรองกลุ่ม
  //   ⚠️ ต้องเช็คก่อน filter ไม่งั้นจะไปเทียบกับ '' แล้วได้ลิสต์ว่าง (ไม่มี OA ให้เลือกเลย)
  //   `hooks` ผ่าน filterVisibleHooks มาแล้ว = เห็นเท่าที่มีสิทธิ์อยู่ดี
  const hooksInGroup = useMemo(
    () => (activeGroupId
      ? hooks.filter((h) => String(h.group ?? h.group_id ?? '') === String(activeGroupId))
      : hooks),
    [hooks, activeGroupId],
  );

  // เปลี่ยนกลุ่มแล้ว OA ที่ค้างอยู่อาจไม่ได้อยู่ในกลุ่มใหม่ → รีเซ็ตเป็นทั้งหมด
  // ไม่งั้นจะยิงคำขอที่ BE ตอบ 403 (เลือก OA นอกกลุ่ม) แล้วหน้าเป็นว่างแบบงงๆ
  useEffect(() => {
    if (hookId !== 'all' && !hooksInGroup.some((h) => h._id === hookId)) setHookId('all');
  }, [activeGroupId, hooksInGroup, hookId]);

  // ── ดึงลิสต์ ────────────────────────────────────────────────────────
  // [FEAT-20260814-CONTACTPAGE] REPLACE semantics only — the old `append: true`
  // "โหลดเพิ่ม" path is gone: the list holds exactly ONE page (owner: "ห้ามแสดง
  // ทั้งหมด"). Server-side search (`q`) untouched — still covers the whole base.
  const fetchPage = useCallback(async (targetPage: number) => {
    if (!groupsLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const res = await chatService.listContacts({
        groupId: activeGroupId || null,
        hookId,
        q: query,
        tag: tagFilter || null,
        follow: followFilter || null,
        page: targetPage,
        limit: perPage,
      });
      setRooms(res.data);
      /* [FEAT-20260907-PROVCONDS] absent = ON; when OFF, clear a stuck follow
         selection (§6.5) so the shortened list gets its rows back. */
      const envelope = res as {
        show_follow_ups?: unknown;
        show_register_action?: unknown;
        show_walletpay_card?: unknown;
      };
      const follows = envelope.show_follow_ups !== false;
      setShowFollowUps(follows);
      if (!follows && followFilter) setFollowFilter('');
      setShowRegisterAction(envelope.show_register_action !== false);
      setShowWalletpayCard(envelope.show_walletpay_card !== false);
      setMeta({
        total: res.meta.total,
        pages: res.meta.pages,
        group_member_total: res.meta.group_member_total,
      });
      setPage(targetPage);
    } catch (e: any) {
      console.error('load contacts failed', e);
      setError(e?.message || translateNow('pageui.contact.load_failed', 'โหลดรายชื่อไม่สำเร็จ'));
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, [groupsLoaded, activeGroupId, hookId, query, tagFilter, followFilter, perPage]);

  // เปลี่ยนตัวกรอง (หรือ per-page) ใดก็ตาม = เริ่มนับหน้าใหม่จาก 1 เสมอ
  useEffect(() => { fetchPage(1); }, [fetchPage]);

  // ── realtime ────────────────────────────────────────────────────────
  // BE ยิง customer:tags_updated / customer:notes_updated มาพร้อม room_id
  // ถ้าตรงกับห้องที่เปิดอยู่ → remount การ์ดให้โหลดข้อมูลใหม่
  // ไม่ refetch ทั้งลิสต์ เพราะ tag/note ไม่ได้เปลี่ยนลำดับหรือสมาชิกในลิสต์
  useTicketWS((evt) => {
    // ==== [FEAT-20260801-CONTACTTABS] ส่งต่อ event โปรไฟล์ให้แผง "ข้อมูลส่วนตัว"
    // แผงนั้น (PersonalPanelNarrow) ฟัง CustomEvent 'tc:customer-profile-updated'
    // อยู่แล้ว แต่คนแปลง WS → CustomEvent เดิมอยู่ในหน้า ticket ที่เดียว
    // ถ้าไม่ทำตรงนี้ แผงบนหน้านี้จะไม่อัปเดตสดตอนลูกค้าผูกบัญชี/แอดมินแก้การผูก
    // (ยังทำงานได้ปกติ แค่ต้องสลับห้องก่อนถึงจะเห็นค่าใหม่)
    //
    // ⚠️ วางบนสุดแล้ว return ทันที เหตุผลเดียวกับหน้า ticket — event นี้ไม่มี room_id
    //    ถ้าไหลลงไปข้างล่างจะถูกมองว่าไม่ตรงห้องแล้วทิ้งเปล่าๆ
    // revert: ลบบล็อกนี้
    if (evt.type === 'customer:profile_updated') {
      window.dispatchEvent(new CustomEvent('tc:customer-profile-updated', { detail: evt.data }));
      return;
    }
    if (evt.type !== 'customer:tags_updated' && evt.type !== 'customer:notes_updated') return;
    const roomId = String(evt.data?.room_id || '');
    if (selected?._id && roomId && roomId === String(selected._id)) {
      setCardNonce((n) => n + 1);
    }
  });

  // แท็บเดียวกันแก้แท็กเอง — TicketChat ยิง event นี้อยู่แล้ว ใช้ซ้ำได้เลย
  useEffect(() => {
    const onTags = () => setCardNonce((n) => n + 1);
    window.addEventListener('tc:tags-changed', onTags as EventListener);
    return () => window.removeEventListener('tc:tags-changed', onTags as EventListener);
  }, []);

  // [FEAT-20260801-CONTACTTABS] ชื่อ OA ของห้องนั้น — แผงข้อมูลส่วนตัวขอมาแสดง
  // ใช้ `hooks` ที่หน้านี้โหลดไว้อยู่แล้ว ไม่ยิง API เพิ่ม · หาไม่เจอ = ส่งค่าว่าง
  // (แผงรองรับ oaLabel ว่างอยู่แล้ว — เหมือนตอนหน้า ticket ยังหา hook ไม่เจอ)
  const oaLabelOf = useCallback(
    (room: ChatRoom) => hooks.find((h) => h._id === room.hook_id)?.line_oa_name || '',
    [hooks]);

  // [FEAT-20260802-CONTACTALL] ตัวเลือก "ทั้งหมด" (value = '') — ข้ามทุกกลุ่มที่มีสิทธิ์
  //   BE ไม่ได้รับ group_id → scope ตกไปที่ getAllowedHookIds ตามสิทธิ์คนเรียก
  //   ⚠️ ไม่ได้แปลว่าเห็นทุกกลุ่มในระบบ — เห็นเท่าที่ตัวเองมีสิทธิ์เท่านั้น (สิทธิ์ไม่หลุด)
  const groupOpts: SelOpt[] = useMemo(
    () => [{ value: '', label: t('pageui.contact.all_groups', 'ทั้งหมด') },
      ...groups.map((g) => ({ value: g._id, label: g.group_name }))], [groups, t]);
  const hookOpts: SelOpt[] = useMemo(
    () => [{ value: 'all', label: activeGroupId ? t('pageui.contact.all_oas_in_group', 'ทุก OA ในกลุ่มนี้') : t('pageui.contact.all_oas', 'ทุก OA') },
      ...hooksInGroup.map((h) => ({ value: h._id, label: h.line_oa_name || h.alias || h._id }))],
    [hooksInGroup, activeGroupId, t]);
  /* [FIX-20260814-TAGLISTHIDE] mirrored from the ticket page (TicketChat.tsx,
     same marker — owner: fix the contact tag filter "ให้ดูวิธีจากหน้า ticket
     เพราะแก้ไปแล้ว"): the dropdown offers ONLY "ทุกแท็ก" — individual tags
     (e.g. "123123"/"4123": real rows, not garbage) are no longer listed.
     ⚠️ Options-list change ONLY — nothing else moves:
       · `tagFilter` still filters exactly as before (BE `tag:` param in fetchPage)
       · `popularTags` keeps loading — dropping the call would be an unordered
         behaviour change (same rationale as the ticket page's note)
     revert: restore `...popularTags.map(...)` into the options below.
     [FEAT-20260801-TAGGROUP] เดิม: value = id ของป้าย (ชื่อซ้ำข้ามกลุ่มได้) */
  const tagOpts: SelOpt[] = useMemo(
    () => [{ value: '', label: t('pageui.contact.all_tags', 'ทุกแท็ก') }],
    [t]);

  /* [FEAT-20260823-CONTACTFOLLOW] "ติดตาม" ที่นี่คือ stamp บนตัวลูกค้า — เวลาที่ระบบ
     ส่งการ์ดเตือนฝาก/ถอนให้เขาครั้งล่าสุด (`config.follow_up.line.notice_*_at`)
     ไม่ใช่สวิตช์ของ OA · ค่าจะถูกส่งไปกรองที่ BE เพราะลิสต์นี้แบ่งหน้าที่ BE —
     กรองฝั่งนี้จะกรองแค่หน้าปัจจุบันและตัวนับจะโกหก */
  const followOpts = useMemo(
    () => [
      { value: '', label: t('pageui.contact.follow_all', 'ติดตาม: ทั้งหมด') },
      { value: 'deposit', label: t('pageui.contact.follow_deposit', 'มีติดตามฝาก') },
      { value: 'withdraw', label: t('pageui.contact.follow_withdraw', 'มีติดตามถอน') },
      { value: 'both', label: t('pageui.contact.follow_both', 'มีทั้งฝากและถอน') },
      { value: 'none', label: t('pageui.contact.follow_none', 'ยังไม่เคยถูกติดตาม') },
    ],
    [t],
  );

  const pickRoom = (r: ChatRoom) => { setSelected(r); setShowPanelMobile(true); };

  // [FEAT-20260814-PROFILESYNC] fresh LINE profile came back from the sync
  // button — merge into the open panel AND the list row (same object shape both
  // places), then bump cardNonce so the personal-info card remounts with it.
  const handleProfileSynced = useCallback((data: SyncedProfileData) => {
    const { id: _drop, ...fields } = data;
    const mergeRoom = (r: ChatRoom): ChatRoom =>
      ({ ...r, user_data: { ...(r.user_data as any), ...fields } } as ChatRoom);
    setSelected((prev) =>
      prev && lineIdOf(prev) === data.line_user_id ? mergeRoom(prev) : prev);
    setRooms((prev) =>
      prev.map((r) => (lineIdOf(r) === data.line_user_id ? mergeRoom(r) : r)));
    setCardNonce((n) => n + 1);
  }, []);

  return (
    // [FIX-20260731-CONTACTFULL] เดิมใช้ `h-full` ซึ่ง**ไม่มีผล** เพราะ <main>
    // ใน App.tsx ไม่ได้กำหนดความสูงไว้ (มีแค่ flex-1) → h-full ไม่มีอะไรให้อ้างอิง
    // หน้าจึงสูงเท่าเนื้อหา แล้วเหลือพื้นที่ว่างด้านล่างเป็นแถบดำยาว
    //
    // ⚠️ ลองใช้ h-[calc(100vh - var(--app-header-h))] แบบหน้า Ticket Chat แล้ว
    // **ยังไม่เต็มอยู่ดี** — เพราะ App.tsx มี `min-h-screen` ซ้อนกันสองชั้น
    // (บรรทัด 439 และ 442) ชั้นในจึงสูง 100vh เต็มอยู่แล้ว *บวก* กับ header
    // ที่อยู่เหนือมัน → กล่องรวมสูงเกินจอ การหักด้วยตัวแปรจึงไม่ตรงความจริง
    // (ไม่แก้ App.tsx เพราะกระทบทุกหน้าในระบบ ความเสี่ยงไม่คุ้ม)
    //
    // ใช้ `fixed` แทน — วัดจากขอบจอตรงๆ ไม่ต้องพึ่งความสูงของ parent เลย
    //   top-[var(--app-header-h,64px)]  เริ่มใต้ header พอดี (ตัวแปรนี้ App.tsx
    //                                   อัปเดตให้เอง หด/ขยายตาม header จริง)
    //   inset-x-0 bottom-0              กว้างเต็มจอ ยาวถึงขอบล่างเสมอ
    //   overflow-hidden                 ให้ลิสต์/พาเนลข้างในเลื่อนกันเอง
    // ไม่ต้องมี negative margin แล้ว เพราะ fixed หลุดจาก flow ของ <main> อยู่แล้ว
    // revert: กลับเป็น className="tc h-full flex flex-col bg-gray-50"
    <div className="tc fixed inset-x-0 bottom-0 top-[var(--app-header-h,64px)] flex flex-col overflow-hidden bg-gray-50">
      {/* [FEAT-20260802-CONTACTCOPY] toast ยืนยันคัดลอก — รูปแบบเดียวกับหน้า flex message */}
      {copyToast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[70] bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-6 duration-300 border border-emerald-400/30">
          <div className="bg-white/20 p-1.5 rounded-lg"><Check size={16} className="text-white" /></div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-black tracking-tight">{t('pageui.contact.copied_line_id', 'คัดลอก LINE user id แล้ว')}</span>
            <span className="text-[11px] font-mono opacity-90 truncate max-w-[280px]">{copyToast}</span>
          </div>
        </div>
      )}
      {/* ── แถบตัวกรอง ─────────────────────────────────────────────── */}
      <div className="shrink-0 bg-white border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-sm font-bold text-gray-700 mr-1">
            <Users size={16} className="text-blue-600" /> {t('pageui.contact.title', 'รายชื่อลูกค้า')}
          </div>

          <SearchableSelect
            value={activeGroupId}
            options={groupOpts}
            onChange={setActiveGroupId}
            placeholder={groupsLoaded && groups.length === 0 ? t('pageui.contact.no_groups', 'ไม่มีกลุ่มที่เข้าถึงได้') : t('pageui.contact.pick_group', 'เลือกกลุ่ม')}
            searchPlaceholder={t('pageui.contact.search_group', 'ค้นหากลุ่ม...')}
            className="w-[190px]"
          />

          <SearchableSelect
            value={hookId}
            options={hookOpts}
            onChange={setHookId}
            placeholder={t('pageui.contact.all_oas_in_group', 'ทุก OA ในกลุ่มนี้')}
            searchPlaceholder={t('pageui.contact.search_oa', 'ค้นหา OA...')}
            className="w-[190px]"
          />

          <SearchableSelect
            value={tagFilter}
            options={tagOpts}
            onChange={setTagFilter}
            placeholder={t('pageui.contact.all_tags', 'ทุกแท็ก')}
            searchPlaceholder={t('pageui.contact.search_tag', 'ค้นหาแท็ก...')}
            className="w-[170px]"
          />

          {/* [FEAT-20260823-CONTACTFOLLOW] ตัวกรองสถานะติดตาม ฝาก/ถอน
              [FEAT-20260907-PROVCONDS] hidden with the follow-up world switch;
              its value is CLEARED on hide in fetchPage (§6.5). */}
          {showFollowUps && (
          <SearchableSelect
            value={followFilter}
            options={followOpts}
            onChange={setFollowFilter}
            placeholder={t('pageui.contact.follow_all', 'ติดตาม: ทั้งหมด')}
            searchPlaceholder={t('pageui.contact.search', 'ค้นหา...')}
            className="w-[180px]"
          />
          )}

          {/* ค้นหา — เบอร์ / ชื่อ / สกุล / LINE display / line user id */}
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('pageui.contact.search_ph', 'ค้นหา เบอร์โทร / ชื่อ-สกุล / ชื่อ LINE / LINE user id')}
              className="w-full pl-9 pr-8 py-2 rounded-lg border border-gray-300 text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title={t('pageui.contact.clear_search', 'ล้างคำค้น')}
              ><X size={14} /></button>
            )}
          </div>

          <button
            onClick={() => fetchPage(1)}
            disabled={loading}
            className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:text-blue-600 hover:border-blue-500 transition-colors disabled:opacity-50"
            title={t('pageui.contact.reload', 'โหลดใหม่')}
          ><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>

        {/* สรุปจำนวน — แยก "ทั้งกลุ่ม" กับ "ที่ค้นเจอ" ให้ชัด */}
        <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500">
          <span className="flex items-center gap-1">
            <Users size={12} /> {t('pageui.contact.members_in_scope', 'สมาชิกในขอบเขตนี้')} <b className="text-gray-700">{meta.group_member_total.toLocaleString()}</b> {t('pageui.contact.people', 'คน')}
          </span>
          {(query || tagFilter || followFilter) && (
            <span className="flex items-center gap-1 text-blue-600 font-semibold">
              <Search size={12} /> {t('pageui.contact.found_n', 'ค้นเจอ {n} คน', { n: meta.total.toLocaleString() })}
            </span>
          )}
          <span className="text-gray-400">{t('pageui.contact.showing_n_of', 'แสดง {shown} / {total}', { shown: rooms.length.toLocaleString(), total: meta.total.toLocaleString() })}</span>
        </div>
      </div>

      {/* ── เนื้อหา ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[360px_1fr]">
        {/* รายชื่อ */}
        <div className={`h-full min-h-0 flex flex-col border-r border-border bg-white ${showPanelMobile ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {loading ? (
              <div className="p-6 text-center text-xs text-gray-400">
                <Loader2 size={18} className="animate-spin inline mr-1.5" /> {t('pageui.contact.loading', 'กำลังโหลด...')}
              </div>
            ) : error ? (
              <div className="p-6 text-center text-xs text-red-500">
                {error}
                <button onClick={() => fetchPage(1)} className="block mx-auto mt-2 underline">{t('pageui.contact.retry', 'ลองใหม่')}</button>
              </div>
            ) : rooms.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400">
                {query || tagFilter || followFilter ? t('pageui.contact.no_match', 'ไม่พบลูกค้าที่ตรงกับเงื่อนไข') : t('pageui.contact.no_customers', 'ยังไม่มีลูกค้าในขอบเขตนี้')}
              </div>
            ) : rooms.map((r) => {
              const isActive = selected?._id === r._id;
              const name = displayNameOf(r);
              const phone = phoneOf(r);
              return (
                <button
                  key={r._id}
                  onClick={() => pickRoom(r)}
                  /* [FEAT-20260814-CONTACTPAGE] owner: active row must read clearly
                     on light theme — blue-50 was too faint → blue-100 + thicker bar */
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 flex items-center gap-2.5 transition-colors ${isActive ? 'bg-blue-100 border-l-4 border-l-blue-600' : 'hover:bg-gray-50'}`}
                >
                  <img
                    src={(r.user_data as any)?.picture_url || AVATAR_FALLBACK}
                    onError={(e) => { (e.target as HTMLImageElement).src = AVATAR_FALLBACK; }}
                    className="w-9 h-9 rounded-full object-cover shrink-0 bg-gray-100"
                    alt=""
                  />
                  {/* [FEAT-20260802-CONTACTROW] ขยายฟอนต์ ~25% (12→15 / 10→12.5)
                      และย้าย OA ขึ้นมาแถวเดียวกับชื่อ — เดิม 3 บรรทัดทำให้แถวสูงเกินจำเป็น
                      ⚠️ ชื่อได้พื้นที่ก่อน (min-w-0 + truncate) · OA ยอมหดแต่ไม่เกิน 45%
                         ไม่งั้น OA ชื่อยาวจะเบียดชื่อลูกค้าจนอ่านไม่ออก */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <p className={`text-[15px] leading-tight truncate min-w-0 ${isActive ? 'font-bold text-blue-600' : 'font-semibold text-gray-800'}`}>{name}</p>
                      {/* [FEAT-20260802-CONTACTOA] มาจาก OA ไหน — จำเป็นมากตอนกรอง "ทั้งหมด"
                          ใช้ oaLabelOf ที่มีอยู่แล้ว (อ่านจาก hooks ในหน้า ไม่ยิง API เพิ่ม)
                          หา OA ไม่เจอ = ไม่แสดง ดีกว่าโชว์ช่องว่างลอย ๆ */}
                      {oaLabelOf(r) && (
                        <span className="shrink-0 max-w-[45%] flex items-center gap-1 text-[12.5px] leading-tight text-gray-400 truncate">
                          <LineLogoIcon className="w-3 h-3 shrink-0" />
                          <span className="truncate">{oaLabelOf(r)}</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12.5px] leading-tight text-gray-400 truncate flex items-center gap-1">
                      {/* [FEAT-20260802-CONTACTLABEL] เดิม "ยังไม่ผูกบัญชี" — คำใหม่ตรงกว่า
                          เพราะสถานะจริงคือลูกค้ายังไม่ได้ลงทะเบียนกับเว็บ */}
                      {phone ? (<><Phone size={11} /> {phone}</>) : (<><UserIcon size={11} /> {t('pageui.contact.not_registered', 'ยังไม่ลงทะเบียน')}</>)}
                    </p>
                  </div>
                </button>
              );
            })}

          </div>

          {/* [FEAT-20260814-CONTACTPAGE] pagination bar — OUTSIDE the scroll
              container so it never scrolls away · hidden while the list is empty */}
          {rooms.length > 0 && (
            <ContactPaginationBar
              page={page}
              pages={meta.pages}
              total={meta.total}
              perPage={perPage}
              loading={loading}
              onPageChange={(p) => fetchPage(p)}
              onPerPageChange={setPerPage}
            />
          )}
        </div>

        {/* แผงข้อมูลลูกค้า */}
        <div className={`h-full min-h-0 flex flex-col bg-gray-50 ${showPanelMobile ? 'flex' : 'hidden lg:flex'}`}>
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
              <MessageSquare size={40} className="opacity-30" />
              <p className="text-xs">{t('pageui.contact.pick_customer', 'เลือกลูกค้าเพื่อดูข้อมูล')}</p>
            </div>
          ) : (
            <>
              {/* หัวแผง — [FEAT-20260814-CONTACTPAGE] collapsible one-line "info" card
                  (full spec in ContactHeaderInfo's header). Collapsed = name+labels+copy;
                  expanded adds avatar + sync-LINE. `key` resets the fold per customer. */}
              <div className="shrink-0 bg-white border-b border-border px-4 py-3 flex items-center gap-2">
                <button
                  onClick={() => setShowPanelMobile(false)}
                  className="lg:hidden p-1.5 -ml-1 rounded text-gray-400 hover:text-gray-700"
                  title={t('pageui.contact.back_to_list', 'กลับไปรายชื่อ')}
                ><ChevronLeft size={18} /></button>
                <ContactHeaderInfo
                  key={`hdr-${selected._id}`}
                  room={selected}
                  onCopy={copyLineId}
                  onSynced={handleProfileSynced}
                />
              </div>

              {/* ==== [FEAT-20260801-CONTACTTABS] START — แท็บเหมือน panel ขวาของหน้า ticket
                   ผู้ใช้สั่ง "ลอกมา ห้ามแก้ไขต้นฉบับ" → ใช้ **คอมโพเนนต์ตัวเดียวกัน**
                   ที่ย้ายออกมาเป็นไฟล์กลาง ไม่ได้ก็อปโค้ดมาไว้อีกชุด

                   ข้อมูลส่วนตัว = PersonalPanelNarrow ตัวเดียวกับหน้า ticket เป๊ะ
                   ดำเนินการ    = ป้ายกำกับ + โน้ต (ของเดิมที่หน้านี้มีอยู่แล้ว ย้ายเข้าแท็บ)

                   ⚠️ ทำไม "ดำเนินการ" มีแค่ 2 การ์ด: ของหน้า ticket ยังมีโอนงาน/ปิดเคส/
                      หมวดหมู่ ซึ่งเป็นเรื่องของ "เคส" ล้วนๆ · หน้านี้ไม่มี ticket
                      (ลูกค้าอาจไม่เคยเปิดเคสเลย) จึงไม่มีอะไรให้ทำ — ยืนยันกับผู้ใช้แล้ว

                   ⚠️ classname ของแท็บยกมาจาก TicketChat ทั้งชุดเพื่อให้หน้าตาตรงกัน
                   revert: ลบบล็อกนี้ เหลือ CustomerTags + CustomerNotes เรียงกันเหมือนเดิม */}
              <div className="flex border-b border-slate-200 bg-slate-50 shrink-0">
                {/* [FEAT-20260814-CONTACTCHAT] read-only chat tab — owner 14/08:
                    "สลับแชทมาไว้ซ้ายสุด" → leftmost POSITION only; the default
                    tab stays 'personal' (same first view as the ticket page).
                    ⚠️ ห้ามมีช่องพิมพ์/ปุ่มส่งเด็ดขาด (เจ้าของสั่ง "ไม่มีส่งค่านะ")
                       ดูเหตุผลที่บล็อก <ChatRoomView> ด้านล่างว่าทำไมมันส่งไม่ได้จริง */}
                <button
                  onClick={() => setRightTab('chat')}
                  className={`flex-1 py-3 text-sm font-bold transition-colors border-b-2 ${rightTab === 'chat' ? 'text-primary border-primary bg-white' : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100'}`}
                >
                  {t('pageui.contact.tab_chat', 'แชท')}
                </button>
                <button
                  onClick={() => setRightTab('personal')}
                  className={`flex-1 py-3 text-sm font-bold transition-colors border-b-2 ${rightTab === 'personal' ? 'text-primary border-primary bg-white' : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100'}`}
                >
                  {t('ticketui.panel.tab_personal', 'ข้อมูลส่วนตัว')}
                </button>
                <button
                  onClick={() => setRightTab('operations')}
                  className={`flex-1 py-3 text-sm font-bold transition-colors border-b-2 ${rightTab === 'operations' ? 'text-primary border-primary bg-white' : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100'}`}
                >
                  {t('ticketui.panel.tab_operations', 'ดำเนินการ')}
                </button>
              </div>

              {rightTab === 'chat' ? (
                /* ==== [FEAT-20260814-CONTACTCHAT] แชทแบบอ่านอย่างเดียว ====
                   เจ้าของสั่ง 14/08: "แสดงอย่างเดียว + search แต่ไม่มีส่งค่านะ"

                   ⚠️ ทำไมยืนยันได้ว่า "ส่งไม่ได้จริง" ไม่ใช่แค่ซ่อนปุ่ม:
                      `ChatRoomView` **ไม่มีโค้ดส่งข้อความอยู่ในตัวเลย** — ช่องพิมพ์กับ
                      ปุ่มส่งของหน้า ticket เป็นคนละคอมโพเนนต์ (`ChatInputBox`) ที่วางไว้
                      ข้าง ๆ กัน และ `chatService.sendReply()` ถูกเรียกที่
                      `TicketChat.tsx:3621` ที่เดียวในทั้ง repo
                   ⇒ การ render ตัวนี้เฉย ๆ จึงส่งอะไรออกไปไม่ได้โดยธรรมชาติ
                      ไม่ต้องเพิ่ม flag readOnly และไม่ต้องแก้ ChatRoomView เลยสักบรรทัด

                   ⚠️ `showDetailBox={false}` — สำคัญ ไม่ใช่แค่เรื่องหน้าตา:
                      กล่องรายละเอียดในตัวนั้นมี **ตัวแก้ไขหมายเหตุที่เขียน DB ได้**
                      (`ChatRoomView.tsx:1470-1497`) ซึ่งเป็นทางเขียนทางเดียวที่เหลืออยู่
                      ปิดมัน = แท็บนี้อ่านอย่างเดียวจริง · และหน้านี้มีการ์ดโน้ตของตัวเอง
                      อยู่แล้วในแท็บ "ดำเนินการ" (หน้า ticket ก็ส่ง false เหมือนกัน)

                   ค้นหาในห้อง: มีมาให้ในตัวอยู่แล้ว ([FEAT-20260801-CHATSEARCH])
                   ไม่ส่ง onCloseCase / canCloseCase / ticketMeta → ไม่มีปุ่มปิดเคส
                   (ถูกแล้ว หน้านี้ไม่มี ticket — ลูกค้าอาจไม่เคยเปิดเคสเลย)

                   revert: ลบแท็บ "แชท" + บล็อกนี้ แล้วคืน type ของ rightTab เป็น 2 ค่า */
                <div className="flex-1 min-h-0 flex flex-col">
                  <ChatRoomView
                    key={`chat-${selected._id}`}
                    room={selected}
                    hookId={selected.hook_id || undefined}
                    oaName={oaLabelOf(selected)}
                    /* ปิดกล่องรายละเอียด = ปิดทางเขียนทางเดียวที่เหลือ (ดูหมายเหตุด้านบน) */
                    showDetailBox={false}
                    /* ป้ายเทียร์บนหัวห้อง — อ่านจาก member ที่หน้านี้มีอยู่แล้ว ไม่ยิง API เพิ่ม
                       (เส้นเดียวกับที่หน้า ticket ใช้ ดู [FIX-20260810-TIERSOURCE]) */
                    memberId={(selected.user_data as any)?._id || undefined}
                    memberData={selected.user_data}
                  />
                </div>
              ) : rightTab === 'personal' ? (
                /* ⚠️ ห้องแชทของหน้านี้พก user_data (สมาชิก) กับ hook_id มาครบอยู่แล้ว
                      — ยืนยันจาก response จริงของ /api/chat/contacts
                      ส่วน 3 ฟิลด์ที่เป็นเรื่องของเคส (job_status/chat_status/admin)
                      ไม่ส่งไป → การ์ด "ผู้ดูแลปัจจุบัน" ขึ้น "ยังไม่มีผู้ดูแล" ตามที่มันรองรับอยู่แล้ว
                      (ไม่ได้ตัดการ์ดทิ้ง) */
                <PersonalPanelNarrow
                  key={`personal-${selected._id}-${cardNonce}`}
                  source={{
                    line_user_data: selected.user_data,
                    line_oa_hook_id: selected.hook_id || null,
                  }}
                  room={selected}
                  oaLabel={oaLabelOf(selected)}
                  // [FEAT-20260907-PROVCONDS] same switches as TicketChat,
                  // from THIS page's own listContacts envelope.
                  showRegisterAction={showRegisterAction}
                  showWalletpayCard={showWalletpayCard}
                />
              ) : (
                /* การ์ด — ใช้ตัวเดียวกับหน้า Ticket Chat เป๊ะ
                   key มี cardNonce เพื่อให้ remount เมื่อมีคนอื่นแก้ (realtime) */
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-3">
                  {/* [FEAT-20260824-FOLLOWUP] พี่น้องใบที่ 3 — ลำดับตรงกับหน้า Ticket Chat
                      [FEAT-20260907-PROVCONDS] gated by the same follow-up world switch. */}
                  {showFollowUps && (
                    <FollowUpCard key={`follow-${selected._id}-${cardNonce}`} room={selected} />
                  )}
                  <CustomerTags key={`tags-${selected._id}-${cardNonce}`} room={selected} />
                  <CustomerNotes key={`notes-${selected._id}-${cardNonce}`} room={selected} />
                </div>
              )}
              {/* ==== [FEAT-20260801-CONTACTTABS] END */}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// [FEAT-20260731-CONTACTS] App.tsx โหลดหน้านี้แบบ lazy โดยไม่ map .default
// (`import("./pages/Contact")` เฉยๆ) จึงต้องมี default export ไม่งั้น build พัง
export default Contact;
