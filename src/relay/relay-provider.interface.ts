export interface RelayOutput {
  uid: string;
  url: string;
  streamKey: string;
}

export interface RelayLiveInput {
  uid: string;
  ingestUrl: string;
  streamKey: string;
  /**
   * WHIP (WebRTC) publish URL for this live input, if the provider supports
   * browser-based ingest -- null otherwise. The host studio's client-side
   * compositor requires this; a provider without it can still be used for
   * the OBS/RTMP ingest fallback, but not the browser studio.
   */
  whipUrl: string | null;
}

export interface RelayLiveInputStatus {
  status: 'idle' | 'connected';
  outputs: Array<{ uid: string; status: string }>;
}

export const RELAY_PROVIDER = Symbol('RELAY_PROVIDER');

/**
 * Abstraction over the managed relay provider (Cloudflare Stream Live by
 * default, Mux Video as a swappable alternative -- see RelayModule, which
 * picks the implementation from config so a provider outage doesn't require
 * a code change to fail over). One live input per LiveStream; one output
 * per LiveStreamDestination. Never call a provider's API directly from
 * anywhere outside its own service in this directory.
 */
export interface RelayProvider {
  createLiveInput(opts: { name: string; recording?: boolean }): Promise<RelayLiveInput>;
  addOutput(liveInputUid: string, dest: { url: string; streamKey: string }): Promise<RelayOutput>;
  removeOutput(liveInputUid: string, outputUid: string): Promise<void>;
  deleteLiveInput(liveInputUid: string): Promise<void>;
  getLiveInputStatus(liveInputUid: string): Promise<RelayLiveInputStatus>;
}
