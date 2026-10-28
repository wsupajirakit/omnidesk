/**
 * [REFACTOR-20260904-OBJLISTSPLIT] One row of the album list.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageList.tsx` (§6.3 step 3): every `<td>`, every
 * class string and the column order are byte-identical to what shipped.
 *
 * 🔴 WHAT MOVED IS MARKUP. NOTHING ELSE. The block reached for twelve names in
 * the page — `setPreviewImage`, `fetchGDrivePreview`, `toggleStatus`,
 * `openView`, `openEdit`, `setDeleteId`, `copyText`, `showAlert`, `groupNames`,
 * `hookNames`, `statusPendingId`, `t` — and every one of them arrives as a prop.
 * No `useState`, no `useEffect`, no handler body came along, so re-render and
 * effect timing are untouched (§6.4 would apply if any had). Markup only.
 *
 * ⚠️ THE COPY-TAGS HANDLER DELIBERATELY STAYED IN THE PAGE. It formats the tags,
 * calls the clipboard and then raises an alert — three effects, none of which is
 * this component's business. It arrives as `onCopyTags`; the row only says WHEN.
 *
 * ⚠️ `matching_tag` is handled as string OR array in two places here. Both
 * branches are real: the list endpoint has returned both shapes, and dropping
 * the string branch looks correct for every album that has an array.
 *
 * revert: paste the body back inside `filteredImages.map(...)` in
 *   `ObjectImageList.tsx`, restore the local names, delete this file.
 */
import React from 'react';
import { Copy, Edit2, Eye, Trash2, Upload } from 'lucide-react';

import { ObjectRowStatusToggle, ObjectScopeCell } from '../../../components/object/scope';
import type { ObjectImage } from '../../../types';
import { ObjectImageThumb } from './ObjectImageThumb';
import { SHOW_MATCHING_TAG } from './objectImageList.constants';

export interface ObjectImageRowProps {
  img: ObjectImage;
  groupNames: Record<string, string>;
  hookNames: Record<string, string>;
  /** True while THIS row's status switch is mid-flight. */
  statusPending: boolean;
  onPreview: (img: ObjectImage) => void;
  onCopyTags: (tags: ObjectImage['matching_tag']) => void;
  onToggleStatus: (img: ObjectImage, next: boolean) => void;
  /**
   * [FEAT-20260907-OBJUPLOADSTEP] The new "upload" action — opens the edit form
   * already on the MEDIA step, which is where an album's files are managed.
   *
   * ⚠️ It is `onEdit` with a starting step, not a new dialog. There is exactly
   *    one place to add files to an album and this leads to it; a second uploader
   *    would be two things to keep in step.
   */
  onUpload: (img: ObjectImage) => void;
  onView: (img: ObjectImage) => void;
  onEdit: (img: ObjectImage) => void;
  onDelete: (id: string) => void;
  t: (key: string) => string;
}

export const ObjectImageRow: React.FC<ObjectImageRowProps> = ({
  img,
  groupNames,
  hookNames,
  statusPending,
  onPreview,
  onCopyTags,
  onToggleStatus,
  onUpload,
  onView,
  onEdit,
  onDelete,
  t,
}) => (
  <tr 
    key={img.id} 
    className="transition-colors group hover:bg-dark-700/50"
  >
    <td className="px-6 py-4">
      <ObjectImageThumb img={img} onPreview={onPreview} />
    </td>
    <td className="px-6 py-4 max-w-xs">
      <div className="truncate text-slate-900 font-medium" title={img.detail}>
        {img.detail || '-'}
      </div>
    </td>
    {/* [UI-20260904-HIDEMATCHTAG] gated with its <th> in ObjectImageTable.
        The data is untouched — only this cell stops being drawn. */}
    {SHOW_MATCHING_TAG && (
      <td className="px-6 py-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            {Array.isArray(img.matching_tag) ? (
              img.matching_tag.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-bold whitespace-nowrap">
                  [[[{tag}]]]
                </span>
              ))
            ) : img.matching_tag ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary-50 text-primary-700 border border-primary-100 text-[10px] font-bold whitespace-nowrap">
                [[[{img.matching_tag}]]]
              </span>
            ) : '-'}
          </div>
          {(Array.isArray(img.matching_tag) ? img.matching_tag.length > 0 : !!img.matching_tag) && (
            <button
              onClick={() => onCopyTags(img.matching_tag)}
              className="flex items-center gap-1 text-[10px] font-bold text-primary-600 hover:text-primary-700 transition-colors w-fit p-1 rounded hover:bg-primary-50 border border-transparent hover:border-primary-100"
            >
              <Copy size={10} />
              COPY
            </button>
          )}
        </div>
      </td>
    )}
    <td className="px-6 py-4">
      <div className="flex flex-wrap gap-1">
        {img.categories?.map((cat) => (
          <span key={cat.id} className="px-2 py-0.5 text-[10px] bg-indigo-600/10 text-indigo-600 rounded border border-indigo-600/20 whitespace-nowrap">
            {cat.name}
          </span>
        ))}
      </div>
    </td>
    <td className="px-6 py-4 capitalize">
      <div className="flex flex-col items-start gap-1">
        <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${
          img.storage === 'local' ? 'bg-amber-600/10 text-amber-600 border-amber-600/20' : 'bg-blue-600/10 text-blue-600 border-blue-600/20'
        }`}>
          {img.storage}
        </span>
        {/* [FEAT-20260804-COPYIMGLINK] ปุ่มคัดลอกลิงก์ "ย้ายไปอยู่ในโมดัลอัลบั้ม" แล้ว
            WHY  1 อัลบั้มมีได้หลายภาพ แต่ปุ่มตรงนี้คัดลอกได้แค่ภาพแรก (first_thumb)
                 ภาพที่ 2, 3, ... ไม่มีทางคัดลอกได้เลย
            ⇒ ย้ายไปไว้บนรูปแต่ละใบใน ObjectImageFormModal (ทั้งโหมดดูและแก้ไข)
              กฎตรวจลิงก์ยังเป็นตัวเดียวกัน (services/imageLinkUtils.ts) */}
      </div>
    </td>
    <td className="px-6 py-4">
      <ObjectScopeCell
        groupIds={(img.group_providers as unknown[]) || []}
        hookIds={img.hook_ids || []}
        groupNames={groupNames}
        hookNames={hookNames}
        rowName={img.detail || img.id}
      />
    </td>
    <td className="px-6 py-4">
      <ObjectRowStatusToggle
        value={img.status}
        name={img.detail || img.id}
        pending={statusPending}
        onConfirm={(next) => onToggleStatus(img, next)}
      />
    </td>
    <td className="px-6 py-4 text-right whitespace-nowrap">
      <div className="flex items-center justify-end gap-2">
        {/* [FEAT-20260907-OBJUPLOADSTEP] BEFORE the eye, as required. It carries a
            LABEL as well as an icon — the other three are icon-only and already
            understood; this one is new, and an unexplained fourth glyph in a row
            of three is a guess for whoever meets it. */}
        <button
          onClick={() => onUpload(img)}
          data-testid={`obj-upload-${img.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 transition-colors hover:bg-indigo-50"
          title={t('object_image.upload_action')}
        >
          <Upload size={14} />
          {t('object_image.upload_action')}
        </button>
        {/* [UI-20260907-HIDEVIEWEYE] The eye is HIDDEN, owner 07/09. It opened the
            form in `view` mode, and on 07/09 every entry point for an existing
            album was pointed at the media step anyway — so it had become a third
            door to the same room, next to Upload and Edit.
            ⚠️ `onView` and the page's `openView` are LEFT IN PLACE: the mode still
               exists and the prop is still typed, so restoring the button is one
               block, not a re-wiring. Nothing else calls it today.
            revert: put the block back; `common.view` is still in all locales. */}
        <button
          onClick={() => onEdit(img)}
          className="p-1.5 rounded-lg hover:bg-primary-600/10 text-slate-400 hover:text-primary-600 transition-colors"
          title={t('common.edit')}
        >
          <Edit2 size={16} />
        </button>
        <button
          onClick={() => onDelete(img.id)}
          className="p-1.5 rounded-lg hover:bg-red-600/10 text-slate-400 hover:text-red-600 transition-colors"
          title={t('common.delete')}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </td>
  </tr>
);
