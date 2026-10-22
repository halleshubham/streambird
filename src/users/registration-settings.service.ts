import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '../billing/entities/app-setting.entity';

const AUTO_APPROVE_KEY = 'auto_approve_registrations';

/**
 * The superadmin's registration switch, kept in app_settings (editable at runtime, no deploy).
 * Off (the default) = every new signup waits in the approval queue, as always. On = new accounts
 * are approved the moment they are created. Turning it off again "pauses" registrations: nobody
 * already approved is affected, new signups simply queue up.
 */
@Injectable()
export class RegistrationSettingsService {
  constructor(@InjectRepository(AppSetting) private readonly settings: Repository<AppSetting>) {}

  async isAutoApprove(): Promise<boolean> {
    const row = await this.settings.findOne({ where: { key: AUTO_APPROVE_KEY } });
    return row?.value === true;
  }

  async setAutoApprove(enabled: boolean): Promise<void> {
    await this.settings.save({ key: AUTO_APPROVE_KEY, value: enabled });
  }
}
