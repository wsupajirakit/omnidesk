import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Save, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
// [FEAT-20260810-MODALSHELL] MOVED OUT of this file: the overlay div, the panel div
// and the whole header block (title + X button) — they now come from the shared
// `form` variant. NOT moved: the nested AlertModal/ConfirmModal, which were siblings
// of the panel and are passed through `afterPanel` so their DOM position is identical.
import { Modal } from '../common/Modal';
import { GroupEntry, HookData, RoleEntry, UserEntry, UserFormData } from '../../types';
import { useI18n } from '../../i18n';
import { groupService } from '../../services/admin';
import { roleService } from '../../services/admin';
import { webhookService } from '../../services/hook';
import { userService } from '../../services/admin';
import { AlertModal } from '../modals';
import { ConfirmModal } from '../modals';
import { getStoredAuth } from '../../services/authStorage';

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: UserFormData) => Promise<void>;
  initialData?: UserEntry;
  mode?: 'create' | 'update';
  canEditRole?: boolean;
  canEditPermissions?: boolean;
}

// ==== [FIX-20260729-HIDDENPERM] START — permissions this form cannot edit
// 🔒 AUTO track — to_dev_auto branch only
//
// These have no checkbox, so this form can neither grant nor revoke them. The
// name says "uneditable" rather than "hidden" because hiding was never the
// problem — the problem was writing values nobody could see or take back.
//
// What went wrong: the role seed copied EVERY permission the role carried,
// including these. With no checkbox to untick, they were saved anyway.
// Confirmed on the staging dump — the `ticket` account was created with "chat
// only" ticked and stored 5 permissions: ticket.manage plus role.manage,
// menu.manage, broadcast.manage and auto_reply.manage.
//
// Used by BOTH the checkbox list and the role seed. Keep it that way: the two
// disagreeing is exactly how this happened.
// revert: inline the Set back into permissionOptions and drop this helper.
const UNEDITABLE_PERMISSIONS = new Set([
  'system.manage',
  'menu.manage',
  'auto_reply.manage',
  'reply.manage',
  'Auto Replies',
  /* ⭐ [REL-20260827-BROADCASTMENU] `broadcast.manage` / `Broadcast` ถูกถอดออกจาก
     ชุดนี้ 27/08/2026 — เจ้าของสั่งปลดเมนู broadcast ให้คนอื่นเห็น ⇒ สิทธิ์ต้องติ๊กให้
     คนอื่นได้ด้วย ไม่งั้นเมนูที่ปลดแล้วก็ยังไม่มีใครได้สิทธิ์ไปเปิด
     ⚠️ auto_reply ยังอยู่ในชุดนี้ตามเดิม — เจ้าของย้ำ "auto reply ไม่เกี่ยว"
     revert: เติม 'broadcast.manage' + 'Broadcast' กลับเข้าชุดนี้ */
  // [FEAT-20260729-HIDEROLEPERM] roles are edited on their own page
  'role.manage',
  'Roles',
]);

// [FEAT-20260811-DEVONLYPERM] auto_reply.manage / broadcast.manage are normally
// UNEDITABLE (WIP features hidden from everyone), BUT username `dev`/`dev2` may tick
// them — this is the grant side of the dev-only Auto-reply + Broadcast menu
// (see Sidebar.tsx [FEAT-20260811-DEVONLYMENU]): the menu shows to dev + the
// permission, so dev must be able to hand themselves that permission here.
// เกี่ยวกับงาน auto reply: เมนูนั้น dev-only ⇒ ต้องติ๊ก perm ได้เฉพาะ dev/dev2 เท่านั้น
// [REL-20260827-BROADCASTMENU] broadcast ถูกปลดออกจากกติกานี้แล้ว 27/08 — เป็นสิทธิ์ปกติ
// revert: ลบ DEV_TICKABLE + isDevUser param, คืน isUneditablePermission เดิม.
/* [REL-20260827-BROADCASTMENU] เหลือแต่ auto_reply — broadcast ปลดให้ทุกคนแล้ว
   จึงไม่ต้องมีสิทธิพิเศษของ dev สำหรับมันอีก */
const DEV_TICKABLE_PERMISSIONS = new Set(['auto_reply.manage']);

// ==== [FIX-20260823-ASSISTDEFAULT] START — default ของ assist_admin เหลือ 3 ช่อง
//
// เจ้าของสั่ง 23/08/2026: "default checkbox สิทธิ์ของ assist admin เวลาสร้าง
// ให้เหลือแค่ 3 อันนี้เท่านั้น" — จัดการงาน (แชท) · รายงานเชิงลึก · ประวัติจ่ายงาน
//
// ปัญหาเดิม: การ seed ติ๊กให้ทุกสิทธิ์ที่ role ถือ แล้วกรองเฉพาะตัวที่แก้ไม่ได้ออก
// role `assist_admin` ถือไว้ 9 ตัว ⇒ คนทั่วไปเห็นติ๊กมา 3 ตัวพอดี แต่ **dev เห็น 5**
// เพราะ DEV_TICKABLE_PERMISSIONS ข้างบนปลดล็อก auto_reply ให้ dev ติ๊กได้
// (ตอนที่เขียนโน้ตนี้ broadcast ก็อยู่ในชุดด้วย — ถูกปลดออก 27/08 [REL-20260827-BROADCASTMENU])
// ⇒ ค่าเริ่มต้นไม่เท่ากันแล้วแต่ว่าใครเป็นคนเปิดฟอร์ม ซึ่งไม่ใช่สิ่งที่เจ้าของต้องการ
//
// ⚠️ ขอบเขต — อ่านก่อนแก้:
//   · เป็น **ค่าตั้งต้นของ checkbox เท่านั้น** ไม่ได้จำกัดว่าติ๊กเพิ่มได้แค่ไหน
//     ใครติ๊กอะไรได้ยังคุมด้วย hasUserPermission (เพดานของคนกรอก) เหมือนเดิม
//     และ BE ยังตรวจ ensurePermissionSubset ซ้ำอีกชั้น
//   · **ไม่แตะ role ในฐานข้อมูล** — ไม่ seed ไม่ back-fill · `assist_admin` ยังถือ
//     9 สิทธิ์เท่าเดิม · ผู้ใช้ที่มีอยู่แล้วไม่ถูกแตะแม้แต่คนเดียว
//   · **ไม่แตะโหมดแก้ไข** — บล็อกนี้อยู่ในสาขา `name === 'role_id'` ของ handleChange
//     เท่านั้น เปิดฟอร์มแก้ผู้ใช้เดิมโดยไม่เปลี่ยน role จะไม่วิ่งผ่านเลย
//   · สิทธิ์ที่ฟอร์มมองไม่เห็น (keptInvisible) ยังถูกเก็บไว้เหมือนเดิม ไม่ได้หายไป
//
// เพิ่ม role อื่นทีหลัง: ใส่คีย์ในแมพนี้ · ไม่มีในแมพ = seed แบบเดิมทุกประการ
// revert: ลบ ROLE_DEFAULT_PERMISSIONS + สองบรรทัดที่เรียกใช้ใน handleChange
const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  assist_admin: ['ticket.manage', 'insight.manage', 'assign_history.manage'],
};

/* [FIX-20260824-ADMINCONFIGDEFAULT] สิทธิ์ที่ role นั้น "มี" แต่ต้องไม่ติ๊กมาให้
 * ============================================================================
 * เจ้าของสั่ง 24/08/2026 พร้อมภาพหน้าจอ create user: role `admin` เปิดมาแล้ว
 * ช่อง "ตั้งค่าระบบ" ติ๊กอยู่ ทั้งที่ไม่ควรติ๊กมาเอง
 *
 * ⚠️ สิทธิ์ตัวนั้นคือ `config.manage` ไม่ใช่ `system.manage` — สองตัวนี้สับสนกันง่าย
 * มาก `system.manage` อยู่ใน UNEDITABLE_PERMISSIONS อยู่แล้วและไม่เคยขึ้นเป็น
 * checkbox เลย · ช่องในภาพคือเมนู "System Config" ซึ่ง `required_permissions`
 * คือ `['config.manage']` (ตรวจกับ collection `menus` ของจริง และกับ
 * `acl-seed.data.ts:135`) ป้ายภาษาไทยของมันคือ "ตั้งค่าระบบ"
 *
 * ทำไมมันติ๊กมา: `admin` ไม่มีคีย์ใน ROLE_DEFAULT_PERMISSIONS ⇒ ตกไปใช้รายการ
 * สิทธิ์ของ role เอง ซึ่งมี `config.manage` อยู่ (`acl-seed.data.ts:267`)
 *
 * ทำไมใช้แมพ "ยกเว้น" แทนที่จะใส่ `admin` ลง ROLE_DEFAULT_PERMISSIONS: การไล่พิมพ์
 * สิทธิ์ทั้ง 19 ตัวลงไปคือการก๊อปรายการที่ BE เป็นเจ้าของมาไว้อีกที่ วันที่ role
 * เปลี่ยนสองที่จะไม่ตรงกันโดยไม่มีใครรู้ · แมพนี้พูดเฉพาะสิ่งที่เปลี่ยน
 *
 * ⚠️ ขอบเขต: เปลี่ยนแค่ "ติ๊กมาให้หรือไม่" — **ไม่ได้ถอดความสามารถ** ช่องยังอยู่
 * และคนกรอกยังติ๊กเองได้ · ส่วนที่ว่า role ควรมีสิทธิ์นี้ไหมเป็นคนละคำถาม
 * และเป็นการแก้ที่ seed ฝั่ง BE ซึ่งยังไม่ได้ตัดสินที่นี่
 *
 * เพิ่ม role อื่นทีหลัง: ใส่คีย์ในแมพนี้ · ไม่มีในแมพ = seed แบบเดิมทุกประการ
 * revert: ลบ ROLE_DEFAULT_EXCLUDED + เงื่อนไข `!excluded.has(p)` ใน
 *         seedPermissionsForRole
 */
const ROLE_DEFAULT_EXCLUDED: Record<string, string[]> = {
  admin: ['config.manage'],
};

/**
 * [FIX-20260823-ASSISTDEFAULT] ค่าตั้งต้นของ checkbox เมื่อเลือก role หนึ่ง ๆ
 *
 * แยกเป็นฟังก์ชันบริสุทธิ์เพื่อให้เทสเรียกตรงได้ ไม่ต้อง render โมดัลทั้งก้อน —
 * และเพื่อให้เทสจับ **ตรรกะจริงที่ฟอร์มใช้** ไม่ใช่ตรรกะที่เทสเขียนเลียนแบบไว้เอง
 *
 * @param role  role ที่เพิ่งถูกเลือก (`undefined` = ไม่เจอ ⇒ ไม่ติ๊กอะไรเลย)
 * @param isDevOperator คนกรอกฟอร์มเป็น dev หรือไม่ — มีผลกับ DEV_TICKABLE_PERMISSIONS
 */
export function seedPermissionsForRole(
  role: { name?: string; permissions?: string[] } | undefined,
  isDevOperator = false,
): string[] {
  const rolePerms = role?.permissions ?? [];
  const roleDefault = ROLE_DEFAULT_PERMISSIONS[role?.name ?? ''];
  /* [FIX-20260824-ADMINCONFIGDEFAULT] applied AFTER the inclusion map, so a role
     that names its own defaults is unaffected unless it also names exclusions.
     Per-role by construction: a role with no entry keeps today's behaviour to
     the letter. */
  const excluded = new Set(ROLE_DEFAULT_EXCLUDED[role?.name ?? ''] ?? []);
  return (roleDefault ?? rolePerms).filter(
    p => !isUneditablePermission(p, isDevOperator) && !excluded.has(p),
  );
}
// ==== [FIX-20260823-ASSISTDEFAULT] END
// exported for unit test — pure, no state.
export const isUneditablePermission = (permission: string, isDevUser = false) => {
  if (isDevUser && DEV_TICKABLE_PERMISSIONS.has(permission)) return false;
  return UNEDITABLE_PERMISSIONS.has(permission);
};
// ==== [FIX-20260729-HIDDENPERM] END

// ==== [FIX-20260731-CONTACTPERM] START — สิทธิ์ที่ระบบรู้จัก (ไม่ได้มาจาก role)
// 🔒 งานสาย AUTO — to_dev_auto / to_prod_auto
//
// ปัญหาที่เจอจริง: ฟอร์มนี้ไม่มี checkbox "รายชื่อ (Contacts)" ให้ติ๊กเลย
//
// ต้นเหตุ: `permissionOptions` ด้านล่างสร้างรายการ checkbox จาก
// **union ของ permissions ที่ role ต่างๆ ถืออยู่** — ไม่ใช่จากลิสต์สิทธิ์ของระบบ
// `contact.manage` มีอยู่ที่เดียวคือ role `superadmin` ซึ่ง**ไม่อยู่ในรายการ
// role ที่ฟอร์มโหลดมา** (เป็น role ที่แจกให้กันไม่ได้)
// → ไม่มี role ไหนเหลือที่ถือสิทธิ์นี้ → checkbox ไม่ถูกสร้างขึ้นมา
// → **แจกสิทธิ์นี้ให้ใครไม่ได้เลยผ่านหน้าเว็บ แม้แต่ superadmin เอง**
//
// วิธีแก้: ประกาศสิทธิ์ที่ระบบรู้จักไว้ตรงนี้ แล้ว union เข้าไปด้วย
// สิทธิ์ใหม่ในอนาคตเพิ่มที่นี่ที่เดียว ไม่ต้องรอให้ role ไหนถือก่อนถึงจะโผล่
// (แก้ที่ seeder ฝั่ง BE อย่างเดียวไม่พอ — ต้องรัน seed ก่อน และสิทธิ์ตัวถัดไป
//  ก็จะเจอปัญหาเดิมซ้ำอีก · นี่คือการแก้ที่ต้นเหตุจริง)
//
// ⚠️ การอยู่ในลิสต์นี้ = "มีให้เห็นในฟอร์ม" เท่านั้น **ไม่ใช่การแจกสิทธิ์**
// ใครติ๊กได้ยังถูกคุมด้วย hasUserPermission (เพดานของคนกรอกฟอร์ม) เหมือนเดิม
// และ BE ยังตรวจ ensurePermissionSubset ซ้ำอีกชั้น
//
// revert: ลบ KNOWN_PERMISSIONS + บรรทัดที่ union มันเข้าไปใน permissionOptions
const KNOWN_PERMISSIONS = [
  // [FEAT-20260804-DASHPERM] สิทธิ์ดูการ์ดข้อมูลใน dashboard — ไม่ seed (แอดมินติ๊กเอง)
  //   ไม่ติ๊ก = เข้า dashboard ได้แต่เห็นแค่นาฬิกา · ติ๊ก = เห็นการ์ดสถิติ
  //   ต้องมีที่นี่ ไม่งั้น checkbox ไม่โผล่ · gate ทำฝั่ง FE (Dashboard.tsx) · BE ไม่ต้องแตะ
  //   revert: ลบ key นี้ + section 'dashboard' ใน SECTIONS (ทั้ง 2 ไฟล์) + label i18n
  'dashboard.stats.view',
  'group.manage', 'hook.manage', 'slip.manage', 'flex.manage',
  'dynamic_tags.manage', 'custom_tools.manage',
  'ticket.manage', 'insight.manage', 'assign_history.manage', 'contact.manage',
  'object.manage',
  'user.manage', 'webhook_log.manage', 'audit.manage', 'config.manage',
  // [FEAT-20260803-TRANSDICT] ต้องมีที่นี่ ไม่งั้น checkbox ไม่โผล่ (seed ให้แต่ superadmin)
  'translation_dict.manage',
  // [FEAT-20260805-HANDOFF] Data-handoff perms — must be listed here or the checkbox never renders
  //   revert: ลบ 2 key นี้ + section 'general' entries (ทั้ง 2 ไฟล์) + label i18n
  'handoff.manage', 'handoff.view_raw', 'handoff.history',
  // [FEAT-20260824-STRIKESESSION] สิทธิ์ "เคลียร์ session strike ของลูกค้า"
  //   BE: PATCH /api/strikes/sessions/:id (omnidesk-api strike.controller.ts) — ขาอ่านยังเป็น
  //   ticket.manage เหมือนเดิม แยกเฉพาะขาเคลียร์
  //   ⚠️ ต้องมีที่นี่ ไม่งั้น checkbox ไม่โผล่ และไม่มีใครติ๊กให้ role ไหนได้เลย
  //   ⚠️ BE seed ให้แค่ superadmin/admin ของฐานใหม่ · ฐานเดิมสองคนนี้ผ่านด้วย system.manage
  //      อยู่แล้ว · role อื่น (assist_admin/operator) ต้องมาติ๊กที่นี่เท่านั้น
  //   revert: ลบ key นี้ + entry ใน SECTIONS (ทั้ง 2 ไฟล์) + label i18n 4 ภาษา
  'strike.manage',
];
// ==== [FIX-20260731-CONTACTPERM] END

const DEFAULT_FORM: UserFormData = {
  username: '',
  password: '',
  display_name: '',
  role_id: '',
  groups: [],
  permissions: [],
  active: true
};

export const UserFormModal: React.FC<UserFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  mode,
  canEditRole = false,
  canEditPermissions = false
}) => {
  const { t } = useI18n();
  const [formData, setFormData] = useState<UserFormData>(DEFAULT_FORM);
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [isGroupsOpen, setIsGroupsOpen] = useState(false);
  const [roles, setRoles] = useState<RoleEntry[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validationAlert, setValidationAlert] = useState<{ isOpen: boolean; message: string } | null>(null);
  const [isUpdateConfirmOpen, setIsUpdateConfirmOpen] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const resolvedMode = mode ?? (initialData ? 'update' : 'create');
  const authRoleName = getStoredAuth()?.role?.name;
  const isSuperAdmin = authRoleName === 'superadmin';
  // [FEAT-20260811-DEVONLYPERM] the CURRENT operator (not the user being edited):
  // only dev/dev2 may tick auto_reply.manage — see the helper.
  // [REL-20260827-BROADCASTMENU] broadcast.manage left this rule on 27/08.
  const currentUsername = getStoredAuth()?.user?.username?.toLowerCase().trim();
  const isDevOperator = currentUsername === 'dev' || currentUsername === 'dev2';
  const isAdmin = authRoleName === 'admin';
  const initialGroupsRef = useRef<string[]>([]);
  const groupDropdownRef = useRef<HTMLDivElement | null>(null);
  // [FEAT-20260729-PERMLIST] operatorAllowedPermissions was removed — it narrowed
  // the checkbox list, and silently dropped ticked values on submit, whenever the
  // selected role was 'operator'. Permissions are chosen by whoever fills in the
  // form now, bounded only by what that person holds themselves.

  const [groupHooks, setGroupHooks] = useState<HookData[]>([]);
  const [hooksLoading, setHooksLoading] = useState(false);

  const creatorAllowedHooks = useMemo(() => {
    const auth = getStoredAuth();
    return auth?.allowed_hooks ?? auth?.user?.allowed_hooks ?? null;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setIsGroupsOpen(false);
    setValidationAlert(null);
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setRolesLoaded(false);
    if (initialData) {
      const initialGroups = (initialData.groups || []).map(group => group.id);
      initialGroupsRef.current = initialGroups;
      const initialAllowedHooks = Array.isArray(initialData.allowed_hooks) ? initialData.allowed_hooks : undefined;
      setFormData({
        username: initialData.username,
        password: '',
        display_name: initialData.display_name || '',
        email: initialData.email || '',
        phone: initialData.phone || '',
        role_id: initialData.role?.id || initialData.role_id || '',
        groups: initialGroups,
        permissions: initialData.permissions || [],
        allowed_hooks: initialAllowedHooks,
        active: initialData.active ?? true
      });
      if (initialData.id && initialData.allowed_hooks === undefined) {
        userService.getUser(initialData.id).then(res => {
          if (res.data && Array.isArray(res.data.allowed_hooks)) {
            setFormData(prev => ({ ...prev, allowed_hooks: res.data.allowed_hooks as string[] }));
          }
        }).catch(() => {});
      }
    } else {
      initialGroupsRef.current = [];
      setFormData(DEFAULT_FORM);
    }
  }, [isOpen, initialData]);

  useEffect(() => {
    if (!isOpen || formData.groups.length === 0) {
      setGroupHooks([]);
      return;
    }
    let isCancelled = false;
    setHooksLoading(true);
    Promise.all(formData.groups.map(groupId => webhookService.getHooksByGroup(groupId)))
      .then(results => {
        if (isCancelled) return;
        const allHooks: HookData[] = [];
        const seen = new Set<string>();
        for (const list of results) {
          for (const hook of list) {
            if (hook && hook._id && !seen.has(hook._id)) {
              seen.add(hook._id);
              allHooks.push(hook);
            }
          }
        }
        setGroupHooks(allHooks);
      })
      .catch(err => {
        console.error('Failed to fetch group hooks:', err);
      })
      .finally(() => {
        if (!isCancelled) setHooksLoading(false);
      });

    return () => { isCancelled = true; };
  }, [isOpen, formData.groups]);

  const availableHooks = useMemo(() => {
    if (!creatorAllowedHooks) return groupHooks;
    const creatorSet = new Set(creatorAllowedHooks);
    return groupHooks.filter(h => creatorSet.has(h._id));
  }, [groupHooks, creatorAllowedHooks]);

  useEffect(() => {
    if (!isGroupsOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!groupDropdownRef.current || !target) return;
      if (!groupDropdownRef.current.contains(target)) {
        setIsGroupsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isGroupsOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    setGroupsLoading(true);
    groupService
      .listGroups({ status: true, limit: 200 })
      .then(res => {
        if (!isActive) return;
        setGroups(res.data ?? []);
      })
      .catch(err => {
        if (!isActive) return;
        console.error('Failed to load groups', err);
        setGroups([]);
      })
      .finally(() => {
        if (!isActive) return;
        setGroupsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [isOpen]);

  const normalizeRoles = (items: RoleEntry[]) => {
    return items
      .map((item: any) => {
        const id = item?.id ?? item?._id ?? '';
        const name = item?.name ?? item?.role_name ?? '';
        if (!id || !name) return null;
        return { id, name, permissions: item?.permissions ?? [] } as RoleEntry;
      })
      .filter((item): item is RoleEntry => Boolean(item));
  };

  const fetchRoles = useCallback(() => {
    if (rolesLoading || rolesLoaded) return;
    setRolesLoading(true);
    roleService
      .listRoles()
      .then(res => {
    const normalized = normalizeRoles(res.data ?? []);
    const filtered = isSuperAdmin ? normalized : normalized.filter(role => role.name !== 'superadmin');
    setRoles(filtered);
    setRolesLoaded(true);
      })
      .catch(err => {
        console.error('Failed to load roles', err);
        setRoles([]);
      })
      .finally(() => {
        setRolesLoading(false);
      });
  }, [rolesLoading, rolesLoaded]);

  useEffect(() => {
    if (!isOpen) return;
    if (!canEditRole && !canEditPermissions) return;
    fetchRoles();
  }, [isOpen, canEditRole, canEditPermissions, fetchRoles]);

  const inputClass = (hasError: boolean, extra: string = '') =>
    `w-full bg-primary-500/10 border rounded-lg px-4 py-2.5 text-slate-900 placeholder-slate-400 focus:ring-2 focus:border-transparent outline-none disabled:opacity-60 disabled:cursor-not-allowed transition-all ${
      hasError ? 'border-red-500 focus:ring-red-500/50' : 'border-primary-500/30 focus:ring-primary-500'
    } ${extra}`;

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    if (!formData.display_name.trim()) {
      nextErrors.display_name = t('user.form_display_name_required');
    }
    if (canEditRole && !formData.role_id?.trim()) {
      nextErrors.role_id = t('user.form_role_required');
    }
    if (resolvedMode === 'create') {
      if (!formData.username.trim()) nextErrors.username = t('user.form_username_required');
      if (!formData.password?.trim()) nextErrors.password = t('user.form_password_required');
      if (!confirmPassword.trim()) nextErrors.confirm_password = t('user.form_confirm_password_required');
      if (formData.password && confirmPassword && formData.password !== confirmPassword) {
        nextErrors.confirm_password = t('user.form_password_mismatch');
      }
    } else if (formData.password?.trim() || confirmPassword.trim()) {
      if (formData.password !== confirmPassword) {
        nextErrors.confirm_password = t('user.form_password_mismatch');
      }
    }
    if (!formData.groups.length) {
      nextErrors.groups = t('user.form_groups_required');
    }
    if (canEditPermissions && formData.permissions.length === 0) {
      nextErrors.permissions = t('user.form_permissions_required');
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'role_id') {
      const selectedRole = roles.find(role => role.id === value);
      // [FEAT-20260729-PERMLIST] the role's own permissions still seed the
      // checkboxes as a convenient starting point, but they are no longer
      // trimmed to an operator allow-list — whatever is ticked afterwards is
      // what gets saved.
      // ==== [FIX-20260729-HIDDENPERM] START — 🔒 AUTO track
      // Seeding from the role used to copy EVERY permission it carries,
      // including the ones this form hides. Those have no checkbox, so they
      // could not be unticked — pick a role, untick everything visible, save,
      // and the account still ends up holding them.
      //
      // Confirmed on the staging dump: the `ticket` account was created with
      // "chat only" ticked and was saved with 5 permissions — ticket.manage plus
      // role.manage, menu.manage, broadcast.manage and auto_reply.manage, which
      // are exactly the four this form never displays.
      //
      // Those extras then blocked its own editor: `admin` does not hold
      // menu/broadcast/auto_reply, so ensurePermissionSubset rejected every save
      // with "permissions exceed your own permissions".
      //
      // Now the seed only offers what is actually shown. Whatever the account
      // ALREADY holds and cannot be seen is preserved untouched, because these
      // permissions still guard 23 real routes — dropping them silently would
      // take away access someone is using.
      // revert: permissions: selectedRole?.permissions ?? []
      // [FEAT-20260811-DEVONLYPERM] pass isDevOperator so a role's auto_reply
      // grants are SEEDED (not stripped) for dev/dev2 — matching what they can
      // now tick. keptInvisible mirrors it so the two never disagree.
      // [REL-20260827-BROADCASTMENU] broadcast is a normal permission now and
      // needs no special seeding for anyone.
      /* [FIX-20260823-ASSISTDEFAULT] ตรรกะ seed ย้ายไปที่ seedPermissionsForRole
         (ข้างบน) เพื่อให้เทสจับตรรกะจริงตัวเดียวกับที่ฟอร์มใช้ */
      const seeded = seedPermissionsForRole(selectedRole, isDevOperator);
      const keptInvisible = (prevPerms: string[]) =>
        prevPerms.filter(p => isUneditablePermission(p, isDevOperator));
      setFormData(prev => ({
        ...prev,
        role_id: value,
        permissions: [...new Set([...keptInvisible(prev.permissions), ...seeded])]
      }));
      const nextRolePermissions = seeded;
      // ==== [FIX-20260729-HIDDENPERM] END
      if (errors.permissions && nextRolePermissions.length > 0) {
        setErrors(prev => {
          const next = { ...prev };
          delete next.permissions;
          return next;
        });
      }
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: name === 'active' ? value === 'true' : value
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
    setFormData(prev => {
      const exists = prev.groups.includes(groupId);
      const nextGroups = exists ? prev.groups.filter(id => id !== groupId) : [...prev.groups, groupId];
      if (nextGroups.length === 0) {
        setErrors(prevErrors => ({
          ...prevErrors,
          groups: t('user.form_groups_required')
        }));
        setValidationAlert({ isOpen: true, message: t('user.form_groups_required') });
        return prev;
      }
      if (errors.groups) {
        setErrors(prevErrors => {
          const next = { ...prevErrors };
          delete next.groups;
          return next;
        });
      }
      if (validationAlert?.isOpen) {
        setValidationAlert(null);
      }
      return { ...prev, groups: nextGroups };
    });
  };

  const selectAllGroups = () => {
    const allIds = groups.map(getGroupId).filter(Boolean);
    if (allIds.length === 0) return;
    setFormData(prev => ({ ...prev, groups: allIds }));
    if (errors.groups) {
      setErrors(prevErrors => {
        const next = { ...prevErrors };
        delete next.groups;
        return next;
      });
    }
    if (validationAlert?.isOpen) {
      setValidationAlert(null);
    }
  };

  const clearAllGroups = () => {
    if (groups.length === 0) return;
    const firstId = getGroupId(groups[0]);
    if (!firstId) return;
    setFormData(prev => ({ ...prev, groups: [firstId] }));
    if (errors.groups) {
      setErrors(prevErrors => {
        const next = { ...prevErrors };
        delete next.groups;
        return next;
      });
    }
    if (validationAlert?.isOpen) {
      setValidationAlert(null);
    }
  };

  const resetGroups = () => {
    const initialGroups = initialGroupsRef.current;
    if (!initialGroups.length && groups.length > 0) {
      const firstId = getGroupId(groups[0]);
      if (!firstId) return;
      setFormData(prev => ({ ...prev, groups: [firstId] }));
    } else {
      setFormData(prev => ({ ...prev, groups: [...initialGroups] }));
    }
    if (errors.groups) {
      setErrors(prevErrors => {
        const next = { ...prevErrors };
        delete next.groups;
        return next;
      });
    }
    if (validationAlert?.isOpen) {
      setValidationAlert(null);
    }
  };

  const togglePermission = (permissionId: string) => {
    setFormData(prev => {
      const exists = prev.permissions.includes(permissionId);
      const nextPermissions = exists
        ? prev.permissions.filter(p => p !== permissionId)
        : [...prev.permissions, permissionId];
      if (nextPermissions.length === 0) {
        setErrors(prevErrors => ({
          ...prevErrors,
          permissions: t('user.form_permissions_required')
        }));
        setValidationAlert({ isOpen: true, message: t('user.form_permissions_required') });
        return prev;
      }
      if (errors.permissions) {
        setErrors(prevErrors => {
          const next = { ...prevErrors };
          delete next.permissions;
          return next;
        });
      }
      if (validationAlert?.isOpen) {
        setValidationAlert(null);
      }
      return { ...prev, permissions: nextPermissions };
    });
  };

  const permissionOptions = useMemo(() => {
    const unique = new Set<string>();
    // [FIX-20260731-CONTACTPERM] เริ่มจากสิทธิ์ที่ระบบรู้จักก่อน — ไม่ใช่รอให้
    // role ไหนถือถึงจะโผล่ (contact.manage มีแต่ใน superadmin ที่ฟอร์มมองไม่เห็น)
    KNOWN_PERMISSIONS.forEach(permission => unique.add(permission));
    roles.forEach(role => {
      (role.permissions || []).forEach(permission => unique.add(permission));
    });
    formData.permissions.forEach(permission => unique.add(permission));

    // Hide Auto Replies + Broadcast permissions for everyone. System Config
    // (config.manage) is now shown as a real checkbox so an admin can grant/revoke
    // it — it used to be hidden, which left it stuck-on and un-editable.
    // [FIX-20260729-HIDDENPERM] ใช้ UNEDITABLE_PERMISSIONS ที่หัวไฟล์เป็นแหล่งเดียว
    // เดิมประกาศซ้ำตรงนี้ แล้ว role.manage ถูกกรองแยกอีกบรรทัด ทำให้รายการ
    // "สิ่งที่ซ่อน" กระจายอยู่ 2 ที่ และ role seed ไม่รู้จักมันเลย

    const selectedRole = roles.find(role => role.id === formData.role_id);
    const selectedRoleName =
      selectedRole?.name ?? (initialData?.role?.id === formData.role_id ? initialData?.role?.name : '');

    // Get current logged-in user details to filter permissions
    const authState = getStoredAuth();
    const authRoleName = authState?.role?.name;
    const authUsername = authState?.user?.username;
    const authPermissions = authState?.permissions || [];
    const isSuperUser = authRoleName === 'superadmin' || authRoleName === 'superuser';

    const normalizeMap: Record<string, string> = {
      'Audit Logs': 'audit.manage',
      'Auto Replies': 'auto_reply.manage',
      'Broadcast': 'broadcast.manage',
      'System Config': 'config.manage',
      'Dynamic Tag Manage': 'dynamic_tags.manage',
      'Flex Manage': 'flex.manage',
      'Sector Groups': 'group.manage',
      'Channels': 'hook.manage',
      'Manage Objects': 'object.manage',
      'Roles': 'role.manage',
      'Slip Manage': 'slip.manage',
      'Users': 'user.manage',
      'Webhook Log': 'webhook_log.manage'
    };

    const hasUserPermission = (permission: string) => {
      if (isSuperUser) return true;
      const normalized = normalizeMap[permission] || permission;
      return authPermissions.includes(permission) || authPermissions.includes(normalized);
    };

    // ==== [FEAT-20260729-PERMLIST] START — show the full list, let the operator choose
    // 🔒 AUTO track — to_dev_auto branch only
    //
    // The list used to be narrowed to whatever the selected role happened to
    // carry (operator saw a short list, admin a longer one). That made the form
    // lie: the person filling it in decides the access, and hiding a checkbox
    // because of a role they picked a second ago just hides the decision.
    //
    // Two filters remain, and both are about the caller rather than the target:
    //   hiddenPermissions   internal permissions nobody edits by hand
    //   hasUserPermission   you cannot hand out access you do not hold —
    //                       the same ceiling the BE enforces in
    //                       ensurePermissionSubset, mirrored here so the UI
    //                       never offers something the API will reject
    //
    // `role.manage` ("บทบาท") is hidden from this form entirely — including from
    // superadmins. Roles are edited on their own page, not as a side effect of
    // editing a person, and the checkbox only ever invited that mistake.
    //
    // Hiding is display-only: an account that already holds role.manage keeps it,
    // because formData.permissions is submitted as-is and the value is never
    // stripped. Nothing about the existing flow changes.
    //
    // ⚠️ อย่าเอา filter ตาม role กลับมา — คนกรอกฟอร์มเป็นคนเลือกสิทธิ์เอง
    // revert: restore the `selectedRoleName === 'operator'` filter line and drop
    //         the role.manage line below.
    return Array.from(unique)
      // [FEAT-20260811-DEVONLYPERM] dev/dev2 see (and can tick) auto_reply.
      .filter(permission => !isUneditablePermission(permission, isDevOperator))
      .filter(permission => hasUserPermission(permission))
      .sort();
  }, [roles, formData.permissions, formData.role_id, initialData, isDevOperator]);
  // ==== [FEAT-20260729-PERMLIST] END

  // Grouped the same way the sidebar groups its menu entries, and in the same
  // order, so a permission is found where its menu lives. A flat alphabetical
  // list put unrelated entries next to each other and read as arbitrary.
  const groupedPermissionOptions = useMemo(() => {
    const SECTIONS: { key: string; permissions: string[] }[] = [
      // [FEAT-20260804-DASHPERM] หมวด dashboard อยู่บนสุด — เห็นการ์ดข้อมูล dashboard
      //   revert: ลบแถวนี้ + key ใน KNOWN_PERMISSIONS + mirror ใน BulkPermissionsModal
      { key: 'dashboard', permissions: ['dashboard.stats.view'] },
      // [FIX-20260804-DICTPERM] `translation_dict.manage` ไม่เคยถูกใส่ในหมวดไหนเลยตั้งแต่เพิ่มเมนูนี้
      // จึงตกไปกอง "other" ท้ายฟอร์ม — ยังติ๊กได้ (ไม่ได้หาย) แต่ผิดหลักที่เขียนไว้ข้างบนว่า
      // "สิทธิ์ต้องอยู่ที่เดียวกับเมนูของมัน" · เมนู translation-dict อยู่ใต้ "จัดการทั่วไป"
      // revert: ลบ 'translation_dict.manage' ออกจากแถวนี้ (จะกลับไปโผล่ที่หมวด other เหมือนเดิม)
      // [FEAT-20260805-HANDOFF] handoff perms live in the same "general" section as translation_dict.manage
      { key: 'general', permissions: ['group.manage', 'hook.manage', 'slip.manage', 'flex.manage', 'dynamic_tags.manage', 'custom_tools.manage', 'translation_dict.manage', 'handoff.manage', 'handoff.view_raw', 'handoff.history'] },
      // [FEAT-20260824-STRIKESESSION] strike.manage อยู่หมวด support เพราะมันคือสิทธิ์บนเคสของลูกค้า คู่กับ ticket.manage
      { key: 'support', permissions: ['ticket.manage', 'insight.manage', 'assign_history.manage', 'contact.manage', 'strike.manage'] },
      { key: 'storage', permissions: ['object.manage'] },
      { key: 'apps', permissions: ['user.manage', 'webhook_log.manage', 'audit.manage', 'config.manage', 'role.manage'] }
    ];
    // Legacy display names are stored on some roles; map them onto the ids the
    // sections are keyed by so those permissions land in a section too.
    const toId: Record<string, string> = {
      'Audit Logs': 'audit.manage', 'Auto Replies': 'auto_reply.manage', 'Broadcast': 'broadcast.manage',
      'System Config': 'config.manage', 'Dynamic Tag Manage': 'dynamic_tags.manage', 'Flex Manage': 'flex.manage',
      'Sector Groups': 'group.manage', 'Channels': 'hook.manage', 'Manage Objects': 'object.manage',
      'Roles': 'role.manage', 'Slip Manage': 'slip.manage', 'Users': 'user.manage', 'Webhook Log': 'webhook_log.manage',
      'Contacts': 'contact.manage'
    };

    const remaining = [...permissionOptions];
    const take = (id: string) => {
      const at = remaining.findIndex(p => (toId[p] || p) === id);
      return at === -1 ? null : remaining.splice(at, 1)[0];
    };

    const sections = SECTIONS
      .map(section => ({
        key: section.key,
        permissions: section.permissions.map(take).filter((p): p is string => p !== null)
      }))
      .filter(section => section.permissions.length > 0);

    // Anything not claimed above still has to be selectable, so it goes last
    // rather than being silently dropped from the form.
    if (remaining.length > 0) sections.push({ key: 'other', permissions: remaining });
    return sections;
  }, [permissionOptions]);

  const getPermissionLabel = (permissionId: string) => {
    const normalizeMap: Record<string, string> = {
      'Audit Logs': 'audit.manage',
      'Auto Replies': 'auto_reply.manage',
      'Broadcast': 'broadcast.manage',
      'System Config': 'config.manage',
      'Dynamic Tag Manage': 'dynamic_tags.manage',
      'Flex Manage': 'flex.manage',
      'Sector Groups': 'group.manage',
      'Channels': 'hook.manage',
      'Manage Objects': 'object.manage',
      'Roles': 'role.manage',
      'Slip Manage': 'slip.manage',
      'Users': 'user.manage',
      'Webhook Log': 'webhook_log.manage'
    };
    const normalizedId = normalizeMap[permissionId] || permissionId;
    const key = `user.permission_${normalizedId.replace(/\./g, '_')}`;
    const translated = t(key);
    return translated === key ? permissionId : translated;
  };


  // [FEAT-20260729-PERMLIST] used to silently drop any ticked permission that
  // was not on the operator allow-list before submitting. That was the worst
  // version of the old behaviour: the box stayed ticked on screen while the
  // value never reached the API, so the change appeared to save and did not.
  // What is ticked is what gets sent; the BE decides what is allowed.
  // revert: restore the operator filter here and in handleChange.
  const buildSubmitPayload = () => formData;

  const confirmUpdate = async () => {
    setLoading(true);
    try {
      const payload = buildSubmitPayload();
      await onSubmit(payload);
      onClose();
    } finally {
      setLoading(false);
      setIsUpdateConfirmOpen(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (resolvedMode === 'update') {
      setIsUpdateConfirmOpen(true);
      return;
    }
    confirmUpdate();
  };

  const getGroupId = (group: GroupEntry) => (group as any)._id || (group as any).id || '';
  const getGroupName = (group: GroupEntry) => group.group_name;

  const groupedSelections = useMemo(() => {
    const map = new Set(formData.groups);
    return groups
      .map(group => {
        const id = getGroupId(group);
        if (!id) return null;
        return {
          id,
          group,
          checked: map.has(id)
        };
      })
      .filter((item): item is { id: string; group: GroupEntry; checked: boolean } => Boolean(item));
  }, [groups, formData.groups]);

  const selectedGroupLabels = useMemo(() => {
    if (!formData.groups.length) return '';
    const labelMap = new Map(groupedSelections.map(item => [item.id, getGroupName(item.group)]));
    const labels = formData.groups.map(id => labelMap.get(id)).filter(Boolean) as string[];
    if (labels.length === 0) return `${formData.groups.length}`;
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  }, [formData.groups, groupedSelections]);

  const InputError = ({ error }: { error?: string }) => {
    if (!error) return null;
    return (
      <div className="flex items-center gap-1 mt-1 text-red-400 text-xs animation-fade-in">
        <AlertCircle size={12} />
        <span>{error}</span>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      variant="form"
      maxWidth="max-w-2xl"
      // These two stay OUTSIDE the panel, exactly where they were rendered before.
      afterPanel={
        <>
          <AlertModal
            isOpen={!!validationAlert?.isOpen}
            onClose={() => setValidationAlert(null)}
            title={t('common.validation_error')}
            message={validationAlert?.message || ''}
            type="error"
          />
          <ConfirmModal
            isOpen={isUpdateConfirmOpen}
            onClose={() => setIsUpdateConfirmOpen(false)}
            onConfirm={confirmUpdate}
            title={t('user.form_update_confirm_title')}
            message={t('user.form_update_confirm_message', {
              name: formData.display_name?.trim()
                ? `${formData.display_name}${formData.username ? ` (${formData.username})` : ''}`
                : formData.username
            })}
            type="warning"
            confirmLabel={t('common.confirm')}
            cancelLabel={t('common.cancel')}
          />
        </>
      }
    >
        <Modal.Header
          title={resolvedMode === 'create' ? t('user.form_create_title') : t('user.form_update_title')}
          onClose={onClose}
        />

        <form onSubmit={handleSubmit} autoComplete="off" className="p-6 overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                {t('user.form_username_label')} {resolvedMode === 'create' && <span className="text-red-500">*</span>}
              </label>
              <input
                name="username"
                value={formData.username}
                onChange={handleChange}
                disabled={resolvedMode === 'update'}
                className={inputClass(!!errors.username)}
                placeholder={t('user.form_username_placeholder')}
              />
              <InputError error={errors.username} />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                {t('user.form_display_name_label')} <span className="text-red-500">*</span>
              </label>
              <input
                name="display_name"
                value={formData.display_name}
                onChange={handleChange}
                className={inputClass(!!errors.display_name)}
                placeholder={t('user.form_display_name_placeholder')}
              />
              <InputError error={errors.display_name} />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                {t('user.form_email_label')}
              </label>
              <input
                type="email"
                name="email"
                value={formData.email || ''}
                onChange={handleChange}
                autoComplete="off"
                className={inputClass(!!errors.email)}
                placeholder={t('user.form_email_placeholder')}
              />
              <InputError error={errors.email} />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                {t('user.form_phone_label')}
              </label>
              <input
                name="phone"
                value={formData.phone || ''}
                onChange={handleChange}
                autoComplete="off"
                className={inputClass(!!errors.phone)}
                placeholder={t('user.form_phone_placeholder')}
              />
              <InputError error={errors.phone} />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                {t('user.form_password_label')} {resolvedMode === 'create' && <span className="text-red-500">*</span>}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password || ''}
                  onChange={handleChange}
                  autoComplete="new-password"
                  className={inputClass(!!errors.password, 'pr-10')}
                  placeholder={resolvedMode === 'create' ? t('user.form_password_placeholder') : t('user.form_password_optional')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                  aria-label={showPassword ? t('user.form_password_hide') : t('user.form_password_show')}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {resolvedMode === 'update' && (
                <p className="mt-1 text-xs text-slate-400">{t('user.form_password_optional')}</p>
              )}
              <InputError error={errors.password} />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-500 mb-1">
                {t('user.form_confirm_password_label')} {resolvedMode === 'create' && <span className="text-red-500">*</span>}
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirm_password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (errors.confirm_password) {
                      setErrors(prev => {
                        const next = { ...prev };
                        delete next.confirm_password;
                        return next;
                      });
                    }
                  }}
                  autoComplete="new-password"
                  className={inputClass(!!errors.confirm_password, 'pr-10')}
                  placeholder={t('user.form_confirm_password_placeholder')}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(prev => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                  aria-label={showConfirmPassword ? t('user.form_password_hide') : t('user.form_password_show')}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <InputError error={errors.confirm_password} />
            </div>

            {canEditRole ? (
              <div>
                <label className="block text-sm font-medium text-slate-500 mb-1">
                  {t('user.form_role_label')} <span className="text-red-500">*</span>
                </label>
                <select
                  name="role_id"
                  value={formData.role_id}
                  onChange={handleChange}
                  onFocus={fetchRoles}
                  className={inputClass(!!errors.role_id, 'appearance-none')}
                  disabled={rolesLoading || (isAdmin && initialData?.role?.name === 'superadmin')}
                >
                  <option value="" disabled>
                    {rolesLoading ? t('user.form_roles_loading') : t('user.form_role_placeholder')}
                  </option>
                  {!isSuperAdmin && initialData?.role?.name === 'superadmin' && formData.role_id && (
                    <option value={formData.role_id} disabled>
                      {initialData.role?.name}
                    </option>
                  )}
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                {roles.length === 0 && !rolesLoading && (
                  <p className="text-xs text-slate-400 mt-1">{t('user.form_roles_empty')}</p>
                )}
                <InputError error={errors.role_id} />
              </div>
            ) : null}

            {canEditPermissions ? (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-500 mb-2">{t('user.form_permissions_label')}</label>
                <div className="rounded-lg border border-dark-700 bg-dark-700/30 p-3 flex flex-col">
                  {groupedPermissionOptions.map((section, sectionIndex) => (
                    <div
                      key={section.key}
                      className={sectionIndex > 0 ? 'mt-3 pt-3 border-t border-dark-700' : undefined}
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                        {t(`user.permission_group_${section.key}`)}
                      </p>
                      <div className="flex flex-col gap-2">
                        {section.permissions.map(permissionId => (
                          <label key={permissionId} className="flex items-center gap-2 text-sm text-slate-600">
                            <input
                              type="checkbox"
                              checked={formData.permissions.includes(permissionId)}
                              onChange={() => togglePermission(permissionId)}
                              className="accent-primary-500"
                            />
                            <span>{getPermissionLabel(permissionId)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <InputError error={errors.permissions} />
              </div>
            ) : null}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-500 mb-2">{t('user.form_groups_label')}</label>
            <div ref={groupDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setIsGroupsOpen(open => !open)}
                className={inputClass(false, 'flex items-center justify-between gap-2')}
              >
                <span className="text-sm text-slate-600">
                  {selectedGroupLabels
                    ? selectedGroupLabels
                    : t('user.form_groups_placeholder')}
                </span>
                <span className="text-xs text-slate-400">{formData.groups.length}</span>
              </button>
              {isGroupsOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-dark-700 bg-dark-800 shadow-xl max-h-48 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between pb-2 border-b border-dark-700">
                    <button
                      type="button"
                      onClick={selectAllGroups}
                      className="text-xs font-medium text-primary-500 hover:text-primary-400"
                    >
                      {t('common.select_all')}
                    </button>
                    <button
                      type="button"
                      onClick={resetGroups}
                      className="text-xs font-medium text-slate-500 hover:text-slate-300"
                    >
                      {t('common.reset')}
                    </button>
                    <button
                      type="button"
                      onClick={clearAllGroups}
                      className="text-xs font-medium text-slate-500 hover:text-slate-300"
                    >
                      {t('common.clear_all')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsGroupsOpen(false)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-300"
                    >
                      {t('common.ok')}
                    </button>
                  </div>
                  {groupsLoading && (
                    <div className="text-xs text-slate-400">{t('user.form_groups_loading')}</div>
                  )}
                  {!groupsLoading && groupedSelections.length === 0 && (
                    <div className="text-xs text-slate-400">{t('user.form_groups_empty')}</div>
                  )}
                  {!groupsLoading && groupedSelections.map(({ id, group, checked }) => (
                    <label key={id} className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGroup(id)}
                        className="accent-primary-500"
                      />
                      <span>{getGroupName(group)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <InputError error={errors.groups} />
          </div>

          {formData.groups.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-500">
                  {t('pageui.admin.group_oa_access', 'สิทธิ์เข้าถึง OA ในกลุ่ม')}
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allIds = availableHooks.map(h => h._id);
                      setFormData(prev => ({ ...prev, allowed_hooks: allIds }));
                    }}
                    className="text-xs font-medium text-primary-500 hover:text-primary-400"
                  >
                    {t('common.select_all')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({ ...prev, allowed_hooks: [] }));
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-300"
                  >
                    {t('common.clear_all')}
                  </button>
                </div>
              </div>
              {hooksLoading ? (
                <div className="text-xs text-slate-400">{t('pageui.admin.loading_oas', 'กำลังโหลด OA...')}</div>
              ) : availableHooks.length === 0 ? (
                <div className="text-xs text-slate-400">{t('pageui.admin.no_oa_in_groups', 'ไม่มี OA ในกลุ่มที่เลือก (หรือไม่มีสิทธิ์)')}</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar p-3 border border-dark-700 rounded-lg bg-dark-800/50">
                  {availableHooks.map(hook => {
                    const isChecked = formData.allowed_hooks
                      ? formData.allowed_hooks.includes(hook._id)
                      : true;
                    return (
                      /* [UI-20260828-OANAMETONE] ชื่อ OA จืดจนเกือบมองไม่เห็นในธีมสว่าง
                         🔴 `text-slate-300` (#CBD5E1) กับ `hover:text-white` เขียนไว้สำหรับ
                            พื้นมืด · โมดัลนี้อยู่บนพื้นสว่าง (#EDF1F6) ⇒ contrast ต่ำมาก
                            ชื่อ OA อ่านเหมือนถูกปิดใช้งานทั้งที่ติ๊กเลือกอยู่
                         ⇒ `slate-700` ในธีมสว่าง · ธีมมืดคงค่าเดิมไว้ผ่าน `dark:`
                            hover เข้มขึ้นแทนที่จะสว่างขึ้น (บนพื้นสว่าง ขาวคือหายไป)
                         ⚠️ แก้เฉพาะบรรทัดนี้ — อีก 4 จุดในไฟล์เป็น `text-slate-500`
                            ซึ่งเป็นปุ่มลิงก์เล็ก คนละบทบาทและยังอ่านออกอยู่ */
                      <label key={hook._id} className="flex items-center gap-2 text-xs text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const current = formData.allowed_hooks ?? availableHooks.map(h => h._id);
                            if (e.target.checked) {
                              setFormData(prev => ({ ...prev, allowed_hooks: [...current, hook._id] }));
                            } else {
                              setFormData(prev => ({ ...prev, allowed_hooks: current.filter(id => id !== hook._id) }));
                            }
                          }}
                          // [FEAT-20260729-OABLUE] blue, not the green used by the
                          // permission checkboxes above — OA access and permissions
                          // are different kinds of grant and were easy to conflate
                          // when both rendered identically.
                          className="accent-sky-500 rounded"
                        />
                        <span className="truncate">{hook.alias || hook.line_oa_name || hook._id}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}


          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{t('user.form_status_label')}</label>
            <select
              name="active"
              value={String(formData.active)}
              onChange={handleChange}
              className={inputClass(false, 'appearance-none')}
            >
              <option value="true">{t('status.active')}</option>
              <option value="false">{t('status.inactive')}</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-dark-700">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-500/20 flex items-center gap-2"
            >
              {loading && <Loader2 className="animate-spin" size={16} />}
              <Save size={18} />
              {t('common.save')}
            </button>
          </div>
        </form>
    </Modal>
  );
};
