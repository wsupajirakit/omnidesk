import { IsOptional, IsString } from 'class-validator';

export class CreateRoomNoteDto {
  @IsString()
  content!: string;
}

export class UpdateNoteContentDto {
  @IsString()
  content!: string;
}

export class ListRoomNotesQueryDto {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
