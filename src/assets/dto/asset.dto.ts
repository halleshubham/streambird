import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ASSET_KINDS } from '../entities/asset.entity';
import type { AssetKind } from '../entities/asset.entity';

export class UploadAssetDto {
  @IsIn(ASSET_KINDS as unknown as string[])
  kind!: AssetKind;

  @IsOptional() @IsString() @MaxLength(120)
  name?: string;
}

export class RenameAssetDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;
}
