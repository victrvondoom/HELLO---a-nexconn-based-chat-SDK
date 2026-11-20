'use client';

import { useRef, useState } from 'react';
import { api, errorText } from '@/components/live/client';
import { useFeedback } from '@/components/ui/Feedback';
import type { PostView } from '@/services/feed';

/**
 * Like, save, share and double-tap for one post, shared by feed cards and reels. Likes and saves answer
 * at once (optimistic) and roll back if the server refuses; a fresh copy of the post from the server
 * always wins.
 */
export function usePostActions(eventId: string, post: PostView, onChanged: () => Promise<void>) {
  const base = `/api/events/${eventId}`;
  const { toast } = useFeedback();
  const [liked, setLiked] = useState(post.liked);
  const [likes, setLikes] = useState(post.likeCount);
  const [saved, setSaved] = useState(post.saved);
  const [burst, setBurst] = useState(0);
  const lastTap = useRef(0);

  const [seen, setSeen] = useState({ liked: post.liked, likeCount: post.likeCount, saved: post.saved });
  if (seen.liked !== post.liked || seen.likeCount !== post.likeCount || seen.saved !== post.saved) {
    setSeen({ liked: post.liked, likeCount: post.likeCount, saved: post.saved });
    setLiked(post.liked);
    setLikes(post.likeCount);
    setSaved(post.saved);
  }

  async function like(on: boolean) {
    setLiked(on);
    setLikes((n) => Math.max(0, n + (on ? 1 : -1)));
    try {
      await api(`${base}/feed/${post.id}`, 'POST', { action: 'like', on });
      await onChanged();
    } catch (e: unknown) {
      setLiked(!on);
      setLikes((n) => Math.max(0, n + (on ? -1 : 1)));
      toast('error', errorText(e));
    }
  }

  /** Two taps within a third of a second like the post (never unlike it) and show the heart. */
  function tap() {
    const t = Date.now();
    if (t - lastTap.current < 320) {
      lastTap.current = 0;
      setBurst((b) => b + 1);
      if (!liked) void like(true);
    } else {
      lastTap.current = t;
    }
  }

  async function save(on: boolean) {
    setSaved(on);
    try {
      await api(`${base}/moments/saves`, 'POST', { postId: post.id, on });
      toast('success', on ? 'Saved. Only you can see your saves.' : 'Removed from your saves.');
      await onChanged();
    } catch (e: unknown) {
      setSaved(!on);
      toast('error', errorText(e));
    }
  }

  async function share() {
    try {
      await api(`${base}/feed`, 'POST', { text: '', repostOf: post.id, communityId: null, mediaId: null });
      toast('success', 'Shared to your feed.');
      await onChanged();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  async function remove() {
    try {
      await api(`${base}/feed/${post.id}`, 'POST', { action: 'delete' });
      toast('success', 'Post deleted.');
      await onChanged();
    } catch (e: unknown) {
      toast('error', errorText(e));
    }
  }

  return { liked, likes, saved, burst, like, tap, save, share, remove };
}
