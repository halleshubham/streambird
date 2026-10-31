import { Type } from 'class-transformer';
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


export class CreateBrandKitDto {
  @IsString() @MinLength(1) @MaxLength(80)
  name!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetId?: string | null;

  @IsOptional() @IsIn(['left', 'right'])
  logoPosition?: 'left' | 'right';

  @IsOptional() @IsInt() @Min(16) @Max(600)
  logoSize?: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetId?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(80)
  wallpaperDim?: number;

  @IsOptional() @IsIn(['bar', 'accent', 'glass'])
  lowerThirdStyle?: 'bar' | 'accent' | 'glass';

  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  /** Replace-all: the kit's ads become exactly this list (max 3, one per placement). Omitted = unchanged; [] = none. */
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  ads?: BrandKitAdDto[];
}

export class UpdateBrandKitDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  name?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetId?: string | null;

  @IsOptional() @IsIn(['left', 'right'])
  logoPosition?: 'left' | 'right';

  @IsOptional() @IsInt() @Min(16) @Max(600)
  logoSize?: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetId?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(80)
  wallpaperDim?: number;

  @IsOptional() @IsIn(['bar', 'accent', 'glass'])
  lowerThirdStyle?: 'bar' | 'accent' | 'glass';

  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  /** Replace-all: the kit's ads become exactly this list (max 3, one per placement). Omitted = unchanged; [] = none. */
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  ads?: BrandKitAdDto[];
}

export class AssignBrandKitDto {
  /** null = back to the account default. */
  @ValidateIf((_, v) => v !== null) @IsUUID()
  brandKitId!: string | null;
}
