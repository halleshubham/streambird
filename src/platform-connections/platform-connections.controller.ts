import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { PlatformConnectionsService } from './platform-connections.service';
import { PlatformConnectionResponseDto } from './dto/platform-connection-response.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';

/**
 * OAuth connect/callback routes per platform
 * (GET /platform-connections/:platform/connect|callback) are deferred:
 * they land alongside each StreamProvider adapter as it's built (see the
 * Build Order in the implementation plan), starting with Twitch. This
 * module currently only covers listing and revoking connections created
 * by that future flow.
 */
@Controller('platform-connections')
@UseGuards(ApiKeyGuard)
export class PlatformConnectionsController {
  constructor(private readonly platformConnectionsService: PlatformConnectionsService) {}

  @Get()
  async findAll(@CurrentAccount() account: Account) {
    const connections = await this.platformConnectionsService.findAllForAccount(account.id);
    return connections.map((c) =>
      plainToInstance(PlatformConnectionResponseDto, c, { excludeExtraneousValues: true }),
    );
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
