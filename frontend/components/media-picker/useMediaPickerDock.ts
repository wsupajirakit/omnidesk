// [FEAT-20260905-DOCKHOOK] Reusable hook to manage modal vs side-panel docked state.
// Encapsulates all docking, maximizing, and confirmation state logic so consuming
// components (like FlexMessageFormModal) remain ultra-clean and zero-debt.
import { useState, useCallback } from 'react';

export interface UseMediaPickerDockOptions {
  initialDocked?: boolean;
}

export function useMediaPickerDock(options: UseMediaPickerDockOptions = {}) {
  const [isDocked, setIsDocked] = useState<boolean>(options.initialDocked || false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const openPicker = useCallback(() => {
    // [USER-DIRECTIVE] When clicking attach, default directly into side panel
    setIsDocked(true);
    setIsModalOpen(false);
  }, []);

  const openModal = useCallback(() => {
    setIsDocked(false);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const dockPanel = useCallback(() => {
    setIsModalOpen(false);
    setIsDocked(true);
  }, []);

  const maximizePanel = useCallback(() => {
    setIsDocked(false);
    setIsModalOpen(true);
  }, []);

  const closeDockedPanel = useCallback(() => {
    setIsDocked(false);
  }, []);

  return {
    isDocked,
    isModalOpen,
    openPicker,
    openModal,
    closeModal,
    dockPanel,
    maximizePanel,
    closeDockedPanel,
  };
}
