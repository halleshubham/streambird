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
  /** Go-live-now only: set when the brand kit's thumbnail was sent to the destinations while creating the stream. */
  @Expose() thumbnailKit?: { id: string; name: string } | null;
  /** Go-live-now only: platforms that refused the brand kit's thumbnail (going live was not affected). */
  @Expose() thumbnailWarnings?: string[];

  /** Create and schedule responses: the title / description was blank in the request and came from a brand kit's defaults. */
  @Expose() titleFromKit?: boolean;
  @Expose() descriptionFromKit?: boolean;
  /** The kit those defaults came from (null/absent when they did not come from a kit). */
  @Expose() titleKit?: { id: string; name: string } | null;
  @Expose() descriptionKit?: { id: string; name: string } | null;

  @Expose()
  @Type(() => DestinationResponseDto)
  destinations!: DestinationResponseDto[];
}
