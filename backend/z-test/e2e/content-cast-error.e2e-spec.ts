import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Error as MongooseError } from 'mongoose';
import request from 'supertest';

import { AllExceptionsFilter } from '@/common';
import {
  ImageStorageController,
  ImageStorageService,
  ObjectCategoriesController,
  ObjectCategoriesService,
  ObjectImagesController,
  ObjectImagesService,
} from '@/modules/content';

import { bindTestServer } from '../lib/bind-test-server';

/**
 * Error-contract parity for the id-taking content routes: a malformed ObjectId
 * must leave as **500 carrying Mongoose's own message**, exactly as the legacy
 * backend answers.
 *
 * ── the behaviour being pinned ─────────────────────────────────────────────
 * Legacy leaves `req.params.id` unguarded on these six handlers, so the raw
 * value reaches Mongoose, which throws a CastError, and each handler's own
 * catch answers 500 with that message verbatim:
 *
 *   legacy-api/src/controllers/content/imageStorageController.js:363-365   (get)
 *   legacy-api/src/controllers/content/imageStorageController.js:394-396   (delete)
 *   legacy-api/src/controllers/content/objectCategoryController.js:41-43   (get)
 *   legacy-api/src/controllers/content/objectCategoryController.js:162-164 (delete)
 *   legacy-api/src/controllers/content/objectImageController.js:137-139    (get)
 *   legacy-api/src/controllers/content/objectImageController.js:304-306    (delete)
 *
 * Measured against the running legacy backend, e.g.
 *
 *   GET /api/object-images/notanid
 *   500 {"error":"Cast to ObjectId failed for value \"notanid\" (type string)
 *        at path \"_id\" for model \"ObjectImage\""}
 *
 * Before the fix these answered 400 {"error":"Invalid image identifier"} from a
 * hand-written `isValidObjectId` pre-check: wrong status AND a message that
 * hides which field was rejected. `MongooseReadErrorInterceptor` on each
 * handler is what preserves the legacy contract.
 *
 * ⚠️ The obvious "cleanup" — restoring an `isValidObjectId` guard — is exactly
 * the regression this file exists to catch. Legacy is the spec even where it
 * looks wrong; turning its 500 into a 400 is a defect, not an improvement.
 *
 * ⚠️ Note the ONE exception in this area: `PUT /api/object-categories/:id`
 * really does answer 400 on legacy (objectCategoryController.js:132-134), so it
 * carries the *other* interceptor. Read the legacy catch per handler — the
 * statuses are not uniform. That asymmetry is asserted at the end of this file.
 *
 * Services are stubbed rather than the Mongoose models: the fix lives entirely
 * in controller-level `@UseInterceptors` wiring, so rejecting at the service
 * boundary exercises the mapping under test without a database.
 */
describe('content id routes — Mongoose cast error (e2e)', () => {
  let app: INestApplication;

  /** Builds the exact error Mongoose raises for an uncastable `_id` filter. */
  const castErrorFor = (model: string): MongooseError.CastError => {
    const e = new MongooseError.CastError('ObjectId', 'notanid', '_id');
    // Mongoose appends the model name when the error comes from a query, and
    // the legacy message contains it. Set the way Mongoose sets it internally.
    e.message = `Cast to ObjectId failed for value "notanid" (type string) at path "_id" for model "${model}"`;
    return e;
  };

  const storageCastError = castErrorFor('ImageStorage');
  const categoryCastError = castErrorFor('ObjectCategory');
  const imageCastError = castErrorFor('ObjectImage');

  const imageStorageService = {
    getImageStorageById: () => Promise.reject(storageCastError),
    deleteImageStorage: () => Promise.reject(storageCastError),
  };
  const objectCategoriesService = {
    getCategoryById: () => Promise.reject(categoryCastError),
    deleteCategory: () => Promise.reject(categoryCastError),
    // The 400 handler, asserted last — same error, different legacy status.
    updateCategory: () => Promise.reject(categoryCastError),
  };
  const objectImagesService = {
    getImageById: () => Promise.reject(imageCastError),
    deleteImage: () => Promise.reject(imageCastError),
  };

  const superUser = {
    user_id: 'a0d000000000000000000009',
    username: 'golden',
    role: { name: 'superadmin' },
    permissions: ['object.manage'],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        ImageStorageController,
        ObjectCategoriesController,
        ObjectImagesController,
      ],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: ImageStorageService, useValue: imageStorageService },
        { provide: ObjectCategoriesService, useValue: objectCategoriesService },
        { provide: ObjectImagesService, useValue: objectImagesService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    // Stand in for the global JwtAuthGuard, registered by AuthModule.
    app.use(
      (
        req: { user?: unknown },
        _res: unknown,
        next: (err?: unknown) => void,
      ) => {
        req.user = superUser;
        next();
      },
    );
    await bindTestServer(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe.each([
    ['GET', '/api/image-storage/notanid', 'ImageStorage'],
    ['DELETE', '/api/image-storage/notanid', 'ImageStorage'],
    ['GET', '/api/object-categories/notanid', 'ObjectCategory'],
    ['DELETE', '/api/object-categories/notanid', 'ObjectCategory'],
    ['GET', '/api/object-images/notanid', 'ObjectImage'],
    ['DELETE', '/api/object-images/notanid', 'ObjectImage'],
  ])('%s %s', (method, path, model) => {
    it("answers 500 carrying Mongoose's message, not a 400 guard", async () => {
      const res = await request(app.getHttpServer())
        [method.toLowerCase() as 'get' | 'delete'](path)
        .expect(500);

      const body = res.body as { error?: string };
      expect(body.error).toBe(
        `Cast to ObjectId failed for value "notanid" (type string) at path "_id" for model "${model}"`,
      );
      // The two specific regressions: the global filter's default must not have
      // swallowed the message, and no pre-check may turn this into a 400.
      expect(body.error).not.toBe('internal error');
      expect(body.error).not.toMatch(/^Invalid .* identifier$/);
    });
  });

  /**
   * The asymmetry guard. If someone "unifies" the interceptors across this
   * controller, one of these two cases must go red — they read the SAME error
   * and legacy answers a different status for each.
   */
  it('PUT /api/object-categories/:id stays 400 — legacy differs per handler', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/object-categories/notanid')
      .send({ name: 'x' })
      .expect(400);

    expect((res.body as { error?: string }).error).toBe(
      categoryCastError.message,
    );
  });
});
