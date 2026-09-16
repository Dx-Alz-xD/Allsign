'use client';

import { Contrast, FileText } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { useModals } from '@/components/modals/ModalProvider';
import { useSettings } from '@/components/providers/SettingsProvider';

export function AccessibilityView() {
  const { openModal } = useModals();
  const { settings, highContrast } = useSettings();

  const commitments: ReadonlyArray<[title: string, detail: string]> = [
    ['Motion', "Animations follow your system's reduce-motion setting."],
    [
      'Keyboard',
      'Every control works with a keyboard. Tab moves between controls, Enter or Space selects, arrow keys move through menus and tabs, and Esc closes them.',
    ],
    [
      'Contrast',
      highContrast
        ? 'High contrast is on. Every text color reaches at least 7:1 contrast.'
        : 'Text and controls meet WCAG 2.1 AA contrast. Turn on high contrast for at least 7:1.',
    ],
    ['Text size', `Text is at ${settings.display.textScale}%. You can enlarge it up to 200%, and the layout rearranges to fit.`],
    ['Reading', 'Body text uses Atkinson Hyperlegible, a typeface designed for readers with low vision.'],
  ];

  return (
    <div className="space-y-6">
      <section aria-label="Accessibility support" className="glass rounded-2xl">
        <dl className="divide-y divide-white/10">
          {commitments.map(([title, detail]) => (
            <div key={title} className="px-5 py-4">
              <dt className="font-display text-lg font-semibold text-ink">{title}</dt>
              <dd className="mt-1 max-w-prose leading-relaxed text-mist">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => openModal({ kind: 'settings', tab: 'display' })} className={buttonStyles.primary}>
          <Contrast aria-hidden className="size-4" />
          Change contrast and text size
        </button>
        <button type="button" onClick={() => openModal({ kind: 'terms', section: 'accessibility' })} className={buttonStyles.secondary}>
          <FileText aria-hidden className="size-4" />
          Read your accessibility rights
        </button>
      </div>
    </div>
  );
}
