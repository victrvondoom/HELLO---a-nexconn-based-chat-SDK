import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUserId, demoModeEnabled } from '@/lib/session';
import { DEMO_EVENT_ID } from '@/store/seed';
import { Wordmark } from '@/components/brand/Wordmark';
import { SignInForm } from '@/components/auth/SignInForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

export default async function SignInPage() {
  if (await currentUserId()) redirect(`/events/${DEMO_EVENT_ID}/flow`);
  return (
    <main className="auth">
      <Link href="/" aria-label="HELLO home">
        <Wordmark height={44} id="wm-signin" title="HELLO" />
      </Link>
      <h1 style={{ marginTop: 20 }}>Welcome</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        One account for the conversation, the feed, calls, games and the map.
      </p>
      <SignInForm demo={demoModeEnabled()} />
    </main>
  );
}
