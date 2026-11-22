import { Tiro_Bangla, Tiro_Gurmukhi, Tiro_Kannada, Tiro_Tamil, Tiro_Telugu } from 'next/font/google';

/**
 * Tiro Typeworks draws one serif across India's scripts, so a greeting in Kannada or Bangla has the same voice as the
 * Latin and Devanagari headline (Tiro Devanagari Hindi, loaded by the root layout). Only the script subsets are
 * requested, and none is preloaded: a browser downloads a script's file only when that greeting is shown.
 */
// next/font reads these options at build time, so each call spells them out (no shared object or spread).
const kannada = Tiro_Kannada({ weight: '400', display: 'swap', preload: false, subsets: ['kannada'] });
const tamil = Tiro_Tamil({ weight: '400', display: 'swap', preload: false, subsets: ['tamil'] });
const telugu = Tiro_Telugu({ weight: '400', display: 'swap', preload: false, subsets: ['telugu'] });
const bangla = Tiro_Bangla({ weight: '400', display: 'swap', preload: false, subsets: ['bengali'] });
const gurmukhi = Tiro_Gurmukhi({ weight: '400', display: 'swap', preload: false, subsets: ['gurmukhi'] });

export type Greeting = {
  lang: string;
  /** How the picker names the language, in its own script. */
  endonym: string;
  /** The language's name in English, for the caption and for screen readers. */
  name: string;
  hello: string;
  fontFamily: string;
};

export const GREETINGS: Greeting[] = [
  { lang: 'hi', endonym: 'हिन्दी', name: 'Hindi', hello: 'नमस्ते', fontFamily: 'var(--font-serif)' },
  { lang: 'kn', endonym: 'ಕನ್ನಡ', name: 'Kannada', hello: 'ನಮಸ್ಕಾರ', fontFamily: kannada.style.fontFamily },
  { lang: 'ta', endonym: 'தமிழ்', name: 'Tamil', hello: 'வணக்கம்', fontFamily: tamil.style.fontFamily },
  { lang: 'te', endonym: 'తెలుగు', name: 'Telugu', hello: 'నమస్కారం', fontFamily: telugu.style.fontFamily },
  { lang: 'bn', endonym: 'বাংলা', name: 'Bangla', hello: 'নমস্কার', fontFamily: bangla.style.fontFamily },
  { lang: 'pa', endonym: 'ਪੰਜਾਬੀ', name: 'Punjabi', hello: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', fontFamily: gurmukhi.style.fontFamily },
  { lang: 'en', endonym: 'English', name: 'English', hello: 'Hello', fontFamily: 'var(--font-serif)' },
];
