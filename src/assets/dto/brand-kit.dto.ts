import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { AD_PLACEMENTS } from '../entities/brand-kit-ad.entity';
import type { AdMode, AdPlacement } from '../entities/brand-kit-ad.entity';

/**
 * One advertisement of a kit. Cross-field rules (interval needs showSec and everySec, one ad per placement, the
 * file is an owned asset of kind 'ad') are checked in BrandKitsService. Continuous ads store no schedule numbers.
 */
export class BrandKitAdDto {
  @IsIn(AD_PLACEMENTS as unknown as string[])
  placement!: AdPlacement;

  @IsUUID()
  assetId!: string;

  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsIn(['continuous', 'interval'])
  mode?: AdMode;

  @IsOptional() @IsInt() @Min(1) @Max(3600)
  showSec?: number;

  @IsOptional() @IsInt() @Min(1) @Max(86400)
  everySec?: number;
}


/** Same limits as a stream's own title and description (CreateStreamDto). */
export const MAX_KIT_TITLE = 200;
export const MAX_KIT_DESCRIPTION = 5000;

/** Trims a string; a blank one becomes null (= cleared). Anything that is not a string is left for the validators to refuse. */
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class CreateBrandKitDto {
  @IsString() @MinLength(1) @MaxLength(80)
  name!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetIdPortrait?: string | null;

  @IsOptional() @IsIn(['left', 'right'])
  logoPosition?: 'left' | 'right';

  @IsOptional() @IsInt() @Min(16) @Max(600)
  logoSize?: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetIdPortrait?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(80)
  wallpaperDim?: number;

  @IsOptional() @IsIn(['bar', 'accent', 'glass'])
  lowerThirdStyle?: 'bar' | 'accent' | 'glass';

  /** The kit's stream thumbnail (a JPG/PNG file of the library). null clears it, omitted leaves it unchanged. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  thumbnailAssetId?: string | null;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  /** Default stream title for streams using this kit. Trimmed; blank or null = none. */
  @IsOptional() @Transform(trimOrNull) @IsString({ message: 'The default title must be text.' }) @MaxLength(MAX_KIT_TITLE, { message: `The default title can be at most ${MAX_KIT_TITLE} characters.` })
  title?: string | null;

  /** Default stream description for streams using this kit. Trimmed; blank or null = none. */
  @IsOptional() @Transform(trimOrNull) @IsString({ message: 'The default description must be text.' }) @MaxLength(MAX_KIT_DESCRIPTION, { message: `The default description can be at most ${MAX_KIT_DESCRIPTION} characters.` })
  description?: string | null;

  /** Replace-all: the kit's ads become exactly this list (max 4, one per placement). Omitted = unchanged; [] = none. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  ads?: BrandKitAdDto[] | null;

  /** Same, for the portrait (9:16) set. `ads` is the landscape set. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  adsPortrait?: BrandKitAdDto[] | null;

  /** Shrink the live picture into the space an ad leaves free while it shows. */
  @IsOptional() @IsBoolean()
  adsShrinkPicture?: boolean;
}

export class UpdateBrandKitDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  name?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetIdPortrait?: string | null;

  @IsOptional() @IsIn(['left', 'right'])
  logoPosition?: 'left' | 'right';

  @IsOptional() @IsInt() @Min(16) @Max(600)
  logoSize?: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetIdPortrait?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(80)
  wallpaperDim?: number;

  @IsOptional() @IsIn(['bar', 'accent', 'glass'])
  lowerThirdStyle?: 'bar' | 'accent' | 'glass';

  /** The kit's stream thumbnail (a JPG/PNG file of the library). null clears it, omitted leaves it unchanged. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  thumbnailAssetId?: string | null;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  /** Default stream title for streams using this kit. Trimmed; blank or null = none. */
  @IsOptional() @Transform(trimOrNull) @IsString({ message: 'The default title must be text.' }) @MaxLength(MAX_KIT_TITLE, { message: `The default title can be at most ${MAX_KIT_TITLE} characters.` })
  title?: string | null;

  /** Default stream description for streams using this kit. Trimmed; blank or null = none. */
  @IsOptional() @Transform(trimOrNull) @IsString({ message: 'The default description must be text.' }) @MaxLength(MAX_KIT_DESCRIPTION, { message: `The default description can be at most ${MAX_KIT_DESCRIPTION} characters.` })
  description?: string | null;

  /** Replace-all: the kit's ads become exactly this list (max 4, one per placement). Omitted = unchanged; [] = none. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  ads?: BrandKitAdDto[] | null;

  /** Same, for the portrait (9:16) set. `ads` is the landscape set. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  adsPortrait?: BrandKitAdDto[] | null;

  /** Shrink the live picture into the space an ad leaves free while it shows. */
  @IsOptional() @IsBoolean()
  adsShrinkPicture?: boolean;
}

export class AssignBrandKitDto {
  /** null = back to the account default. */
  @ValidateIf((_, v) => v !== null) @IsUUID()
  brandKitId!: string | null;
}
