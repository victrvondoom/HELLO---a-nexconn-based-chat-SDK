'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface NavLinkItem {
  href: string;
  label: string;
  icon: IconName;
  /** A live count shown beside the label. Omitted or zero shows nothing. */
  count?: number;
}

/** Client island: only the active-state calculation and live counts need the browser. */
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
            {item.count && item.count > 0 ? (
              <span className="nav-count" aria-label={`${item.count} unread`}>
                {item.count > 99 ? '99+' : item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </>
  );
}
