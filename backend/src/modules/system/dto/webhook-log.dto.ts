import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Body of `POST /webhook/logs` and `PUT /webhook/logs/:logId`.
 *
 * The legacy service accepts whatever the caller sends and lets Mongoose drop
 * unknown paths, but the global ValidationPipe here runs with
 * `forbidNonWhitelisted`, so every field a real caller sends must be declared or
 * the request would 400 where legacy returned 201. Field names are taken from
 * the deployed webhook_logs schema, not from the legacy controller — the
 * controller passes `req.body` straight through and names nothing.
 *
 * ⚠️ Known divergence, verified against the running legacy backend: a body
 * carrying a field that no schema declares (`note`, say) gets 201 there —
 * Mongoose drops it silently — and 400 here. This is stricter, not looser, and
 * it surfaces a write legacy was discarding without telling anyone. If a real
 * caller turns out to send such a field, the fix is to declare it here *and* on
 * the schema, never to relax the validation pipe.
 */
export class WebhookLogPayloadDto {
  @ApiPropertyOptional({ description: 'Parent hook ObjectId' })
  @IsOptional()
  @IsString()
  hook_id?: string;

  @ApiPropertyOptional({ description: 'Parent hook alias' })
  @IsOptional()
  @IsString()
  hook_alias?: string;

  @ApiPropertyOptional({ description: 'Channel type of the parent hook' })
  @IsOptional()
  @IsString()
  channel_type?: string;

  @ApiPropertyOptional({ description: 'Owning group ObjectId' })
  @IsOptional()
  @IsString()
  group_id?: string;

  /**
   * `channel`/`log_source`, `line_event_id`/`event_id` and
   * `line_key_mask`/`access_key_mask` are three mid-rename pairs. The service
   * mirrors whichever name arrives onto its counterpart, so both spellings have
   * to be accepted here or one half of each pair would be rejected.
   */
  @ApiPropertyOptional({ description: 'Log provenance tag (legacy name)' })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({ description: 'Log provenance tag (current name)' })
  @IsOptional()
  @IsString()
  log_source?: string;

  @ApiPropertyOptional({ description: 'Action type' })
  @IsOptional()
  @IsString()
  action_type?: string;

  @ApiPropertyOptional({ description: 'HTTP method' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ description: 'Endpoint called' })
  @IsOptional()
  @IsString()
  endpoint?: string;

  @ApiPropertyOptional({ description: 'success | error' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Upstream HTTP status code' })
  @IsOptional()
  @IsNumber()
  http_status?: number;

  @ApiPropertyOptional({ description: 'Error code' })
  @IsOptional()
  @IsString()
  error_code?: string;

  @ApiPropertyOptional({ description: 'Error message' })
  @IsOptional()
  @IsString()
  error_message?: string;

  @ApiPropertyOptional({ description: 'Trimmed request payload' })
  @IsOptional()
  payload_summary?: unknown;

  @ApiPropertyOptional({ description: 'Trimmed response payload' })
  @IsOptional()
  response_summary?: unknown;

  @ApiPropertyOptional({ description: 'Arbitrary request metadata' })
  @IsOptional()
  request_meta?: unknown;

  @ApiPropertyOptional({ description: 'Related document id' })
  @IsOptional()
  @IsString()
  doc_id?: string;

  @ApiPropertyOptional({ description: 'Related prompt id' })
  @IsOptional()
  @IsString()
  prompt_id?: string;

  @ApiPropertyOptional({ description: 'Caller-supplied correlation id' })
  @IsOptional()
  @IsString()
  reference_id?: string;

  @ApiPropertyOptional({ description: 'LINE event id (legacy name)' })
  @IsOptional()
  @IsString()
  line_event_id?: string;

  @ApiPropertyOptional({ description: 'Event id (current name)' })
  @IsOptional()
  @IsString()
  event_id?: string;

  @ApiPropertyOptional({ description: 'Masked access key (legacy name)' })
  @IsOptional()
  @IsString()
  line_key_mask?: string;

  @ApiPropertyOptional({ description: 'Masked access key (current name)' })
  @IsOptional()
  @IsString()
  access_key_mask?: string;

  @ApiPropertyOptional({ description: 'Masked Gemini API key' })
  @IsOptional()
  @IsString()
  gemini_api_key_mask?: string;

  @ApiPropertyOptional({ description: 'Duration of the call in ms' })
  @IsOptional()
  @IsNumber()
  duration_ms?: number;

  @ApiPropertyOptional({ description: 'Retry counter' })
  @IsOptional()
  @IsNumber()
  retries?: number;

  @ApiPropertyOptional({ description: 'Raw request snapshot' })
  @IsOptional()
  raw_request?: unknown;

  @ApiPropertyOptional({ description: 'Raw response snapshot' })
  @IsOptional()
  raw_response?: unknown;
}
