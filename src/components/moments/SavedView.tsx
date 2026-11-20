'use client';

import { useLive } from '@/components/live/client';
import type { PostView } from '@/services/feed';
import { PostGrid } from './PostGrid';

interface SavedData {
  now: number;
  posts: PostView[];
}

/** Your saved posts. Saves are private: nobody, including the author, can see who saved what. */
export function SavedView({ eventId, initial }: { eventId: string; initial: SavedData }) {
  const { data, refresh } = useLive<SavedData>(`/api/events/${eventId}/moments/saves`, initial, 30_000);
  return <PostGrid eventId={eventId} posts={data.posts} now={data.now} onChanged={refresh} empty="Tap the bookmark on any post to keep it here. Only you can see your saves." />;
}
