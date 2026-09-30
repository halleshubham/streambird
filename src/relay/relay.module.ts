import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CloudflareRelayService } from './cloudflare-relay.service';
import { CLOUDFLARE_RELAY } from './cloudflare-relay.interface';

@Module({
  imports: [HttpModule],
  providers: [
    CloudflareRelayService,
    { provide: CLOUDFLARE_RELAY, useExisting: CloudflareRelayService },
  ],
  exports: [CLOUDFLARE_RELAY],
})
export class RelayModule {}
