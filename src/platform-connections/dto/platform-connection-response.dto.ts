import { Exclude, Expose } from 'class-transformer';
import { Platform } from '../../common/enums/platform.enum';

/**
 * credentialsCiphertext must never reach a client — this DTO is the only
 * shape a PlatformConnection is ever serialized as in a response.
 */
@Exclude()
export class PlatformConnectionResponseDto {
  @Expose() id!: string;
  @Expose() platform!: Platform;
  @Expose() externalAccountId!: string;
  @Expose() label!: string;
  @Expose() isActive!: boolean;
}
