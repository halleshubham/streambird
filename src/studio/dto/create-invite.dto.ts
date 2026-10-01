import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateInviteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  /**
   * Optional join password. When set, a guest must supply the exact same
   * string to join (see StudioSessionsService.joinAsGuest). Invites no
   * longer carry a TTL -- they live for the whole stream, see
   * StudioSessionsService.createInvite.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password?: string;
}
