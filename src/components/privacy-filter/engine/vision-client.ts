import type { Envelope, VisionRequest, VisionResult } from './protocol';

type ResultOf<T extends VisionResult['type']> = Extract<VisionResult, { type: T }>;

/** One vision worker, used request by request. Each lane (faces, QR) gets its own, so neither waits on the other. */
export class VisionClient {
  private readonly worker: Worker;
  private seq = 0;
  private readonly waiting = new Map<number, { resolve: (v: VisionResult) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module', name: 'hello-privacy-vision' });
    this.worker.onmessage = (event: MessageEvent<Envelope<VisionResult>>) => {
      const entry = this.waiting.get(event.data.id);
      if (!entry) return;
      this.waiting.delete(event.data.id);
      if (event.data.ok) entry.resolve(event.data.body);
      else entry.reject(new Error(event.data.error));
    };
    this.worker.onerror = (event) => {
      for (const entry of this.waiting.values()) entry.reject(new Error(event.message || 'The privacy filter worker stopped.'));
      this.waiting.clear();
    };
  }

  request<T extends VisionRequest['type']>(req: Extract<VisionRequest, { type: T }>): Promise<ResultOf<T>> {
    const id = (this.seq += 1);
    const transfer: Transferable[] = [];
    if ('frame' in req) transfer.push(req.frame);
    if ('image' in req) transfer.push(req.image);
    return new Promise<VisionResult>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker.postMessage({ id, req }, transfer);
    }) as Promise<ResultOf<T>>;
  }

  terminate(): void {
    this.worker.terminate();
    for (const entry of this.waiting.values()) entry.reject(new Error('stopped'));
    this.waiting.clear();
  }
}
