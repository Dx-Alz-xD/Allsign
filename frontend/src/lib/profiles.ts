import type { LucideIcon } from 'lucide-react';
import {
  AudioLines,
  AudioWaveform,
  Eye,
  HeartPulse,
  MessageSquareText,
  Mic,
  Puzzle,
} from 'lucide-react';
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
    label: 'ClearVoice Mode',
    description: 'Tidies your speech into clear, grammatical text and pastes it where you type.',
    icon: MessageSquareText,
  },
  {
    id: 'fluency',
    label: 'Fluency Coach Mode',
    description: 'Plays your voice back with a slight delay or pitch shift to support smoother speech.',
    icon: AudioWaveform,
  },
  {
    id: 'vocal_assist',
    label: 'Vocal Assist AAC Mode',
    description: 'Turns short sounds you can make into full phrases, spoken aloud or typed for you.',
    icon: Mic,
  },
  {
    id: 'therapy',
    label: 'Therapy Mode',
    description: 'Shows vowel targets and articulation accuracy for guided practice.',
    icon: HeartPulse,
  },
  {
    id: 'aphasia',
    label: 'Aphasia Mode',
    description: 'Rebuilds missing or out-of-order words into complete sentences using fixed grammar rules.',
    icon: Puzzle,
  },
  {
    id: 'sensory',
    label: 'Sensory HUD Mode',
    description: 'Shows volume, pitch, and voice strain as visual cues on screen.',
    icon: Eye,
  },
  {
    id: 'pitch_demo',
    label: 'Pitch Demo Mode',
    description: 'Shows audio analysis, text reconstruction, and caregiver telemetry side by side for live demos.',
    icon: AudioLines,
  },
];

export const DEFAULT_PROFILE: ProfileMode = 'clearvoice';

export function getProfilePreset(id: ProfileMode): ProfilePreset {
  return PROFILE_PRESETS.find((preset) => preset.id === id) ?? PROFILE_PRESETS[0];
}
