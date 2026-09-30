import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AccountResponseDto } from './dto/account-response.dto';
import { AccountGuard } from '../common/guards/account.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from './entities/account.entity';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  async create(@Body() dto: CreateAccountDto) {
    const { account, apiKey } = await this.accountsService.create(dto);
    // apiKey is shown exactly once, here — it is never retrievable again.
    return { id: account.id, name: account.name, apiKey };
  }

  @Get('me')
  @UseGuards(AccountGuard)
  async me(@CurrentAccount() account: Account) {
    return plainToInstance(AccountResponseDto, account, { excludeExtraneousValues: true });
  }
}
