import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadEventViewer } from '@/lib/viewer';
import { DomainError } from '@/domain/errors';
import { viewGame } from '@/services/games';
import { GameBoard } from '@/components/games/Games';

export const dynamic = 'force-dynamic';

export default async function GamePage({ params }: { params: Promise<{ eventId: string; gameId: string }> }) {
  const { eventId, gameId } = await params;
  const viewer = await loadEventViewer(eventId);
  const game = await viewGame(viewer.ctx, eventId, viewer.userId, gameId).catch((error: unknown) => {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });
  return (
    <div className="page">
      <p className="eyebrow">
        <Link href={`/events/${eventId}/games`}>Games</Link> / {game.kind === 'FOUR' ? 'Four in a row' : 'Schedule quiz'}
      </p>
      <div className="page-header">
        <h1>{game.kind === 'FOUR' ? 'Four in a row' : 'Schedule quiz'}</h1>
      </div>
      <GameBoard eventId={eventId} initial={game} />
    </div>
  );
}
