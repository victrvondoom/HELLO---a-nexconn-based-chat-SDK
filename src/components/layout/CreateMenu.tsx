'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface CreateOption {
  href: string;
  label: string;
  hint: string;
  icon: IconName;
}

/** The options "Create" offers. Posting needs `message.send`; reporting a problem is open to everyone. */
export function createOptions(eventId: string, canPost: boolean): CreateOption[] {
  const base = `/events/${eventId}`;
  return [
    ...(canPost
      ? [
          { href: `${base}/feed?compose=story`, label: 'New story', hint: 'Gone in 24 hours', icon: 'camera' as const },
          { href: `${base}/feed?compose=post`, label: 'New post', hint: 'Text, a picture or a video', icon: 'plus' as const },
        ]
      : []),
    { href: `${base}/conversation`, label: 'Report a problem', hint: 'HELLO finds the right people', icon: 'incidents' as const },
  ];
}

/** The sidebar's "Create" button: a small menu that closes on navigation, Escape or a click outside. */
export function CreateMenu({ eventId, canPost }: { eventId: string; canPost: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const options = createOptions(eventId, canPost);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="create-menu" ref={root}>
      <button
        type="button"
        className="button button--sun button--block create-menu__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <Icon name="plus" size={18} /> Create
      </button>
      {open ? (
        <div className="create-menu__panel" role="menu" aria-label="Create">
          {options.map((o) => (
            <Link
              key={o.href}
              href={o.href}
              role="menuitem"
              className="create-menu__item"
              onClick={() => {
                setOpen(false);
              }}
            >
              <span className="create-menu__icon" aria-hidden="true">
                <Icon name={o.icon} size={18} />
              </span>
              <span>
                <strong>{o.label}</strong>
                <span className="xs faint">{o.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
