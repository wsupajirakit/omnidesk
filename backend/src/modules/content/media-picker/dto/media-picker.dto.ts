import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

// [FEAT-20260905-MEDIAPICKER] DTOs for the central media picker endpoint.

export enum MediaPickerSortOrder {
  DESC = 'desc',
  ASC = 'asc',
}

export class ListMediaAlbumsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 12;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(MediaPickerSortOrder)
  sort?: MediaPickerSortOrder = MediaPickerSortOrder.DESC;
}

export enum MediaPickerKindFilter {
  ALL = 'all',
  IMAGE = 'image',
  VIDEO = 'video',
}

export class ListMediaItemsQueryDto {
  @IsNotEmpty({ message: 'album_id is required' })
  @IsString()
  album_id!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 18;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(MediaPickerKindFilter)
  media_kind?: MediaPickerKindFilter = MediaPickerKindFilter.ALL;

  @IsOptional()
  @IsEnum(MediaPickerSortOrder)
  sort?: MediaPickerSortOrder = MediaPickerSortOrder.DESC;
}
