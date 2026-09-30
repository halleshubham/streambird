import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AccountsService } from '../../accounts/accounts.service';

export interface AuthenticatedRequest extends Request {
  account?: import('../../accounts/entities/account.entity').Account;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly accountsService: AccountsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey || Array.isArray(apiKey)) {
      throw new UnauthorizedException('Missing x-api-key header');
    }

    const account = await this.accountsService.findByApiKey(apiKey);
    if (!account) {
      throw new UnauthorizedException('Invalid API key');
    }

    request.account = account;
    return true;
  }
}
