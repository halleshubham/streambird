import { Exclude, Expose } from 'class-transformer';
import { DestinationStatus } from '../../common/enums/destination-status.enum';

/**
 * Platform-side ingestUrl/streamKey must never reach a client — only
 * Cloudflare's single relay endpoint does (see StreamResponseDto).
 */
@Exclude()
export class DestinationResponseDto {
  @Expose() id!: string;
  @Expose() platformConnectionId!: string;
  @Expose() status!: DestinationStatus;
  @Expose() viewerCount!: number | null;
  @Expose() watchUrl!: string | null;
  @Expose() errorMessage!: string | null;
}
