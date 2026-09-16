/**
 * What happens when an acoustic trigger fires or a sentence is reconstructed:
 * the four `targetAction`s of AcousticTriggerProfile, plus direct paste of
 * grammar output. Everything here is a side effect on the main thread and
 * is only reached from the session, never from the workers.
 */

import type { CaregiverAlert, CaregiverMessage } from '@shared/types';
import type { TriggerMatch } from '@/workers/trigger.worker';

export type ActionOutcome =
  | { ok: true; action: TriggerMatch['targetAction']; detail: string }
  | { ok: false; action: TriggerMatch['targetAction']; detail: string };

export interface ActionContext {
  /** Sends over the caregiver data channel; false when no caregiver is connected. */
  sendToCaregiver: (message: CaregiverMessage) => boolean;
}

let alertCounter = 0;

export function makeAlert(kind: CaregiverAlert['kind'], message: string, durationMs?: number): CaregiverAlert {
  alertCounter += 1;
  return { id: `${Date.now()}-${alertCounter}`, kind, message, timestamp: Date.now(), ...(durationMs !== undefined ? { durationMs } : {}) };
}

/** Types text into the focused app through the desktop bridge. */
export async function typeIntoActiveApp(text: string, submit = false): Promise<{ ok: boolean; detail: string }> {
  const bridge = typeof window !== 'undefined' ? window.omnivoice : undefined;
  if (!bridge) return { ok: false, detail: 'Direct paste needs the desktop app.' };
  const result = await bridge.directPaste.type({ text, mode: 'auto', submit });
  if (result.ok) {
    return { ok: true, detail: `Typed ${result.characters} characters${result.method === 'paste' ? ' through the clipboard' : ''}.` };
  }
  return { ok: false, detail: result.message };
}

export function speak(text: string): { ok: boolean; detail: string } {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return { ok: false, detail: 'Speech output is not available here.' };
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return { ok: true, detail: `Spoke "${text}".` };
}

export async function performTriggerAction(match: TriggerMatch, context: ActionContext): Promise<ActionOutcome> {
  const action = match.targetAction;
  switch (action) {
    case 'DIRECT_PASTE': {
      const result = await typeIntoActiveApp(match.mappedPhrase);
      return { ok: result.ok, action, detail: result.detail };
    }
    case 'TTS_SPOKEN': {
      const result = speak(match.mappedPhrase);
      return { ok: result.ok, action, detail: result.detail };
    }
    case 'WEBRTC_ALERT': {
      const alert = makeAlert('trigger', match.mappedPhrase);
      const sent = context.sendToCaregiver({ type: 'alert', alert });
      return sent
        ? { ok: true, action, detail: `Alert sent to the caregiver: "${match.mappedPhrase}".` }
        : { ok: false, action, detail: 'No caregiver device is connected, so the alert was not sent.' };
    }
    case 'OS_HOTKEY': {
      const bridge = typeof window !== 'undefined' ? window.omnivoice : undefined;
      if (!bridge) return { ok: false, action, detail: 'System shortcuts need the desktop app.' };
      const result = await bridge.directPaste.pressShortcut(match.mappedPhrase);
      return result.ok
        ? { ok: true, action, detail: `Pressed ${result.accelerator}.` }
        : { ok: false, action, detail: result.message };
    }
    default:
      return { ok: false, action, detail: `Unknown action ${String(action)}.` };
  }
}
