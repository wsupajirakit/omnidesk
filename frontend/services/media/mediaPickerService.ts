// [FEAT-20260905-MEDIAPICKER] Central media picker service.
// Communicates with /api/media-picker/albums and /api/media-picker/items endpoints.
import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

export type MediaPickerSortOrder = 'desc' | 'asc';
export type MediaPickerKindFilter = 'all' | 'image' | 'video';

export interface MediaPickerAlbumItem {
  id: string;
  detail: string;
  matching_tag: string | null;
  first_thumb: string | null;
  item_count: number;
  has_video: boolean;
  categories: Array<{ id: string; name: string }>;
  created_at?: string;
  updated_at?: string;
}

export interface MediaPickerMediaItem {
  id: string;
  image_url: string;
  media_kind: 'image' | 'video';
  file_size: number;
  detail_text: string | null;
  detail_link: string | null;
  priority: number;
  created_by_name: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MediaPickerPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ListAlbumsResponse {
  data: MediaPickerAlbumItem[];
  pagination: MediaPickerPagination;
}

export interface ListMediaItemsResponse {
  data: MediaPickerMediaItem[];
  album: {
    id: string;
    detail: string;
    matching_tag: string | null;
  };
  pagination: MediaPickerPagination;
}

export interface ListAlbumsParams {
  page?: number;
  limit?: number;
  search?: string;
  sort?: MediaPickerSortOrder;
}

export interface ListMediaItemsParams {
  album_id: string;
  page?: number;
  limit?: number;
  search?: string;
  media_kind?: MediaPickerKindFilter;
  sort?: MediaPickerSortOrder;
}

/**
 * Fetches paginated albums from /api/media-picker/albums
 */
export const listMediaPickerAlbums = async (
  params: ListAlbumsParams = {},
): Promise<ListAlbumsResponse> => {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.search && params.search.trim()) query.set('search', params.search.trim());
  if (params.sort) query.set('sort', params.sort);

  const url = `${API_BASE_URL}/api/media-picker/albums?${query.toString()}`;
  const res = await authFetch(url);
  return handleApiResponse<ListAlbumsResponse>(res, 'list media picker albums');
};

/**
 * Fetches paginated media items (images & videos) for a specific album from /api/media-picker/items
 */
export const listMediaPickerItems = async (
  params: ListMediaItemsParams,
): Promise<ListMediaItemsResponse> => {
  const query = new URLSearchParams();
  query.set('album_id', params.album_id);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.search && params.search.trim()) query.set('search', params.search.trim());
  if (params.media_kind && params.media_kind !== 'all') {
    query.set('media_kind', params.media_kind);
  }
  if (params.sort) query.set('sort', params.sort);

  const url = `${API_BASE_URL}/api/media-picker/items?${query.toString()}`;
  const res = await authFetch(url);
  return handleApiResponse<ListMediaItemsResponse>(res, 'list media picker items');
};
