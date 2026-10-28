// [FEAT-20260905-MEDIAPICKER] DOM tests for central MediaPickerModal, views, and AttachMediaButton.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { I18nProvider } from '../i18n';
import {
  AttachMediaButton,
  MediaPickerModal,
  AlbumListView,
  MediaItemListView,
  MediaPreviewModal,
  DockedMediaPicker,
  useMediaPickerDock,
} from '../components/media-picker';
import * as mediaPickerService from '../services/media/mediaPickerService';

// Custom render wrapped in I18nProvider for full Thai/English translation support
const renderWithI18n = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

// Mock service calls
vi.mock('../services/media/mediaPickerService', async () => {
  const actual = await vi.importActual('../services/media/mediaPickerService');
  return {
    ...actual,
    listMediaPickerAlbums: vi.fn(),
    listMediaPickerItems: vi.fn(),
  };
});

const mockAlbumsResponse: mediaPickerService.ListAlbumsResponse = {
  data: [
    {
      id: 'album-1',
      detail: 'Summer Promo 2026',
      matching_tag: 'promo_summer',
      first_thumb: 'https://example.com/uploads/images/thumb1.jpg',
      item_count: 5,
      has_video: true,
      categories: [{ id: 'cat-1', name: 'Promotions' }],
      created_at: '2026-09-05T10:00:00.000Z',
    },
    {
      id: 'album-2',
      detail: 'Product Banners',
      matching_tag: 'banners',
      first_thumb: 'https://example.com/uploads/images/thumb2.jpg',
      item_count: 3,
      has_video: false,
      categories: [],
      created_at: '2026-09-04T10:00:00.000Z',
    },
  ],
  pagination: {
    page: 1,
    limit: 12,
    total: 2,
    total_pages: 1,
  },
};

const mockItemsResponse: mediaPickerService.ListMediaItemsResponse = {
  data: [
    {
      id: 'item-1',
      image_url: 'https://example.com/uploads/images/banner1.jpg',
      media_kind: 'image',
      file_size: 2450000,
      detail_text: 'Main Promo Banner High Res',
      detail_link: null,
      priority: 1,
      created_by_name: 'admin_joe',
      created_at: '2026-09-05T10:30:00.000Z',
    },
    {
      id: 'item-2',
      image_url: 'https://example.com/uploads/videos/intro.mp4',
      media_kind: 'video',
      file_size: 15400000,
      detail_text: 'Product Intro Clip 15s',
      detail_link: null,
      priority: 2,
      created_by_name: 'admin_joe',
      created_at: '2026-09-05T10:35:00.000Z',
    },
  ],
  album: {
    id: 'album-1',
    detail: 'Summer Promo 2026',
    matching_tag: 'promo_summer',
  },
  pagination: {
    page: 1,
    limit: 18,
    total: 2,
    total_pages: 1,
  },
};

describe('Central Media Picker Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mediaPickerService.listMediaPickerAlbums).mockResolvedValue(mockAlbumsResponse);
    vi.mocked(mediaPickerService.listMediaPickerItems).mockResolvedValue(mockItemsResponse);

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders AttachMediaButton with correct default label', () => {
    renderWithI18n(<AttachMediaButton />);
    const btn = screen.getByRole('button', { name: /attach vdo \/ img/i });
    expect(btn).toBeInTheDocument();
  });

  it('opens MediaPickerModal when AttachMediaButton is clicked', async () => {
    renderWithI18n(<AttachMediaButton />);
    const btn = screen.getByRole('button', { name: /attach vdo \/ img/i });
    fireEvent.click(btn);

    expect(await screen.findByText(/เลือกรูปภาพและวิดีโอ/i)).toBeInTheDocument();
    expect(mediaPickerService.listMediaPickerAlbums).toHaveBeenCalled();
  });

  it('renders AlbumListView with search, date sort, and albums cards', async () => {
    const handleSelectAlbum = vi.fn();
    renderWithI18n(<AlbumListView onSelectAlbum={handleSelectAlbum} />);

    // Check loading then data
    expect(await screen.findByText('Summer Promo 2026')).toBeInTheDocument();
    expect(screen.getByText('Product Banners')).toBeInTheDocument();
    // User requested: No tag on album (so #promo_summer should not be shown)
    expect(screen.queryByText('#promo_summer')).not.toBeInTheDocument();
    expect(screen.getByText('5 รายการ')).toBeInTheDocument();

    // Verify date sorting toggle button
    const sortBtn = screen.getByRole('button', { name: /วันที่: ล่าสุด/i });
    expect(sortBtn).toBeInTheDocument();
    fireEvent.click(sortBtn);

    // Should request asc sort
    await waitFor(() => {
      expect(mediaPickerService.listMediaPickerAlbums).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'asc' }),
      );
    });

    // Clicking an album card triggers selection
    const albumCard = screen.getByText('Summer Promo 2026');
    fireEvent.click(albumCard);
    expect(handleSelectAlbum).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'album-1' }),
    );
  });

  it('renders MediaItemListView with filter pills (All / Image / Video), search, and copy link', async () => {
    const handleBack = vi.fn();
    const handleNotify = vi.fn();

    renderWithI18n(
      <MediaItemListView
        album={mockAlbumsResponse.data[0]}
        onBackToAlbums={handleBack}
        onNotifyCopied={handleNotify}
      />,
    );

    // Breadcrumb album title
    expect(await screen.findByText('Summer Promo 2026')).toBeInTheDocument();

    // Filter pills (shown after entering album)
    const allPill = screen.getByRole('button', { name: 'ทั้งหมด' });
    const imgPill = screen.getByRole('button', { name: /รูปภาพ/i });
    const vdoPill = screen.getByRole('button', { name: /วิดีโอ/i });

    expect(allPill).toBeInTheDocument();
    expect(imgPill).toBeInTheDocument();
    expect(vdoPill).toBeInTheDocument();

    // Display items
    expect(screen.getByText('Main Promo Banner High Res')).toBeInTheDocument();
    expect(screen.getByText('Product Intro Clip 15s')).toBeInTheDocument();

    // Badges: Only VDO badge should exist (no IMG badge per user requirement)
    expect(screen.queryByText('IMG')).not.toBeInTheDocument();
    expect(screen.getByText('VDO')).toBeInTheDocument();
    expect(screen.getByText('2.3 MB')).toBeInTheDocument();
    expect(screen.getByText('14.7 MB')).toBeInTheDocument();

    // Filter by Video
    fireEvent.click(vdoPill);
    await waitFor(() => {
      expect(mediaPickerService.listMediaPickerItems).toHaveBeenCalledWith(
        expect.objectContaining({ media_kind: 'video' }),
      );
    });

    // Test Copy link button (คัดลอกลิงก์)
    const copyBtns = screen.getAllByRole('button', { name: /copy link|คัดลอกลิงก์/i });
    expect(copyBtns.length).toBeGreaterThan(0);
    fireEvent.click(copyBtns[0]);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/uploads/images/banner1.jpg'),
      );
      expect(handleNotify).toHaveBeenCalledWith(
        expect.stringContaining('/uploads/images/banner1.jpg'),
      );
    });

    // Back button
    const backBtn = screen.getByRole('button', { name: /กลับไปอัลบั้ม/i });
    fireEvent.click(backBtn);
    expect(handleBack).toHaveBeenCalled();
  });

  it('renders MediaPreviewModal with interactive preview and metadata', async () => {
    const handleClose = vi.fn();
    const handleCopySuccess = vi.fn();

    const videoItem = mockItemsResponse.data[1]; // video item
    renderWithI18n(
      <MediaPreviewModal
        item={videoItem}
        onClose={handleClose}
        onCopySuccess={handleCopySuccess}
      />,
    );

    expect(screen.getByText('Product Intro Clip 15s')).toBeInTheDocument();
    expect(screen.getByText('VDO')).toBeInTheDocument();
    expect(screen.getByText('14.7 MB')).toBeInTheDocument();
    expect(screen.getByText('admin_joe')).toBeInTheDocument();

    // Copy link in preview
    const copyBtn = screen.getByRole('button', { name: /คัดลอกลิงก์ \(copy\)/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/uploads/videos/intro.mp4'),
      );
      expect(handleCopySuccess).toHaveBeenCalled();
    });
  });

  it('renders Upload More button on modal header that opens /object-images in a new tab', async () => {
    const originalOpen = window.open;
    window.open = vi.fn();

    renderWithI18n(<MediaPickerModal isOpen={true} onClose={vi.fn()} />);

    const uploadMoreBtn = screen.getByRole('button', { name: /อัปโหลดเพิ่มเติม|upload more/i });
    expect(uploadMoreBtn).toBeInTheDocument();
    fireEvent.click(uploadMoreBtn);

    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('#/object-images'),
      '_blank',
      'noopener,noreferrer',
    );

    window.open = originalOpen;
  });

  it('requires at least 4 characters to trigger search and does not search on 1-3 chars', async () => {
    renderWithI18n(<AlbumListView onSelectAlbum={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText(/ค้นหาอัลบั้ม \(พิมพ์อย่างน้อย 4 ตัวอักษร\)/i);
    expect(searchInput).toBeInTheDocument();

    // Type 2 characters
    fireEvent.change(searchInput, { target: { value: 'ab' } });

    // Hint should appear
    expect(await screen.findByText(/พิมพ์อีก 2 ตัวอักษรเพื่อค้นหา/i)).toBeInTheDocument();

    // Fast-forward debounce: listMediaPickerAlbums should NOT be called with 'ab'
    await waitFor(() => {
      expect(mediaPickerService.listMediaPickerAlbums).not.toHaveBeenCalledWith(
        expect.objectContaining({ search: 'ab' }),
      );
    });

    // Type 4 characters
    fireEvent.change(searchInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(mediaPickerService.listMediaPickerAlbums).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'test' }),
      );
    });
  });

  it('renders minimize/dock button on MediaPickerModal and calls onDock when clicked', async () => {
    const handleDock = vi.fn();
    renderWithI18n(
      <MediaPickerModal
        isOpen={true}
        onClose={vi.fn()}
        onDock={handleDock}
      />,
    );

    const dockBtn = screen.getByRole('button', { name: /ย่อแผงข้าง|dock to panel/i });
    expect(dockBtn).toBeInTheDocument();
    fireEvent.click(dockBtn);

    expect(handleDock).toHaveBeenCalledTimes(1);
  });

  it('renders DockedMediaPicker with Maximize and Close buttons, prompting styled theme ConfirmModal', async () => {
    const handleMaximize = vi.fn();
    const handleClose = vi.fn();

    renderWithI18n(
      <DockedMediaPicker
        onMaximize={handleMaximize}
        onClose={handleClose}
      />,
    );

    // Title should show clean modal title
    expect(screen.getByText(/เลือกรูปภาพและวิดีโอ/i)).toBeInTheDocument();

    // Maximize button - opens styled theme ConfirmModal
    const maxBtn = screen.getByRole('button', { name: /ขยายเต็มจอ|maximize/i });
    expect(maxBtn).toBeInTheDocument();
    fireEvent.click(maxBtn);

    // ConfirmModal should appear with message
    expect(
      screen.getByText(/คุณต้องการขยาย Media Picker เป็นหน้าต่างเต็มจอหรือไม่\?/i),
    ).toBeInTheDocument();

    // Click confirm in ConfirmModal
    const confirmButtons = screen.getAllByRole('button', { name: /ยืนยัน|confirm/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(handleMaximize).toHaveBeenCalledTimes(1);

    // Close button - opens styled theme ConfirmModal
    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);

    // ConfirmModal should appear with close message
    expect(
      screen.getByText(/คุณต้องการปิด Media Picker และกลับไปแสดง Variable Guide หรือไม่\?/i),
    ).toBeInTheDocument();

    // Click confirm in ConfirmModal
    const confirmCloseButtons = screen.getAllByRole('button', { name: /ยืนยัน|confirm/i });
    fireEvent.click(confirmCloseButtons[confirmCloseButtons.length - 1]);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('renders AlbumListView with single grid density toggle button cycling 4x2 -> 6x2 -> 2x2 with toast', async () => {
    const mockOnSelect = vi.fn();
    const mockToast = vi.fn();
    const { container } = renderWithI18n(
      <AlbumListView onSelectAlbum={mockOnSelect} isDocked={true} onToast={mockToast} />,
    );

    // Wait for albums to load
    await waitFor(() => {
      expect(screen.getByText('Summer Promo 2026')).toBeInTheDocument();
    });

    // Default density is 4x2
    const grid = container.querySelector('.grid');
    expect(grid?.className).toContain('grid-cols-2 sm:grid-cols-4');

    // Single GridDensityToggle button showing current density '4x2'
    const toggleBtn = screen.getByRole('button', { name: /4x2/i });
    expect(toggleBtn).toBeInTheDocument();

    // Click to switch 4x2 -> 6x2
    fireEvent.click(toggleBtn);
    expect(grid?.className).toContain('grid-cols-3 sm:grid-cols-6');
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('6x2'));

    // Click to switch 6x2 -> 2x2
    fireEvent.click(toggleBtn);
    expect(grid?.className).toContain('grid-cols-2');
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('2x2'));

    // Click to switch 2x2 -> 4x2
    fireEvent.click(toggleBtn);
    expect(grid?.className).toContain('grid-cols-2 sm:grid-cols-4');
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('4x2'));
  });

  it('renders MediaItemListView with single grid density toggle button cycling 4x2 -> 6x2 -> 2x2 with toast', async () => {
    const mockBack = vi.fn();
    const mockToast = vi.fn();
    const { container } = renderWithI18n(
      <MediaItemListView
        album={mockAlbumsResponse.data[0]}
        onBackToAlbums={mockBack}
        isDocked={true}
        onToast={mockToast}
      />,
    );

    // Wait for items to load
    await waitFor(() => {
      expect(screen.getByText('Main Promo Banner High Res')).toBeInTheDocument();
    });

    // Default density is 4x2
    const grid = container.querySelector('.grid');
    expect(grid?.className).toContain('grid-cols-2 sm:grid-cols-4');

    // Single GridDensityToggle button showing current density '4x2'
    const toggleBtn = screen.getByRole('button', { name: /4x2/i });
    expect(toggleBtn).toBeInTheDocument();

    // Click to switch 4x2 -> 6x2
    fireEvent.click(toggleBtn);
    expect(grid?.className).toContain('grid-cols-3 sm:grid-cols-6');
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('6x2'));

    // Click to switch 6x2 -> 2x2
    fireEvent.click(toggleBtn);
    expect(grid?.className).toContain('grid-cols-2');
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('2x2'));
  });

  it('useMediaPickerDock defaults to docked side-panel on openPicker and restores variable guide on maximize', () => {
    // Component to test hook
    let hookResult: ReturnType<typeof useMediaPickerDock>;
    const TestComponent = () => {
      hookResult = useMediaPickerDock();
      return null;
    };

    render(<TestComponent />);

    // Initially closed
    expect(hookResult!.isDocked).toBe(false);
    expect(hookResult!.isModalOpen).toBe(false);

    // User clicks Attach (openPicker) -> Defaults directly to docked side panel
    act(() => {
      hookResult!.openPicker();
    });
    expect(hookResult!.isDocked).toBe(true);
    expect(hookResult!.isModalOpen).toBe(false);

    // User clicks Maximize in docked panel -> Restores Var Guide (isDocked: false) & opens Modal (isModalOpen: true)
    act(() => {
      hookResult!.maximizePanel();
    });
    expect(hookResult!.isDocked).toBe(false);
    expect(hookResult!.isModalOpen).toBe(true);

    // User docks back from Modal -> Closes modal, docks to side panel
    act(() => {
      hookResult!.dockPanel();
    });
    expect(hookResult!.isDocked).toBe(true);
    expect(hookResult!.isModalOpen).toBe(false);

    // User confirms closing docked panel -> Closes docked panel, restoring Var Guide
    act(() => {
      hookResult!.closeDockedPanel();
    });
    expect(hookResult!.isDocked).toBe(false);
    expect(hookResult!.isModalOpen).toBe(false);
  });
});
