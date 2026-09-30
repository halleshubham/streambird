import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { PlatformConnectionsService } from './platform-connections.service';
import { PlatformConnectionResponseDto } from './dto/platform-connection-response.dto';
import { CreateManualTwitchConnectionDto } from './dto/create-manual-twitch-connection.dto';
import { AccountGuard } from '../common/guards/account.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';

/**
 * OAuth connect/callback routes for YouTube/Facebook/LinkedIn are
 * deferred: they land alongside each StreamProvider adapter (see the
 * Build Order in the implementation plan). Twitch has no such flow here
 * because Twitch's own API doesn't expose a user's stream key
 * programmatically — POST :platform/twitch/manual (below) is the actual
 * connection method for Twitch, not a stand-in for a future OAuth route.
 */
@Controller('platform-connections')
@UseGuards(AccountGuard)
export class PlatformConnectionsController {
  constructor(private readonly platformConnectionsService: PlatformConnectionsService) {}

  @Get()
  async findAll(@CurrentAccount() account: Account) {
    const connections = await this.platformConnectionsService.findAllForAccount(account.id);
    return connections.map((c) =>
      plainToInstance(PlatformConnectionResponseDto, c, { excludeExtraneousValues: true }),
    );
  }

  @Post('twitch/manual')
  async createManualTwitchConnection(
    @CurrentAccount() account: Account,
    @Body() dto: CreateManualTwitchConnectionDto,
  ) {
    const connection = await this.platformConnectionsService.createManualTwitchConnection(
      account.id,
      dto,
    );
    return plainToInstance(PlatformConnectionResponseDto, connection, {
      excludeExtraneousValues: true,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.platformConnectionsService.remove(id, account.id);
  }
}
