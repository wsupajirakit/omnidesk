import { useCallback, useMemo, useState } from 'react';

import { useObjectCategoriesQuery, useObjectImagesPageQuery } from '../../../services/media/queries';
import type { ObjectCategory, ObjectImage } from '../../../types';

/**
 * [REFACTOR-20260904-OBJLISTSPLIT] The album list's data: what to ask the server
 * for, what came back, and what is shown of it.
 * ===========================================================================
 *
 * ### Why it moved as one unit (§6.4)
 *
 * Six states, two fetches, two effects and two memos are ONE feature: the search
 * box and the two filters are inputs to a request, the request fills `images`,
 * and `filteredImages` narrows that again on the client. Splitting them would
 * put half the rule on each side of a seam.
 *
 * 🔴 THE SEARCH RUNS TWICE, ON PURPOSE, AND BOTH HALVES MATTER. Typing re-queries
 * the SERVER (the effect below depends on `search`) *and* filters what is already
 * on screen. Keeping only the local filter looks correct until the album that
 * matches was never in the response; keeping only the server call makes every
 * keystroke a network round trip before anything narrows.
 * Two layers of search, on purpose: dropping either breaks a different way.
 *
 * [FEAT-20261027-TANSTACK] The two reads are TanStack queries now
 * (services/media/queries/useObjectQueries.ts, shared contract in
 * services/query/usePageQuery.ts: loading on every read, a failed read alerts and
 * KEEPS the rows). `t` is only read inside the alert callback, so an unstable `t`
 * can no longer re-fire the read (the old useCallback deps could — it once hung a
 * test suite for seven minutes). Pinned by test/requests/contentLists.requests.test.tsx.
 *
 * ⚠️ Paging is a placeholder and always has been: the endpoint returns the whole
 * list, so `totalPages` is pinned to 1 and `itemsPerPage` is unused by the query.
 * It is carried over unchanged rather than "fixed" inside a refactor.
 *
 * revert: paste these members back into `ObjectImageList.tsx` and delete this
 *   file. Nothing else references it.
 */
// stable empties (memo deps below read `images`)
const NO_IMAGES: ObjectImage[] = [];
const NO_CATEGORIES: ObjectCategory[] = [];

export function useObjectImageList(
  showAlert: (title: string, message: string, type: 'success' | 'error') => void,
  t: (key: string) => string,
) {
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('');

  const imagesQuery = useObjectImagesPageQuery(
    { search: search.trim() || undefined, category: selectedCategory || undefined, tag: selectedTag.trim() || undefined },
    (e: any) => { console.error(e); showAlert(t('common.error_title'), e.message || t('object_image.alert_load_failed'), 'error'); },
  );
  const images: ObjectImage[] = imagesQuery.page || NO_IMAGES;
  const totalItems = images.length;
  const totalPages = 1;   // the endpoint returns the whole list (see the header)
  const [actionLoading, setLoading] = useState(false);   // the page's own actions call setLoading
  const loading = imagesQuery.loading || actionLoading;
  const { refetch: refetchImages } = imagesQuery;
  const fetchImages = useCallback(async () => { await refetchImages(); }, [refetchImages]);
  // category filter options — one read per mount; a failure leaves the filter empty (as before)
  const categories: ObjectCategory[] = useObjectCategoriesQuery().data || NO_CATEGORIES;

  /**
   * [FEAT-20260901-OBJROWSTATUS] Flip one row's switch.
   *
   * Uses the ordinary update endpoint so the backend writes the same audit row
   * as any other edit, and sends ONLY `status` — replaying the whole row would
   * let a stale list overwrite a scope changed elsewhere a moment ago.
   */
  const filteredImages = useMemo(() => {
    if (!search.trim()) return images;
    const term = search.toLowerCase();
    return images.filter(img => {
      const matchDetail = img.detail?.toLowerCase().includes(term);
      // [FIX-20260801-HOOKTYPES] เดิมมีกิ่ง else เผื่อกรณี matching_tag เป็นสตริงเดี่ยว
      // แต่ที่อื่นเรียก .map() ตรง ๆ อยู่แล้ว (ObjectImageFormModal) แปลว่ามันเป็น array เสมอ
      // → กิ่งนั้นวิ่งไม่ถึงจริง TS จึงมองเป็น never · ตัดออกให้ตรงกับของจริง
      // ⚠️ ยังคง Array.isArray ไว้ เพราะ matching_tag เป็น optional (undefined ได้)
      const matchTags = Array.isArray(img.matching_tag)
        && img.matching_tag.some(t => t.toLowerCase().includes(term));
      const matchCategories = img.categories?.some(cat => cat.name.toLowerCase().includes(term));
      
      return matchDetail || matchTags || matchCategories;
    });
  }, [images, search]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    images.forEach(img => {
      if (Array.isArray(img.matching_tag)) {
        img.matching_tag.forEach(t => tags.add(t));
      } else if (img.matching_tag) {
        tags.add(img.matching_tag);
      }
    });
    return Array.from(tags).sort();
  }, [images]);

  return {
    loading,
    setLoading,
    images,
    search,
    setSearch,
    currentPage,
    setCurrentPage,
    totalPages,
    totalItems,
    categories,
    selectedCategory,
    setSelectedCategory,
    selectedTag,
    setSelectedTag,
    filteredImages,
    availableTags,
    fetchImages,
  };
}
