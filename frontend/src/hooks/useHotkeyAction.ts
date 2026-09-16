'use client';

import { useEffect, useRef } from 'react';
import type { HotkeyAction } from '@/types/omnivoice';

/** Subscribes to global shortcuts forwarded by the Electron main process. No-op in a plain browser. */
export function useHotkeyAction(handler: (action: HotkeyAction) => void): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => window.omnivoice?.hotkeys.onAction((action) => handlerRef.current(action)), []);
}
