import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { FeedbackProvider } from '@/components/ui/Feedback';

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#151514' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
