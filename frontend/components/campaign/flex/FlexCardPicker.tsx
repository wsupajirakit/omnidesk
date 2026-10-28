/**
 * [FEAT-20260824-BCASTFLEXID] Pick the card this campaign sends, from the library.
 * ===========================================================================
 * Owner, 24/08: *"flex id ใช้ส่ง ไม่ใช่ กรอกดิบ"* · *"บอกให้ผูก flex id จำไม่ได้หรอ
 * + มี preview"*.
 *
 * 🔴 IT HANDS UP AN ID, NEVER A COPY. The campaign stores WHICH card, so a fix
 *    made in the card library reaches every campaign pointing at it. Pasting
 *    JSON gave each job a private snapshot that silently went stale.
 *    เก็บ id ไม่เก็บสำเนา ⇒ แก้การ์ดที่ต้นทาง job เดิมตามด้วย.
 *
 * 🔴 ITS OWN FILE FROM THE START. `BroadcastFormModal.tsx` is 1,098 lines —
 *    past the 400-line cap — and the anti-bloat rule (dev-local §6.1) says the
 *    waiver list may only shrink. `campaign/flex/` is the role folder, beside
 *    `campaign/preview/` and `campaign/history/`.
 *    ฟอร์มแม่เกินเพดานแล้ว ของใหม่แยกไฟล์ตั้งแต่แรก ห้ามยัด.
 *
 * ⚠️ REUSES `flexMessageService.listFlexMessages` — the same endpoint the card
 *    library page reads, with the same group scoping, so an admin sees exactly
 *    the cards they are allowed to send. No new service, no second list shape.
 *
 * revert: delete this file and put the `message_flex` textarea back.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { flexMessageService } from '../../../services/media/flexMessageService';
/* [FIX-20260824-FLEXPICKSEARCH] REUSE, ไม่สร้างใหม่ — repo มี combobox ที่ค้นหาได้
   อยู่แล้วที่ `components/common/SearchableSelect.tsx` (มีช่องค้นหาในตัว · เลื่อนด้วย
   คีย์บอร์ด · ปุ่มล้างค่า) รอบแรกผมใช้ <select> ธรรมดา + ช่องค้นหาแยกซึ่งโผล่เฉพาะตอน
   การ์ดเกิน 10 ใบ — คนละเรื่องกับ combobox จริง และเป็นการทำซ้ำของที่มีอยู่ */
/* [FEAT-20260907-FLEXGALLERY] the gallery replaced the combobox — see the block
   comment at the trigger button. `SearchableSelect` is no longer used here. */
import { LayoutGrid } from 'lucide-react';
import { FlexGalleryModal } from './FlexGalleryModal';
/* [FEAT-20260907-FLEXPICKREFRESH] the label + refresh button live beside this
   file, in the same role folder — see that file's header for why. */
import { FlexCardPickerHeader } from './FlexCardPickerHeader';
import { useI18n } from '../../../i18n';
import type { FlexMessageEntry } from '../../../types';

/** How many cards one page of the picker asks for. */
export const PICKER_PAGE_SIZE = 50;

/**
 * [FEAT-20260907-FLEXPICKREFRESH] How close together two reload triggers have to
 * be before the second is treated as the same gesture.
 *
 * Not a cache and not a throttle on the admin: it exists because opening the
 * modal, arriving on the step and opening the dropdown are three separate
 * triggers that a single click can set off within a few hundred milliseconds.
 * The refresh button ignores it. 1.5s is short enough that nobody can edit a
 * card in another tab and come back inside it.
 */
export const COALESCE_MS = 1_500;

export interface FlexCardPickerProps {
  /** The id currently saved on the job. `null`/`''` = nothing picked yet. */
  readonly value?: string | null;
  /** Hands up the chosen id, or `null` when the admin clears the choice. */
  readonly onChange: (flexId: string | null) => void;
  /**
   * The card body, so the parent can preview WHAT WAS PICKED without fetching
   * it a second time. `null` when nothing is selected.
   *
   * ⚠️ For DISPLAY only. The body that actually ships is fetched by the backend
   * at send time from the id — never from anything this component passed up.
   * ตัวที่ส่งจริงคือ BE ดึงจาก id เอง ค่านี้ใช้โชว์เท่านั้น.
   */
  readonly onPreviewChange?: (contentJson: unknown | null) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly className?: string;
  /**
   * [FEAT-20260907-FLEXPICKREFRESH] Is the wizard step this picker lives on
   * VISIBLE right now?
   *
   * 🔴 A PROP RATHER THAN SOMETHING THIS FILE COULD WORK OUT. The step panes
   *    hide with `hidden`, they do NOT unmount (`BroadcastStepper.tsx` documents
   *    why — unmounting would wipe every child's state), so no effect in here
   *    re-runs when the admin walks onto the step. The parent is the only thing
   *    that knows, and it asks `isStepVisible` so there is one formula.
   *    The pane hides without unmounting, so the picker cannot know by itself.
   *
   * Defaults to `true` so a caller that renders this outside the wizard behaves
   * exactly as before this prop existed.
   */
  readonly active?: boolean;
  /**
   * [FEAT-20260907-FLEXTOOLROW] Extra tools for the label row, rendered after
   * the refresh button. Owner, 07/09: "จัดการ flex message" and "ดูตัวอย่าง"
   * belong up here with refresh, at one size, in that order.
   *
   * ⚠️ Opaque on purpose. The picker forwards the node and reads nothing from
   *    it, so it stays a picker — the form keeps owning the permission check and
   *    the preview modal. Passing handlers instead would move both into here.
   */
  readonly headerActions?: React.ReactNode;
}

export const FlexCardPicker: React.FC<FlexCardPickerProps> = ({
  value,
  onChange,
  onPreviewChange,
  disabled = false,
  invalid = false,
  className = '',
  active = true,
  headerActions
}) => {
  const { t } = useI18n();
  const [cards, setCards] = useState<FlexMessageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* [FEAT-20260907-FLEXGALLERY] whether the picker's gallery is open. Local on
     purpose: nothing outside this component has any business knowing, and the
     selected id — the only thing that matters to the campaign — still lives
     entirely in the parent's `value`/`onChange` pair. */
  const [galleryOpen, setGalleryOpen] = useState(false);

  /* Alive across renders, not state: changing these must never re-render. */
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const lastLoadedAt = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * [FEAT-20260907-FLEXPICKREFRESH] Ask the library again.
   *
   * 🔴 FOUR THINGS CALL THIS, AND THEY CAN FIRE TOGETHER. Owner, 07/09: the
   *    list must be current when the modal opens, when the admin reaches this
   *    step, and when the dropdown is opened — plus the refresh button. Opening
   *    the modal already on step 2 and clicking the select does all three within
   *    a few hundred milliseconds, so without the two guards below one click
   *    becomes three identical requests, so the duplicates must be guarded.
   *
   *   · `inFlight` — never start a second request while one is running
   *   · `COALESCE_MS` — ignore a trigger that lands right after a completed
   *     fetch, because nobody edits the card library in that window. The
   *     refresh BUTTON bypasses it (`force`): a person who presses refresh is
   *     telling us the stored answer is wrong, and refusing them would look
   *     broken — a refresh button that does nothing reads as a dead button.
   *
   * ⚠️ `mounted` replaces the old per-effect `alive` flag for the same reason it
   *    existed: a slow first response must never overwrite a newer list, and a
   *    response arriving after the modal closed must not set state at all.
   */
  const reload = useCallback(
    (opts: { readonly force?: boolean } = {}) => {
      if (inFlight.current) return;
      if (
        !opts.force &&
        lastLoadedAt.current > 0 &&
        Date.now() - lastLoadedAt.current < COALESCE_MS
      ) {
        return;
      }
      inFlight.current = true;
      setLoading(true);
      setLoadError(null);
      flexMessageService
        .listFlexMessages({ page: 1, limit: PICKER_PAGE_SIZE })
        .then(res => {
          if (!mounted.current) return;
          setCards(Array.isArray(res?.data) ? res.data : []);
        })
        .catch((e: unknown) => {
          if (!mounted.current) return;
          /* 🔴 SAY SO. An empty dropdown with no message reads as "there are no
             cards", and an admin would go and create a duplicate. A failed fetch
             and an empty library are different facts.
             A failed fetch is not an empty library; say which one it is. */
          setLoadError(e instanceof Error ? e.message : String(e));
          setCards([]);
        })
        .finally(() => {
          inFlight.current = false;
          lastLoadedAt.current = Date.now();
          if (mounted.current) setLoading(false);
        });
    },
    [],
  );

  /* Trigger 1 — the modal opened. The form returns `null` while closed, so this
     component really does remount each time (`BroadcastFormModal.tsx:894`);
     this is the fetch that has always been here. */
  useEffect(() => {
    reload();
  }, [reload]);

  /* Trigger 2 — the admin walked onto this step. Fires on the false → true edge
     only; `reload` coalesces if the mount fetch just happened. */
  useEffect(() => {
    if (active) reload();
  }, [active, reload]);

  const selected = useMemo(
    () => cards.find(c => String(c.id) === String(value ?? '')) ?? null,
    [cards, value]
  );

  /* Push the picked body up for preview whenever the selection resolves. */
  useEffect(() => {
    if (!onPreviewChange) return;
    onPreviewChange(selected ? (selected.content_json ?? null) : null);
  }, [selected, onPreviewChange]);

  /* [FEAT-20260907-FLEXGALLERY] Two dead blocks were removed here with the
     dropdown: the `SelectOption[]` builder, which had no reader once the
     combobox went, and `selectClass`, which had ALREADY had no reader before
     today — the select was styled by its own `className` prop. Neither is
     needed by the gallery, which renders cards, not rows.
     ⚠️ The id is still shown to the admin: it is printed under the field
        (`flex-card-id` below), which is where it was, and the gallery tile shows
        the name. The reason that id is visible has not changed — a failed send
        names it and somebody has to be able to read it off the screen. */

  return (
    <div className={className} data-testid="flex-card-picker">
      {/* [FEAT-20260907-FLEXPICKREFRESH] the label + the refresh button, in the
          own file that owns that markup — trigger 4 of the four reloads */}
      <FlexCardPickerHeader
        onRefresh={() => reload({ force: true })}
        busy={loading}
        disabled={disabled}
        /* [FEAT-20260907-FLEXTOOLROW] "จัดการ flex message" and "ดูตัวอย่าง" ride
           along on the label row. Passed straight through — the picker does not
           read them, so it never learns what a permission or a preview is. */
        actions={headerActions}
      />
      {/* [FEAT-20260907-FLEXGALLERY] The field is now a TRIGGER that opens the
          gallery, not a dropdown. Owner, 07/09: pick the card by looking at it.
          🔴 THE SELECTION PATH IS UNCHANGED. This trigger holds no value of its
             own — it prints `selected?.name` and the gallery calls the same
             `onChange(flexId)` the dropdown called. Nothing about how a card is
             bound to a campaign moved. เปลี่ยนแค่การแสดงผล.
          ⚠️ Opening still RELOADS — the old `onOpen` trigger, kept alive at the
             same moment it used to fire (trigger 3 of four). Losing it here
             would quietly undo the "always shows the latest cards" behaviour.
          ⚠️ `bcast-field` stays: `index.css` uses it to force this control white
             inside the broadcast modal. Dropping it turns the field grey.
          revert: put the <SearchableSelect> block back — it is in this commit. */}
      <button
        type="button"
        data-testid="flex-card-open-gallery"
        disabled={disabled || loading}
        onClick={() => {
          reload();
          setGalleryOpen(true);
        }}
        className={`bcast-field flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          invalid ? 'border-red-500' : 'border-dark-600 hover:border-primary-400'
        }`}
      >
        <span className={selected ? 'truncate text-slate-900' : 'truncate text-slate-400'}>
          {selected ? selected.name : t('broadcast.flex_pick_none')}
        </span>
        <LayoutGrid size={15} className="shrink-0 text-slate-400" />
      </button>

      <FlexGalleryModal
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        cards={cards}
        value={value ?? null}
        /* 🔴 the same call the dropdown made, byte for byte in meaning */
        onSelect={id => onChange(id)}
        onRefresh={() => reload({ force: true })}
        loading={loading}
      />

      {loading && (
        <p className="mt-1 text-xs text-slate-700" data-testid="flex-card-loading">
          {t('broadcast.flex_pick_loading')}
        </p>
      )}

      {loadError && (
        <p className="mt-1 text-xs text-red-400" data-testid="flex-card-error">
          {t('broadcast.flex_pick_failed')}
        </p>
      )}

      {!loading && !loadError && cards.length === 0 && (
        <p className="mt-1 text-xs text-amber-400" data-testid="flex-card-empty">
          {t('broadcast.flex_pick_empty')}
        </p>
      )}

      {/* 🔴 The id is shown, not hidden. When a send fails with "the flex card
          this broadcast points at no longer exists", this is the string an
          admin needs to hand over. ให้เห็น id จริง เวลาพังจะได้บอกต่อได้. */}
      {selected && (
        <p className="mt-1 text-xs text-slate-700" data-testid="flex-card-chosen">
          {t('broadcast.flex_pick_chosen')}: {String(selected.id)}
        </p>
      )}
    </div>
  );
};

export default FlexCardPicker;
