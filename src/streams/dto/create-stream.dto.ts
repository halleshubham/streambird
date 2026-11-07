import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
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

  /** Only meaningful to providers that support it (YouTube) -- see BroadcastMeta. */
  @IsOptional()
  @IsIn(['public', 'unlisted', 'private'])
  visibility?: 'public' | 'unlisted' | 'private';

  /** 'landscape' (16:9, default) or 'portrait' (9:16 vertical). One encode goes to every destination, so it applies to all of them. */
  @IsOptional()
  @IsIn(['landscape', 'portrait'])
  orientation?: 'landscape' | 'portrait';

  /**
   * Which brand kit's thumbnail a stream without its own thumbnail gets: omitted = the destination's kit, else the
   * account default kit; a kit id = that kit; null = none (e.g. the host chose "No brand kit" or uploads their own).
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  thumbnailBrandKitId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50) // matches Cloudflare's per-live-input output ceiling
  @IsUUID('4', { each: true })
  @Type(() => String)
  destinationConnectionIds!: string[];
}
