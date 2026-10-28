/**
 * [FEAT-20260907-FLEXMANAGELINK] "Manage flex messages" — and the dialog for an
 * admin who may not.
 * ===========================================================================
 * Owner, 07/09: the broadcast form's "open this flex card" link is replaced by a
 * way into the card library itself. An admin without the flex permission gets a
 * themed dialog saying so, instead of being sent to a page that bounces them
 * back to the dashboard root with no explanation.
 *
 * 🔴 THE PERMISSION IS ASKED THROUGH `permAllows`, NEVER `includes`. A bare
 *    `permissions.includes('flex.manage')` would lock out every system
 *    administrator: `permAllows` (`common/MegaMenu.tsx:158-159`) also honours
 *    `system.manage` and `*`, and it is the helper the navigation itself uses to
 *    decide whether to show this destination at all. Two different answers for
 *    one question is how a menu entry and its page disagree.
 *    ใช้ตัวเดียวกับเมนู ไม่งั้นเมนูโชว์แต่กดเข้าไม่ได้ (หรือกลับกัน).
 *
 * 🔴 IT STOPS AT THE DIALOG — IT DOES NOT ENFORCE. `App.tsx:1183-1185` is the
 *    real gate and redirects an unauthorised visitor regardless of what this
 *    component does. This exists so the admin is TOLD, not so the route is
 *    protected. ตัวกันจริงอยู่ที่ route ตัวนี้แค่บอกเหตุผล.
 *
 * ⚠️ Permissions are read from `getStoredAuth()`, the pattern already used by
 *    `pages/insight/Dashboard.tsx:31`, rather than threading a new prop down
 *    through `BroadcastFormModal` → `FlexCardPicker`. The form reads no auth
 *    today and adding a prop to two components to carry one boolean is more
 *    surface than the question deserves.
 *
 * ⚠️ Opens in a NEW TAB. The broadcast form is a long wizard holding unsaved
 *    work; navigating away in place would throw it out. เปิดแท็บใหม่ ไม่งั้นงานที่
 *    กรอกค้างไว้หายทั้งใบ.
 *
 * revert: delete this file and its one use in `BroadcastFormModal.tsx`; the
 * previous "open this flex card" anchor and its `broadcast.open_flex_card` key
 * are in the same commit.
 */
import React, { useState } from 'react';
import { Layers } from 'lucide-react';

import { Modal } from '../../common/Modal';
import { permAllows } from '../../common/MegaMenu';
import { getStoredAuth } from '../../../services/authStorage';
import { useI18n } from '../../../i18n';
/* [FEAT-20260907-FLEXTOOLROW] one theme/size for every tool on the flex row */
import { FlexToolButton } from './FlexToolButton';

/**
 * The one destination this button knows, and the permission that guards it.
 *
 * 🔴 [FIX-20260907-FLEXMANAGEHASH] THE `#` IS NOT OPTIONAL. The app mounts on
 *    `HashRouter` (`App.tsx:559,582`), so every route lives after a `#`. A bare
 *    `/flex-messages` asks the SERVER for a path that only the client knows —
 *    on stg it lands on the SPA fallback with an empty hash and the library
 *    never opens. Reported from `https://stg-omnidesk.example.com/#/broadcasts`.
 *
 * ⚠️ Built from `origin + pathname` rather than hard-coded, which is the shape
 *    `pages/hook/WebhookList.tsx:598-648` already uses for exactly this reason:
 *    it survives the app being served from a sub-path.
 */
export const FLEX_LIBRARY_ROUTE = '#/flex-messages';
export const flexLibraryUrl = (): string =>
  `${window.location.origin}${window.location.pathname}${FLEX_LIBRARY_ROUTE}`;
export const FLEX_MANAGE_PERMISSION = 'flex.manage';

export interface FlexManageButtonProps {
  readonly disabled?: boolean;
  readonly className?: string;
}

export const FlexManageButton: React.FC<FlexManageButtonProps> = ({
  disabled = false,
  className = '',
}) => {
  const { t } = useI18n();
  const [denied, setDenied] = useState(false);

  /* Read at click time, not at mount: a session can be refreshed while this
     long form sits open, and a stale answer here is the wrong answer. */
  const allowed = (): boolean =>
    permAllows(getStoredAuth()?.permissions ?? [], FLEX_MANAGE_PERMISSION);

  return (
    <>
      {/* [FEAT-20260907-FLEXTOOLROW] was a large green `border-2 … px-4 py-2`
          button sitting below the field. Owner, 07/09: it moves onto the label
          row and shares ONE theme and ONE size with refresh and preview, so the
          geometry now comes from `FlexToolButton` and not from here. */}
      <FlexToolButton
        testId="manage-flex-messages"
        disabled={disabled}
        className={className}
        label={t('broadcast.manage_flex_messages')}
        icon={<Layers size={13} />}
        onClick={() => {
          if (!allowed()) {
            setDenied(true);
            return;
          }
          window.open(flexLibraryUrl(), '_blank', 'noopener,noreferrer');
        }}
      />

      {/* ⚠️ The app's own dialog shell, not hand-rolled chrome — the whole point
          of `[FEAT-20260810-MODALSHELL]`. `variant="form"` is the family the
          other campaign dialogs already use, so this looks like the rest of the
          modal it opens from. */}
      <Modal isOpen={denied} variant="form" maxWidth="max-w-md">
        <Modal.Header
          title={t('broadcast.flex_manage_denied_title')}
          onClose={() => setDenied(false)}
        />
        <Modal.Body>
          <p
            className="text-sm text-slate-700"
            data-testid="flex-manage-denied"
          >
            {t('broadcast.flex_manage_denied_body')}
          </p>
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            onClick={() => setDenied(false)}
            className="rounded-lg border border-dark-600 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-dark-700"
          >
            {t('common.close')}
          </button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default FlexManageButton;
