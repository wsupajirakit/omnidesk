import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ScrollIndicatorProps {
  containerRef: React.RefObject<HTMLDivElement>;
}

export const ScrollIndicator: React.FC<ScrollIndicatorProps> = ({ containerRef }) => {
  const [showDown, setShowDown] = useState(false);
  const [showUp, setShowUp] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const checkScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      // Show down if there is more to scroll and we haven't reached the bottom
      const canScrollDown = scrollHeight > clientHeight + 5 && scrollTop + clientHeight < scrollHeight - 30;
      // Show up if we have scrolled down a bit
      const canScrollUp = scrollTop > 30;
      
      setShowDown(canScrollDown);
      setShowUp(canScrollUp);
    };

    // Initial check
    checkScroll();

    // Resize observer to catch content changes
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);
    
    // Also observe children
    const childObserver = new MutationObserver(checkScroll);
    childObserver.observe(el, { childList: true, subtree: true });

    el.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);

    return () => {
      observer.disconnect();
      childObserver.disconnect();
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [containerRef]);

  const handleScrollDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    containerRef.current?.scrollBy({ top: 250, behavior: 'smooth' });
  };

  const handleScrollUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    containerRef.current?.scrollBy({ top: -250, behavior: 'smooth' });
  };

  if (!showDown && !showUp) return null;

  return (
    <>
      {showUp && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-4 duration-500">
          <button 
            type="button"
            onClick={handleScrollUp}
            className="w-12 h-12 flex items-center justify-center bg-primary-600 rounded-full border-[3px] border-primary-400 shadow-[0_10px_25px_rgba(6,199,85,0.4)] relative group hover:scale-110 active:scale-95 transition-all cursor-pointer"
            title="Scroll Up"
          >
            <div className="absolute inset-0 rounded-full bg-primary-400 animate-ping opacity-20"></div>
            <ChevronUp size={24} strokeWidth={4} className="text-white relative z-10" />
          </button>
        </div>
      )}

      {showDown && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-bottom-4 duration-500">
          <button 
            type="button"
            onClick={handleScrollDown}
            className="w-12 h-12 flex items-center justify-center bg-primary-600 rounded-full border-[3px] border-primary-400 shadow-[0_10px_25px_rgba(6,199,85,0.4)] relative group hover:scale-110 active:scale-95 transition-all cursor-pointer"
            title="Scroll Down"
          >
            <div className="absolute inset-0 rounded-full bg-primary-400 animate-ping opacity-20"></div>
            <ChevronDown size={24} strokeWidth={4} className="text-white animate-bounce relative z-10" />
          </button>
        </div>
      )}
    </>
  );
};
