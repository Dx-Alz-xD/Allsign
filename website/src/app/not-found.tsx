import type { Metadata } from 'next';
import { NotFoundScene } from '@/components/site/NotFoundScene';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
};

export default function NotFound() {
  return <NotFoundScene />;
}
