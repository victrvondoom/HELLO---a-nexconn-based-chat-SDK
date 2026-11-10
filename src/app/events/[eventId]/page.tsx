import { redirect } from 'next/navigation';

export default async function EventIndexPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  redirect(`/events/${eventId}/conversation`);
}
