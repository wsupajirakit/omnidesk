// ==== [FEAT-20260731-HOOKFULLPAGE] START
// 🔒 สาย AUTO — to_dev_auto / to_prod_auto
//
// ── Why ──────────────────────────────────────────────────────────────────────
// User requirement: Separate Edit Hook and Clone Hook into a standalone full page.
// Clicking edit or clone on the Webhook List opens a NEW browser tab (`window.open`).
//
// This component acts as the page container for routes:
//   - /hooks/edit/:id   (Edit mode)
//   - /hooks/clone/:id  (Clone mode — pre-fills initial data, saves as new)
//   - /hooks/create     (Create mode)
//   - /hooks/view/:id   (View details mode)
//
// ── Feature & Logic Parity ───────────────────────────────────────────────────
// Renders `HookFormModal` with `isFullPage={true}`.
// Preserves 100% of field parsing, tab logic, training document splitting ([FIX-20260731-CLONEDOC]),
// Raw JSON rules ([FEAT-20260731-RAWJSONSAMPLE]), AI history limit, custom tools, and slip check settings.
//
// revert: delete this file, remove route declarations in App.tsx, and revert handleEdit/handleCopy in WebhookList.tsx
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle, Eye, Edit2, Copy, Plus } from 'lucide-react';
import { HookFormModal } from '../../components/hook';
import { webhookService } from '../../services/hook';
import { useHookDetailQuery } from '../../services/hook/queries';
import { auditService } from '../../services/admin';
import { getAuthUser } from '../../services/authStorage';
import { normalizeHookSubmission } from '../../utils/hookFormPayload';
import { HookData, HookFormData } from '../../types';
import { useI18n } from '../../i18n';
// [FIX-20260817-BLANKSECRET] the mask must never be diffed as if it were a value
import { SECRET_MASK, isMaskedSecret } from '../../utils/secretMask';
import { AlertModal } from '../../components/modals';

interface HookFormPageProps {
  mode?: 'edit' | 'clone' | 'create' | 'view';
}

const safeAudit = async (payload: {
  ref_id?: string;
  hook_id?: string;
  parent?: string;
  action: string;
  changed_fields?: any[];
  actor?: any;
  note?: string;
}) => {
  try {
    await auditService.createHookAuditLog(payload as any);
  } catch (err) {
    console.warn('[HookFormPage] audit log failed silently:', err);
  }
};

const getActor = () => {
  const u = getAuthUser();
  if (!u) return { user_id: 'system', username: 'system', display_name: 'system' };
  return {
    user_id: u.id || (u as any)._id || u.username,
    username: u.username,
    // [FEAT-20260731-HOOKFULLPAGE] `AuthUser` ไม่มี field `name` (types.ts:1)
    // เดิมเขียน u.name ตรงๆ ทำให้ tsc ไม่ผ่านทั้ง build
    // ยังอ่านค่านั้นอยู่เผื่อ token รุ่นเก่าส่งมา แต่ cast ก่อนเหมือนที่บรรทัดบน
    // ทำกับ _id — ไม่ใช่การเพิ่ม field ใหม่เข้า type ซึ่งจะกระทบทั้งระบบ
    // revert: กลับเป็น u.display_name || u.name || u.username
    display_name: u.display_name || (u as any).name || u.username
  };
};

const redactIfSensitive = (field: string, val: any): any => {
  if (val === null || val === undefined) return val;
  // [FEAT-20260904-VENDORSECCOL] `custom_ai_key_sec` — a THIRD list that has to
  // know about a new credential (the other two: `AUDIT_SENSITIVE_FIELDS` in
  // utils/secretMask.ts and `SECRET_LOCK_CLEAR_FIELDS` in form/secretLock.tsx).
  const sensitiveFields = ['channel_secret', 'access_token', 'custom_ai_key', 'custom_ai_key_sec', 'telegram_key', 'slip_verify_key', 'callback_token'];
  if (sensitiveFields.includes(field)) {
    const s = String(val);
    if (s.length <= 6) return '******';
    return s.slice(0, 3) + '***' + s.slice(-3);
  }
  return val;
};

export const HookFormPage: React.FC<HookFormPageProps> = ({ mode: propMode }) => {
  const { t } = useI18n();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Determine mode from route path if propMode is not explicitly set
  const effectiveMode = propMode || (
    location.pathname.includes('/edit/') ? 'edit' :
    location.pathname.includes('/clone/') ? 'clone' :
    location.pathname.includes('/view/') ? 'view' : 'create'
  );

  // [FEAT-20260805-CREATE-INGROUP] optional ?group=:id on the create route → prefill+lock
  // the group (สร้างใหม่ใต้กลุ่มเดิม). ไม่มี param = create ปกติเป๊ะ ไม่กระทบอะไร.
  const presetGroupId = useMemo(() => {
    if (effectiveMode !== 'create') return '';
    // hash router: query can live in location.search OR after the hash — cover both
    const q = location.search || (location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '');
    return new URLSearchParams(q).get('group') || '';
  }, [effectiveMode, location.search, location.hash]);

  // [FEAT-20260806-CLONE-PROVISION] clone route may carry ?provision=1 → on create, also provision
  // the source OA's handoff chain/target bindings. absent = plain clone (field-copy only · seamless).
  const provisionFromClone = useMemo(() => {
    if (effectiveMode !== 'clone') return false;
    const q = location.search || (location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '');
    return new URLSearchParams(q).get('provision') === '1';
  }, [effectiveMode, location.search, location.hash]);

  /* [FEAT-20261027-TANSTACK] the hook being edited/cloned/viewed — `useHookDetailQuery`
     is noCache on purpose (an editable form must never be seeded from a cached copy), so
     every open is a fresh fetch behind the same loading screen as before.
     One quirk of the old loader is gone: a UI-language switch no longer refetches and
     re-seeds the form (`t` sat in the old useCallback deps).
     revert: restore from tag ckpt-before-tanstack-demo-26102026. */
  const needsHook = effectiveMode !== 'create' && !!id;
  const detailQuery = useHookDetailQuery(id, needsHook);
  const hookData: HookData | undefined = detailQuery.data || undefined;
  const loading = needsHook && detailQuery.isPending;
  const fetchError: string | null = !needsHook
    ? null
    : detailQuery.isError
      ? detailQuery.error?.message || 'Failed to load hook data'
      : detailQuery.isSuccess && !detailQuery.data
        ? t('webhook_list.alert_hook_not_found') || 'Hook not found'
        : null;
  useEffect(() => {
    if (detailQuery.isError) console.error('[HookFormPage] Failed to load hook:', detailQuery.error);
  }, [detailQuery.isError, detailQuery.error]);
  const [alert, setAlert] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' | 'warning' }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success'
  });

  // [FEAT-20260801-SAVETOAST] savedMessage = ข้อความยืนยันที่จะไปโผล่บนหน้า /hooks
  // ไม่ส่งมา = พฤติกรรมเดิมเป๊ะ (ปุ่ม "ย้อนกลับ" ปกติจึงไม่ทำให้เกิดแถบแจ้งผล)
  // ⚠️ เคสเปิดเป็นหน้าต่างใหม่ (window.opener) จะปิดหน้าต่างไปเลย ไม่มีหน้า list
  //    ให้ไปโชว์ — ตรงนั้น AlertModal ที่ผู้ใช้เพิ่งกดปิดคือตัวยืนยันอยู่แล้ว
  // ==== [FEAT-20260801-SAVETOAST] ทำไมต้องใช้ ref ตัวนี้
  // HookFormModal เรียก onClose() **ทันที** หลัง onSubmit สำเร็จ (ดูในไฟล์นั้น)
  // บนหน้าเต็ม onClose = handleBack → เด้งกลับ /hooks ทันที
  // → AlertModal ที่หน้านี้ตั้งไว้ไม่มีทางถูกเห็นเลย = ผู้ใช้ไม่รู้ว่าสำเร็จ
  //
  // แทนที่จะไปแก้ HookFormModal (ซึ่งหน้า WebhookList ใช้เป็น modal จริง
  // และการปิดหลังเซฟที่นั่นถูกต้องอยู่แล้ว) ให้หน้านี้จำไว้เองว่าเพิ่งเซฟอะไร
  // แล้วตอน onClose ค่อยส่งข้อความนั้นไปกับ navigate
  //
  // ⚠️ ใช้ ref ไม่ใช่ state — onClose ถูกเรียกในจังหวะเดียวกับที่ setState
  //    ยังไม่ทันมีผล ถ้าใช้ state จะอ่านได้ค่าเก่า (undefined) เสมอ
  // ⚠️ ล้างทิ้งทุกครั้งที่อ่าน — กดปุ่มย้อนกลับเฉย ๆ ต้องไม่ขึ้นแถบว่าบันทึกแล้ว
  const justSavedRef = useRef<string | null>(null);

  const handleBack = (savedMessage?: string) => {
    // ⚠️ ฟังก์ชันนี้ถูกผูกเป็น onClick / onClose ตรง ๆ ด้วย (บรรทัดล่าง)
    //    React จะส่ง event object เข้ามาเป็น argument แรก ไม่ใช่สตริง
    //    ถ้าปล่อยผ่านไปเป็น navigate state → pushState clone ไม่ได้ →
    //    DataCloneError: PointerEvent object could not be cloned (เจอจริงมาแล้ว)
    //    → รับเฉพาะสตริงเท่านั้น อย่างอื่นถือว่าไม่ได้ส่งมา
    const explicit = typeof savedMessage === 'string' && savedMessage.trim() ? savedMessage : undefined;
    const msg = explicit || justSavedRef.current || undefined;
    justSavedRef.current = null;   // อ่านแล้วล้างทันที
    if (window.history.length > 1 && window.opener) {
      try {
        window.close();
      } catch (e) {
        navigate('/hooks', msg ? { state: { savedMessage: msg } } : undefined);
      }
    } else {
      navigate('/hooks', msg ? { state: { savedMessage: msg } } : undefined);
    }
  };

  const handleSubmit = async (data: HookFormData) => {
    try {
      // [FEAT-20260817-FORMDIFF] On edit the form now sends only the fields the
      // operator changed, so this block must not re-create the ones it omitted —
      // the guarded rules live in utils/hookFormPayload.ts, shared with
      // WebhookList so the two screens cannot drift apart again.
      const normalizedPayload = normalizeHookSubmission(data as any, {
        isCreate: effectiveMode !== 'edit',
      }) as HookFormData;
      const finalPayload: Partial<HookFormData> = normalizedPayload;

      if (effectiveMode === 'edit' && hookData && hookData._id) {
        await webhookService.updateHook(hookData._id, finalPayload);
        const changes = Object.keys(finalPayload).flatMap((key) => {
          const field = key as keyof HookFormData;
          const beforeVal = (hookData as any)[field];
          const afterVal = (finalPayload as any)[field];
          // [FIX-20260817-BLANKSECRET] `hookData` holds SECRET_MASK for every
          // configured secret (the API never ships the real one). Diffing it
          // logs "changed from __SECRET_KEPT__" on a field nobody touched, so
          // either side being the mask means: not edited, nothing to record.
          if (isMaskedSecret(beforeVal) || isMaskedSecret(afterVal)) return [];
          if (JSON.stringify(beforeVal ?? null) === JSON.stringify(afterVal ?? null)) return [];
          const f = String(field);
          return [{
            field: f,
            from: redactIfSensitive(f, beforeVal ?? null),
            to: redactIfSensitive(f, afterVal ?? null)
          }];
        });
        await safeAudit({
          ref_id: hookData._id,
          hook_id: hookData._id,
          parent: 'hook',
          action: 'update',
          changed_fields: changes,
          actor: getActor(),
          note: 'fullpage form update'
        });
        // [FEAT-20260801-SAVETOAST] จำข้อความไว้ให้ handleBack หยิบไปโชว์ที่หน้า list
        justSavedRef.current = t('webhook_list.alert_updated_message');
        setAlert({
          isOpen: true,
          title: t('webhook_list.alert_updated_title'),
          message: t('webhook_list.alert_updated_message'),
          type: 'success'
        });
      } else {
        // Clone mode or Create mode -> Create new record.
        // [FEAT-20260806-CLONE-PROVISION] in clone mode, tell BE where we cloned from + whether to
        // provision handoff bindings (default false → identical to a plain create).
        const createPayload: any = effectiveMode === 'clone'
          ? { ...normalizedPayload, clone_from: hookData?._id || id, provision_handoff: provisionFromClone }
          : normalizedPayload;
        /**
         * [FEAT-20260818-CLONEFULL] clone ยิงเส้นของตัวเอง `POST /hook/:src/duplicate`
         *
         * ทำไมไม่ใช่ createHook เหมือนเดิม: ฟอร์มไม่มีค่า creds ในมือ (GET ส่ง
         * `__SECRET_KEPT__` มาแทน โดยเจตนา) และไม่มี `raw_site_rules_data` ⇒ clone
         * ที่ผ่านมาได้ไม่ครบทุกใบ (เทียบของจริง 18/08: หาย 7 ค่า) · เส้นใหม่ให้ BE
         * คัดลอกจาก id ต้นทางเองในเครื่อง คีย์จึงไม่ต้องวิ่งออกมาที่นี่เลย
         * `clone_from` ยังส่งไปด้วยเพื่อความเข้ากันได้ย้อนหลัง (BE ทิ้งค่านี้ตามเดิม)
         */
        const cloneSourceId = hookData?._id || id;
        const created: any =
          effectiveMode === 'clone' && cloneSourceId
            ? await webhookService.duplicateHook(String(cloneSourceId), createPayload)
            : await webhookService.createHook(createPayload);
        const createdId = created?._id || created?.data?._id;
        /**
         * [FEAT-20260818-CLONEFULL] โหมด clone ไม่ต้องเขียน audit จากฝั่งนี้แล้ว —
         * เส้น `/duplicate` เขียนแถวให้ที่ server พร้อมรายการ field ที่คัดลอกจริง
         * (ฝั่งนี้ไม่รู้ว่า BE เติมอะไรไปบ้าง เพราะค่า creds ไม่เคยมาถึงเบราว์เซอร์)
         * ถ้าเขียนทั้งสองที่จะได้แถวซ้ำ 2 ใบต่อการโคลนหนึ่งครั้ง
         */
        if (createdId && effectiveMode !== 'clone') {
          const customAi = (normalizedPayload as any).custom_ai_key;
          const suggestionText = (normalizedPayload as any).suggestion_text;
          await safeAudit({
            ref_id: createdId,
            hook_id: createdId,
            parent: 'hook',
            action: 'create',
            changed_fields: [
              { field: 'status', from: null, to: (normalizedPayload as any).status ?? null },
              { field: 'fast_mode', from: null, to: (normalizedPayload as any).fast_mode ?? null },
              ...(customAi ? [{ field: 'custom_ai_key', from: null, to: redactIfSensitive('custom_ai_key', customAi) }] : []),
              ...(suggestionText ? [{ field: 'suggestion_text', from: null, to: suggestionText }] : [])
            ],
            actor: getActor(),
            note: 'fullpage form create'
          });
        }
        // [FEAT-20260801-SAVETOAST] จำข้อความไว้ให้ handleBack หยิบไปโชว์ที่หน้า list
        justSavedRef.current = t('webhook_list.alert_created_message');
        setAlert({
          isOpen: true,
          title: t('webhook_list.alert_created_title'),
          message: t('webhook_list.alert_created_message'),
          type: 'success'
        });
      }
    } catch (error: any) {
      setAlert({
        isOpen: true,
        title: t('webhook_list.alert_operation_failed_title'),
        message: error?.message || t('webhook_list.alert_operation_failed_message'),
        type: 'error'
      });
      throw error;
    }
  };

  const getPageTitle = () => {
    switch (effectiveMode) {
      case 'edit':
        return hookData?.line_oa_name
          ? `${t('hook_form.update_title')} - ${hookData.line_oa_name}`
          : t('hook_form.update_title');
      case 'clone':
        return hookData?.line_oa_name
          ? `${t('pageui.hook.form.clone_title', 'คัดลอก (Clone)')} - ${hookData.line_oa_name}`
          : t('pageui.hook.form.clone_title_empty', 'คัดลอก Webhook Channel');
      case 'view':
        return hookData?.line_oa_name
          ? `${t('hook_form.view_title')} - ${hookData.line_oa_name}`
          : t('hook_form.view_title');
      default:
        return t('hook_form.create_title');
    }
  };

  const getPageIcon = () => {
    switch (effectiveMode) {
      case 'edit': return <Edit2 size={22} className="text-primary-500" />;
      case 'clone': return <Copy size={22} className="text-indigo-400" />;
      case 'view': return <Eye size={22} className="text-blue-400" />;
      default: return <Plus size={22} className="text-emerald-400" />;
    }
  };

  if (loading) {
    return (
      <div className="w-full min-h-screen bg-dark-900 flex flex-col items-center justify-center p-6 text-slate-300">
        <Loader2 className="animate-spin text-primary-500 mb-4" size={40} />
        <p className="text-sm font-medium">{t('pageui.hook.form.loading', 'กำลังโหลดข้อมูล Webhook Channel…')}</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="w-full min-h-screen bg-dark-900 p-6 flex flex-col items-center justify-center text-slate-100">
        <div className="bg-dark-800 border border-dark-700 rounded-xl p-8 max-w-md w-full shadow-2xl text-center space-y-4">
          <AlertCircle className="mx-auto text-red-500" size={48} />
          <h2 className="text-xl font-bold text-slate-100">{t('pageui.hook.form.load_error', 'เกิดข้อผิดพลาดในการโหลดข้อมูล')}</h2>
          <p className="text-sm text-slate-400">{fetchError}</p>
          <button
            onClick={() => handleBack()}
            className="w-full py-2.5 px-4 rounded-lg bg-dark-700 hover:bg-dark-600 text-slate-200 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft size={16} />
            {t('pageui.hook.form.back_to_list', 'กลับสู่หน้า Webhook List')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-dark-900 text-slate-100 p-3 sm:p-5 flex flex-col">
      {/* Form Container — Full Width Rounded Card */}
      <div className="flex-1 w-full flex flex-col min-h-0">
        <HookFormModal
          isOpen={true}
          isFullPage={true}
          onClose={() => handleBack()}
          onSubmit={handleSubmit}
          initialData={hookData}
          isViewMode={effectiveMode === 'view'}
          mode={effectiveMode === 'edit' ? 'update' : 'create'}
          presetGroupId={presetGroupId || undefined}
        />
      </div>

      <AlertModal
        isOpen={alert.isOpen}
        onClose={() => {
          setAlert((prev) => ({ ...prev, isOpen: false }));
          if (alert.type === 'success') {
            // [FEAT-20260801-SAVETOAST] ส่งข้อความเดียวกับที่โชว์ใน modal ไปต่อ
            // เพื่อให้ผู้ใช้ยังเห็นผลหลังเด้งกลับ ไม่ใช่กลับมาแล้วเงียบ
            handleBack(alert.message || alert.title);
          }
        }}
        title={alert.title}
        message={alert.message}
        type={alert.type}
      />
    </div>
  );
};

export default HookFormPage;
// ==== [FEAT-20260731-HOOKFULLPAGE] END
