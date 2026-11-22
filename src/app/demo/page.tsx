import Link from 'next/link';
import { getRuntime } from '@/lib/runtime';
import { demoModeEnabled } from '@/lib/session';
import { DEMO_EVENT_ID } from '@/store/seed';
import { ROLE_LABEL } from '@/components/ui/labels';
import { DemoSignIn } from '@/components/demo/DemoSignIn';
import { Wordmark } from '@/components/brand/Wordmark';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Enter' };

export default async function DemoPage() {
  if (!demoModeEnabled()) {
    return (
      <main className="auth">
        <h1>Sign-in unavailable</h1>
        <p className="muted">
          Demo accounts are disabled in this deployment. <Link href="/signin">Sign in or create an account</Link>.
        </p>
      </main>
    );
  }
  const { store } = await getRuntime();
  const memberships = await store.listMemberships(DEMO_EVENT_ID);
  const accounts = await Promise.all(
    memberships.map(async (m) => ({
      userId: m.userId,
      name: (await store.getUser(m.userId))?.displayName ?? m.userId,
      role: ROLE_LABEL[m.role],
    })),
  );
  return (
    <main className="auth">
      <Link href="/" aria-label="HELLO home">
        <Wordmark height={44} id="wm-demo" title="HELLO" />
      </Link>
      <h1>Welcome</h1>
      <p className="muted">A demo event with fictional people. Nothing to fill in.</p>
      <DemoSignIn eventId={DEMO_EVENT_ID} accounts={accounts} />
      <p className="small muted">
        <Link href="/signin">Use your own account</Link>
      </p>
    </main>
  );
}
