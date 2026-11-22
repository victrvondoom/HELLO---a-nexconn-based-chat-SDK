// @ts-nocheck -- inherited from Chatdom (see THIRD_PARTY_CHATDOM.md); not type-checked under HELLO's config
/* global Worker:readonly */
import { growPictureMotions, type PictureMotion, type PictureMotionReply, type PictureTreeRef } from './picture-motion-core';
export { growPictureMotions, pictureTreeOf, type PictureMotion, type PictureMotionReply, type PictureTreeRef } from './picture-motion-core';

export function preparePictureMotions(refs: readonly PictureTreeRef[], options: { readonly signal?: AbortSignal } = {}): Promise<ReadonlyMap<string, PictureMotion>> {
  const index = (motions: readonly PictureMotion[]) => new Map(motions.map(motion => [motion.id, motion]));
  const unique = [...new Map(refs.map(ref => [`${ref.species}:${ref.style}:${ref.variant}`, ref])).values()];
  if (!unique.length) return Promise.resolve(new Map());
  if (typeof Worker === 'undefined') return Promise.resolve(index(growPictureMotions(unique)));
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(new DOMException('The kingdom closed', 'AbortError'));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./picture-motion-worker.ts', import.meta.url), { type: 'module', name: 'picture-motion' }); }
    catch (error) { reject(error); return; }
    let finished = false;
    const finish = () => { finished = true; worker.terminate(); signal?.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { if (finished) return; finish(); reject(error); };
    const abort = () => fail(new DOMException('The kingdom closed', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<PictureMotionReply>) => {
      if (finished) return;
      if ('error' in event.data) { fail(new Error(event.data.error)); return; }
      finish(); resolve(index(event.data.motions));
    };
    worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'The tree motion worker failed')); };
    worker.onmessageerror = () => fail(new Error('The tree motion worker sent an unreadable reply'));
    worker.postMessage(unique);
  });
}
