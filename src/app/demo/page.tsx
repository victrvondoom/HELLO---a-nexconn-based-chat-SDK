import Link from 'next/link';
import { getRuntime } from '@/lib/runtime';
import { demoModeEnabled } from '@/lib/session';
import { DEMO_EVENT_ID } from '@/store/seed';
import { ROLE_LABEL } from '@/components/ui/labels';
import { DemoSignIn } from '@/components/demo/DemoSignIn';

export const dynamic = 'force-dynamic';

const ROLE_BLURB: Record<string, string> = {
  ATTENDEE: 'Report problems, ask questions, follow your requests.',
  SPEAKER: 'Attendee view plus presentation-related reporting.',
  VOLUNTEER: 'Claim and progress work that matches your skills.',
  OPERATIONS_STAFF: 'Operational queue, incident handling, room status.',
  ORGANISER: 'Everything above, plus approvals and signal review.',
  PLATFORM_ADMIN: 'Configuration and audit access.',
};

export default async function DemoPage() {
  if (!demoModeEnabled()) {
    return (
      <div className="page" style={{ maxWidth: 640 }}>
        <h1>Sign-in unavailable</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Demo accounts are disabled in this deployment. Real authentication must be configured first.
        </p>
      </div>
    );
  }
  const { store } = await getRuntime();
  const memberships = await store.listMemberships(DEMO_EVENT_ID);
  const accounts = await Promise.all(
    memberships.map(async (m) => {
      const user = await store.getUser(m.userId);
      return {
        userId: m.userId,
        name: user?.displayName ?? m.userId,
        role: ROLE_LABEL[m.role],
        blurb: ROLE_BLURB[m.role] ?? '',
      };
    }),
  );
  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <p className="eyebrow">
        <Link href="/">HELLO</Link> / Demo
      </p>
      <div className="page-header" style={{ marginTop: 8 }}>
        <div>
          <h1>Choose a demo role</h1>
          <p>
            Each account is a seeded, fictional person in the HELLO Global Technology Summit. Switch roles to see what each one
            can do. Access is decided on the server for every request.
          </p>
        </div>
      </div>
      <div className="notice notice--demo" role="note" style={{ marginBottom: 20 }}>
        <strong>Demo only.</strong> These accounts are not real people, and this is not production sign-in.
      </div>
      <DemoSignIn eventId={DEMO_EVENT_ID} accounts={accounts} />
    </div>
  );
}
