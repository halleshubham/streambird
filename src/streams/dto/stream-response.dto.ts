import { Exclude, Expose, Type } from 'class-transformer';
import { StreamStatus } from '../../common/enums/stream-status.enum';
import { DestinationResponseDto } from './destination-response.dto';

@Exclude()
export class StreamResponseDto {
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() status!: StreamStatus;
  /** Cloudflare's single ingest endpoint — always this, never any platform's. */
  @Expose() ingestUrl!: string | null;
  @Expose() streamKey!: string | null;
  @Expose() whipUrl!: string | null;
  @Expose() visibility!: string | null;
  @Expose() orientation!: 'landscape' | 'portrait';
  @Expose() studioSessionId?: string;
  @Expose() description!: string | null;
  @Expose() scheduledAt!: Date | null;
  @Expose() isScheduledEvent!: boolean;
  @Expose() timezone!: string | null;
  @Expose() expectedDurationMinutes!: number | null;
  @Expose() cancelledAt!: Date | null;

  @Expose()
  @Type(() => DestinationResponseDto)
  destinations!: DestinationResponseDto[];
}
