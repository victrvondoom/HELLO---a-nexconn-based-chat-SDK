import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, Nunito } from 'next/font/google';
import './globals.css';
import { FeedbackProvider } from '@/components/ui/Feedback';

// Self-hosted at build time by next/font: no request reaches Google from a visitor's browser.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const nunito = Nunito({ subsets: ['latin'], weight: ['600', '700', '800', '900'], variable: '--font-nunito', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'HELLO — One conversation. Everyone connected.',
    template: '%s · HELLO',
  },
  description: 'Coordination for physical events: conversations that become accountable workflows.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${nunito.variable}`}>
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
