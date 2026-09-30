import { Exclude, Expose, Type } from 'class-transformer';
import { StreamStatus } from '../../common/enums/stream-status.enum';
import { DestinationStatus } from '../../common/enums/destination-status.enum';
import { Platform } from '../../common/enums/platform.enum';

@Exclude()
class DestinationSummaryDto {
  @Expose() platform!: Platform;
  @Expose() status!: DestinationStatus;
}

// Deliberately omits ingestUrl/streamKey/whipUrl -- a list view shouldn't
// leak them, unlike StreamResponseDto which is only ever returned from the
// single-stream endpoints the owning account explicitly requested.
@Exclude()
export class StreamListItemDto {
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() status!: StreamStatus;
  @Expose() scheduledAt!: Date | null;
  @Expose() startedAt!: Date | null;
  @Expose() endedAt!: Date | null;
  @Expose() createdAt!: Date;

  @Expose()
  @Type(() => DestinationSummaryDto)
  destinationsSummary!: DestinationSummaryDto[];
}
