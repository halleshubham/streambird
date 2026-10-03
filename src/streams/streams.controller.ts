import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { StreamsService } from './streams.service';
import { StreamSchedulingService } from './stream-scheduling.service';
import { AddScheduleGuestsDto, ScheduleStreamDto, UpdateScheduleDto } from './dto/schedule-stream.dto';
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
  constructor(
    private readonly streamsService: StreamsService,
    private readonly scheduling: StreamSchedulingService,
  ) {}

  @Post()
  @UseGuards(StreamCreateThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 stream-creates/min/account
  async create(@CurrentAccount() account: Account, @Body() dto: CreateStreamDto) {
    const stream = await this.streamsService.create(account.id, dto);
    return plainToInstance(StreamResponseDto, stream, { excludeExtraneousValues: true });
  }

  // ---- Scheduled streams ------------------------------------------------

  @Post('schedule')
  @UseGuards(StreamCreateThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  schedule(@CurrentAccount() account: Account, @Body() dto: ScheduleStreamDto) {
    return this.scheduling.schedule(account, dto);
  }

  @Get(':id/schedule')
  getSchedule(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.getDetail(account, id);
  }

  @Patch(':id/schedule')
  @UseGuards(StreamCreateThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  updateSchedule(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.scheduling.update(account, id, dto);
  }

  @Post(':id/schedule/guests')
  @UseGuards(StreamCreateThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // each call can send up to 20 emails
  addGuests(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddScheduleGuestsDto,
  ) {
    return this.scheduling.addGuests(account, id, dto);
  }

  @Delete(':id/schedule/guests/:inviteId')
  removeGuest(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.scheduling.removeGuest(account, id, inviteId);
  }

  @Post(':id/schedule/guests/:inviteId/resend')
  @UseGuards(StreamCreateThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  resendInvite(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    return this.scheduling.resendInvite(account, id, inviteId);
  }

  @Post(':id/schedule/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelSchedule(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string) {
    await this.scheduling.cancel(account, id);
  }

  /** Starts a scheduled stream: creates the platform broadcasts and goes LIVE. */
  @Post(':id/start')
  async start(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string) {
    const stream = await this.streamsService.start(id, account.id);
    return plainToInstance(StreamResponseDto, stream, { excludeExtraneousValues: true });
  }

  @Get()
  async findAll(@CurrentAccount() account: Account, @Query() query: ListStreamsDto) {
    const { items, total } = await this.streamsService.findAllForAccount(
      account.id,
      query.limit,
      query.offset,
      query.view === 'upcoming',
    );

    const guestCounts =
      query.view === 'upcoming' ? await this.scheduling.guestCounts(items.map((s) => s.id)) : null;

    return {
      items: items.map((stream) =>
        plainToInstance(
          StreamListItemDto,
          {
            ...stream,
            ...(guestCounts ? { guestCount: guestCounts.get(stream.id) ?? 0 } : {}),
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
