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
  /** Permanent live-link slug (YouTube/Facebook only, else null). */
  @Expose() liveSlug!: string | null;
  /** Absolute shareable URL for liveSlug, filled in by the controller from PUBLIC_BASE_URL; null without a slug. */
  @Expose() liveLinkUrl!: string | null;
}
