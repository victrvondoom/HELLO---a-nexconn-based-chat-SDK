'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The landing hero's world: a deep sky, a sun, drifting clouds and four layers of hills with a lone
 * tree, a dirt road and a small walker. Each layer is its own SVG at its own depth, so moving the
 * pointer or scrolling shifts them at different speeds (parallax), which reads as real 3D space. Each
 * layer moves as one composited element, so the grass texture is drawn once, not every frame.
 *
 * Motion is a progressive enhancement: the scene is complete without JavaScript, and nothing moves for
 * people who prefer reduced motion. Pointer and scroll updates are batched into one animation frame.
 * Everything is drawn inline: no image or font request leaves the page.
 */
export function MeadowScene({ children }: { children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const scroll = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height)));
      el.style.setProperty('--px', px.toFixed(3));
      el.style.setProperty('--py', py.toFixed(3));
      el.style.setProperty('--scroll', scroll.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      px = event.clientX / window.innerWidth - 0.5;
      py = event.clientY / window.innerHeight - 0.5;
      schedule();
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="meadow" ref={root}>
      <div className="meadow__sky" aria-hidden="true">
        <div className="meadow__sun" />
        <div className="meadow__cloud meadow__cloud--a" />
        <div className="meadow__cloud meadow__cloud--b" />
        <div className="meadow__cloud meadow__cloud--c" />
        <div className="meadow__cloud meadow__cloud--d" />
      </div>

      <div className="meadow__land" aria-hidden="true">
        <svg className="meadow__layer meadow__layer--far" viewBox="0 0 1440 560" preserveAspectRatio="xMidYMax slice" focusable="false">
          <defs>
            <linearGradient id="mw-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#93c7b0" />
              <stop offset="1" stopColor="#7db58f" />
            </linearGradient>
            <linearGradient id="mw-back" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#86c46e" />
              <stop offset="1" stopColor="#5fa64c" />
            </linearGradient>
            <linearGradient id="mw-mid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5daa4a" />
              <stop offset="1" stopColor="#3b8a3c" />
            </linearGradient>
            <linearGradient id="mw-near" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3f9445" />
              <stop offset="0.6" stopColor="#25703a" />
              <stop offset="1" stopColor="#164f28" />
            </linearGradient>
            <filter id="mw-grass" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9 0.35" numOctaves="2" seed="7" result="noise" />
              <feColorMatrix in="noise" values="0 0 0 0 0.05  0 0 0 0 0.2  0 0 0 0 0.08  0 0 0 0.35 0" result="tint" />
              <feComposite in="tint" in2="SourceGraphic" operator="in" result="grain" />
              <feMerge>
                <feMergeNode in="SourceGraphic" />
                <feMergeNode in="grain" />
              </feMerge>
            </filter>
          </defs>
          <path d="M-120 250 C60 200 300 215 460 240 C620 265 760 205 930 215 C1100 225 1260 190 1560 205 V560 H-120 Z" fill="url(#mw-far)" />
        </svg>

        <svg className="meadow__layer meadow__layer--back" viewBox="0 0 1440 560" preserveAspectRatio="xMidYMax slice" focusable="false">
          <path d="M-120 300 C80 250 360 262 540 300 C720 338 900 270 1080 280 C1260 290 1360 262 1560 270 V560 H-120 Z" fill="url(#mw-back)" />
        </svg>

        <svg className="meadow__layer meadow__layer--mid" viewBox="0 0 1440 560" preserveAspectRatio="xMidYMax slice" focusable="false">
          <path d="M-120 360 C120 300 420 318 640 360 C860 402 1040 320 1240 328 C1340 332 1440 340 1560 346 V560 H-120 Z" fill="url(#mw-mid)" filter="url(#mw-grass)" />
          {/* The lone tree, leaning a little into the wind. */}
          <g transform="translate(1118 300)">
            <path d="M0 34 C1 18 4 6 9 -8" stroke="#4a3a24" strokeWidth="5" strokeLinecap="round" fill="none" />
            <path d="M5 0 C-4 -6 -10 -12 -14 -20" stroke="#4a3a24" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            <ellipse cx="-14" cy="-30" rx="24" ry="18" fill="#2f7d3a" />
            <ellipse cx="14" cy="-38" rx="28" ry="22" fill="#3a8c41" />
            <ellipse cx="-2" cy="-52" rx="22" ry="17" fill="#4aa04b" />
            <ellipse cx="26" cy="-22" rx="16" ry="12" fill="#2a7134" />
            <ellipse cx="6" cy="-44" rx="12" ry="8" fill="#6dbb5a" opacity="0.7" />
            <ellipse cx="2" cy="36" rx="34" ry="5" fill="#1f5f2c" opacity="0.35" />
          </g>
        </svg>

        <svg className="meadow__layer meadow__layer--near" viewBox="0 0 1440 560" preserveAspectRatio="xMidYMax slice" focusable="false">
          <path d="M-120 430 C100 380 420 392 620 430 C820 468 1000 400 1200 404 C1320 406 1440 418 1560 424 V560 H-120 Z" fill="url(#mw-near)" filter="url(#mw-grass)" />
          {/* A dirt road winding up the hill. */}
          <path d="M520 560 C560 520 600 486 700 462 C780 444 850 436 930 418" stroke="#d8c59a" strokeWidth="16" strokeLinecap="round" fill="none" opacity="0.9" />
          <path d="M520 560 C560 520 600 486 700 462 C780 444 850 436 930 418" stroke="#b9a274" strokeWidth="2" strokeDasharray="2 14" strokeLinecap="round" fill="none" opacity="0.7" />
        </svg>

        {/* The walker has a layer of its own (moving with the near hill), so walking never repaints the grass. */}
        <svg className="meadow__layer meadow__layer--near meadow__figures" viewBox="0 0 1440 560" preserveAspectRatio="xMidYMax slice" focusable="false">
          {/* White shirt, blue jeans: small against a big hill. */}
          <g className="meadow__walker">
            <g transform="translate(760 452)">
              <circle cx="0" cy="-15" r="3" fill="#5b4632" />
              <path d="M-3 -12 h6 v8 h-6z" fill="#ffffff" />
              <path d="M-2.4 -4 l-1.4 7 M2.4 -4 l1.4 7" stroke="#1565a8" strokeWidth="2.4" strokeLinecap="round" />
              <ellipse cx="0" cy="4" rx="6" ry="1.4" fill="#164f28" opacity="0.35" />
            </g>
          </g>
        </svg>
      </div>

      <div className="meadow__content">{children}</div>
    </div>
  );
}
