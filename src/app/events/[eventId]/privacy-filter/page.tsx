import { loadEventViewer } from '@/lib/viewer';
import { PrivacyDock } from '@/components/privacy-filter/PrivacyDock';

export const dynamic = 'force-dynamic';

export default async function PrivacyFilterPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const viewer = await loadEventViewer(eventId);
  return (
    <div className="page page--wide">
      <div className="page-header">
        <div>
          <h1>Privacy filter</h1>
          <p>Blur strangers, QR codes and phone numbers in your camera and pictures, on your own device, before anyone sees them.</p>
        </div>
      </div>
      <PrivacyDock eventId={eventId} userId={viewer.userId} />
    </div>
  );
}
