import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  CloudflareRelay,
  RelayLiveInput,
  RelayLiveInputStatus,
  RelayOutput,
} from './cloudflare-relay.interface';

/**
 * In-memory stand-in for CloudflareRelayService, used in tests so
 * StreamsService's orchestration logic can be exercised without a real
 * Cloudflare account.
 */
@Injectable()
export class FakeCloudflareRelay implements CloudflareRelay {
  readonly liveInputs = new Map<string, { outputs: Map<string, RelayOutput> }>();

  async createLiveInput(): Promise<RelayLiveInput> {
    const uid = crypto.randomUUID();
    this.liveInputs.set(uid, { outputs: new Map() });
    return {
      uid,
      ingestUrl: `rtmps://fake.local/${uid}`,
      streamKey: 'fake-stream-key',
      whipUrl: `https://fake.local/${uid}/webRTC/publish`,
    };
  }

  async addOutput(
    liveInputUid: string,
    dest: { url: string; streamKey: string },
  ): Promise<RelayOutput> {
    const input = this.liveInputs.get(liveInputUid);
    if (!input) throw new Error(`Unknown live input ${liveInputUid}`);
    const uid = crypto.randomUUID();
    const output = { uid, url: dest.url, streamKey: dest.streamKey };
    input.outputs.set(uid, output);
    return output;
  }

  async removeOutput(liveInputUid: string, outputUid: string): Promise<void> {
    this.liveInputs.get(liveInputUid)?.outputs.delete(outputUid);
  }

  async deleteLiveInput(liveInputUid: string): Promise<void> {
    this.liveInputs.delete(liveInputUid);
  }

  async getLiveInputStatus(liveInputUid: string): Promise<RelayLiveInputStatus> {
    const input = this.liveInputs.get(liveInputUid);
    return {
      status: input ? 'connected' : 'idle',
      outputs: [...(input?.outputs.values() ?? [])].map((o) => ({
        uid: o.uid,
        status: 'live',
      })),
    };
  }
}
