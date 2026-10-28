import { getStoredAuth } from '../authStorage';
import { groupService } from './groupService';

/**
 * The set of sector groups a user may act on, applied IDENTICALLY everywhere
 * (top-bar switcher, the account menu's "YOUR SECTOR GROUPS", …):
 *
 *   role super (superadmin / superuser / dev)  → ALL active groups
 *   everyone else                              → active groups ∩ the user's
 *                                                own sector groups (JWT)
 *
 * We always start from the live ACTIVE groups (status:true) so a stale JWT that
 * still lists a deleted/deactivated group never leaks one back in.
 */
export interface VisibleGroup { _id: string; group_name: string; description?: string }

export const isSuperRole = (): boolean => {
  const auth = getStoredAuth();
  const roleName = (auth?.role?.name || '').toLowerCase().trim();
  const username = (auth?.user?.username || '').toLowerCase().trim();
  return roleName === 'superadmin' || roleName === 'superuser' || username === 'dev';
};

// Keys (ids + names) of the groups the signed-in user belongs to, from the JWT.
const myGroupKeys = () => {
  const raw = (getStoredAuth()?.user as any)?.groups ?? [];
  const ids = new Set<string>();
  const names = new Set<string>();
  raw.forEach((g: any) => {
    if (typeof g === 'string') { ids.add(g); return; }
    if (g?._id) ids.add(g._id);
    if (g?.id) ids.add(g.id);
    if (g?.group_name) names.add(g.group_name);
  });
  return { ids, names };
};

/**
 * Filter a list of already-active groups down to what the current user may see.
 * Pure — call it with whatever active-groups list you already have.
 */
export const filterVisibleGroups = <T extends { _id: string; group_name: string }>(
  activeGroups: T[]
): T[] => {
  if (isSuperRole()) return [...activeGroups];
  const { ids, names } = myGroupKeys();
  return activeGroups.filter(g => ids.has(g._id) || names.has(g.group_name));
};

/** Fetch active groups then apply the visibility rule. */
export const fetchVisibleGroups = async (): Promise<VisibleGroup[]> => {
  const res: any = await groupService.listGroups({ limit: 200, status: true });
  const active: VisibleGroup[] = res?.data || res || [];
  return filterVisibleGroups(active).sort((a, b) =>
    (a.group_name || '').localeCompare(b.group_name || '', undefined, { numeric: true, sensitivity: 'base' })
  );
};

/**
 * OA (hook) visibility — the same super/perm rule, one level down:
 *   role super                       → EVERY OA (allowed_hooks ignored)
 *   everyone else with a whitelist   → only OAs in their allowed_hooks
 *   everyone else with no whitelist  → all OAs (null = no restriction, legacy)
 * Use this for any OA selector so perm-by-OA is enforced consistently.
 */
export const filterVisibleHooks = <T extends { _id: string }>(hooks: T[]): T[] => {
  if (isSuperRole()) return [...hooks];
  const auth = getStoredAuth();
  const allowed = auth?.allowed_hooks ?? (auth?.user as any)?.allowed_hooks ?? null;
  if (!allowed) return [...hooks]; // null = no whitelist → all OAs
  const set = new Set(allowed);
  return hooks.filter(h => set.has(h._id));
};

/**
 * True when the user can ONLY reach the ticket pages — i.e. they have
 * ticket.manage but NONE of the other menu permissions that would populate the
 * mega-menu (insight/assign_history/hook/slip/flex/dynamic_tags/group/object/
 * user/webhook_log/audit/config, or the super-role chat menu). For such users the
 * whole top nav is noise, so the header/mega-menu is hidden and the Ticket bar
 * rises to the top. Kept in sync with MegaMenu's ticketOnly check.
 */
const MEGA_MENU_PERMS = [
  // [FIX-20260805-DASHTICKETONLY] dashboard.stats.view นับเป็นสิทธิ์เมนูบนด้วย —
  //   user ที่มี ticket.manage + สิทธิ์นี้ ต้อง "ไม่" เป็น ticket-only (เห็น Dashboard link)
  //   เดิมตกหล่น → มีสิทธิ์ dashboard แล้วยังถูกซ่อนเมนูบน · คนมี ticket ล้วนยัง ticket-only เหมือนเดิม
  //   revert: ลบ 'dashboard.stats.view' บรรทัดถัดไป
  'dashboard.stats.view',
  'insight.manage', 'assign_history.manage',
  'hook.manage', 'slip.manage', 'flex.manage', 'dynamic_tags.manage', 'group.manage',
  'object.manage', 'user.manage', 'webhook_log.manage', 'audit.manage', 'config.manage',
];
export const isTicketOnly = (permissions?: string[] | null): boolean => {
  const perms = permissions ?? getStoredAuth()?.permissions ?? [];
  if (!perms.includes('ticket.manage')) return false;        // not a ticket user at all
  if (isSuperRole()) return false;                            // super role sees the chat menu
  return !MEGA_MENU_PERMS.some((p) => perms.includes(p));     // no other menu perm → ticket-only
};

/** True when a given OA (hook id) is visible to the current user. */
export const isHookVisible = (hookId?: string | null): boolean => {
  if (!hookId) return true;
  if (isSuperRole()) return true;
  const auth = getStoredAuth();
  const allowed = auth?.allowed_hooks ?? (auth?.user as any)?.allowed_hooks ?? null;
  if (!allowed) return true;
  return new Set(allowed).has(hookId);
};
