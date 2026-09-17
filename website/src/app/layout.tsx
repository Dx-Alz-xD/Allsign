import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { SiteFooter } from '@/components/site/SiteFooter';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteProviders } from '@/components/site/SiteProviders';
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
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://voicematics.vercel.app'),
  title: { default: 'Voicematics: assistive speech that hears you exactly', template: '%s · Voicematics' },
  description: 'Voicematics hears stuttered and atypical speech word for word, types it into any app, coaches fluency and keeps caregivers in the loop. Audio never leaves your computer.',
  applicationName: 'Voicematics',
  openGraph: { siteName: 'Voicematics', type: 'website' },
};

export const viewport: Viewport = {
  themeColor: '#0D0D0D',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="flex min-h-screen flex-col bg-obsidian font-sans text-bone antialiased">
        <SiteProviders>
          <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-ember focus:px-4 focus:py-2 focus:font-bold focus:text-obsidian">
            Skip to content
          </a>
          <SiteHeader />
          <div id="content" className="flex-1">
            {children}
          </div>
          <SiteFooter />
        </SiteProviders>
      </body>
    </html>
  );
}
