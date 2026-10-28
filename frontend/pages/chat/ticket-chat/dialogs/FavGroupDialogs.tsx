/**
 * [REFACTOR-20261027-TCSPLIT] Favourite-group confirm and the cap warning.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * revert: paste the body back where `<FavGroupDialogs />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { ConfirmModal } from '../../../../components/modals';
import type { TFn } from '../types';

export type FavGroupDialogsProps = {
  favConfirm: { id: string; name: string; faved: boolean; };
  setFavConfirm: React.Dispatch<React.SetStateAction<{ id: string; name: string; faved: boolean; }>>;
  confirmFav: () => void;
  t: TFn;
  favLimitWarn: boolean;
  setFavLimitWarn: React.Dispatch<React.SetStateAction<boolean>>;
  FAV_MAX: 5;
};

export const FavGroupDialogs: React.FC<FavGroupDialogsProps> = ({
  favConfirm,
  setFavConfirm,
  confirmFav,
  t,
  favLimitWarn,
  setFavLimitWarn,
  FAV_MAX,
}) => (
  <>
    {/* Favourite groups: confirm fav / unfav. Backdrop click does NOT close
        (ConfirmModal has no backdrop handler) — only the buttons / X do. */}
    <ConfirmModal
      isOpen={!!favConfirm}
      onClose={() => setFavConfirm(null)}
      onConfirm={confirmFav}
      title={favConfirm?.faved ? t('ticket.fav.unfavTitle') : t('ticket.fav.favTitle')}
      message={
        favConfirm
          ? `${favConfirm.faved ? t('ticket.fav.unfavMsg') : t('ticket.fav.favMsg')}\n${favConfirm.name}`
          : ''
      }
      confirmLabel={favConfirm?.faved ? t('ticket.fav.unfav') : t('ticket.fav.fav')}
      type={favConfirm?.faved ? 'warning' : 'info'}
    />

    {/* Fav cap reached — must unfav one first. Single acknowledge button. */}
    <ConfirmModal
      isOpen={favLimitWarn}
      onClose={() => setFavLimitWarn(false)}
      onConfirm={() => setFavLimitWarn(false)}
      title={t('ticket.fav.limitTitle').replace('{max}', String(FAV_MAX))}
      message={t('ticket.fav.limitMsg').replace(/\{max\}/g, String(FAV_MAX))}
      confirmLabel={t('common.ok')}
      hideCancel
      type="warning"
    />
  </>
);
