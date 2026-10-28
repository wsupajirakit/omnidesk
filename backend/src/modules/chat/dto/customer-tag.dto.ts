import { IsOptional, IsString } from 'class-validator';

export class CreateCustomerTagDto {
  @IsString()
  label!: string;

  @IsOptional()
  @IsString()
  color?: string;
}

export class ListPopularTagsDto {
  @IsOptional()
  @IsString()
  limit?: string;
}

export class SuggestTagsDto {
  @IsOptional()
  @IsString()
  q?: string;
}
