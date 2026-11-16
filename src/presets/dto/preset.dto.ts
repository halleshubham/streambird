import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Same values as the plan's `maxResolution` and the studio's quality picker. */
export const PRESET_QUALITIES = ['sd', 'hd', 'fhd', 'qhd'] as const;

/** Same values as CreateStreamDto.visibility. */
export const PRESET_VISIBILITIES = ['public', 'unlisted', 'private'] as const;

export class PresetConfigDto {
  @IsOptional()
  @IsIn(['landscape', 'portrait'])
  orientation?: 'landscape' | 'portrait';

  /** Platform connection ids of this account (checked in the service). Same ceiling as CreateStreamDto. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  @Type(() => String)
  destinationIds?: string[];

  /** null = "no kit / manual"; omitted = "the destination's or account default kit". */
  @IsOptional()
  @IsUUID('4')
  brandKitId?: string | null;

  @IsOptional()
  @IsIn(PRESET_QUALITIES as unknown as string[])
  quality?: (typeof PRESET_QUALITIES)[number];

  /**
   * Privacy of the broadcast on platforms that have it (YouTube; Twitch and Facebook ignore it). Omitted = not chosen:
   * the stream is created without a visibility, which YouTube turns into unlisted. null is accepted and treated as omitted.
   */
  @IsOptional()
  @IsIn(PRESET_VISIBILITIES as unknown as string[])
  visibility?: (typeof PRESET_VISIBILITIES)[number];

  @IsOptional()
  @IsBoolean()
  tickerEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tickerText?: string;
}

export class CreatePresetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PresetConfigDto)
  config!: PresetConfigDto;
}

export class UpdatePresetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  /** Replaces the whole config (not a merge). */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PresetConfigDto)
  config?: PresetConfigDto;
}

/** Optional body of POST /presets/:id/start. */
export class StartPresetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  /** For this start only: wins over the preset's saved visibility. */
  @IsOptional()
  @IsIn(PRESET_VISIBILITIES as unknown as string[])
  visibility?: (typeof PRESET_VISIBILITIES)[number];
}
