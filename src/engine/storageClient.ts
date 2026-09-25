// Main-thread client for the storage worker (M1-12). One worker per app,
// created lazily on first use.
import { RpcClient } from './rpc';
import type { StorageApi } from './storageApi';

let client: RpcClient<StorageApi> | undefined;

export function storageClient(): RpcClient<StorageApi> {
  if (!client || client.isLost) {
    const worker = new Worker(new URL('../workers/storage.worker.ts', import.meta.url), {
      type: 'module',
      name: 'storage',
    });
    client = new RpcClient<StorageApi>(worker, 'storage');
  }
  return client;
}
