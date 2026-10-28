import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { AuditLogService } from '@/modules/audit';
/* Through the barrel, not the internal file: `no-restricted-imports` makes a
   deep path into another module an ERROR here, and the barrel is the module's
   declared surface. */
import {
  ImageStorage,
  ImageStorageService,
  ObjectImage,
  VideoStorageService,
} from '@/modules/content';

/**
 * [FEAT-20260904-OBJVIDEO] `POST /api/image-storage/dashboard-video` — what a
 * stored Object video row actually says.
 * ===========================================================================
 * Three things decide whether this feature is right, and all three are one
 * field or one word wide, which is exactly the kind of thing that regresses
 * without anybody noticing:
 *
 *  1. the file URL points at `/uploads/videos/`, NEVER `/uploads/images/`
 *     (owner: ห้ามปนกับรูป — mixing them is the failure, not a cosmetic issue)
 *  2. `media_kind` is `'video'`, so no reader has to guess from the extension
 *     — the schema comment says outright that guessing is what this avoids
 *  3. the recorded size is the size AS STORED, because nothing re-encodes on
 *     this side: the browser shrinks before upload and there is no ffmpeg here
 *
 * ⚠️ The route path is named in this file on purpose as well: the
 * `scripts/route-coverage.mjs` gate fails a route with no test, and it reads the
 * raw text of `z-test/`. The cases below exercise the service the route calls —
 * the mention is not what makes this a test.
 */
describe('[OBJVIDEO] POST /api/image-storage/dashboard-video', () => {
  let service: VideoStorageService;
  let saved: Record<string, unknown> | null;

  const FILE = {
    filename: 'dashboard_1_abc.mp4',
    originalname: 'clip.MP4',
    path: '/srv/public/uploads/videos/dashboard_1_abc.mp4',
    size: 12_345,
  };

  /** Stands in for `new this.imageStorageModel({...})`. */
  class StorageModel {
    public _id = 'st-new';
    constructor(doc: Record<string, unknown>) {
      Object.assign(this, doc);
      saved = doc;
    }
    save(): Promise<void> {
      return Promise.resolve();
    }
    /* the priority lookup: no earlier row ⇒ priority 1 */
    static findOne(): { sort: () => Promise<null> } {
      return { sort: () => Promise.resolve(null) };
    }
  }

  const objectImageModel = {
    findById: jest.fn().mockResolvedValue({ _id: 'album-1' }),
  };

  beforeEach(async () => {
    saved = null;
    objectImageModel.findById.mockResolvedValue({ _id: 'album-1' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoStorageService,
        { provide: getModelToken(ImageStorage.name), useValue: StorageModel },
        {
          provide: getModelToken(ObjectImage.name),
          useValue: objectImageModel,
        },
        {
          provide: AuditLogService,
          useValue: { createAuditLog: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = moduleRef.get(VideoStorageService);
  });

  const upload = () =>
    service.createVideoFromDashboard(
      { userId: 'a0d00000000000000000002b' } as never,
      'album-1',
      FILE,
      'https://api.example.test',
    );

  it('🔴 stores the file under /uploads/videos, never /uploads/images', async () => {
    await upload();
    expect(saved?.image_url).toBe(
      'https://api.example.test/uploads/videos/dashboard_1_abc.mp4',
    );
    expect(String(saved?.image_url)).not.toContain('/uploads/images/');
  });

  it('🔴 marks the row media_kind=video so nobody guesses from the extension', async () => {
    await upload();
    expect(saved?.media_kind).toBe('video');
  });

  it('records the size AS STORED — nothing re-encodes on this side', async () => {
    /* The image path takes compressImage's result and falls back to file.size.
       There is no compressor here, so the raw size is the only honest number. */
    await upload();
    expect(saved?.file_size).toBe(FILE.size);
  });

  it('keeps the album link and the object source, like an image row', async () => {
    await upload();
    expect(saved?.object_image_id).toBe('album-1');
    expect(saved?.source).toBe('object');
    expect(saved?.storage_type).toBe('dashboard');
  });

  it('stores the extension lower-cased and without the dot', async () => {
    /* `clip.MP4` — the same shape the image path stores, so one column reads
       the same way for both kinds. */
    await upload();
    expect(saved?.image_type).toBe('mp4');
  });

  it('starts priority at 1 when the album has no files yet', async () => {
    await upload();
    expect(saved?.priority).toBe(1);
  });

  it('refuses a request with no album id', async () => {
    await expect(
      service.createVideoFromDashboard(
        {} as never,
        undefined,
        FILE as never,
        'https://api.example.test',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a request with no file', async () => {
    await expect(
      service.createVideoFromDashboard(
        {} as never,
        'album-1',
        undefined,
        'https://api.example.test',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an album that does not exist', async () => {
    objectImageModel.findById.mockResolvedValue(null);
    await expect(upload()).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * [FEAT-20260904-OBJVIDEO] `media_kind` survives the trip BACK OUT.
 *
 * 🔴 THE TRAP THIS PINS, and it was live until 04/09. `sanitizeStorage` builds
 * a NEW object field by field, so a column not named there is dropped on the
 * way to the client. `media_kind` had been on the schema since 25/08 and was
 * written by the LINE inbound path — and no client could ever see it, because
 * the sanitizer never listed it. The row was right; the screen could not know.
 *
 * ⚠️ Writing the field is only half a round trip. This is the other half.
 * ฟิลด์ที่ไม่อยู่ในลิสต์ขาออก = หายเงียบ ทั้งที่ DB ถูก
 */
describe('[OBJVIDEO] sanitizeStorage keeps media_kind', () => {
  const sanitize = (raw: Record<string, unknown>) =>
    new ImageStorageService(
      {} as never,
      {} as never,
      {} as never,
    ).sanitizeStorage({ toObject: () => raw } as never);

  it('🔴 a video row still says video after sanitising', () => {
    expect(
      sanitize({
        _id: 'a',
        image_url: '/uploads/videos/x.mp4',
        media_kind: 'video',
      })?.media_kind,
    ).toBe('video');
  });

  it('an image row still says image', () => {
    expect(
      sanitize({
        _id: 'a',
        image_url: '/uploads/images/x.png',
        media_kind: 'image',
      })?.media_kind,
    ).toBe('image');
  });

  it('🔴 a legacy row with no kind stays ABSENT, not defaulted', () => {
    /* Absent is meaningful: every reader treats it as an image, and inventing
       a value here would make a legacy row indistinguishable from one that was
       explicitly marked. */
    expect(
      sanitize({ _id: 'a', image_url: '/uploads/images/x.png' })?.media_kind,
    ).toBeUndefined();
  });
});
