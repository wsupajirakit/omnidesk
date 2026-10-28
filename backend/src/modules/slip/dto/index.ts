/**
 * DTO barrel for the slip module.
 *
 * This file previously REDECLARED both classes as plain shapes with no
 * `class-validator` decorators, shadowing the real definitions in
 * `slip-verification.dto.ts`. The controller imported the undecorated copies,
 * so the global ValidationPipe saw a DTO with zero whitelisted properties:
 * `whitelist` stripped every field and `forbidNonWhitelisted` then rejected the
 * request, making `GET /api/slip-verifications?limit=1` answer 400 where legacy
 * answers 200. Re-export the real ones — never restate a DTO in a barrel.
 */

export {
  ListSlipVerificationsQueryDto,
  SlipVerificationPayloadDto,
} from './slip-verification.dto';
