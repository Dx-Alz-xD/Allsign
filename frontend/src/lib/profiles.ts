import type { LucideIcon } from 'lucide-react';
import { AudioWaveform, Eye, HeartPulse, Hand, LayoutDashboard, MessageSquareText } from 'lucide-react';
import type { ProfileMode } from '@shared/types';

export interface ProfilePreset {
  id: ProfileMode;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const PROFILE_PRESETS: readonly ProfilePreset[] = [
  {
    id: 'clearvoice',
    label: 'ClearVoice',
    description: 'Hears what you say, word for word, and rebuilds it into clear text that is typed where you are working.',
    icon: MessageSquareText,
  },
  {
    id: 'fluency',
    label: 'Fluency Coach',
    description: 'Plays your voice back with a slight delay or pitch shift to support smoother speech.',
    icon: AudioWaveform,
  },
  {
    id: 'vocal_assist',
    label: 'Gesture Trainer',
    description: 'Teach Voicematics short sounds you can make, and link each one to a phrase, a spoken message or a shortcut.',
    icon: Hand,
  },
  {
    id: 'therapy',
    label: 'Therapy',
    description: 'Shows vowel targets and articulation accuracy for guided practice.',
    icon: HeartPulse,
  },
  {
    id: 'sensory',
    label: 'Sensory HUD',
    description: 'Shows volume, pitch, and voice strain as visual cues on screen.',
    icon: Eye,
  },
  {
    id: 'pitch_demo',
    label: 'Studio',
    description: 'Audio analysis, text reconstruction and caregiver telemetry side by side.',
    icon: LayoutDashboard,
  },
];

/** Aphasia Mode was folded into ClearVoice; saved data with that profile still loads. */
export const RETIRED_PROFILES: readonly ProfileMode[] = ['aphasia'];

export const DEFAULT_PROFILE: ProfileMode = 'clearvoice';

export function getProfilePreset(id: ProfileMode): ProfilePreset {
  const match = PROFILE_PRESETS.find((preset) => preset.id === id);
  if (match) return match;
  // A retired profile shows as the mode that replaced it.
  return { ...PROFILE_PRESETS[0], id };
}
