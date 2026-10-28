import { InternalServerErrorException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Error as MongooseError } from 'mongoose';

import { AssignHistory, ChatRoom } from '@/modules/chat';
import { Hook } from '@/modules/hooks';
import { AssignHistoriesService } from '@/modules/tickets';

/**
 * `POST /api/assign-histories` — every create failure is **500** with ONE fixed
 * string, never a 400 and never Mongoose's own text.
 *
 * ── the behaviour being pinned ─────────────────────────────────────────────
 * Legacy `createAssignHistory`
 * (legacy-api/src/controllers/chat/assignHistoryController.js:28-37) is:
 *
 *     const history = new AssignHistory(req.body);
 *     await history.save();
 *     ...
 *   catch (error) {
 *     console.error("Error creating assignment history:", error.message);
 *     return res.status(500).json({ success: false,
 *                                   error: "Failed to create assignment history" });
 *   }
 *
 * There is no request validation at all, so a missing `chat_room_id` — which
 * the schema marks `required: true`
 * (legacy-api/src/models/chat/assignHistoryModel.js) — is caught by Mongoose
 * and reported through that catch. The real reason is logged server-side and
 * the caller is told nothing more, so a missing field and a malformed one are
 * deliberately indistinguishable.
 *
 * Measured against the running legacy backend:
 *
 *   POST /api/assign-histories  {}
 *   500 {"success":false,"error":"Failed to create assignment history"}
 *
 * Before the fix the DTO carried a bare `@IsString() chat_room_id!: string`,
 * so the ValidationPipe answered 400 {"error":"chat_room_id must be a string"}
 * before the handler ever ran — a different status AND a different body shape.
 * The field is still required; it is just enforced by the layer legacy enforces
 * it in (the schema), which is why the DTO now marks it `@IsOptional()`.
 *
 * ⚠️ This is why `MongooseErrorInterceptor` is NOT mounted on this route: it
 * would surface the driver's message and a 400, which legacy never sends here.
 * Re-adding a required-string validator to the DTO fails the first case below.
 */
describe('AssignHistoriesService.createAssignHistory — error contract', () => {
  let service: AssignHistoriesService;
  let nextError: unknown;

  const assignHistoryModel = {
    create: () => Promise.reject(nextError),
  };
  const unusedModel = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AssignHistoriesService,
        {
          provide: getModelToken(AssignHistory.name),
          useValue: assignHistoryModel,
        },
        { provide: getModelToken(Hook.name), useValue: unusedModel },
        { provide: getModelToken(ChatRoom.name), useValue: unusedModel },
      ],
    }).compile();

    service = moduleRef.get(AssignHistoriesService);
  });

  /**
   * Both shapes legacy funnels into the same reply: the schema's `required`
   * rule (empty body) and a cast failure (malformed id).
   */
  const validationError = new MongooseError.ValidationError();
  validationError.message =
    'AssignHistory validation failed: chat_room_id: Path `chat_room_id` is required.';

  const castError = new MongooseError.CastError(
    'ObjectId',
    'notanid',
    'chat_room_id',
  );

  it.each([
    ['a missing required field', validationError],
    ['a malformed ObjectId', castError],
  ])("answers 500 with legacy's fixed string for %s", async (_label, err) => {
    nextError = err;

    await expect(service.createAssignHistory({})).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    await service.createAssignHistory({}).catch((e: unknown) => {
      const thrown = e as InternalServerErrorException;
      expect(thrown.getStatus()).toBe(500);
      expect(thrown.getResponse()).toEqual({
        success: false,
        error: 'Failed to create assignment history',
      });
      // The regression guard: Mongoose's own text must NOT reach the caller
      // here, unlike the content read routes where legacy does forward it.
      expect(JSON.stringify(thrown.getResponse())).not.toContain('Path `');
      expect(JSON.stringify(thrown.getResponse())).not.toContain('Cast to');
    });
  });
});
