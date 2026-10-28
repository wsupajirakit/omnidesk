import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { type Model } from 'mongoose';

import type { AuthenticatedUser } from '@/common';
import { escapeRegex } from '@/common/utils';
import { getAllowedHookIds, Hook, type HookDocument } from '@/modules/hooks';
import { objectScopeFilter } from '../object-scope';
import {
  ImageStorage,
  type ImageStorageDocument,
} from '../schemas/image-storage.schema';
import {
  ObjectImage,
  type ObjectImageDocument,
} from '../schemas/object-image.schema';
import {
  ListMediaAlbumsQueryDto,
  ListMediaItemsQueryDto,
  MediaPickerKindFilter,
  MediaPickerSortOrder,
} from './dto/media-picker.dto';

/** Helper to extract safe uploader display name from populated user row */
function extractUploaderName(createdBy: unknown): string | null {
  if (!createdBy || typeof createdBy !== 'object') return null;
  const user = createdBy as { display_name?: unknown; username?: unknown };
  if (typeof user.display_name === 'string' && user.display_name.trim()) {
    return user.display_name;
  }
  if (typeof user.username === 'string' && user.username.trim()) {
    return user.username;
  }
  return null;
}

export interface MediaPickerAlbumItem {
  id: unknown;
  detail: string;
  matching_tag: unknown;
  first_thumb: string | null;
  item_count: number;
  has_video: boolean;
  categories: Array<{ id: unknown; name: string }>;
  created_at?: Date;
  updated_at?: Date;
}

export interface MediaPickerMediaItem {
  id: unknown;
  image_url: string;
  media_kind: 'image' | 'video';
  file_size: number;
  detail_text: string | null;
  detail_link: string | null;
  priority: number;
  created_by_name: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface MediaPickerItemsResult extends PaginatedResult<MediaPickerMediaItem> {
  album: {
    id: unknown;
    detail: string;
    matching_tag: unknown;
  };
}

/**
 * [FEAT-20260905-MEDIAPICKER] Central Media Picker Service
 *
 * Provides a scoped, paginated, searchable and date-sortable asset discovery
 * endpoint for both images and videos in the Object library, respecting user
 * JWT permissions and group scopes.
 */
@Injectable()
export class MediaPickerService {
  constructor(
    @InjectModel(ObjectImage.name)
    private readonly objectImageModel: Model<ObjectImageDocument>,
    @InjectModel(ImageStorage.name)
    private readonly imageStorageModel: Model<ImageStorageDocument>,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
  ) {}

  /** Resolves caller's scope filter across groups and authorized hooks */
  private async resolveScope(
    user?: AuthenticatedUser | null,
  ): Promise<Record<string, unknown>> {
    const allowedHookIds = await getAllowedHookIds(user, this.hookModel);
    return objectScopeFilter({
      groupIds: user?.groups ?? [],
      allowedHookIds,
      includeDisabled: false,
    });
  }

  /**
   * List albums (ObjectImage rows) with pagination, search, date sorting,
   * and precomputed media count and video indicator.
   */
  public async listAlbums(
    dto: ListMediaAlbumsQueryDto,
    user?: AuthenticatedUser | null,
  ): Promise<PaginatedResult<MediaPickerAlbumItem>> {
    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(dto.limit) || 12));
    const skip = (page - 1) * limit;
    const sortDirection: 1 | -1 =
      dto.sort === MediaPickerSortOrder.ASC ? 1 : -1;

    const filters: Record<string, unknown> = {
      deleted_at: { $exists: false },
      status: { $ne: false },
    };

    const scope = await this.resolveScope(user);
    Object.assign(filters, scope);

    const searchTrimmed = (dto.search || '').trim();
    if (searchTrimmed.length >= 4) {
      const escaped = escapeRegex(searchTrimmed);
      filters['$or'] = [
        { detail: { $regex: escaped, $options: 'i' } },
        { matching_tag: { $regex: escaped, $options: 'i' } },
      ];
    }

    const total = await this.objectImageModel.countDocuments(filters);
    const totalPages = Math.ceil(total / limit) || 1;

    const albums = await this.objectImageModel
      .find(filters)
      .select(
        '_id detail matching_tag categories group_providers created_at updated_at',
      )
      .populate('categories', 'name')
      .sort({ created_at: sortDirection })
      .skip(skip)
      .limit(limit);

    if (albums.length === 0) {
      return {
        data: [],
        pagination: {
          page,
          limit,
          total,
          total_pages: totalPages,
        },
      };
    }

    // Batch query all image storages for these albums to prevent N+1 queries
    const albumIds = albums.map((a) => a._id);
    const storages = await this.imageStorageModel
      .find({
        object_image_id: { $in: albumIds },
        deleted_at: { $exists: false },
      })
      .select('_id object_image_id image_url media_kind priority created_at')
      .sort({ priority: 1, created_at: 1 });

    const storageMap = new Map<string, typeof storages>();
    for (const storage of storages) {
      if (!storage.object_image_id) continue;
      const key = storage.object_image_id.toString();
      const list = storageMap.get(key) || [];
      list.push(storage);
      storageMap.set(key, list);
    }

    const data: MediaPickerAlbumItem[] = albums.map((album) => {
      const albumStorages = storageMap.get(album._id.toString()) || [];
      const hasVideo = albumStorages.some((s) => s.media_kind === 'video');
      /* [FIX-20260906-ALBUMTHUMB] The thumbnail is the first IMAGE, not merely the
         first row. `albumStorages` is sorted by `priority` alone, so an operator who
         uploads the teaser video first gets priority 1 on a video row — and the album
         tile then has nothing to show, because a video's `image_url` is not a picture.
         The `?? albumStorages[0]` keeps an all-video album behaving exactly as before
         rather than turning it into a null, so the only case whose answer changes is
         the one that was wrong. อัลบั้มที่วิดีโอมาก่อน ต้องไม่กลายเป็นไม่มีปก */
      const firstStorage =
        albumStorages.find((s) => s.media_kind !== 'video') ?? albumStorages[0];

      const rawCats = Array.isArray(album.categories) ? album.categories : [];
      const categories = rawCats.map((cat: unknown) => {
        if (typeof cat === 'object' && cat !== null && '_id' in cat) {
          const c = cat as { _id: unknown; name?: string };
          return { id: c._id, name: c.name || '' };
        }
        return { id: cat, name: '' };
      });

      return {
        id: album._id,
        detail: album.detail || '',
        matching_tag: album.matching_tag,
        first_thumb: firstStorage?.image_url || null,
        item_count: albumStorages.length,
        has_video: hasVideo,
        categories,
        created_at: (album as unknown as { created_at?: Date }).created_at,
        updated_at: (album as unknown as { updated_at?: Date }).updated_at,
      };
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    };
  }

  /**
   * List media items (ImageStorage rows) within a specific album, with
   * kind-filter (all/image/video), search, date sorting, and pagination.
   */
  public async listMediaItems(
    dto: ListMediaItemsQueryDto,
    user?: AuthenticatedUser | null,
  ): Promise<MediaPickerItemsResult> {
    if (!dto.album_id || !mongoose.isValidObjectId(dto.album_id)) {
      throw new BadRequestException('invalid or missing album_id');
    }

    const page = Math.max(1, Number(dto.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(dto.limit) || 18));
    const skip = (page - 1) * limit;
    const sortDirection: 1 | -1 =
      dto.sort === MediaPickerSortOrder.ASC ? 1 : -1;

    // Verify parent album exists and is in user scope
    const albumFilter: Record<string, unknown> = {
      _id: new mongoose.Types.ObjectId(dto.album_id),
      deleted_at: { $exists: false },
      status: { $ne: false },
    };
    const scope = await this.resolveScope(user);
    Object.assign(albumFilter, scope);

    const album = await this.objectImageModel.findOne(albumFilter);
    if (!album) {
      throw new NotFoundException('album not found or access denied');
    }

    const itemFilter: Record<string, unknown> = {
      object_image_id: album._id,
      deleted_at: { $exists: false },
    };

    if (dto.media_kind === MediaPickerKindFilter.IMAGE) {
      // Legacy rows have no media_kind and are images; new images have media_kind === 'image'
      itemFilter['media_kind'] = { $ne: 'video' };
    } else if (dto.media_kind === MediaPickerKindFilter.VIDEO) {
      itemFilter['media_kind'] = 'video';
    }

    const searchTrimmed = (dto.search || '').trim();
    if (searchTrimmed.length >= 4) {
      const escaped = escapeRegex(searchTrimmed);
      itemFilter['$or'] = [
        { detail_text: { $regex: escaped, $options: 'i' } },
        { detail_link: { $regex: escaped, $options: 'i' } },
        { image_url: { $regex: escaped, $options: 'i' } },
      ];
    }

    const total = await this.imageStorageModel.countDocuments(itemFilter);
    const totalPages = Math.ceil(total / limit) || 1;

    const items = await this.imageStorageModel
      .find(itemFilter)
      .populate('created_by', 'display_name username')
      .sort({ created_at: sortDirection, priority: 1 })
      .skip(skip)
      .limit(limit);

    const data: MediaPickerMediaItem[] = items.map((item) => {
      const isVideo = item.media_kind === 'video';
      return {
        id: item._id,
        image_url: item.image_url,
        media_kind: isVideo ? 'video' : 'image',
        file_size: item.file_size || 0,
        detail_text: item.detail_text || null,
        detail_link: item.detail_link || null,
        priority: item.priority ?? 1,
        created_by_name: extractUploaderName(item.created_by),
        created_at: (item as unknown as { created_at?: Date }).created_at,
        updated_at: (item as unknown as { updated_at?: Date }).updated_at,
      };
    });

    return {
      data,
      album: {
        id: album._id,
        detail: album.detail || '',
        matching_tag: album.matching_tag,
      },
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    };
  }
}
