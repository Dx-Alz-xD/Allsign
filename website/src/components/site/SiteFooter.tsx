import Link from 'next/link';
import { BrandMark } from '@/components/site/BrandMark';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#simulator', label: 'Live demo' },
      { href: '/#pricing', label: 'Pricing' },
      { href: '/about', label: 'How it works' },
    ],
  },
  {
    title: 'Caregivers',
    links: [
      { href: '/caregiver', label: 'Caregiver console' },
      { href: '/alert', label: 'Phone alert button' },
      { href: '/help', label: 'Help and answers' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About Voicematics' },
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/account', label: 'Your profile' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-white/[0.06] bg-onyx/40">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div>
          <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold text-bone">
            <BrandMark gradientId="brand-bar-footer" />
            Voicematics
          </Link>
          <p className="mt-3 max-w-xs text-sm text-smoke">
            Assistive speech for people who stutter or speak differently. Your voice is analysed on your computer; audio is never uploaded.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <p className="text-xs font-bold uppercase tracking-wider text-smoke">{column.title}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-bone/80 hover:text-ember">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/[0.06] px-6 py-5 text-center text-xs text-smoke">
        Voicematics is an assistive communication tool, not a medical device. © {new Date().getFullYear()} Voicematics.
      </div>
    </footer>
  );
}
