import { loadEventViewer } from '@/lib/viewer';
import { listGames } from '@/services/games';
import { GameLobby } from '@/components/games/Games';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Games' };

export default async function GamesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Between sessions</p>
          <h1>Games</h1>
          <p>Play with other people at the event. Moves and scores are checked by the server, so nobody can cheat from their browser.</p>
        </div>
      </div>
      <GameLobby eventId={eventId} initial={await listGames(viewer.ctx, eventId, viewer.userId)} canPlay={viewer.can('message.send')} />
    </div>
  );
}
