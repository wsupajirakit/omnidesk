import React, { useState, useEffect } from 'react';
import {
  ArrowUpDown,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Film,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type {
  MediaPickerAlbumItem,
  MediaPickerGridDensity,
  MediaPickerPagination,
  MediaPickerSortOrder,
} from './types';
import { listMediaPickerAlbums } from '../../services/media/mediaPickerService';
import { formatMediaDate } from './mediaPickerUtils';
import { MediaThumbnail } from './MediaThumbnail';
import { GridDensityToggle } from './GridDensityToggle';
import { useI18n } from '../../i18n';

export interface AlbumListViewProps {
  onSelectAlbum: (album: MediaPickerAlbumItem) => void;
  isDocked?: boolean;
  initialDensity?: MediaPickerGridDensity;
  onToast?: (message: string) => void;
}

export const AlbumListView: React.FC<AlbumListViewProps> = ({
  onSelectAlbum,
  isDocked = false,
  initialDensity = '4x2',
  onToast,
}) => {
  const { t } = useI18n();
  const [localToast, setLocalToast] = useState<string | null>(null);

  const handleLocalToast = (msg: string) => {
    setLocalToast(msg);
    setTimeout(() => setLocalToast(null), 2500);
  };

  // [FEAT-20260905-DENSITY] Density options 2x2, 4x2, 6x2 with default 4x2
  const [gridDensity, setGridDensity] = useState<MediaPickerGridDensity>(initialDensity);
  const [albums, setAlbums] = useState<MediaPickerAlbumItem[]>([]);
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

  // Search & Sort state
  const [searchInput, setSearchInput] = useState<string>('');
  const [appliedSearch, setAppliedSearch] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<MediaPickerSortOrder>('desc');
  const [page, setPage] = useState<number>(1);

  // Debounce search typing - [FIX-20260905-SEARCHLEN] require >= 4 chars to prevent server bottleneck
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

  // Load albums from central API with append support for Load More
  const loadAlbums = async (
    targetPage = 1,
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
      const res = await listMediaPickerAlbums({
        page: targetPage,
        limit: 12,
        search: targetSearch,
        sort: targetSort,
      });
      if (isAppend) {
        setAlbums((prev) => {
          const existingIds = new Set(prev.map((a) => String(a.id)));
          const newOnes = (res.data || []).filter((a) => !existingIds.has(String(a.id)));
          return [...prev, ...newOnes];
        });
      } else {
        setAlbums(res.data || []);
      }
      setPagination(res.pagination);
      setPage(targetPage);
    } catch (err: any) {
      setError(err?.message || t('media_picker.load_album_error'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadAlbums(1, sortOrder, appliedSearch, false);
  }, [sortOrder, appliedSearch]);

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
      await loadAlbums(1, sortOrder, appliedSearch, false);
    } finally {
      // Visually keep round animation for at least 600ms
      setTimeout(() => setIsRefreshing(false), 600);
    }
  };

  const handleLoadMore = () => {
    if (loading || loadingMore || albums.length >= pagination.total) return;
    loadAlbums(page + 1, sortOrder, appliedSearch, true);
  };

  const searchTrimmed = searchInput.trim();
  const showMinCharsHint = searchTrimmed.length > 0 && searchTrimmed.length < 4;
  const hasMore = albums.length < pagination.total;

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
    <div className="flex flex-col h-full space-y-3.5">
      {/* Top Filter & Toolbar */}
      <div className={`flex flex-col gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800 ${!isDocked ? 'sm:flex-row sm:items-center sm:justify-between' : ''}`}>
        {/* Search Bar */}
        <div className={`relative ${isDocked ? 'w-full' : 'flex-1 max-w-md'}`}>
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('media_picker.search_album_placeholder')}
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

        {/* Action Controls: Date Sort, Grid Density & Refresh */}
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

          {/* [UI-20260905-REFRESH] Prominent Refresh Button with animated round */}
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

      {/* Albums Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && albums.length === 0 ? (
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
        ) : albums.length === 0 ? (
          /* Empty State */
          <div className="h-full min-h-[260px] flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <FolderOpen size={48} className="mb-3 text-slate-300 dark:text-slate-600 stroke-[1.5]" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {appliedSearch
                ? t('media_picker.no_albums_match', { search: appliedSearch })
                : t('media_picker.no_albums')}
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
            {albums.map((album) => (
              <div
                key={String(album.id)}
                onClick={() => onSelectAlbum(album)}
                className={`group flex flex-col bg-white dark:bg-slate-800/90 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-lg transition-all duration-200 cursor-pointer overflow-hidden ${
                  isDense ? 'p-1.5' : isMedium ? 'p-2' : 'p-2.5'
                }`}
              >
                {/* Thumbnail container */}
                <div
                  className={`relative w-full aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center ${
                    isDense ? 'mb-1' : 'mb-2'
                  }`}
                >
                  <MediaThumbnail
                    url={album.first_thumb}
                    mediaKind="album"
                    alt={album.detail}
                    density={gridDensity}
                    containerClassName="w-full h-full"
                  />

                  {/* [USER-DIRECTIVE] Top Badges: หน้าอัลบั้มต้องไม่มี badge "vdo หรือภาพ" - แสดงเฉพาะจำนวนรายการ */}
                  <div
                    className={`absolute pointer-events-none z-10 ${
                      isDense ? 'top-1 right-1' : isMedium ? 'top-1.5 right-1.5' : 'top-2 right-2'
                    }`}
                  >
                    <span
                      className={`rounded-md bg-black/60 text-white font-medium backdrop-blur-xs shadow-xs leading-none ${
                        isDense
                          ? 'px-1 py-0.5 text-[7px]'
                          : isMedium
                          ? 'px-1.5 py-0.5 text-[7.5px]'
                          : 'px-1.5 py-0.5 text-[9.5px]'
                      }`}
                    >
                      {t('media_picker.item_count', { count: album.item_count })}
                    </span>
                  </div>
                </div>

                {/* Album Info */}
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <h4
                      className={`font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors ${
                        isDense ? 'text-[10px]' : isMedium ? 'text-[11px]' : 'text-xs'
                      }`}
                      title={album.detail}
                    >
                      {album.detail || t('media_picker.untitled_album')}
                    </h4>
                  </div>

                  <div
                    className={`border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-slate-400 ${
                      isDense ? 'mt-1 pt-1 text-[9px]' : 'mt-2 pt-2 text-[10px]'
                    }`}
                  >
                    <span className="flex items-center gap-1 truncate">
                      <Calendar size={isDense ? 9 : 11} />
                      <span className="truncate">{formatMediaDate(album.created_at)}</span>
                    </span>
                    {!isDense && (
                      <span className="font-medium text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {t('media_picker.open_album')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
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
                    {t('media_picker.load_more')} ({pagination.total - albums.length}{' '}
                    {t('media_picker.items_remaining', { count: pagination.total - albums.length })})
                  </span>
                </>
              )}
            </button>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {t('media_picker.showing_elements', { current: albums.length, total: pagination.total })}
            </span>
          </div>
        )}

        {!hasMore && albums.length > 0 && (
          <div className="py-3 text-center text-xs text-slate-400 dark:text-slate-500 select-none">
            {t('media_picker.all_loaded', { total: pagination.total })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <div>
          {t('media_picker.showing_elements', { current: albums.length, total: pagination.total })}
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
    </div>
  );
};
