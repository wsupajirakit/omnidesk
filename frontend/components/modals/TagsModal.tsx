import React from 'react';
import { X, Tag } from 'lucide-react';
import { useI18n } from '../../i18n';

interface TagsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tags: string[];
}

export const TagsModal: React.FC<TagsModalProps> = ({ isOpen, onClose, tags }) => {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white/45 backdrop-blur transition-opacity">
      <div className="bg-dark-800 border border-dark-700 rounded-xl shadow-2xl w-full max-w-sm transform transition-all scale-100">
        <div className="flex justify-between items-center p-4 border-b border-dark-700">
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Tag className="text-primary-500" size={20} />
            {t('tags_modal.title', { count: tags.length })}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, index) => (
                <span key={index} className="bg-primary-500/20 text-primary-500 text-sm px-3 py-1.5 rounded-full border border-primary-500/30">
                    {tag}
                </span>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-dark-700 bg-dark-900/50 rounded-b-xl">
          <button 
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-dark-700 transition-colors"
          >
            {t('tags_modal.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
