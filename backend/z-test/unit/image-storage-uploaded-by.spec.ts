/**
 * [FEAT-20260904-UPLOADEDBY] The uploader's NAME leaves the server; the id never
 * does.
 * ===========================================================================
 * Owner, 04/09: *เก็บ id แล้วไปจอยเอาเอง ไม่ต้องเพิ่มเก็บสองอย่าง* — so nothing new is
 * stored, `created_by` stays an ObjectId ref, and the name is resolved when the
 * row is read. Two things therefore have to hold and neither is visible from a
 * screenshot:
 *
 *  · `sanitizeStorage` builds its object FIELD BY FIELD — a field not listed
 *    there is dropped silently on the way out, which is exactly how `media_kind`
 *    stayed invisible to every client from 25/08 until today
 *  · an id must never appear in the response, not even when the populate did
 *    not run
 */
import { ImageStorageService } from '@/modules/content/image-storage.service';

/** Only `sanitizeStorage` is exercised, so the deps are never touched. */
const service = new ImageStorageService(
  null as never,
  null as never,
  null as never,
);

const row = (
  createdBy: unknown,
): Parameters<typeof service.sanitizeStorage>[0] =>
  ({
    _id: 'st-1',
    image_url: '/uploads/videos/a.mp4',
    priority: 1,
    media_kind: 'video',
    created_by: createdBy,
  }) as never;

describe('[UPLOADEDBY] the name comes out', () => {
  it('⭐ a populated user gives its display name', () => {
    const out = service.sanitizeStorage(
      row({ _id: 'u1', display_name: 'Super User', username: 'su' }),
    );
    expect(out?.created_by_name).toBe('Super User');
  });

  it('⭐ an account with no display name falls back to its username', () => {
    /* Accounts can exist without a display name; showing a dash for a row that
       does have an owner is worse than showing the login. */
    const out = service.sanitizeStorage(row({ _id: 'u1', username: 'dev' }));
    expect(out?.created_by_name).toBe('dev');
  });

  it('⭐ a blank display name is not a name', () => {
    const out = service.sanitizeStorage(
      row({ _id: 'u1', display_name: '   ', username: 'dev' }),
    );
    expect(out?.created_by_name).toBe('dev');
  });
});

describe('[UPLOADEDBY] the id never comes out', () => {
  it('🔴 an UNPOPULATED created_by yields null, not the id', () => {
    /* 🔴 MUTATION KILLER. The list path populates; other paths do not, and there
       the value is a bare ObjectId. Returning it "because it is what we have"
       would put a user id in every gallery payload. ห้ามส่ง id ออกไป */
    const out = service.sanitizeStorage(row('a0d000000000000000000066'));
    expect(out?.created_by_name).toBeNull();
    expect(JSON.stringify(out)).not.toContain('a0d000000000000000000066');
  });

  it('⭐ a row with no uploader at all is null, and that is normal', () => {
    /* Legacy rows and deleted users both land here. No backfill was done and
       none is planned — the dashboard prints a dash. */
    expect(service.sanitizeStorage(row(null))?.created_by_name).toBeNull();
    expect(service.sanitizeStorage(row(undefined))?.created_by_name).toBeNull();
  });

  it('🔴 no other user field escapes with the name', () => {
    /* 🔴 The populate asks for two fields, but a future edit could widen it.
       This pins the RESPONSE rather than the query: whatever arrives on the
       user object, only the name is allowed through. */
    const out = service.sanitizeStorage(
      row({
        _id: 'u1',
        display_name: 'Super User',
        username: 'su',
        password_hash: 'NEVER',
        permissions: ['*'],
      }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('NEVER');
    expect(json).not.toContain('permissions');
    expect(json).not.toContain('username');
  });
});
