import { useState } from 'react';

import { copyText } from '../../../utils/copyText';
import { isSafeImageLink } from '../../../services/media';
import type { ObjectImage } from '../../../types';

/**
 * [REFACTOR-20260904-OBJLISTSPLIT] The page's one alert dialog, and the two
 * clipboard actions that speak through it.
 * ===========================================================================
 * They move together because the copies exist only to raise an alert: every
 * outcome of a clipboard write — refused link, browser said no, done — is a
 * sentence in this dialog. Leaving `showAlert` behind and moving the copies, or
 * the reverse, would split one conversation across two files.
 *
 * 🔴 THE ALERT FOLLOWS THE REAL RESULT, ALWAYS. `copyText` can fail for reasons
 * that have nothing to do with the link — a non-https origin, a browser that
 * refuses without a user gesture — and the old code announced success before
 * knowing ([FIX-20260830-COPYHTTP2]). Both helpers here await the answer first.
 * Never announce a copy before knowing it succeeded.
 *
 * ⚠️ `isSafeImageLink` is checked BEFORE copying, not after: it stops an admin
 * putting a path that is not a servable image on a card and wondering later why
 * the picture never loads. The BE guards the serve route as well; this guards
 * the human.
 *
 * revert: paste the four members back into `ObjectImageList.tsx` and delete this
 *   file. Every call site keeps the same names.
 */
export interface AlertState {
  isOpen: boolean;
  title: string;
  message: string;
  type: 'success' | 'error';
}

export function useObjectImageAlerts(t: (key: string, fallback?: string) => string) {
  const [alertState, setAlertState] = useState<AlertState>({
    isOpen: false,
    title: '',
    message: '',
    type: 'success',
  });

  const showAlert = (
    title: string,
    message: string,
    type: 'success' | 'error',
  ): void => {
    setAlertState({ isOpen: true, title, message, type });
  };

  const closeAlert = (): void =>
    setAlertState((prev) => ({ ...prev, isOpen: false }));

  /** Copy one stored file's link, after checking it is one we actually serve. */
  const copyImageLink = async (url: string): Promise<void> => {
    if (!isSafeImageLink(url)) {
      showAlert(t('common.error_title'), t('object_image.copy_link_invalid'), 'error');
      return;
    }
    if (await copyText(url)) {
      showAlert(t('status.success'), t('object_image.copy_link_ok') + '\n' + url, 'success');
    } else {
      showAlert(t('common.error_title'), t('common.copy_failed_message'), 'error');
    }
  };

  /**
   * Copy an album's tags in the shape the bot matches on.
   *
   * ⚠️ `matching_tag` really is string OR array — the endpoint has returned both.
   */
  const copyTags = (matching_tag: ObjectImage['matching_tag']): void => {
    const tags = Array.isArray(matching_tag) ? matching_tag : [matching_tag];
    const tagStr = tags.map((tag) => `[[[${tag}]]]`).join(' ');
    void copyText(tagStr).then((ok) =>
      ok
        ? showAlert(t('common.success'), t('pageui.content.copy_tag_ok', 'คัดลอก Tag แล้ว: ') + tagStr, 'success')
        : showAlert(t('common.error_title'), t('common.copy_failed_message'), 'error'),
    );
  };

  return { alertState, showAlert, closeAlert, copyImageLink, copyTags };
}
