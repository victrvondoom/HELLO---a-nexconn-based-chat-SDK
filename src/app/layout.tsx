import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
// The Meadow design system, in cascade order: tokens, then primitives, then the shell, then each area.
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/shell.css';
import '@/styles/landing.css';
import '@/styles/ops.css';
import '@/styles/social.css';
import '@/styles/venue.css';
import '@/styles/moments.css';
import { FeedbackProvider } from '@/components/ui/Feedback';

// Self-hosted at build time by next/font: no request reaches Google from a visitor's browser.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const instrument = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'HELLO — One conversation. Everyone connected.',
    template: '%s · HELLO',
  },
  description: 'Coordination for physical events: conversations that become accountable workflows, and an event that feels like home.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f5f1e6',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable} ${jetbrains.variable}`}>
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
