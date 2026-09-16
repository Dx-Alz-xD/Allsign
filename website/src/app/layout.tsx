import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// The same OFL fonts the desktop app bundles (see ./fonts/OFL-*.txt).
const display = localFont({
  src: [
    { path: './fonts/ChakraPetch-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ChakraPetch-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/ChakraPetch-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-display',
  display: 'swap',
});

const body = localFont({
  src: [
    { path: './fonts/AtkinsonHyperlegible-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/AtkinsonHyperlegible-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Voicematics',
  description: 'Sub-15ms assistive speech realignment. Your audio stays on your device.',
};

export const viewport: Viewport = {
  themeColor: '#0D0D0D',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen bg-obsidian font-sans text-bone antialiased">{children}</body>
    </html>
  );
}
