import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// Fonts are bundled (SIL OFL, see ./fonts/OFL-*.txt) so the desktop app renders correctly offline.
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
  description: 'Assistive speech and acoustic desktop platform.',
};

export const viewport: Viewport = {
  themeColor: '#0B0F17',
  colorScheme: 'dark',
};

/**
 * Applies saved display settings before first paint so high contrast never flashes off. Mirrors
 * src/lib/settings/schema.ts. In the desktop app the preload script applies text size as page zoom.
 */
const APPLY_DISPLAY_SETTINGS = `(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('omnivoice:settings') || 'null');
    var display = (saved && saved.display) || {};
    var high = typeof display.highContrast === 'boolean'
      ? display.highContrast
      : window.matchMedia('(prefers-contrast: more)').matches;
    document.documentElement.setAttribute('data-contrast', high ? 'high' : 'standard');
    var scale = Number(display.textScale);
    if (!window.omnivoice && scale > 100 && scale <= 200) document.documentElement.style.fontSize = scale + '%';
  } catch (error) {}
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPLY_DISPLAY_SETTINGS }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
