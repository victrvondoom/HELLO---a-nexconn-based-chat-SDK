import { loadEventViewer } from '@/lib/viewer';
import { StudioOutput } from '@/components/privacy-filter/StudioOutput';

export const dynamic = 'force-dynamic';

/** The protected camera alone, for OBS Window Capture. Same session, permissions and settings as the privacy page. */
export default async function PrivacyStudioPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  return (
    <>
      <h1 className="visually-hidden">Privacy filter studio output</h1>
      <StudioOutput eventId={eventId} userId={viewer.userId} />
    </>
  );
}
