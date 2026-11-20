'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import type { NavLinkItem } from './NavLinks';
import type { SearchHit } from '@/services/search';

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  person: 'Person',
  session: 'Session',
  room: 'Room',
  request: 'Request',
  mission: 'Mission',
  community: 'Community',
  post: 'Post',
  guide: 'Event guide',
  announcement: 'Announcement',
  messages: 'Conversation',
};

type Entry = { href: string; label: string; icon: NavLinkItem['icon'] | null; kind: string | null; detail: string };

/**
 * Jump anywhere with ⌘K / Ctrl+K. It lists the pages the navigation already offers this viewer, and from
 * two characters on it also searches the event (GET /api/events/[eventId]/search). The server filters every
 * result by the viewer's permissions, so the palette never shows a record their role cannot open.
 */
export function CommandPalette({ items }: { items: NavLinkItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const eventId = /^\/events\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Search the event as the person types, a moment after they pause. A newer query replaces an older one.
  useEffect(() => {
    const q = query.trim();
    if (!open || !eventId || q.length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/events/${eventId}/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
        .then((r) => r.json() as Promise<{ ok: boolean; data?: { hits: SearchHit[] } }>)
        .then((body) => {
          if (live) setHits(body.ok && body.data ? body.data.hits : []);
        })
        .catch(() => {
          if (live) setHits([]);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, open, eventId]);

  const results: Entry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Pages: label matches first, then pages that only match on a keyword ("feed" finds Moments).
    const byLabel = q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items;
    const byKeyword = q ? items.filter((item) => !byLabel.includes(item) && (item.keywords ?? '').toLowerCase().includes(q)) : [];
    const pages = [...byLabel, ...byKeyword].map((item) => ({ href: item.href, label: item.label, icon: item.icon, kind: null, detail: '' }));
    return [...pages, ...hits.map((h) => ({ href: h.href, label: h.title, icon: null, kind: KIND_LABEL[h.kind], detail: h.detail }))];
  }, [items, query, hits]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  function go(item: Entry | undefined) {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }

  function onInputKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') setOpen(false);
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[active]);
    }
  }

  return (
    <>
      <button type="button" className="palette-trigger" onClick={() => { setOpen(true); }} aria-haspopup="dialog" aria-label="Search pages">
        <Icon name="search" />
        <span className="grow palette-trigger__text">Search or jump to…</span>
        <kbd className="palette-trigger__kbd">⌘K</kbd>
      </button>
      {open
        ? createPortal(
        <div className="palette-backdrop" onClick={() => { setOpen(false); }}>
          <div
            className="palette"
            role="dialog"
            aria-modal="true"
            aria-label="Jump to a page"
            onClick={(event) => { event.stopPropagation(); }}
          >
            <input
              ref={inputRef}
              className="palette__input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKey}
              placeholder="Search people, sessions, rooms, requests… or a page"
              aria-label="Search the event"
              aria-controls="palette-results"
              aria-activedescendant={results[active] ? `palette-${String(active)}` : undefined}
            />
            <ul id="palette-results" className="palette__list" role="listbox" aria-label="Pages">
              {results.map((item, index) => (
                <li
                  key={`${item.href}|${item.label}`}
                  id={`palette-${String(index)}`}
                  role="option"
                  aria-selected={index === active}
                  className="palette__item"
                  onMouseEnter={() => { setActive(index); }}
                  onClick={() => { go(item); }}
                >
                  {item.icon ? <Icon name={item.icon} /> : <span className="palette__kind xs">{item.kind}</span>}
                  <span className="grow">
                    {item.label}
                    {item.detail ? <span className="palette__detail xs faint">{item.detail}</span> : null}
                  </span>
                </li>
              ))}
              {results.length === 0 ? <li className="palette__empty">{searching ? 'Searching…' : `Nothing matches “${query}”.`}</li> : null}
            </ul>
            <p className="palette__hint xs faint">↑ ↓ to move · Enter to open · Esc to close</p>
          </div>
        </div>,
            // Rendered on <body>: the sidebar's backdrop-filter would otherwise trap this fixed overlay inside it.
            document.body,
          )
        : null}
    </>
  );
}
