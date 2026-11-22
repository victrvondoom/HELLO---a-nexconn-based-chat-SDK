'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';

/** Tabs across the Moments pages: Feed, MemoReels, Explore, Saved and the charter that orders them. */
export function MomentsNav({ eventId }: { eventId: string }) {
  const pathname = usePathname();
  const base = `/events/${eventId}/feed`;
  const tabs: Array<{ href: string; label: string; icon: IconName }> = [
    { href: base, label: 'Feed', icon: 'home' },
    { href: `${base}/reels`, label: 'MemoReels', icon: 'reels' },
    { href: `${base}/explore`, label: 'Explore', icon: 'compass' },
    { href: `${base}/saved`, label: 'Saved', icon: 'bookmark' },
    { href: `${base}/charter`, label: 'How it works', icon: 'info' },
  ];
  return (
    <nav className="moments-nav" aria-label="Moments">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="moments-nav__tab" aria-current={pathname === t.href ? 'page' : undefined}>
          <Icon name={t.icon} size={17} />
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
