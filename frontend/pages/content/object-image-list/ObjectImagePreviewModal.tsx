/**
 * 🔴 UNREACHABLE SINCE 07/09 — READ THIS BEFORE EDITING.
 * [FEAT-20260907-OBJUPLOADSTEP] The album's picture in the list used to open this
 * dialog. On 07/09 that click was repointed at the EDIT form's media step, and
 * this was its only entry point — so nothing reaches
 * this file any more, and `useGDrivePreview`/`fetchGDrivePreview` in
 * `ObjectImageList.tsx` is now called by nobody either.
 *
 * It is still mounted and still correct; it was NOT deleted because removing a
 * 319-line dialog plus the Drive-preview state is the owner's call, not a side
 * effect of repointing a click handler. Either give it an entry point again or
 * delete it together with the Drive preview hook — leaving it here indefinitely
 * is the debt. ตัวนี้ไม่มีทางเข้าแล้ว ต้องตัดสินใจ: คืนทางเข้า หรือลบพร้อม hook.
 *
 * [REFACTOR-20260904-OBJLISTSPLIT] The album preview dialog.
 * ===========================================================================
 * Lifted VERBATIM out of `ObjectImageList.tsx` (§6.3 step 3): markup, class
 * strings and element order byte-identical.
 *
 * 🔴 IT TAKES A WIDE PROP LIST, AND THAT IS THE HONEST SHAPE OF IT. The block
 * reached for nineteen names in the page — the Drive gallery's five loading
 * flags and its paging token, the server-file list, the copy flag, four
 * handlers, three setters. Every one of them arrives as a prop and NOTHING moved
 * with the markup: no `useState`, no `useEffect`, no `useRef`, no handler body.
 * That keeps this a §6.3 lift instead of a §6.4 state move, which would need
 * interaction tests for Drive paging that do not exist yet.
 *
 * ⚠️ SO THE PROP LIST IS A FINDING, NOT A STYLE. It says the Drive gallery is a
 * feature whose state lives one level up. Collapsing it properly means moving
 * that state — `useGDrivePreview` — and that is its own piece of work with its
 * own tests, deliberately NOT done as a side effect of a markup split.
 * The list is long because the state lives one level up, not because the code
 * is careless; moving that state is its own piece of work.
 *
 * ⚠️ THE TWO SECTIONS ARE MUTUALLY EXCLUSIVE ON PURPOSE: the server-file grid
 * shows when there are stored files, and the single-image / Drive view shows
 * only when there are none. Both conditions read the same two values from
 * opposite sides — change one and the dialog can render both at once, or
 * neither.
 *
 * revert: paste the body back behind `{previewImage && (…)}` in
 *   `ObjectImageList.tsx`, restore the local names, delete this file.
 */
import React from 'react';
import {
  Copy,
  Database,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Pencil,
  X,
} from 'lucide-react';

import { StoredMediaThumb } from '../../../components/object/gallery/StoredMediaThumb';
import { UploaderCaption } from '../../../components/object/gallery/UploaderCaption';
import type { ImageStorage, ObjectImage } from '../../../types';
import { SHOW_MATCHING_TAG } from './objectImageList.constants';

export interface ObjectImagePreviewModalProps {
  /** The album being previewed. The parent renders this only when set. */
  album: ObjectImage;
  /** Files stored on our own server for this album. */
  serverFiles: ImageStorage[];
  loadingServerFiles: boolean;
  /** Google Drive gallery — state and paging both owned by the page. */
  driveFiles: { id: string; name: string; url: string }[];
  loadingDrive: boolean;
  loadingMore: boolean;
  loadingAll: boolean;
  hasMoreDrive: string | null;
  onLoadMore: () => void;
  onLoadAll: () => void;
  onCancelLoadAll: () => void;
  /** True while the "copied" flash is showing. */
  copied: boolean;
  onCopyTags: (tags: ObjectImage['matching_tag']) => void;
  onZoom: (url: string, mediaKind?: 'image' | 'video') => void;
  onEditStorage: (storage: ImageStorage) => void;
  onClose: () => void;
  t: (key: string) => string;
}

export const ObjectImagePreviewModal: React.FC<ObjectImagePreviewModalProps> = ({
  album,
  serverFiles,
  loadingServerFiles,
  driveFiles,
  loadingDrive,
  loadingMore,
  loadingAll,
  hasMoreDrive,
  onLoadMore,
  onLoadAll,
  onCancelLoadAll,
  copied,
  onCopyTags,
  onZoom,
  onEditStorage,
  onClose,
  t,
}) => (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-white/45 backdrop-blur animate-in fade-in duration-300"
    >
      <div 
        className="bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] w-full max-w-4xl overflow-hidden border border-slate-200 relative animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex flex-col">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ImageIcon size={20} className="text-primary-600 shrink-0" />
              {/* [UI-20260904-HIDEMATCHTAG] With the flag off this falls to the
                  else branch below, so the dialog is titled by the album own
                  detail instead of by its tag — a title either way, never an
                  empty header. The tag stays copyable from the row actions. */}
              {SHOW_MATCHING_TAG && album.matching_tag && (Array.isArray(album.matching_tag) ? album.matching_tag.length > 0 : !!album.matching_tag) ? (
                <div className="flex items-center gap-3">
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {(Array.isArray(album.matching_tag) ? album.matching_tag : [album.matching_tag]).map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-primary-100/50 text-primary-700 rounded-lg text-[10px] font-black uppercase tracking-wider border border-primary-200/50">
                        [[[{tag}]]]
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => onCopyTags(album.matching_tag)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-primary-700 bg-primary-50 border border-primary-200 hover:bg-primary-100 transition-all active:scale-95 shadow-sm font-bold text-[10px]"
                      title={t('common.copy')}
                    >
                      <Copy size={12} />
                      <span>{t('common.copy')}</span>
                    </button>
                    {copied && (
                      <span className="text-[10px] font-black text-emerald-600 animate-in fade-in slide-in-from-left-2 duration-300 uppercase">
                         {t('common.copied_title')}!
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <span className="truncate">{album.detail || t('object_image.header_image')}</span>
              )}
            </h3>
            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">{album.storage} storage</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-sm font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 transition-all active:scale-95 shadow-sm"
            >
                {t('common.close')}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-4 bg-slate-50 flex flex-col gap-6 min-h-[200px] max-h-[90vh] overflow-y-auto custom-scrollbar">
          {/* Server Storage section in Preview (Always show if exists) */}
          {(loadingServerFiles || serverFiles.length > 0) && (
            <div className="w-full flex flex-col gap-3 animate-in fade-in duration-500">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                   <div className="w-6 h-6 rounded bg-primary-600/10 flex items-center justify-center">
                     <Database size={12} className="text-primary-600" />
                   </div>
                   <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Server Storage (Local Gallery)</span>
                </div>
                {loadingServerFiles && <Loader2 size={12} className="animate-spin text-primary-500" />}
              </div>

              {serverFiles.length > 0 && (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 px-1">
                  {serverFiles.map(sImg => (
                    <div key={sImg.id} className="aspect-square bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm group/srv relative transition-all hover:border-primary-300">
                      {/* [FEAT-20260904-OBJVIDEO] image or video, from `media_kind`
                          alone — the same component the album modal's gallery
                          uses, so the two screens cannot answer differently.
                          Before this, a stored video rendered as a broken <img>
                          on this screen while playing correctly on that one. */}
                      <StoredMediaThumb
                        url={sImg.image_url}
                        mediaKind={sImg.media_kind}
                        className="w-full h-full object-cover transition-transform group-hover/srv:scale-110"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover/srv:bg-black/40 transition-all flex items-center justify-center">
                        <button
                          /* [FEAT-20260904-OBJVIDEO] the KIND travels with the
                             url, or the overlay renders a video as <img>. */
                          onClick={() => onZoom(sImg.image_url, sImg.media_kind)}
                          className="p-1.5 bg-primary-600 text-white rounded-lg opacity-0 group-hover/srv:opacity-100 transition-all hover:bg-primary-500 hover:scale-110 shadow-lg"
                          title="Zoom Preview"
                        >
                          <Maximize2 size={12} />
                        </button>
                        <button
                          onClick={() => onEditStorage(sImg)}
                          className="p-1.5 bg-amber-600 text-white rounded-lg opacity-0 group-hover/srv:opacity-100 transition-all hover:bg-amber-500 hover:scale-110 shadow-lg"
                          title="Edit Details"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>

                      {/* [FEAT-20260904-UPLOADEDBY] The strip used to read
                          "Server Image", which every tile in this grid already
                          is. It now says WHO uploaded it — the one thing about a
                          stored file this screen could not tell you. */}
                      <UploaderCaption name={sImg.created_by_name} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Main Storage logic - HIDDEN IF LOCAL JOIN IMAGES EXIST as per request */}
          {(loadingServerFiles || serverFiles.length === 0) && (
            <>
              {album.storage === 'google_drive' ? (
                <div className="w-full flex flex-col gap-4 border-t border-slate-200 pt-4">
                  {/* GDrive Gallery UI */}
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                       <div className="w-6 h-6 rounded bg-blue-600/10 flex items-center justify-center">
                         <Globe size={12} className="text-blue-600" />
                       </div>
                       <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Google Drive Gallery</span>
                    </div>
                    {(loadingDrive || loadingMore || loadingAll) && <Loader2 size={16} className="animate-spin text-primary-500" />}
                  </div>

                  {loadingDrive && driveFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-white/50 rounded-2xl border-2 border-dashed border-primary-100 animate-in fade-in duration-700 mx-2">
                      <Loader2 size={48} strokeWidth={2.5} className="animate-spin text-primary-500 mb-4 opacity-30" />
                      <p className="text-xs font-black text-primary-600 tracking-widest uppercase">{t('object_image.loading_more')}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 animate-in slide-in-from-bottom-2 duration-300 w-full">
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto p-1 custom-scrollbar w-full relative">
                        {loadingAll && (
                          <div className="sticky top-0 left-0 right-0 z-[60] bg-white/80 backdrop-blur-sm border-b border-primary-100 p-3 flex flex-col items-center justify-center gap-2 animate-in slide-in-from-top duration-300">
                            <div className="flex items-center gap-3">
                              <Loader2 size={24} className="animate-spin text-primary-600" />
                              <span className="text-sm font-black text-primary-900 tracking-widest uppercase">SYNCING DRIVE...</span>
                            </div>
                            <p className="text-[10px] font-bold text-primary-500 uppercase tracking-tighter">Please wait while we fetch all images</p>
                          </div>
                        )}
                        {driveFiles.map(img => (
                          <div key={img.id} className="aspect-square bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm group/prev relative">
                            <img src={img.url} alt={img.name} className="w-full h-full object-cover transition-transform group-hover/prev:scale-110" />
                            <div className="absolute inset-0 bg-black/0 group-hover/prev:bg-black/40 transition-all flex items-center justify-center">
                              <button
                                /* Drive files are images only — the query asks
                                   Drive for `mimeType contains 'image/'`, so no
                                   kind is passed and the overlay shows a picture. */
                                onClick={() => onZoom(img.url)}
                                className="p-1.5 bg-primary-600 text-white rounded-lg opacity-0 group-hover/prev:opacity-100 transition-all hover:bg-primary-500 hover:scale-110 shadow-lg"
                                title="Zoom Preview"
                              >
                                <Maximize2 size={12} />
                              </button>
                            </div>
                            <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1.5 truncate text-[10px] text-white opacity-0 group-hover/prev:opacity-100 transition-opacity">
                              {img.name}
                            </div>
                          </div>
                        ))}
                      </div>

                      {hasMoreDrive && (
                        <div className="flex gap-3 mt-2 w-full">
                          <button
                            onClick={onLoadMore}
                            disabled={loadingMore || loadingAll}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-primary-200 bg-primary-50 text-primary-700 text-xs font-bold hover:bg-primary-100 transition-all active:scale-95 disabled:opacity-50"
                          >
                            {loadingMore ? <Loader2 size={14} className="animate-spin" /> : `${t('object_image.load_more').split('+')[0]} (24)`}
                          </button>

                          {loadingAll ? (
                            <button
                              onClick={onCancelLoadAll}
                              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-red-200 bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100 transition-all active:scale-95"
                            >
                              <X size={14} /> {t('object_image.stop_loading')}
                            </button>
                          ) : (
                            <button
                              onClick={onLoadAll}
                              disabled={loadingMore}
                              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 transition-all active:scale-95 disabled:opacity-50"
                            >
                              {t('object_image.load_all')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full flex flex-col items-center justify-center p-4 border-t border-slate-100 pt-6">
                  <div className="relative group/main">
                    <div className="absolute -inset-8 bg-blue-500/10 rounded-full blur-3xl opacity-0 group-hover/main:opacity-100 transition-opacity" />
                    <img 
                      src={album.img_path} 
                      alt="Preview" 
                      className="max-w-full max-h-[50vh] object-contain rounded-2xl shadow-xl border-4 border-white relative z-10 animate-in zoom-in duration-500"
                      onError={(e) => {
                        (e.target as any).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'%3E%3C/rect%3E%3Ccircle cx='9' cy='9' r='2'%3E%3C/circle%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'%3E%3C/path%3E%3C/svg%3E";
                      }}
                    />
                  </div>
                  <div className="mt-4 flex items-center gap-2 px-4 py-1.5 bg-white rounded-full border border-slate-200 shadow-sm">
                    <ExternalLink size={12} className="text-slate-400" />
                    <span className="text-[10px] text-slate-500 font-medium truncate max-w-[300px]">{album.img_path}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
);
