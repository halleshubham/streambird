export interface RelayLiveInput {
  uid: string;
  ingestUrl: string;
  streamKey: string;
}

export interface RelayLiveInputStatus {
  status: 'idle' | 'connected';
  outputs: Array<{ uid: string; status: string }>;
}

export const RELAY_PROVIDER = Symbol('RELAY_PROVIDER');

/**
 * Abstraction over an optional managed relay provider (Cloudflare Stream
 * Live by default, Mux Video as a swappable alternative -- see RelayModule,
 * which picks the implementation from config so a provider outage doesn't
 * require a code change to fail over). One live input per LiveStream; one
 * output per LiveStreamDestination. Never call a provider's API directly
 * from anywhere outside its own service in this directory.
 *
 * A RelayProvider is no longer in the platform-delivery critical path --
 * MediaMtxService forwards WHIP directly to every destination's own ingest
 * (see StreamsService.create()). A RelayProvider is only used additionally,
 * for its own value-add (hosted preview, recording), and only when
 * isConfigured() says its credentials are actually present -- StreamsService
 * skips creating a live input at all otherwise, rather than let an
 * unconfigured provider's API calls fail every time.
 */
export interface RelayProvider {
  /** Whether this provider's credentials are actually configured (env vars present), not just "selected" via RELAY_PROVIDER. */
  isConfigured(): boolean;
  createLiveInput(opts: { name: string; recording?: boolean }): Promise<RelayLiveInput>;
  deleteLiveInput(liveInputUid: string): Promise<void>;
  getLiveInputStatus(liveInputUid: string): Promise<RelayLiveInputStatus>;
}
