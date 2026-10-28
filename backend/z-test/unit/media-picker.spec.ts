import { Types } from 'mongoose';

// The media-picker module is not on the content barrel, and putting it there to
// satisfy a test would widen that module's public surface for no runtime reason.
// Same exemption `custom-tool-assign-scope.spec.ts:30` already takes.
// eslint-disable-next-line no-restricted-imports
import {
  MediaPickerController,
  MediaPickerKindFilter,
  MediaPickerService,
  MediaPickerSortOrder,
} from '@/modules/content/media-picker';
import { PERMISSIONS_KEY } from '@/common/decorators/require-permissions.decorator';

describe('[FEAT-20260905-MEDIAPICKER] Media Picker Service & Controller', () => {
  const albumId1 = new Types.ObjectId();
  const albumId2 = new Types.ObjectId();

  const mockAlbum1 = {
    _id: albumId1,
    detail: 'Summer Sale 2026',
    matching_tag: 'img_a_1000001',
    categories: [{ _id: new Types.ObjectId(), name: 'Promotions' }],
    group_providers: [],
    created_at: new Date('2026-09-01T10:00:00Z'),
    updated_at: new Date('2026-09-01T10:00:00Z'),
  };

  const mockAlbum2 = {
    _id: albumId2,
    detail: 'VIP Lounge Guide',
    matching_tag: 'img_a_1000002',
    categories: [{ _id: new Types.ObjectId(), name: 'Guides' }],
    group_providers: [],
    created_at: new Date('2026-09-02T10:00:00Z'),
    updated_at: new Date('2026-09-02T10:00:00Z'),
  };

  const mockStorage1 = {
    _id: new Types.ObjectId(),
    object_image_id: albumId1,
    image_url: 'https://cdn.example.com/promo1.jpg',
    media_kind: 'image',
    priority: 1,
    file_size: 102400,
    detail_text: 'Promo banner 1',
    detail_link: 'https://example.com/promo',
    created_by: { display_name: 'Admin Alice', username: 'alice' },
    created_at: new Date('2026-09-01T10:05:00Z'),
    updated_at: new Date('2026-09-01T10:05:00Z'),
  };

  const mockStorage2 = {
    _id: new Types.ObjectId(),
    object_image_id: albumId1,
    image_url: 'https://cdn.example.com/video1.mp4',
    media_kind: 'video',
    priority: 2,
    file_size: 5242880,
    detail_text: 'Teaser video 15s',
    detail_link: null,
    created_by: { display_name: null, username: 'bob' },
    created_at: new Date('2026-09-01T10:10:00Z'),
    updated_at: new Date('2026-09-01T10:10:00Z'),
  };

  /* A Mongoose model stub is a handful of jest.fn()s. `any` was flagged; naming
     the methods the tests actually drive says the same thing, keeps index access
     defined, and makes an added call site visible instead of silently allowed. */
  interface ModelStub {
    countDocuments: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  }
  /** A stub is not a Mongoose Model; the cast is at the ONE construction site. */
  const asModel = (stub: ModelStub): never => stub as never;
  const modelStub = (over: Partial<ModelStub>): ModelStub => ({
    countDocuments: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    ...over,
  });
  let mockObjectImageModel: ModelStub;
  let mockImageStorageModel: ModelStub;
  let mockHookModel: ModelStub;
  let service: MediaPickerService;
  let controller: MediaPickerController;

  beforeEach(() => {
    mockObjectImageModel = {
      countDocuments: jest.fn().mockResolvedValue(2),
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockAlbum2, mockAlbum1]),
      }),
      findOne: jest.fn(),
    };

    mockImageStorageModel = modelStub({
      countDocuments: jest.fn().mockResolvedValue(2),
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockStorage2, mockStorage1]),
      }),
    });

    mockHookModel = modelStub({
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      }),
    });

    service = new MediaPickerService(
      asModel(mockObjectImageModel),
      asModel(mockImageStorageModel),
      asModel(mockHookModel),
    );

    controller = new MediaPickerController(service);
  });

  describe('Permissions & Controller Decorator', () => {
    it('MediaPickerController specifies required permissions for flex, broadcast and object manage', () => {
      const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.listAlbums);
      expect(perms).toEqual(
        expect.arrayContaining([
          'flex.manage',
          'broadcast.manage',
          'object.manage',
        ]),
      );

      const itemPerms = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.listMediaItems,
      );
      expect(itemPerms).toEqual(
        expect.arrayContaining([
          'flex.manage',
          'broadcast.manage',
          'object.manage',
        ]),
      );
    });
  });

  describe('listAlbums', () => {
    it('returns paginated albums with precomputed item counts and has_video flags', async () => {
      mockImageStorageModel.find.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([mockStorage1, mockStorage2]),
      });

      const res = await service.listAlbums(
        { page: 1, limit: 10, sort: MediaPickerSortOrder.DESC },
        {
          id: 'u1',
          username: 'dev',
          groups: [],
          permissions: ['flex.manage'],
        } as never,
      );

      expect(res.pagination.page).toBe(1);
      expect(res.pagination.limit).toBe(10);
      expect(res.pagination.total).toBe(2);
      expect(res.pagination.total_pages).toBe(1);
      expect(res.data).toHaveLength(2);

      // Verify album 1 contains video and thumb
      const a1 = res.data.find((a) => String(a.id) === String(albumId1));
      expect(a1).toBeDefined();
      expect(a1?.first_thumb).toBe('https://cdn.example.com/promo1.jpg');
      expect(a1?.item_count).toBe(2);
      expect(a1?.has_video).toBe(true);
    });

    it('⭐ [FIX-20260906-ALBUMTHUMB] the thumbnail is the first IMAGE, not the first row', async () => {
      /* `albumStorages` is sorted by `priority` alone, so an operator who uploads
         the teaser VIDEO first gets priority 1 on a video row. `albumStorages[0]`
         then handed the tile a video's `image_url`, which is not a picture, and the
         album showed no cover at all. The rows below are deliberately in that
         order — video first — because a fixture that puts the image first cannot
         tell the two implementations apart. อัลบั้มที่วิดีโอมาก่อน ต้องยังมีปก */
      const videoFirst = {
        _id: 's-vid',
        object_image_id: albumId1,
        image_url: 'https://cdn.example.com/teaser.mp4',
        media_kind: 'video',
        priority: 1,
      };
      const imageSecond = {
        _id: 's-img',
        object_image_id: albumId1,
        image_url: 'https://cdn.example.com/cover.jpg',
        media_kind: 'image',
        priority: 2,
      };
      mockImageStorageModel.find.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([videoFirst, imageSecond]),
      });

      const res = await service.listAlbums(
        { page: 1, limit: 10, sort: MediaPickerSortOrder.DESC },
        {
          id: 'u1',
          username: 'dev',
          groups: [],
          permissions: ['flex.manage'],
        } as never,
      );

      const a1 = res.data.find((a) => String(a.id) === String(albumId1));
      expect(a1?.first_thumb).toBe('https://cdn.example.com/cover.jpg');
      // the video is still reported — only the COVER changed
      expect(a1?.has_video).toBe(true);
      expect(a1?.item_count).toBe(2);
    });

    it('an all-video album keeps its previous answer rather than becoming null', async () => {
      /* The `?? albumStorages[0]` half of the fix. Without it this album would
         answer `null` where it used to answer something — a second behaviour
         change nobody asked for, in a case that was never wrong. */
      mockImageStorageModel.find.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([
          {
            _id: 's-only',
            object_image_id: albumId1,
            image_url: 'https://cdn.example.com/only.mp4',
            media_kind: 'video',
            priority: 1,
          },
        ]),
      });

      const res = await service.listAlbums(
        { page: 1, limit: 10, sort: MediaPickerSortOrder.DESC },
        {
          id: 'u1',
          username: 'dev',
          groups: [],
          permissions: ['flex.manage'],
        } as never,
      );

      const a1 = res.data.find((a) => String(a.id) === String(albumId1));
      expect(a1?.first_thumb).toBe('https://cdn.example.com/only.mp4');
    });

    it('passes search filter with regex escaping', async () => {
      mockImageStorageModel.find.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([]),
      });

      await service.listAlbums(
        { page: 1, limit: 10, search: 'Sale (2026)' },
        null,
      );

      const calledFilter = mockObjectImageModel.countDocuments.mock.calls[0][0];
      expect(calledFilter['$or']).toBeDefined();
      expect(calledFilter['$or'][0].detail.$regex).toBe('Sale \\(2026\\)');
    });

    it('ignores search query with fewer than 4 characters to prevent database bottleneck', async () => {
      mockImageStorageModel.find.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([]),
      });

      await service.listAlbums({ page: 1, limit: 10, search: 'abc' }, null);

      const calledFilter = mockObjectImageModel.countDocuments.mock.calls[0][0];
      expect(calledFilter['$or']).toBeUndefined();
    });

    it('applies ascending sort when sort=asc is specified', async () => {
      mockImageStorageModel.find.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([]),
      });

      const sortMock = jest.fn().mockReturnThis();
      mockObjectImageModel.find.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        sort: sortMock,
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
      });

      await service.listAlbums(
        { page: 1, limit: 10, sort: MediaPickerSortOrder.ASC },
        null,
      );

      expect(sortMock).toHaveBeenCalledWith({ created_at: 1 });
    });
  });

  describe('listMediaItems', () => {
    it('throws BadRequestException for invalid album_id', async () => {
      await expect(
        service.listMediaItems({ album_id: 'bad-id' }, null),
      ).rejects.toThrow('invalid or missing album_id');
    });

    it('throws NotFoundException if album does not exist or out of scope', async () => {
      mockObjectImageModel.findOne.mockResolvedValueOnce(null);

      await expect(
        service.listMediaItems({ album_id: albumId1.toHexString() }, null),
      ).rejects.toThrow('album not found or access denied');
    });

    it('filters media items by media_kind: video', async () => {
      mockObjectImageModel.findOne.mockResolvedValueOnce(mockAlbum1);
      mockImageStorageModel.countDocuments.mockResolvedValueOnce(1);
      mockImageStorageModel.find.mockReturnValueOnce({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockStorage2]),
      });

      const res = await service.listMediaItems(
        {
          album_id: albumId1.toHexString(),
          media_kind: MediaPickerKindFilter.VIDEO,
          page: 1,
          limit: 18,
          sort: MediaPickerSortOrder.DESC,
        },
        null,
      );

      expect(res.data).toHaveLength(1);
      expect(res.data[0]!.media_kind).toBe('video');
      expect(res.data[0]!.created_by_name).toBe('bob');
      expect(res.album.detail).toBe('Summer Sale 2026');

      const filterUsed = mockImageStorageModel.countDocuments.mock.calls[0][0];
      expect(filterUsed['media_kind']).toBe('video');
    });

    it('filters media items by media_kind: image (matches non-video)', async () => {
      mockObjectImageModel.findOne.mockResolvedValueOnce(mockAlbum1);
      mockImageStorageModel.countDocuments.mockResolvedValueOnce(1);
      mockImageStorageModel.find.mockReturnValueOnce({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([mockStorage1]),
      });

      const res = await service.listMediaItems(
        {
          album_id: albumId1.toHexString(),
          media_kind: MediaPickerKindFilter.IMAGE,
        },
        null,
      );

      expect(res.data).toHaveLength(1);
      expect(res.data[0]!.media_kind).toBe('image');
      expect(res.data[0]!.created_by_name).toBe('Admin Alice');

      const filterUsed = mockImageStorageModel.countDocuments.mock.calls[0][0];
      expect(filterUsed['media_kind']).toEqual({ $ne: 'video' });
    });
  });
});
