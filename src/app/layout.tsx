import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Anek_Latin, Tiro_Devanagari_Hindi, JetBrains_Mono } from 'next/font/google';
// The Jharokha design system, in cascade order: tokens, then primitives, then the shell, then each area.
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/shell.css';
import '@/styles/landing.css';
import '@/styles/ops.css';
import '@/styles/social.css';
import '@/styles/venue.css';
import '@/styles/moments.css';
import '@/styles/guide.css';
import '@/styles/privacy.css';
import { FeedbackProvider } from '@/components/ui/Feedback';

// Self-hosted at build time by next/font: no request reaches Google from a visitor's browser.
// Anek Latin (Ek Type) for reading; Tiro Devanagari Hindi (Tiro Typeworks) for display, a Latin serif drawn to sit
// beside Devanagari, so Hindi names and greetings share the headline's voice.
const anek = Anek_Latin({ subsets: ['latin', 'latin-ext'], variable: '--font-anek', display: 'swap', axes: ['wdth'] });
const tiro = Tiro_Devanagari_Hindi({
  subsets: ['latin', 'devanagari'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-tiro',
  display: 'swap',
});
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
  themeColor: '#fbfaf7',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${anek.variable} ${tiro.variable} ${jetbrains.variable}`}>
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}

export const dynamic = 'force-dynamic';
