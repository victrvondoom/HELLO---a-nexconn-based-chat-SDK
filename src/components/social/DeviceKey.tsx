'use client';

import { useEffect } from 'react';
import { deviceIdentity, e2eeSupported } from '@/lib/e2ee/keystore';

/** Makes sure the signed-in person has a device key, so connections can message them. Renders nothing. */
export function DeviceKey({ userId }: { userId: string }) {
  useEffect(() => {
    if (!e2eeSupported()) return;
    deviceIdentity(userId).catch(() => undefined);
  }, [userId]);
  return null;
}
