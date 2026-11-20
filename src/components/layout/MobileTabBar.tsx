'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { NavLinks, isCurrent, type NavLinkItem } from './NavLinks';
import type { NavGroup } from './nav-model';
import { createOptions } from './CreateMenu';

type Sheet = 'menu' | 'create' | null;

/**
 * Phone navigation: five thumbs-reach tabs (Home, Moments, Create, Messages, Menu), like the apps people
 * already live in. "Menu" opens every section the sidebar offers; "Create" offers story, post or report.
 * Shown only below 900px (see shell.css); the sidebar covers wider screens.
 */
export function MobileTabBar({
  eventId,
  groups,
  more,
  settings,
  canPost,
  unreadMessages = 0,
}: {
  eventId: string;
  groups: NavGroup[];
  more: NavLinkItem[];
  settings: NavLinkItem;
  canPost: boolean;
  unreadMessages?: number;
}) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = useCallback(() => {
    setSheet(null);
  }, []);
  const base = `/events/${eventId}`;

  useEffect(() => {
    setSheet(null);
  }, [pathname]);

  const tabs: Array<{ item: NavLinkItem; short: string }> = [
    { item: { href: base, label: 'Home', icon: 'home', exact: true }, short: 'Home' },
    { item: { href: `${base}/feed`, label: 'Moments', icon: 'camera' }, short: 'Moments' },
    { item: { href: `${base}/messages`, label: 'Messages', icon: 'lock', count: unreadMessages }, short: 'Messages' },
  ];
  const [home, moments, messages] = tabs;

  return (
    <>
      <nav className="tabbar" aria-label="Quick navigation">
        {home ? <Tab item={home.item} label={home.short} pathname={pathname} /> : null}
        {moments ? <Tab item={moments.item} label={moments.short} pathname={pathname} /> : null}
        <button
          type="button"
          className="tabbar__create"
          aria-label="Create"
          aria-expanded={sheet === 'create'}
          onClick={() => {
            setSheet(sheet === 'create' ? null : 'create');
          }}
        >
          <Icon name="plus" size={24} />
        </button>
        {messages ? <Tab item={messages.item} label={messages.short} pathname={pathname} /> : null}
        <button
          type="button"
          className="tabbar__tab"
          aria-expanded={sheet === 'menu'}
          onClick={() => {
            setSheet(sheet === 'menu' ? null : 'menu');
          }}
        >
          <Icon name="menu" size={22} />
          <span>Menu</span>
        </button>
      </nav>

      {sheet === 'menu' ? (
        <BottomSheet label="Menu" onClose={close}>
          {groups.map((g) => (
            <section key={g.id} className="sheet__group">
              {g.label ? <h2 className="nav-group">{g.label}</h2> : null}
              <div className="sheet__grid">
                <NavLinks items={g.items} />
              </div>
            </section>
          ))}
          <section className="sheet__group">
            <h2 className="nav-group">More</h2>
            <div className="sheet__grid">
              <NavLinks items={[...more, settings]} />
            </div>
          </section>
        </BottomSheet>
      ) : null}

      {sheet === 'create' ? (
        <BottomSheet label="Create" onClose={close}>
          <div className="sheet__create">
            {createOptions(eventId, canPost).map((o) => (
              <Link key={o.href} href={o.href} className="create-menu__item create-menu__item--big">
                <span className="create-menu__icon" aria-hidden="true">
                  <Icon name={o.icon} size={22} />
                </span>
                <span>
                  <strong>{o.label}</strong>
                  <span className="xs faint">{o.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </BottomSheet>
      ) : null}
    </>
  );
}

function Tab({ item, label, pathname }: { item: NavLinkItem; label: string; pathname: string }) {
  const current = isCurrent(pathname, item);
  return (
    <Link href={item.href} className="tabbar__tab" aria-current={current ? 'page' : undefined}>
      <span className="tabbar__icon">
        <Icon name={item.icon} size={22} />
        {item.count && item.count > 0 ? <span className="tabbar__dot" aria-label={`${item.count} unread`} /> : null}
      </span>
      <span>{label}</span>
    </Link>
  );
}

/** A modal sheet that slides up from the bottom. Escape, the backdrop and the close button dismiss it. */
function BottomSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="sheet__handle" aria-hidden="true" />
        <div className="sheet__head">
          <h2 className="serif">{label}</h2>
          <button ref={closeRef} type="button" className="icon-button" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}
