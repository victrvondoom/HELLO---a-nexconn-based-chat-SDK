'use client';

import { useEffect, useState } from 'react';
import { GREETINGS, type Greeting } from './scripts';
import { Rangoli } from './Motifs';

const TURN_MS = 3200;

/**
 * The landing hero's window: an ogee arch at dawn, a blue-pottery medallion inside it, and "hello" in seven of
 * India's scripts. The greeting turns on its own until someone picks a language, hovers or focuses the window, or
 * prefers reduced motion; then it stays where they left it. Each greeting carries its `lang`, so a screen reader
 * pronounces it in that language.
 */
export function Jharokha() {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [chosen, setChosen] = useState(false);

  useEffect(() => {
    if (held || chosen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % GREETINGS.length);
    }, TURN_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [held, chosen]);

  const greeting = GREETINGS[index % GREETINGS.length] as Greeting;

  return (
    <figure
      className="jharokha"
      onPointerEnter={() => {
        setHeld(true);
      }}
      onPointerLeave={() => {
        setHeld(false);
      }}
      onFocus={() => {
        setHeld(true);
      }}
      onBlur={() => {
        setHeld(false);
      }}
    >
      <div className="jharokha__frame">
        <div className="jharokha__window">
          <div className="jharokha__medallion">
            <p key={greeting.lang} className="jharokha__hello" lang={greeting.lang} style={{ fontFamily: greeting.fontFamily }}>
              {greeting.hello}
            </p>
            <p className="jharokha__caption">Hello in {greeting.name}</p>
          </div>
          <div className="jharokha__ghat" aria-hidden="true" />
        </div>
        <div className="jharokha__flowers" aria-hidden="true">
          <Rangoli id="jk-f1" dye="mehendi" petals={9} size={118} className="jharokha__f1" />
          <Rangoli id="jk-f2" dye="kesar" kind="point" petals={8} inner={0.5} size={84} className="jharokha__f2" />
          <Rangoli id="jk-f3" dye="neel" petals={4} inner={0.42} size={72} className="jharokha__f3" rotate={45} />
          <Rangoli id="jk-f4" dye="rani" petals={10} inner={0.74} size={54} className="jharokha__f4" />
          <Rangoli id="jk-f5" dye="dawn" petals={8} size={96} className="jharokha__f5" />
          <Rangoli id="jk-f6" dye="peacock" kind="point" petals={6} inner={0.46} size={60} className="jharokha__f6" />
          <Rangoli id="jk-f7" dye="rani" kind="point" petals={4} inner={0.4} size={40} className="jharokha__f7" rotate={45} />
        </div>
      </div>
      <figcaption className="jharokha__picker">
        <span className="visually-hidden">Say hello in</span>
        {GREETINGS.map((g, i) => (
          <button
            key={g.lang}
            type="button"
            lang={g.lang}
            className="jharokha__script"
            style={{ fontFamily: g.fontFamily }}
            aria-pressed={i === index}
            title={g.name}
            onClick={() => {
              setIndex(i);
              setChosen(true);
            }}
          >
            {g.endonym}
          </button>
        ))}
      </figcaption>
    </figure>
  );
}
