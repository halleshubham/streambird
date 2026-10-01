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
  @Expose() studioSessionId?: string;

  @Expose()
  @Type(() => DestinationResponseDto)
  destinations!: DestinationResponseDto[];
}
