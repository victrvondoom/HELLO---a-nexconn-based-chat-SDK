'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import type { NavLinkItem } from './NavLinks';

/**
 * Jump anywhere with ⌘K / Ctrl+K. It only lists pages the navigation already offers this viewer,
 * so it never reveals a page their role cannot open (and each page re-checks access on the server).
 */
export function CommandPalette({ items }: { items: NavLinkItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

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

  function go(item: NavLinkItem | undefined) {
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
      <button type="button" className="palette-trigger" onClick={() => { setOpen(true); }} aria-haspopup="dialog">
        <Icon name="search" />
        <span className="grow">Jump to…</span>
        <kbd>⌘K</kbd>
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
              placeholder="Type a page name…"
              aria-label="Search pages"
              aria-controls="palette-results"
              aria-activedescendant={results[active] ? `palette-${String(active)}` : undefined}
            />
            <ul id="palette-results" className="palette__list" role="listbox" aria-label="Pages">
              {results.map((item, index) => (
                <li
                  key={item.href}
                  id={`palette-${String(index)}`}
                  role="option"
                  aria-selected={index === active}
                  className="palette__item"
                  onMouseEnter={() => { setActive(index); }}
                  onClick={() => { go(item); }}
                >
                  <Icon name={item.icon} />
                  <span className="grow">{item.label}</span>
                </li>
              ))}
              {results.length === 0 ? <li className="palette__empty">No page matches “{query}”.</li> : null}
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
