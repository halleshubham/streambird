import { Body, Controller, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  async create(@Body() dto: CreateAccountDto) {
    const { account, apiKey } = await this.accountsService.create(dto);
    // apiKey is shown exactly once, here — it is never retrievable again.
    return { id: account.id, name: account.name, apiKey };
  }
}
