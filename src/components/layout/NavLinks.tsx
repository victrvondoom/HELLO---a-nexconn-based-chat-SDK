'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface NavLinkItem {
  href: string;
  label: string;
  icon: IconName;
}

/** Client island: only the active-state calculation needs the browser router. */
export function NavLinks({ items }: { items: NavLinkItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} className="nav-link" href={item.href} aria-current={current ? 'page' : undefined}>
            <Icon name={item.icon} />
            <span className="grow">{item.label}</span>
          </Link>
        );
      })}
    </>
  );
}
