/**
 * [FEAT-20260907-FLEXGALLERY] Picking the flex card by LOOKING at it.
 * ===========================================================================
 * The flex selector is a gallery — a large modal, cards laid
 * out two across, each one showing a real thumbnail of the card plus its name,
 * clicked to select, with its own "refresh รายการ" button inside.
 *
 * 🔴 **UI ONLY. THE BINDING LOGIC IS UNTOUCHED — said twice, in as many words.**
 *    This modal picks an id and hands it to the SAME `onChange(flexId)` the
 *    dropdown called. It does not fetch, does not decide what a valid card is,
 *    does not know the campaign exists. `FlexCardPicker` still owns the list,
 *    the reload rules and the selection; only the thing the admin looks at
 *    changed.
 *
 * 🔴 THE THUMBNAILS COST NOTHING. `content_json` already travels with every row
 *    of the list — confirmed in the backend's own list mapper
 *    (`omnidesk-api/src/modules/content/flex-messages.service.ts#toListItem`,
 *    which returns `content_json` verbatim), not assumed from the FE type. So a
 *    grid of previews is zero extra requests. If that mapper ever stops sending
 *    it, the tiles fall back to the name and a note — they do not go blank.
 *
 * 🔴 `FlexBubble`, NEVER A HAND-WRITTEN RENDERER. It is the one flex renderer in
 *    the app and the one place DOMPurify runs — the only thing standing between
 *    admin-editable JSON and stored XSS. Same rule `FlexCardCarousel` and
 *    `FlexRowPreview` are built on.
 *
 * ⚠️ `zoom`, not `transform: scale()`. `FlexBubble` takes its 300px width from
 *    the flex-render stylesheet and does not set it itself, so `transform` would
 *    leave a full-size hole in the layout. Same reasoning as the carousel.
 *
 * ⚠️ THE SEARCH BOX IS NOT NEW SCOPE. The dropdown this replaces had one, and
 *    the library runs past fifty cards; dropping it would make the gallery worse
 *    at the one job it has. It filters the list already in memory — no request.
 *
 * revert: delete this file, drop `<FlexGalleryModal>` and the trigger button
 * from `FlexCardPicker.tsx`, and put the `<SearchableSelect>` block back (it is
 * in the same commit, with its `onOpen` / `maxRows` / `wrapLabel` props).
 */
import React, { useMemo, useState } from 'react';
import { Check, RefreshCw, Search, X } from 'lucide-react';

import { Modal } from '../../common/Modal';
/* [FEAT-20260907-GALLERYPICKCONFIRM] the app's own confirm shell, not a new one */
import { ConfirmModal } from '../../modals/ConfirmModal';
import { FlexBubble, canRenderFlex } from '../../chat/FlexBubble';
import { useI18n } from '../../../i18n';
import { FlexToolButton } from './FlexToolButton';
/* [FEAT-20260907-GALLERYMANAGELINK] the SAME button the form's label row uses —
   label, permission dialog and the `#` in the URL all come with it. */
import { FlexManageButton } from './FlexManageButton';

/** Same 70% the flex page's carousel uses, so one card looks the same in both. */
export const GALLERY_ZOOM = 0.7;

export interface FlexGalleryCard {
  readonly id: string;
  readonly name: string;
  readonly content_json?: unknown;
}

export interface FlexGalleryModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly cards: readonly FlexGalleryCard[];
  /** The id currently bound to the campaign, or null. */
  readonly value: string | null;
  /** 🔴 The SAME callback the dropdown used. Nothing else changed. */
  readonly onSelect: (flexId: string | null) => void;
  /** Refresh the list, from inside the modal. */
  readonly onRefresh: () => void;
  readonly loading?: boolean;
}

/** Case-insensitive name match. Exported so the rule can be tested directly. */
export const matchesGalleryQuery = (name: string, q: string): boolean =>
  name.toLowerCase().includes(q.trim().toLowerCase());

export const FlexGalleryModal: React.FC<FlexGalleryModalProps> = ({
  isOpen,
  onClose,
  cards,
  value,
  onSelect,
  onRefresh,
  loading = false,
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  /**
   * [FEAT-20260907-GALLERYPICKCONFIRM] Clicking a card asks first, with the
   * card's NAME in the question — the tiles are large and adjacent, and
   * a misclick silently rebinds the campaign to a different card.
   *
   * ⚠️ Holds the whole card, not just the id, so the question can name it. A
   *    misclick confirmed against a bare id would be no safer than no dialog.
   */
  const [pending, setPending] = useState<FlexGalleryCard | null>(null);

  /* [UI-20260907-GALLERYSEARCHRESET] Every time the gallery is opened, the
     search box starts empty.
     🔴 AN EFFECT IS REQUIRED — THIS COMPONENT DOES NOT REMOUNT. The `Modal`
        shell returns null while closed, but `FlexGalleryModal` itself stays
        mounted inside the picker, so `useState('')` runs ONCE for the life of
        the form. Without this, an admin who searched "coin", closed, and
        reopened would be shown a filtered gallery with no idea why most of the
        library was missing.
     ⚠️ Keyed on the false → true edge. Resetting on every render would fight the
        user's typing. */
  React.useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

  const shown = useMemo(
    () => (query.trim() === '' ? cards : cards.filter(c => matchesGalleryQuery(c.name, query))),
    [cards, query],
  );

  return (
    <Modal isOpen={isOpen} variant="form" maxWidth="max-w-4xl">
      <Modal.Header title={t('broadcast.flex_pick_label')} onClose={onClose} />
      <Modal.Body>
        <div className="mb-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              data-testid="flex-gallery-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('broadcast.flex_gallery_search')}
              className="w-full rounded-lg border border-dark-600 bg-white py-1.5 pl-8 pr-9 text-sm text-slate-900 focus:border-primary-400 focus:outline-none"
            />
            {/* [UI-20260907-GALLERYSEARCHRESET] Clearing the box by hand meant
                selecting the text and deleting it. Shown only when there is
                something to clear, so it never sits there as dead furniture.
                ⚠️ `pr-9` above reserves the room — without it the ✕ lands on top
                   of whatever the admin typed. */}
            {query !== '' && (
              <button
                type="button"
                data-testid="flex-gallery-search-clear"
                onClick={() => setQuery('')}
                title={t('common.clear')}
                aria-label={t('common.clear')}
                className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {/* Refresh has to be reachable from INSIDE the modal: somebody who has
              just created a card in another tab is standing here, not up on the
              form's label row. */}
          <FlexToolButton
            testId="flex-gallery-refresh"
            onClick={onRefresh}
            disabled={loading}
            label={t('broadcast.flex_pick_refresh')}
            icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
          />
          {/* [FEAT-20260907-GALLERYMANAGELINK] the same "จัดการ
              flex message" button, here in the gallery header.
              🔴 THE EXISTING COMPONENT, NOT A SECOND BUTTON. It already carries
                 the label, the `permAllows` check, the "no permission" dialog and
                 — easy to miss — the router `#` in the
                 URL ([FIX-20260907-FLEXMANAGEHASH]). Rebuilding any of that here
                 is how the two copies start disagreeing about who may click it.
              ⚠️ It renders its own denial dialog while THIS modal is open. Both
                 use the app's `Modal` shell, and the denial one mounts later in
                 the DOM at the same stacking level, so it paints on top. Do not
                 give either a custom z-index without checking the other.
              revert: delete these three lines. */}
          <FlexManageButton />
        </div>

        {/* [FIX-20260907-GALLERYREFRESHVISIBLE] Pressing refresh DID refetch —
            proven by a mutation that removed the call and turned a case red —
            but nothing on screen said so, so it read as a dead button. The
            picker's own `flex-card-loading` line is rendered BEHIND this modal
            and is invisible while it is open. The status belongs where the
            person pressing the button is looking.
            ⚠️ It also reports the count AFTER the fetch: a refresh that returns
               the same list is a real answer, and "nothing happened" is exactly
               what the admin was unsure about. */}
        {loading ? (
          <p
            className="py-2 text-center text-xs text-slate-600"
            data-testid="flex-gallery-loading"
          >
            {t('broadcast.flex_pick_loading')}
          </p>
        ) : (
          <p
            className="py-2 text-center text-xs text-slate-500"
            data-testid="flex-gallery-count"
          >
            {String(shown.length)} / {String(cards.length)}
          </p>
        )}

        {shown.length === 0 ? (
          <p
            className="py-10 text-center text-sm text-slate-500"
            data-testid="flex-gallery-empty"
          >
            {t('broadcast.flex_pick_empty')}
          </p>
        ) : (
          /* Two across, as required. `max-h` + scroll keeps the modal from growing
             past the viewport once the library has fifty cards in it. */
          <div
            data-testid="flex-gallery-grid"
            /* `items-start` because tiles no longer share a height — see
               [UI-20260907-GALLERYFITCARD]. Without it a short card is stretched
               to match the tallest one in its row and gets a band of empty grey. */
            className="grid max-h-[60vh] grid-cols-1 items-start gap-4 overflow-y-auto custom-scrollbar p-0.5 sm:grid-cols-2"
          >
            {shown.map(card => {
              const picked = String(card.id) === String(value ?? '');
              return (
                <button
                  key={card.id}
                  type="button"
                  data-testid={`flex-gallery-card-${card.id}`}
                  aria-pressed={picked}
                  /* [FEAT-20260907-GALLERYPICKCONFIRM] ASK FIRST. The click no
                     longer binds anything — it opens a confirm dialog naming the
                     card. The binding itself is unchanged and still happens in
                     one place, below. */
                  onClick={() => setPending(card)}
                  className={`group relative flex flex-col overflow-hidden rounded-2xl bg-dark-800 text-left ring-1 transition-all hover:-translate-y-0.5 ${
                    picked
                      ? 'ring-2 ring-primary-500 shadow-lg'
                      : 'ring-slate-200/80 hover:ring-primary-300'
                  }`}
                >
                  {/* [UI-20260907-GALLERYFITCARD] NO fixed height and NO inner
                      scroll. The card must fit and show in full —
                      a 260px box with `overflow-y-auto` meant every tall card
                      was cut off with a scrollbar inside a tile the admin was
                      supposed to be judging at a glance. The box now grows to
                      whatever the card is, so a tall card makes a tall tile.
                      ⚠️ Tiles therefore have DIFFERENT heights; the grid uses
                         `items-start` so they sit at the top instead of being
                         stretched to match the tallest one in the row.
                      ⚠️ `overflow-x-hidden` stays: `FlexBubble` is 300px wide
                         from the flex-render stylesheet (210px at this zoom) and
                         fits, but a card that declares its own wider layout must
                         not push the grid sideways. Vertically nothing clips —
                         there is no height to clip against.
                      revert: `h-[260px] overflow-y-auto custom-scrollbar`. */}
                  {/* [UI-20260907-GALLERYHOVERPICK] Hovering blurs the card and
                      floats "เลือกการ์ดใบนี้" over the middle of it.
                      🔴 IT IS A <span>, NOT A <button>. The tile itself is already
                         the button; a button inside a button is invalid HTML,
                         React warns about it and keyboard order breaks — the same
                         trap `FlexCardCarousel` documents at the top of its tile.
                         So this is a LABEL that looks like a control, and the
                         click it appears to take is the tile's own.
                      ⚠️ `pointer-events-none` for the same reason: it must never
                         swallow the click it is advertising.
                      ⚠️ The blur is on the CARD box below, not on this overlay —
                         blurring a parent blurs its children too, and the label
                         would come out fuzzy. */}
                  <div className="pointer-events-none absolute inset-x-0 top-0 bottom-[52px] z-10 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <span className="rounded-full bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-600/30">
                      {t('broadcast.flex_pick_this_card')}
                    </span>
                  </div>
                  <div className="flex w-full items-start justify-center overflow-x-hidden bg-dark-900/60 p-2 transition-all duration-150 group-hover:blur-[3px]">
                    {canRenderFlex(card.content_json) ? (
                      <div style={{ zoom: GALLERY_ZOOM }}>
                        <FlexBubble json={card.content_json} />
                      </div>
                    ) : (
                      /* Not blank, and not a lie: the card exists and is
                         selectable, this renderer just cannot draw it. */
                      <span
                        className="self-center px-3 text-center text-xs text-amber-600"
                        data-testid="flex-gallery-unrenderable"
                      >
                        {t('flex.row_preview_unsupported')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 border-t border-dark-700 px-3 py-2.5">
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900"
                      title={card.name}
                    >
                      {card.name}
                    </span>
                    {picked && <Check size={16} className="shrink-0 text-primary-600" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        {/* [UI-20260907-GALLERYNOCLEAR] The "ล้างค่า" button was here and the
            Explicitly required.
            🔴 SAY WHAT THAT COSTS: the dropdown this gallery replaced was
               `clearable`, so a campaign could be put back to having NO flex
               card from the screen. It cannot any more — the only way out of a
               chosen card is choosing a different one, or switching the message
               type away from flex. Nothing about the stored value changed:
               `onSelect(null)` is still what the picker forwards, there is just
               no control that calls it.
            revert: restore the button below `data-testid="flex-gallery-clear"`
            and the "clearing still yields null" case in
            `test/flexGallery.dom.test.tsx`. */}
        <button
          type="button"
          data-testid="flex-gallery-close"
          onClick={onClose}
          className="rounded-lg border border-dark-600 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-dark-700"
        >
          {t('common.close')}
        </button>
      </Modal.Footer>

      {/* [FEAT-20260907-GALLERYPICKCONFIRM] The one place the card is actually
          bound. The tiles only propose; this confirms.
          🔴 STILL THE SAME CALL — `onSelect(card.id)`, exactly what the tile used
             to do and exactly what the dropdown did before that. The dialog adds
             a step for the person, not a step for the data.
          ⚠️ `ConfirmModal` is the app's own shell, not a hand-rolled overlay, and
             it renders after this modal at the same stacking level so it paints
             on top of the gallery. Do not give it a custom z-index. */}
      <ConfirmModal
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          onSelect(pending.id);
          setPending(null);
          onClose();
        }}
        title={t('broadcast.flex_pick_confirm_title')}
        message={`${t('broadcast.flex_pick_confirm_body')}\n\n${pending?.name ?? ''}`}
        /* [UI-20260907-CONFIRMBLUETONE] blue header, blue confirm —
           not red. `info` supplies the blue header; `confirmTone` is what makes
           the BUTTON blue without recolouring the dozen other `type="info"`
           dialogs in the app. Choosing a card is not a destructive action, so
           the red danger styling was wrong for it anyway. */
        type="info"
        confirmTone="blue"
      />
    </Modal>
  );
};

export default FlexGalleryModal;
