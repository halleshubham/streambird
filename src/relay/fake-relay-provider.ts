import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { RelayProvider, RelayLiveInput, RelayLiveInputStatus } from './relay-provider.interface';

/**
 * In-memory stand-in for a real RelayProvider (Cloudflare or Mux), used in
 * tests so StreamsService's orchestration logic can be exercised without a
 * real account against either.
 */
@Injectable()
export class FakeRelayProvider implements RelayProvider {
  readonly liveInputs = new Set<string>();

  /** Always "configured" in tests -- there's no env var to be missing. */
  isConfigured(): boolean {
    return true;
  }

  async createLiveInput(): Promise<RelayLiveInput> {
    const uid = crypto.randomUUID();
    this.liveInputs.add(uid);
    return {
      uid,
      ingestUrl: `rtmps://fake.local/${uid}`,
      streamKey: 'fake-stream-key',
    };
  }

  async deleteLiveInput(liveInputUid: string): Promise<void> {
    this.liveInputs.delete(liveInputUid);
  }

  async getLiveInputStatus(liveInputUid: string): Promise<RelayLiveInputStatus> {
    return {
      status: this.liveInputs.has(liveInputUid) ? 'connected' : 'idle',
      outputs: [],
    };
  }
}
