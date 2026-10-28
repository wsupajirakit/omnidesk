// [FEAT-20260905-MEDIAPICKER] Media item list view inside an album with Kind Filter (VDO/IMG), Search, Date Sort, and Link Copying.
import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  Film,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type {
  MediaPickerAlbumItem,
  MediaPickerGridDensity,
  MediaPickerKindFilter,
  MediaPickerMediaItem,
  MediaPickerPagination,
  MediaPickerSortOrder,
} from './types';
import { listMediaPickerItems } from '../../services/media/mediaPickerService';
import {
  copyMediaLinkToClipboard,
  formatFileSize,
  formatMediaDate,
  resolveAbsoluteMediaUrl,
} from './mediaPickerUtils';
import { MediaPreviewModal } from './MediaPreviewModal';
import { MediaThumbnail } from './MediaThumbnail';
import { GridDensityToggle } from './GridDensityToggle';
import { useI18n } from '../../i18n';

export interface MediaItemListViewProps {
  album: MediaPickerAlbumItem;
  onBackToAlbums: () => void;
  onSelectMedia?: (media: MediaPickerMediaItem) => void;
  onNotifyCopied?: (url: string) => void;
  isDocked?: boolean;
  initialDensity?: MediaPickerGridDensity;
  onToast?: (message: string) => void;
  /**
   * [FEAT-20260907-IMAGEONLYPICKER] Lock the view to ONE media kind and hide the
   * kind pills.
   *
   * WHY: the broadcast form's image message accepts an image URL and nothing
   * else, so a picker that can hand back a video is offering a value the field
   * cannot use. "images only, and do not disturb the flex picker".
   *
   * 🔴 OPTIONAL, AND THAT IS THE WHOLE SAFETY OF IT. Not passing it leaves
   *    `kindFilter` starting at `'all'` with all three pills rendered — exactly
   *    today's behaviour — so `components/flex/FlexMessageFormModal.tsx`, the
   *    only caller that exists, is byte-identical. ไม่ส่ง = เหมือนเดิมทุกประการ.
   *
   * ⚠️ It LOCKS, it does not merely preselect: the pills are hidden, because a
   *    pill row where two of three choices are gone reads as broken.
   */
  lockKind?: 'image' | 'video';
  /**
   * [FEAT-20260907-USETHISIMAGE] What the tile's PRIMARY button does.
   *
   *  · `'copy'` (default, and what happens when the prop is absent) — the button
   *    copies the link to the clipboard, exactly as it always has.
   *  · `'use'`  — the button reads "ใช้ภาพนี้" and hands the item straight to
   *    `onSelectMedia`. The broadcast form's image field wants the URL IN the
   *    input, so asking somebody to copy and then paste is a step for nothing.
   *
   * 🔴 `'use'` DOES NOT TOUCH THE CLIPBOARD. `handleCopy` only calls
   *    `onSelectMedia` when the copy SUCCEEDED (`if (ok)`), and `copyText` can
   *    fail — the local stack is plain http, where the async Clipboard API does
   *    not exist and only the `execCommand` fallback is left. Routing insertion
   *    through that would make "attach" silently do nothing on exactly the setup
   *    it is being tested on. แทรกค่าต้องไม่ผูกกับ clipboard.
   *
   * 🔴 Optional. Absent = `'copy'` = byte-identical for
   *    `components/flex/FlexMessageFormModal.tsx`, the only other caller.
   */
  selectAction?: 'copy' | 'use';
}

export const MediaItemListView: React.FC<MediaItemListViewProps> = ({
  album,
  onBackToAlbums,
  onSelectMedia,
  onNotifyCopied,
  isDocked = false,
  initialDensity = '4x2',
  onToast,
  lockKind,
  selectAction = 'copy',
}) => {
  const { t } = useI18n();
  const [localToast, setLocalToast] = useState<string | null>(null);

  const handleLocalToast = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => setLocalToast(null), 2500);
  };

  // [FEAT-20260905-DENSITY] Density options 2x2, 4x2, 6x2 with default 4x2
  const [gridDensity, setGridDensity] = useState<MediaPickerGridDensity>(initialDensity);
  const [items, setItems] = useState<MediaPickerMediaItem[]>([]);
  const [pagination, setPagination] = useState<MediaPickerPagination>({
    page: 1,
    limit: 12,
    total: 0,
    total_pages: 1,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter, Search & Sort state
  // [FEAT-20260905-MEDIAPICKER] Filter pills shown AFTER clicking into an album (filter vdo / img / all)
  /* [FEAT-20260907-IMAGEONLYPICKER] `lockKind` seeds this and the pills below
     are not rendered when it is set. Unset = `'all'`, as before. */
  const [kindFilter, setKindFilter] = useState<MediaPickerKindFilter>(lockKind ?? 'all');
  const [searchInput, setSearchInput] = useState<string>('');
  const [appliedSearch, setAppliedSearch] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<MediaPickerSortOrder>('desc');
  const [page, setPage] = useState<number>(1);

  // Copied feedback map: key is item ID
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Preview Modal state
  const [previewItem, setPreviewItem] = useState<MediaPickerMediaItem | null>(null);

  // Debounce search input - [FIX-20260905-SEARCHLEN] Require >= 4 chars to prevent server bottleneck
  useEffect(() => {
    const trimmed = searchInput.trim();
    const timer = setTimeout(() => {
      if (trimmed.length === 0) {
        if (appliedSearch !== '') {
          setAppliedSearch('');
          setPage(1);
        }
      } else if (trimmed.length >= 4) {
        setAppliedSearch(trimmed);
        setPage(1);
      }
      // If 1-3 chars, do not fire search query
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput, appliedSearch]);

  // Load items from central API with append support for Load More
  const loadItems = async (
    targetPage = 1,
    targetKind = kindFilter,
    targetSort = sortOrder,
    targetSearch = appliedSearch,
    isAppend = false,
  ) => {
    if (isAppend) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await listMediaPickerItems({
        album_id: String(album.id),
        page: targetPage,
        limit: 12,
        media_kind: targetKind,
        search: targetSearch,
        sort: targetSort,
      });
      if (isAppend) {
        setItems((prev) => {
          const existingIds = new Set(prev.map((it) => String(it.id)));
          const newItems = (res.data || []).filter((it) => !existingIds.has(String(it.id)));
          return [...prev, ...newItems];
        });
      } else {
        setItems(res.data || []);
      }
      setPagination(res.pagination);
      setPage(targetPage);
    } catch (err: any) {
      setError(err?.message || t('media_picker.load_item_error'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadItems(1, kindFilter, sortOrder, appliedSearch, false);
  }, [kindFilter, sortOrder, appliedSearch]);

  const handleKindChange = (kind: MediaPickerKindFilter) => {
    setKindFilter(kind);
  };

  const toggleSort = () => {
    const nextSort: MediaPickerSortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    setSortOrder(nextSort);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setAppliedSearch('');
    setPage(1);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadItems(1, kindFilter, sortOrder, appliedSearch, false);
    } finally {
      // Visually keep round animation for at least 600ms
      setTimeout(() => setIsRefreshing(false), 600);
    }
  };

  const handleLoadMore = () => {
    if (loading || loadingMore || items.length >= pagination.total) return;
    loadItems(page + 1, kindFilter, sortOrder, appliedSearch, true);
  };

  const handleCopy = async (item: MediaPickerMediaItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const ok = await copyMediaLinkToClipboard(item.image_url);
    if (ok) {
      setCopiedId(String(item.id));
      const fullUrl = resolveAbsoluteMediaUrl(item.image_url);
      if (onNotifyCopied) onNotifyCopied(fullUrl);
      if (onSelectMedia) onSelectMedia(item);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const searchTrimmed = searchInput.trim();
  const showMinCharsHint = searchTrimmed.length > 0 && searchTrimmed.length < 4;
  const hasMore = items.length < pagination.total;

  const isDense = gridDensity === '6x2';
  const isMedium = gridDensity === '4x2';

  const getGridColsClass = () => {
    switch (gridDensity) {
      case '2x2':
        return 'grid grid-cols-2 gap-3 p-1';
      case '4x2':
        return isDocked
          ? 'grid grid-cols-2 sm:grid-cols-4 gap-2 p-1'
          : 'grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-1';
      case '6x2':
      default:
        return isDocked
          ? 'grid grid-cols-3 sm:grid-cols-6 gap-1.5 p-1'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 p-1';
    }
  };

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Top Header Row: Back button, Album Title, and Kind Filter Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pb-2.5 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBackToAlbums}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 transition-all cursor-pointer shrink-0"
            title={t('media_picker.back_to_albums')}
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">{t('media_picker.back_to_albums')}</span>
          </button>
          <div className="min-w-0">
            <h3
              className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 truncate"
              title={album.detail}
            >
              {album.detail || t('media_picker.untitled_album')}
            </h3>
          </div>
        </div>

        {/* Kind Filters: All / IMG / VDO
            [FEAT-20260907-IMAGEONLYPICKER] hidden when the caller locked the kind.
            A pill row with two of its three choices removed reads as broken, and
            the one remaining pill would say nothing the caller does not already
            know. `lockKind` unset renders this exactly as before. */}
        {!lockKind && (
        <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => handleKindChange('all')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              kindFilter === 'all'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {t('media_picker.filter_all')}
          </button>
          <button
            type="button"
            onClick={() => handleKindChange('image')}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              kindFilter === 'image'
                ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ImageIcon size={13} />
            {t('media_picker.filter_image')}
          </button>
          <button
            type="button"
            onClick={() => handleKindChange('video')}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              kindFilter === 'video'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Film size={13} />
            {t('media_picker.filter_video')}
          </button>
        </div>
        )}
      </div>

      {/* Search Bar, Date Sort, Density and Refresh */}
      <div
        className={`flex flex-col gap-2.5 ${
          !isDocked ? 'sm:flex-row sm:items-center sm:justify-between' : ''
        }`}
      >
        {/* Search within album */}
        <div className={`relative ${isDocked ? 'w-full' : 'flex-1 max-w-md'}`}>
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('media_picker.search_item_placeholder')}
            className="w-full pl-9 pr-24 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
          />
          {showMinCharsHint && (
            <div className="absolute right-8 top-1/2 -translate-y-1/2 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/80 px-1.5 py-0.5 rounded-md pointer-events-none whitespace-nowrap">
              {t('media_picker.search_min_chars_hint', { count: 4 - searchTrimmed.length })}
            </div>
          )}
          {searchInput && (
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label={t('media_picker.clear_search')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Action Controls: Date Sort, Grid Density & Prominent Animated Refresh */}
        <div className={`flex items-center gap-1.5 ${isDocked ? 'w-full' : 'self-end sm:self-auto'}`}>
          <button
            type="button"
            onClick={toggleSort}
            className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-all cursor-pointer ${
              isDocked ? 'flex-1 justify-center' : ''
            }`}
            title={t('media_picker.sort_tooltip')}
          >
            <ArrowUpDown size={14} className="text-indigo-500 shrink-0" />
            <span className="truncate">
              {isDocked
                ? sortOrder === 'desc'
                  ? t('pageui.media.sort_newest_short', 'ล่าสุด')
                  : t('pageui.media.sort_oldest_short', 'เก่าสุด')
                : sortOrder === 'desc'
                ? t('media_picker.sort_date_newest')
                : t('media_picker.sort_date_oldest')}
            </span>
          </button>

          {/* [FEAT-20260905-DENSITY-TOGGLE] Single Animated Grid Density Toggle Button with Toast */}
          <GridDensityToggle
            density={gridDensity}
            onChange={setGridDensity}
            onToast={onToast || handleLocalToast}
          />

          {/* [UI-20260905-REFRESH] Prominent Refresh Button with Label and animated round */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || isRefreshing}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-2 border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 shadow-xs disabled:opacity-50 transition-all cursor-pointer active:scale-95 shrink-0 ${
              isRefreshing ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700' : ''
            }`}
            title={t('media_picker.refresh_tooltip')}
          >
            <RefreshCw
              size={14}
              className={`text-indigo-600 dark:text-indigo-400 stroke-[2.2] transition-transform duration-500 ${
                isRefreshing || loading ? 'animate-spin' : ''
              }`}
            />
            <span className="hidden sm:inline">{t('media_picker.refresh_btn')}</span>
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={handleRefresh}
            className="font-bold underline ml-2 cursor-pointer"
          >
            {t('media_picker.retry')}
          </button>
        </div>
      )}

      {/* Local Toast Alert fallback when no parent toast container */}
      {localToast && !onToast && (
        <div
          role="status"
          aria-live="polite"
          className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs flex items-center justify-between shadow-xs animate-fadeIn shrink-0"
        >
          <span className="font-semibold">{localToast}</span>
          <button
            type="button"
            onClick={() => setLocalToast(null)}
            className="text-indigo-500 hover:text-indigo-700 p-0.5 cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Media Cards Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && items.length === 0 ? (
          /* Loading Skeletons */
          <div className={getGridColsClass()}>
            {Array.from({ length: isDense ? 12 : isMedium ? 8 : 6 }).map((_, i) => (
              <div
                key={i}
                className={`animate-pulse flex flex-col rounded-2xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-2 ${
                  isDense ? 'p-1.5' : isMedium ? 'p-2' : 'p-2.5'
                }`}
              >
                <div className="w-full aspect-square bg-slate-200 dark:bg-slate-700 rounded-xl" />
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-3/4" />
                {!isDense && <div className="h-2.5 bg-slate-200 dark:bg-slate-700 rounded w-1/2" />}
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          /* Empty State */
          <div className="h-full min-h-[260px] flex flex-col items-center justify-center p-8 text-center text-slate-400">
            {kindFilter === 'video' ? (
              <Film size={48} className="mb-3 text-slate-300 dark:text-slate-600 stroke-[1.5]" />
            ) : (
              <ImageIcon size={48} className="mb-3 text-slate-300 dark:text-slate-600 stroke-[1.5]" />
            )}
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {appliedSearch
                ? t('media_picker.no_items_match', { search: appliedSearch })
                : kindFilter === 'video'
                ? t('media_picker.no_videos')
                : kindFilter === 'image'
                ? t('media_picker.no_images')
                : t('media_picker.no_items')}
            </p>
            {appliedSearch && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="mt-3 text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 cursor-pointer"
              >
                {t('media_picker.clear_search')}
              </button>
            )}
          </div>
        ) : (
          /* Cards Grid */
          <div className={getGridColsClass()}>
            {items.map((item) => {
              const isVideo = item.media_kind === 'video';
              const isCopied = copiedId === String(item.id);

              return (
                <div
                  key={String(item.id)}
                  className={`group relative flex flex-col bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-lg transition-all duration-200 overflow-hidden ${
                    isDense ? 'p-1.5' : isMedium ? 'p-2' : 'p-2.5'
                  }`}
                >
                  {/* Media Visual Container: Clicking thumbnail directly opens preview player */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setPreviewItem(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPreviewItem(item);
                      }
                    }}
                    className="relative w-full aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center cursor-pointer select-none group/thumb"
                    title={isVideo ? t('pageui.media.play_video_tip', 'คลิกเพื่อเล่นวิดีโอ (Preview Player)') : t('media_picker.preview')}
                  >
                    <MediaThumbnail
                      url={item.image_url}
                      mediaKind={isVideo ? 'video' : 'image'}
                      alt={item.detail_text || ''}
                      density={gridDensity}
                      containerClassName="w-full h-full"
                    />

                    {/* Top Badges Bar: Scaled for 4x2 and 6x2 so they never overlap or bloat */}
                    <div
                      className={`absolute inset-x-1 flex items-center justify-between gap-1 pointer-events-none z-10 ${
                        isDense ? 'top-1' : isMedium ? 'top-1.5' : 'top-2'
                      }`}
                    >
                      {/* Left: Video Badge */}
                      <div className="flex items-center min-w-0">
                        {isVideo && (
                          <span
                            className={`inline-flex items-center rounded-md bg-purple-600/90 text-white font-bold shadow-xs backdrop-blur-xs leading-none shrink-0 ${
                              isDense
                                ? 'p-0.5 text-[6.5px]'
                                : isMedium
                                ? 'px-1 py-0.5 text-[7px] gap-0.5'
                                : 'px-1.5 py-0.5 text-[9.5px] gap-1'
                            }`}
                          >
                            <Film size={isDense ? 6.5 : isMedium ? 7 : 10} />
                            {!isDense && <span>{t('media_picker.vdo_badge')}</span>}
                          </span>
                        )}
                      </div>

                      {/* Right: File Size badge */}
                      {item.file_size > 0 && (
                        <span
                          className={`rounded-md bg-black/60 text-white font-medium backdrop-blur-xs shadow-xs leading-none shrink-0 truncate max-w-[60%] text-right ${
                            isDense
                              ? 'px-0.5 py-0.5 text-[6.5px]'
                              : isMedium
                              ? 'px-1 py-0.5 text-[7px]'
                              : 'px-1.5 py-0.5 text-[9.5px]'
                          }`}
                        >
                          {formatFileSize(item.file_size)}
                        </span>
                      )}
                    </div>

                    {/* Center Overlay Preview button on Hover for images */}
                    {!isVideo && (
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                        <span className="p-1.5 rounded-full bg-white/90 text-slate-800 shadow-md">
                          <Eye size={isDense ? 12 : isMedium ? 15 : 18} />
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Caption, Date and Copy Action */}
                  <div className="flex-1 flex flex-col justify-between mt-1.5">
                    <div>
                      <h4
                        className={`font-bold text-slate-800 dark:text-slate-100 truncate ${
                          isDense ? 'text-[10px]' : isMedium ? 'text-[11px]' : 'text-xs'
                        }`}
                        title={item.detail_text || ''}
                      >
                        {item.detail_text || (isVideo ? t('media_picker.untitled_video') : t('media_picker.untitled_image'))}
                      </h4>
                      <p
                        className={`text-slate-400 flex items-center gap-1 ${
                          isDense ? 'text-[9px] mt-0.5 hidden sm:flex' : 'text-[11px] mt-0.5'
                        }`}
                      >
                        <Calendar size={isDense ? 9 : 11} />
                        <span className="truncate">{formatMediaDate(item.created_at)}</span>
                      </p>
                    </div>

                    {/* Action Bar: Copy Link Button */}
                    <div
                      className={`border-t border-slate-100 dark:border-slate-700/60 flex items-center gap-1 ${
                        isDense ? 'mt-1.5 pt-1.5' : 'mt-2 pt-2'
                      }`}
                    >
                      <button
                        type="button"
                        /* [FEAT-20260907-USETHISIMAGE] `use` inserts, `copy` copies.
                           The insert path deliberately skips the clipboard — see
                           the note on the `selectAction` prop. */
                        onClick={(e) => {
                          if (selectAction === 'use') {
                            e.stopPropagation();
                            if (onSelectMedia) onSelectMedia(item);
                            return;
                          }
                          void handleCopy(item, e);
                        }}
                        aria-label={
                          selectAction === 'use'
                            ? t('media_picker.use_image')
                            : t('media_picker.copy_link')
                        }
                        data-testid={
                          selectAction === 'use'
                            ? `media-use-${String(item.id)}`
                            : `media-copy-${String(item.id)}`
                        }
                        className={`flex-1 inline-flex items-center justify-center gap-1 rounded-xl font-bold transition-all shadow-xs cursor-pointer ${
                          isDense ? 'py-1 px-1 text-[10px]' : 'py-1.5 px-2 text-[11px]'
                        } ${
                          isCopied
                            ? 'bg-emerald-600 text-white'
                            : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                        }`}
                        title={
                          selectAction === 'use'
                            ? t('media_picker.use_image')
                            : t('media_picker.copy_action')
                        }
                      >
                        {isCopied ? <Check size={isDense ? 10 : 12} /> : <Copy size={isDense ? 10 : 12} />}
                        <span className="truncate">
                          {selectAction === 'use'
                            ? t('media_picker.use_image')
                            : isCopied
                            ? t('media_picker.copied')
                            : isDense
                            ? t('pageui.media.copy_short', 'คัดลอก')
                            : t('media_picker.copy_link')}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPreviewItem(item)}
                        className={`rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer ${
                          isDense ? 'p-1' : 'p-1.5'
                        }`}
                        title={t('media_picker.preview')}
                      >
                        <Eye size={isDense ? 11 : 13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* [FEAT-20260905-LOADMORE] Load More Button */}
        {hasMore && (
          <div className="flex flex-col items-center justify-center py-4 gap-1.5">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore || loading}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white shadow-sm hover:shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {loadingMore ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>{t('media_picker.loading_more')}</span>
                </>
              ) : (
                <>
                  <ChevronDown size={16} />
                  <span>
                    {t('media_picker.load_more')} ({pagination.total - items.length}{' '}
                    {t('media_picker.items_remaining', { count: pagination.total - items.length })})
                  </span>
                </>
              )}
            </button>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {t('media_picker.showing_elements', { current: items.length, total: pagination.total })}
            </span>
          </div>
        )}

        {!hasMore && items.length > 0 && (
          <div className="py-3 text-center text-xs text-slate-400 dark:text-slate-500 select-none">
            {t('media_picker.all_loaded', { total: pagination.total })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <div>
          {t('media_picker.showing_elements', { current: items.length, total: pagination.total })}
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore || loading}
            className="font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 cursor-pointer inline-flex items-center gap-1"
          >
            <ChevronDown size={14} />
            <span>{t('media_picker.load_more')}</span>
          </button>
        )}
      </div>

      {/* Media Preview Lightbox Modal */}
      {previewItem && (
        <MediaPreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onCopySuccess={(url) => {
            if (onNotifyCopied) onNotifyCopied(url);
          }}
        />
      )}
    </div>
  );
};
