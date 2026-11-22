'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/components/live/client';
import { DEFAULT_PRIVACY_FILTER, type PrivacyFilterSettings } from '@/domain/privacy-filter/settings';
import { featuresOf, listPeople, type KeptPerson } from './engine/gallery';

export interface AlertView {
  id: string;
  from: string;
  source: 'CALL' | 'TWITCH';
  callId: string | null;
  at: number;
  acknowledged: boolean;
}

export interface TwitchView {
  connection: string;
  live: boolean | null;
  channel: string;
  alert: { sender: string; at: number } | null;
  eventId: string | null;
}

export interface PrivacyFilterState {
  settings: PrivacyFilterSettings & { updatedAt: number | null };
  alerts: AlertView[];
  twitch: TwitchView;
  userId: string;
}

/** The person's switches (server) and the people kept visible (this device only). */
export function usePrivacyFilter(eventId: string, userId: string) {
  const [state, setState] = useState<PrivacyFilterState | null>(null);
  const [people, setPeople] = useState<KeptPerson[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setState(await api<PrivacyFilterState>(`/api/events/${eventId}/privacy-filter`));
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load the privacy filter.');
    }
  }, [eventId]);

  const reloadPeople = useCallback(async () => {
    try {
      setPeople(await listPeople(userId));
    } catch {
      setPeople([]);
    }
  }, [userId]);

  useEffect(() => {
    void reload();
    void reloadPeople();
  }, [reload, reloadPeople]);

  const save = useCallback(
    async (patch: Partial<PrivacyFilterSettings>) => {
      // Optimistic: the switch moves at once; a refused change is put back from the server's copy.
      setState((s) => (s ? { ...s, settings: { ...s.settings, ...patch } } : s));
      try {
        const settings = await api<PrivacyFilterState['settings']>(`/api/events/${eventId}/privacy-filter`, 'PUT', patch);
        setState((s) => (s ? { ...s, settings } : s));
        return settings;
      } catch (error) {
        await reload();
        throw error;
      }
    },
    [eventId, reload],
  );

  return {
    state,
    loaded: state !== null,
    settings: state?.settings ?? { ...DEFAULT_PRIVACY_FILTER, updatedAt: null },
    people,
    gallery: featuresOf(people),
    error,
    reload,
    reloadPeople,
    save,
  };
}
