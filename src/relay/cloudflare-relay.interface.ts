export interface RelayOutput {
  uid: string;
  url: string;
  streamKey: string;
}

export interface RelayLiveInput {
  uid: string;
  ingestUrl: string;
  streamKey: string;
}

export interface RelayLiveInputStatus {
  status: 'idle' | 'connected';
  outputs: Array<{ uid: string; status: string }>;
}

export const CLOUDFLARE_RELAY = Symbol('CLOUDFLARE_RELAY');

/**
 * Abstraction over the managed relay provider (Cloudflare Stream Live).
 * One live input per LiveStream; one output per LiveStreamDestination.
 * Never call the Cloudflare API directly from anywhere else.
 */
export interface CloudflareRelay {
  createLiveInput(opts: { name: string; recording?: boolean }): Promise<RelayLiveInput>;
  addOutput(liveInputUid: string, dest: { url: string; streamKey: string }): Promise<RelayOutput>;
  removeOutput(liveInputUid: string, outputUid: string): Promise<void>;
  deleteLiveInput(liveInputUid: string): Promise<void>;
  getLiveInputStatus(liveInputUid: string): Promise<RelayLiveInputStatus>;
}
