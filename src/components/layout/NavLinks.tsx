'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface NavLinkItem {
  href: string;
  label: string;
  icon: IconName;
  /** A live count shown beside the label. Omitted or zero shows nothing. */
  count?: number;
  /** Match only this exact path, not its sub-pages. Used for the event home. */
  exact?: boolean;
  /** Extra words the command palette matches, so "feed" still finds Moments. */
  keywords?: string;
}

export function isCurrent(pathname: string, item: Pick<NavLinkItem, 'href' | 'exact'>): boolean {
  return pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`));
}

/** Client island: only the active-state calculation and live counts need the browser. */
export function NavLinks({ items, onNavigate }: { items: NavLinkItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const current = isCurrent(pathname, item);
        return (
          <Link key={item.href} className="nav-link" href={item.href} aria-current={current ? 'page' : undefined} onClick={onNavigate}>
            <Icon name={item.icon} size={18} />
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

/** "More": a fold for tools people open rarely. It starts open when the current page is inside it. */
export function NavMore({ items, children }: { items: NavLinkItem[]; children?: ReactNode }) {
  const pathname = usePathname();
  const inside = items.some((item) => isCurrent(pathname, item));
  return (
    <details className="nav-more" open={inside || undefined}>
      <summary className="nav-more__summary">
        <Icon name="more" size={18} />
        <span className="grow">More</span>
        <Icon name="chevron" size={14} />
      </summary>
      <div className="nav-more__items">
        <NavLinks items={items} />
        {children}
      </div>
    </details>
  );
}
