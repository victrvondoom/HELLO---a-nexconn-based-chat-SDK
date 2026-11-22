// @ts-nocheck -- inherited from Chatdom (see THIRD_PARTY_CHATDOM.md); not type-checked under HELLO's config
/* global Worker:readonly */
import type { SettlementPlan } from '@chatdom/world';
import { foundedGroundWindow, joinFoundedGround, sampleFoundedGroundBand, type FoundedGround, type FoundedGroundBand, type FoundedGroundRequest } from './terrain-founded-core';
export { foundedHeightSampler } from './terrain-founded-sampler';
export { foundedGroundWindow, joinFoundedGround, sampleFoundedGroundBand, type FoundedGround, type FoundedGroundBand, type FoundedGroundRequest, type FoundedGroundWindow } from './terrain-founded-core';

/**
 * Samples the installed ground in up to six workers. Without workers (tests, very old browsers) it samples
 * here. Rejects on abort or a worker failure; there is no partial result.
 */
export function prepareFoundedGround(plan: SettlementPlan, options: { readonly signal?: AbortSignal; readonly parts?: number } = {}): Promise<FoundedGround> {
  const window = foundedGroundWindow(plan);
  if (typeof Worker === 'undefined') return Promise.resolve(joinFoundedGround(plan, window, [sampleFoundedGroundBand({ plan, window, part: 0, parts: 1 })]));
  // The opening waits on these bands before it can place anything; on a big machine more bands finish sooner.
  const parts = options.parts ?? Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2));
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(new DOMException('The kingdom closed', 'AbortError'));
  return new Promise((resolve, reject) => {
    const workers: Worker[] = [], bands: FoundedGroundBand[] = [];
    let finished = false;
    const stop = () => { for (const worker of workers) worker.terminate(); signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { if (finished) return; finished = true; stop(); reject(error); };
    const abort = () => fail(new DOMException('The kingdom closed', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    for (let part = 0; part < parts; part++) {
      let worker: Worker;
      try { worker = new Worker(new URL('./terrain-founded-worker.ts', import.meta.url), { type: 'module', name: 'founded-ground' }); }
      catch (error) { fail(error); return; }
      workers.push(worker);
      worker.onmessage = (event: MessageEvent<FoundedGroundBand | { readonly error: string }>) => {
        if (finished) return;
        if ('error' in event.data) { fail(new Error(event.data.error)); return; }
        bands.push(event.data); worker.terminate();
        if (bands.length < parts) return;
        try { const ground = joinFoundedGround(plan, window, bands); finished = true; stop(); resolve(ground); }
        catch (error) { fail(error); }
      };
      worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'The ground worker failed')); };
      worker.onmessageerror = () => fail(new Error('The ground worker sent an unreadable band'));
      worker.postMessage({ plan, window, part, parts } satisfies FoundedGroundRequest);
    }
  });
}
