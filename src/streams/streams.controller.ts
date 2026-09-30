import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { StreamsService } from './streams.service';
import { CreateStreamDto } from './dto/create-stream.dto';
import { ListStreamsDto } from './dto/list-streams.dto';
import { StreamResponseDto } from './dto/stream-response.dto';
import { StreamListItemDto } from './dto/stream-list-item.dto';
import { DestinationResponseDto } from './dto/destination-response.dto';
import { AccountGuard } from '../common/guards/account.guard';
import { StreamCreateThrottlerGuard } from '../common/guards/stream-create-throttler.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';

@Controller('streams')
@UseGuards(AccountGuard)
export class StreamsController {
  constructor(private readonly streamsService: StreamsService) {}

  @Post()
  @UseGuards(StreamCreateThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 stream-creates/min/account
  async create(@CurrentAccount() account: Account, @Body() dto: CreateStreamDto) {
    const stream = await this.streamsService.create(account.id, dto);
    return plainToInstance(StreamResponseDto, stream, { excludeExtraneousValues: true });
  }

  @Get()
  async findAll(@CurrentAccount() account: Account, @Query() query: ListStreamsDto) {
    const { items, total } = await this.streamsService.findAllForAccount(
      account.id,
      query.limit,
      query.offset,
    );

    return {
      items: items.map((stream) =>
        plainToInstance(
          StreamListItemDto,
          {
            ...stream,
            destinationsSummary: stream.destinations.map((d) => ({
              platform: d.platformConnection.platform,
              status: d.status,
            })),
          },
          { excludeExtraneousValues: true },
        ),
      ),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @Get(':id')
  async findOne(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const stream = await this.streamsService.findByIdOrThrow(id, account.id);
    return plainToInstance(StreamResponseDto, stream, { excludeExtraneousValues: true });
  }

  @Get(':id/status')
  async status(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.streamsService.getStatus(id, account.id);
  }

  @Post(':id/destinations/:destinationId/retry')
  async retry(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('destinationId', ParseUUIDPipe) destinationId: string,
  ) {
    const destination = await this.streamsService.retryDestination(id, destinationId, account.id);
    return plainToInstance(DestinationResponseDto, destination, {
      excludeExtraneousValues: true,
    });
  }

  @Post(':id/end')
  async end(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string) {
    const stream = await this.streamsService.end(id, account.id);
    return plainToInstance(StreamResponseDto, stream, { excludeExtraneousValues: true });
  }
}
