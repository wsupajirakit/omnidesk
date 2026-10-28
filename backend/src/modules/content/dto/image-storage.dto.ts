import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateImageStorageDashboardDto {
  /** Legacy's hand-rolled check answers the same string here — :121. */
  @IsString({ message: 'object_image_id is required' })
  @IsNotEmpty({ message: 'object_image_id is required' })
  object_image_id!: string;
}

export class CreateImageStorageExternalDto {
  /**
   * ⚠️ Explicit message on BOTH constraints. Legacy checks this by hand and
   * answers exactly `{"error":"object_image_id is required"}`
   * (imageStorageController.js:176). Without the override class-validator
   * emits its own wording and, because two constraints fail at once on a
   * missing field, the pipe joined them into
   * "object_image_id should not be empty; object_image_id must be a string" —
   * a different string for the same input, which the dashboard prints verbatim.
   */
  @IsString({ message: 'object_image_id is required' })
  @IsNotEmpty({ message: 'object_image_id is required' })
  object_image_id!: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  drive_id?: string;

  @IsOptional()
  @IsString()
  api_key?: string;
}

export class UpdateImageStorageDto {
  @IsOptional()
  priority?: unknown;

  @IsOptional()
  @IsString()
  detail_link?: string;

  @IsOptional()
  @IsString()
  detail_text?: string;
}
