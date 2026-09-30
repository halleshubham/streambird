import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { CloudflareRelayService } from './cloudflare-relay.service';
import { MuxRelayService } from './mux-relay.service';
import { MediaMtxService } from './mediamtx.service';
import { RELAY_PROVIDER } from './relay-provider.interface';

// Which RelayProvider backs RELAY_PROVIDER is a config value (RELAY_PROVIDER
// env var), not a compile-time choice -- so failing over from Cloudflare to
// Mux during an outage is a Coolify env-var change + redeploy, not a code
// change. Both concrete services are always instantiated (cheap -- they
// hold no state until called) so the switch is a single env var away.
@Module({
  imports: [HttpModule],
  providers: [
    CloudflareRelayService,
    MuxRelayService,
    MediaMtxService,
    {
      provide: RELAY_PROVIDER,
      useFactory: (config: ConfigService, cloudflare: CloudflareRelayService, mux: MuxRelayService) =>
        config.get<string>('relayProviderName') === 'mux' ? mux : cloudflare,
      inject: [ConfigService, CloudflareRelayService, MuxRelayService],
    },
  ],
  exports: [RELAY_PROVIDER, MediaMtxService],
})
export class RelayModule {}
