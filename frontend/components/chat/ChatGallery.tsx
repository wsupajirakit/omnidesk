import React, { useState, useEffect } from 'react';
import { ExternalLink, Maximize2, X, Loader2 } from 'lucide-react';
import { chatService } from '../../services/chat';

interface ChatGalleryProps {
  tag: string;
  onImageClick?: (url: string) => void;
}

export const ChatGallery: React.FC<ChatGalleryProps> = ({ tag, onImageClick }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedImg, setSelectedImg] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await chatService.getImageByTag(tag);
        // Sometimes the API might return successfully but with no data
        if (res) {
          setData(res);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error('Gallery fetch error:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [tag]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-slate-400 py-2">
        <Loader2 size={12} className="animate-spin" /> Fetching gallery for {tag}...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-[10px] text-red-400 py-1">
        Failed to load gallery for tag: {tag}
      </div>
    );
  }

  const images = data.data || [];

  const handleImageClick = (url: string) => {
    if (onImageClick) {
      onImageClick(url);
    } else {
      setSelectedImg(url);
    }
  };

  return (
    <div className="mt-2 bg-white/50 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="bg-slate-100/50 px-3 py-1.5 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            {data.response_type || 'MEDIA'} GALLERY
          </span>
          <span className="text-[10px] text-slate-400 truncate max-w-[120px]">#{data.matching_tag}</span>
        </div>
        {data.detail && (
          <span className="text-[10px] text-slate-500 italic max-w-[150px] truncate">{data.detail}</span>
        )}
      </div>

      <div className="p-2 grid grid-cols-2 gap-2">
        {images.map((img: any) => (
          <div key={img.id} className="group relative border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm hover:shadow-md transition-all">
            <div className="aspect-square relative flex items-center justify-center overflow-hidden bg-slate-50">
              <img 
                src={img.image_url} 
                alt={img.detail_text || 'gallery img'} 
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
              />
              <button 
                onClick={() => handleImageClick(img.image_url)}
                className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
              >
                <Maximize2 size={24} className="text-white drop-shadow-lg" />
              </button>
            </div>
            {(img.detail_text || img.detail_link) && (
              <div className="p-2 border-t border-slate-100">
                {img.detail_text && <p className="text-[10px] text-slate-600 font-medium line-clamp-1 mb-1">{img.detail_text}</p>}
                {img.detail_link && (
                  <a 
                    href={img.detail_link} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-primary-500 hover:text-primary-600 transition-colors"
                  >
                    Details <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {selectedImg && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-10 animate-in fade-in duration-200">
          <div className="relative max-w-5xl w-full h-full flex flex-col items-center justify-center">
            <button 
              onClick={() => setSelectedImg(null)}
              className="absolute -top-12 right-0 md:-right-12 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all group"
            >
              <X size={32} className="group-hover:scale-110 transition-transform" />
            </button>
            <div className="w-full max-h-[80vh] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
              <img 
                src={selectedImg} 
                alt="zoom" 
                className="w-full h-full object-contain bg-black/40"
              />
            </div>
            <button 
              onClick={() => setSelectedImg(null)}
              className="mt-8 px-10 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-primary-500/30 transition-all transform hover:-translate-y-0.5"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
