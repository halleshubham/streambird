import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateStreamDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50) // matches Cloudflare's per-live-input output ceiling
  @IsUUID('4', { each: true })
  @Type(() => String)
  destinationConnectionIds!: string[];
}
