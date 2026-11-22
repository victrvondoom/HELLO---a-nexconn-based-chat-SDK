// @ts-nocheck -- inherited from Chatdom (see THIRD_PARTY_CHATDOM.md); not type-checked under HELLO's config
/// <reference lib="webworker" />
import { planAdoptedCoverFor, type AdoptedCoverReply, type AdoptedCoverRequest } from './adopted-cover-request';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<AdoptedCoverRequest>) => {
  try {
    scope.postMessage({ plan: planAdoptedCoverFor(event.data) } satisfies AdoptedCoverReply);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies AdoptedCoverReply);
  }
};
