import { getRuntime } from '@/lib/runtime';
import { demoModeEnabled } from '@/lib/session';
import { DEMO_EVENT_ID } from '@/store/seed';
import { ROLE_LABEL } from '@/components/ui/labels';
import { DemoSignIn } from '@/components/demo/DemoSignIn';

export const dynamic = 'force-dynamic';

export default async function DemoPage() {
  if (!demoModeEnabled()) {
    return (
      <main className="main">
        <h1>Sign-in unavailable</h1>
        <p className="muted">Demo accounts are disabled in this deployment. Configure real authentication to continue.</p>
      </main>
    );
  }
  const { store } = await getRuntime();
  const memberships = await store.listMemberships(DEMO_EVENT_ID);
  const accounts = await Promise.all(
    memberships.map(async (m) => {
      const user = await store.getUser(m.userId);
      return { userId: m.userId, name: user?.displayName ?? m.userId, role: ROLE_LABEL[m.role] };
    }),
  );
  return (
    <main className="main" style={{ maxWidth: 760 }}>
      <h1>Choose a demo account</h1>
      <div className="notice notice--demo stack" role="note" style={{ marginBottom: 16 }}>
        <strong>Demo accounts only.</strong>
        <span>
          These switch you into a seeded role for the HELLO Global Technology Summit. They are not real people and this
          is not production sign-in. Each role sees only what its permissions allow.
        </span>
      </div>
      <DemoSignIn eventId={DEMO_EVENT_ID} accounts={accounts} />
    </main>
  );
}
