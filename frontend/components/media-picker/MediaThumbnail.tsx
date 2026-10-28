// [FEAT-20260905-MEDIAPICKER] Central Media Thumbnail & Placeholder Engine
// Modular functions for easily customizable and reusable media rendering without technical debt.
import React, { useState, useEffect } from 'react';
import { Film, Image as ImageIcon, Folder, Play } from 'lucide-react';
import type { MediaPickerGridDensity } from './types';
import { resolveAbsoluteMediaUrl } from './mediaPickerUtils';
import { translateNow } from '../../i18n';

export type MediaKind = 'image' | 'video' | 'album';

export interface MediaThumbnailProps {
  url?: string | null;
  mediaKind?: MediaKind;
  alt?: string;
  className?: string;
  containerClassName?: string;
  density?: MediaPickerGridDensity;
}

/**
 * [HELPER-FUNCTION] Renders a beautiful default placeholder when media fails to load,
 * is missing, or is still resolving. Scaled proportionally to grid density so icons never bloat.
 */
export const renderDefaultMediaPlaceholder = (
  mediaKind: MediaKind = 'image',
  title?: string,
  extraClassName = '',
  density: MediaPickerGridDensity = '4x2',
): React.ReactElement => {
  const is6x2 = density === '6x2';
  const is4x2 = density === '4x2';

  if (mediaKind === 'album') {
    const boxPadding = is6x2 ? 'p-1.5 rounded-lg mb-0.5' : is4x2 ? 'p-2 rounded-xl mb-1' : 'p-3 rounded-2xl mb-1.5';
    const folderSize = is6x2 ? 16 : is4x2 ? 20 : 28;
    const textSize = is6x2 ? 'text-[8px]' : is4x2 ? 'text-[10px]' : 'text-[11px]';

    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center p-1.5 bg-gradient-to-br from-slate-100 via-indigo-50/30 to-slate-200 dark:from-slate-800/90 dark:via-slate-850 dark:to-slate-900 text-slate-400 select-none ${extraClassName}`}
      >
        <div
          className={`${boxPadding} bg-white/80 dark:bg-slate-800/80 shadow-xs border border-slate-200/70 dark:border-slate-700/60 flex items-center justify-center text-indigo-500 dark:text-indigo-400 transition-all`}
        >
          <Folder size={folderSize} className="stroke-[1.8]" />
        </div>
        <span
          className={`${textSize} font-semibold text-slate-600 dark:text-slate-300 truncate max-w-[90%] text-center`}
        >
          {title || translateNow('pageui.media.album', 'อัลบั้ม')}
        </span>
      </div>
    );
  }

  if (mediaKind === 'video') {
    const circleSize = is6x2 ? 'w-6 h-6 mb-0.5' : is4x2 ? 'w-8 h-8 mb-1' : 'w-12 h-12 mb-1.5';
    const playSize = is6x2 ? 12 : is4x2 ? 15 : 22;
    const textSize = is6x2 ? 'text-[8px]' : is4x2 ? 'text-[10px]' : 'text-[11px]';

    return (
      <div
        className={`w-full h-full flex flex-col items-center justify-center p-1.5 bg-gradient-to-br from-slate-900 via-slate-950 to-purple-950/80 text-slate-300 select-none border border-slate-800/80 ${extraClassName}`}
      >
        <div
          className={`${circleSize} rounded-full bg-purple-600/30 text-purple-300 border border-purple-500/40 flex items-center justify-center shadow-md`}
        >
          <Play size={playSize} className="fill-purple-300 ml-0.5" />
        </div>
        <span className={`${textSize} font-bold text-purple-200 tracking-wide`}>
          {translateNow('pageui.media.video_vdo', 'วิดีโอ (VDO)')}
        </span>
      </div>
    );
  }

  // Default Image placeholder
  const imgBoxPadding = is6x2 ? 'p-1 rounded-lg mb-0.5' : is4x2 ? 'p-1.5 rounded-xl mb-1' : 'p-2.5 rounded-2xl mb-1.5';
  const imgSize = is6x2 ? 16 : is4x2 ? 20 : 26;
  const imgTextSize = is6x2 ? 'text-[8px]' : is4x2 ? 'text-[10px]' : 'text-[11px]';

  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center p-1.5 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 dark:from-slate-800/90 dark:via-slate-850 dark:to-slate-900 text-slate-400 select-none ${extraClassName}`}
    >
      <div
        className={`${imgBoxPadding} bg-white/90 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 shadow-xs border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center`}
      >
        <ImageIcon size={imgSize} className="stroke-[1.6]" />
      </div>
      <span
        className={`${imgTextSize} font-semibold text-slate-600 dark:text-slate-300 truncate max-w-[90%] text-center`}
      >
        {title || translateNow('pageui.media.image', 'รูปภาพ')}
      </span>
    </div>
  );
};

/**
 * Reusable Component wrapper for placeholder
 */
export const DefaultMediaPlaceholder: React.FC<{
  mediaKind?: MediaKind;
  title?: string;
  className?: string;
  density?: MediaPickerGridDensity;
}> = ({ mediaKind = 'image', title, className, density = '4x2' }) => {
  return renderDefaultMediaPlaceholder(mediaKind, title, className, density);
};

/**
 * [HELPER-FUNCTION] Renders a video thumbnail with play button overlay for direct click-to-preview
 */
export const renderVideoThumbnail = (
  url: string,
  onError: () => void,
  className = 'w-full h-full object-cover',
  density: MediaPickerGridDensity = '4x2',
): React.ReactElement => {
  const is6x2 = density === '6x2';
  const is4x2 = density === '4x2';
  const circleSize = is6x2 ? 'w-6 h-6' : is4x2 ? 'w-8 h-8' : 'w-12 h-12';
  const playSize = is6x2 ? 12 : is4x2 ? 15 : 22;

  return (
    <div className="relative w-full h-full bg-slate-950 flex items-center justify-center overflow-hidden pointer-events-none">
      <video
        src={url}
        preload="metadata"
        playsInline
        muted
        onError={onError}
        className={`${className} pointer-events-none`}
      />
      {/* Centered glowing play button badge indicating click to preview player */}
      <div className="absolute inset-0 bg-black/25 group-hover:bg-black/45 transition-all flex items-center justify-center pointer-events-none">
        <div
          className={`${circleSize} rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-lg transition-transform group-hover:scale-110`}
        >
          <Play size={playSize} className="fill-white ml-0.5" />
        </div>
      </div>
    </div>
  );
};

/**
 * [HELPER-FUNCTION] Renders an image element with lazy loading and error handler
 */
export const renderImageElement = (
  url: string,
  alt: string,
  onError: () => void,
  className = 'w-full h-full object-cover transition-transform duration-300 group-hover:scale-105',
): React.ReactElement => {
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={onError}
      className={className}
    />
  );
};

/**
 * [MAIN-COMPONENT] Central Media Thumbnail component
 * Automatically detects whether media is video or image, renders video thumbnail with play trigger,
 * and falls back gracefully to a beautiful placeholder on error or missing URL.
 */
export const MediaThumbnail: React.FC<MediaThumbnailProps> = ({
  url,
  mediaKind = 'image',
  alt = 'Media thumbnail',
  className = 'w-full h-full object-cover transition-transform duration-300 group-hover:scale-105',
  containerClassName = 'relative w-full aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 flex items-center justify-center',
  density = '4x2',
}) => {
  const [hasError, setHasError] = useState<boolean>(false);
  const resolvedUrl = resolveAbsoluteMediaUrl(url);

  // Reset error state if URL changes
  useEffect(() => {
    setHasError(false);
  }, [resolvedUrl]);

  if (!resolvedUrl || hasError) {
    return (
      <div className={containerClassName}>
        {renderDefaultMediaPlaceholder(mediaKind, alt, '', density)}
      </div>
    );
  }

  if (mediaKind === 'video') {
    return (
      <div className={containerClassName}>
        {renderVideoThumbnail(resolvedUrl, () => setHasError(true), className, density)}
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      {renderImageElement(resolvedUrl, alt, () => setHasError(true), className)}
    </div>
  );
};
