import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { AccountGuard } from '../common/guards/account.guard';
import { StreamCreateThrottlerGuard } from '../common/guards/stream-create-throttler.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';
import { StreamResponseDto } from '../streams/dto/stream-response.dto';
import { PresetsService } from './presets.service';
import { CreatePresetDto, StartPresetDto, UpdatePresetDto } from './dto/preset.dto';

/** Saved "go live" setups (migration 0029). Contract: docs/API-PRESETS.md. */
@Controller('presets')
@UseGuards(AccountGuard)
export class PresetsController {
  constructor(private readonly presets: PresetsService) {}

  @Get()
  list(@CurrentAccount() account: Account) {
    return this.presets.list(account.id);
  }

  @Post()
  create(@CurrentAccount() account: Account, @Body() dto: CreatePresetDto) {
    return this.presets.create(account.id, dto);
  }

  @Patch(':id')
  update(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePresetDto) {
    return this.presets.update(account.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string) {
    await this.presets.remove(account.id, id);
  }

  /** Stamps lastUsedAt and returns the preset (plus how it applies today). Nothing else happens. */
  @Post(':id/use')
  @HttpCode(HttpStatus.OK)
  use(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string) {
    return this.presets.use(account.id, id);
  }

  /** Creates the stream like POST /streams (same limits and the same 5/min/account throttle) from the preset. */
  @Post(':id/start')
  @UseGuards(StreamCreateThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async start(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StartPresetDto) {
    const { stream, preset } = await this.presets.start(account.id, id, dto ?? {});
    return { ...plainToInstance(StreamResponseDto, stream, { excludeExtraneousValues: true }), preset };
  }
}
