'use client';

import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { useModals } from '@/components/modals/ModalProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { DirectPastePanel } from '@/components/ui/DirectPastePanel';
import { HotkeyPanel } from '@/components/ui/HotkeyPanel';
import { serverHost } from '@/lib/settings/network';

const METERED_PLACEHOLDER = 'your_metered_key_here';

export function SettingsView() {
  const [runtime, setRuntime] = useState<string | null>(null);
  const { openModal } = useModals();
  const { settings } = useSettings();

  useEffect(() => {
    setRuntime(window.omnivoice ? `Desktop app (${window.omnivoice.platform})` : 'Browser');
  }, []);

  const meteredKey = process.env.NEXT_PUBLIC_METERED_API_KEY;
  const { stunUrls, turnUrl } = settings.network;
  const rows: ReadonlyArray<[label: string, value: string]> = [
    ['Backend server', process.env.NEXT_PUBLIC_BACKEND_URL || 'Not set'],
    ['STUN servers', stunUrls.length > 0 ? stunUrls.join(', ') : 'Not set'],
    ['TURN relay', turnUrl ? serverHost(turnUrl) : 'Not set'],
    ['Metered TURN key', meteredKey && meteredKey !== METERED_PLACEHOLDER ? 'Set' : 'Not set'],
    ['App version', process.env.NEXT_PUBLIC_APP_VERSION || 'Not set'],
    ['Running as', runtime ?? 'Checking'],
  ];

  return (
    <div className="space-y-6">
      <section aria-labelledby="settings-preferences" className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5">
        <div className="min-w-0">
          <h2 id="settings-preferences" className="text-xl font-semibold text-ink">
            Preferences
          </h2>
          <p className="mt-1 max-w-prose text-mist">Contrast, text size, audio devices, keyboard shortcuts, and network servers.</p>
        </div>
        <button type="button" onClick={() => openModal({ kind: 'settings' })} className={buttonStyles.primary}>
          <SlidersHorizontal aria-hidden className="size-4" />
          Open settings
        </button>
      </section>
      <DirectPastePanel />
      <HotkeyPanel />
      <section aria-label="Connection details" className="glass rounded-2xl">
        <dl className="divide-y divide-white/10">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6">
              <dt className="text-mist sm:w-48 sm:shrink-0">{label}</dt>
              <dd className="break-all font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
