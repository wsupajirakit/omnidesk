import { IsOptional, IsString } from 'class-validator';

export class CreateAssignHistoryDto {
  /**
   * ⚠️ `@IsOptional()` on a field the schema marks `required: true`, on
   * purpose. Legacy `createAssignHistory`
   * (legacy-api/src/controllers/chat/assignHistoryController.js:28-37) does
   * `new AssignHistory(req.body)` with NO request validation, so a missing
   * `chat_room_id` is caught by Mongoose's own `required` rule and answered as
   * **500** `{success:false,error:"Failed to create assignment history"}`.
   * A bare `@IsString()` here rejects at the validation pipe with a 400 before
   * the handler ever runs — a different status AND a different body shape.
   * The field is still enforced, just by the layer legacy enforces it in.
   */
  @IsOptional()
  @IsString()
  chat_room_id?: string;

  @IsOptional()
  @IsString()
  ticket_id?: string;

  @IsOptional()
  @IsString()
  assign_to?: string | null;

  @IsOptional()
  @IsString()
  changed_by_id?: string | null;

  @IsOptional()
  @IsString()
  action?: string | null;

  @IsOptional()
  @IsString()
  detail?: string | null;
}

export class UpdateAssignHistoryDto {
  @IsOptional()
  @IsString()
  chat_room_id?: string;

  @IsOptional()
  @IsString()
  ticket_id?: string;

  @IsOptional()
  @IsString()
  assign_to?: string | null;

  @IsOptional()
  @IsString()
  changed_by_id?: string | null;

  @IsOptional()
  @IsString()
  action?: string | null;

  @IsOptional()
  @IsString()
  detail?: string | null;
}

export class ListAssignHistoriesQueryDto {
  @IsOptional()
  @IsString()
  chat_room_id?: string;

  /**
   * [FEAT-20260817-ASSIGNDATERANGE] Bangkok calendar day, `YYYY-MM-DD`.
   * Both optional and both capped in the service (MAX_RANGE_DAYS); a full ISO
   * instant is also accepted and passed through unshifted.
   */
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  assign_to?: string;

  @IsOptional()
  @IsString()
  changed_by_id?: string;

  @IsOptional()
  @IsString()
  ticket_id?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
