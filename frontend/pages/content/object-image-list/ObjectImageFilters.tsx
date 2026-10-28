/**
 * [REFACTOR-20260904-OBJLISTSPLIT] The album list's control row.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageList.tsx` (§6.3 step 3): every class string
 * and the element order are byte-identical to what shipped, including the
 * `flex-1` / `ml-auto` pair that is the whole reason the two buttons stay on the
 * right edge at every width.
 *
 * 🔴 NO STATE MOVED. `search`, `selectedCategory` and `selectedTag` still live
 * in the page — they are inputs to the fetch, and moving them here would change
 * WHEN the list refetches, which is a §6.4 behaviour change, not a lift. This
 * component holds nothing and decides nothing: markup moved, state did not.
 *
 * ⚠️ `categories` arrives as a prop and is loaded by the page. A version of this
 * that fetched its own would double the request on every mount — and the select
 * would still render fine with an empty list, so nothing would look wrong.
 *
 * revert: paste the body back above the table in `ObjectImageList.tsx`, restore
 *   the local names, and delete this file.
 */
import React from 'react';
import { Filter, Plus, RefreshCw, Search, Tag } from 'lucide-react';

import type { ObjectCategory } from '../../../types';

export interface ObjectImageFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  categories: ObjectCategory[];
  selectedCategory: string;
  onCategoryChange: (value: string) => void;
  selectedTag: string;
  onTagChange: (value: string) => void;
  /** Rounds the refresh icon — the page owns the request. */
  loading: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  t: (key: string) => string;
}

export const ObjectImageFilters: React.FC<ObjectImageFiltersProps> = ({
  search,
  onSearchChange,
  categories,
  selectedCategory,
  onCategoryChange,
  selectedTag,
  onTagChange,
  loading,
  onRefresh,
  onCreate,
  t,
}) => (
  <>
  {/* [UI-20260901-IMGCONTROLS] Search first and wide, filters next, actions
      pinned right.

      The search box is NEW ON SCREEN, not new in code: `search` state and
      a filter that already matched detail, tags and category names both
      existed — with nothing to type into. The list could be searched only
      by not being searchable.

      `flex-1` on search and `ml-auto` on the actions is what keeps the
      two buttons on the right edge at every width, instead of drifting
      left as the filters shrink. */}
  <div className="flex flex-col lg:flex-row gap-3 w-full lg:items-center">

    {/* Search — detail, tag or category name */}
    <div className="relative w-full lg:flex-1 lg:min-w-[18rem]">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Search className="text-slate-400" size={16} />
      </div>
      <input
        type="text"
        data-testid="object-image-search"
        placeholder={t('object_image.search_placeholder')}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="pl-9 pr-4 w-full bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
      />
    </div>

    <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
       {/* Category Filter */}
       <div className="relative w-full sm:w-auto">
         <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Filter className="text-slate-400" size={16} />
         </div>
         <select
            value={selectedCategory}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="pl-9 pr-4 w-full sm:w-44 bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none cursor-pointer"
         >
           <option value="">{t('object_image.filter_category_all') || 'All Categories'}</option>
           {categories.map((cat) => (
             <option key={cat.id} value={cat.id}>{cat.name}</option>
           ))}
         </select>
      </div>

      {/* Tag Filter */}
      <div className="relative w-full sm:w-auto">
         <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Tag className="text-slate-400" size={16} />
         </div>
         <input 
            type="text" 
            placeholder={t('object_image.filter_tag_placeholder') || 'Filter tag...'} 
            value={selectedTag}
            onChange={(e) => onTagChange(e.target.value)}
            className="pl-9 pr-4 w-full sm:w-44 bg-dark-800 border border-dark-600 rounded-lg py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
         />
      </div>


    </div>

    {/* Actions stay on the right at every width — `lg:ml-auto` replaces
        the old `lg:ml-0`, which pulled them back beside the filters. */}
    <div className="flex gap-2 w-full sm:w-auto sm:ml-auto lg:ml-auto">
      <button
        onClick={onRefresh}
        className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 text-slate-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        <RefreshCw className={loading ? 'animate-spin' : ''} size={18} />
        {t('common.refresh')}
      </button>

      <button 
        onClick={onCreate}
        className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-lg shadow-primary-500/20 transition-all hover:scale-105 whitespace-nowrap"
      >
        <Plus size={18} />
        {t('common.add_new')}
      </button>
    </div>
  </div>
  </>
);
