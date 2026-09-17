/**
 * The sign-up interview: the questions, their choices, and what the answers suggest. The answers are saved with
 * the account (backend schemas.OnboardingAnswers) and only tune what the site and the app point people to first.
 */

import type { OnboardingAnswers, OnboardingExperience, OnboardingGoal, OnboardingPlace, OnboardingRole, OnboardingSpeech } from '@shared/types';

export interface Choice<T extends string> {
  value: T;
  label: string;
  detail: string;
}

export const ROLE_CHOICES: Choice<OnboardingRole>[] = [
  { value: 'myself', label: 'For myself', detail: 'I want help being heard, typing by voice or practising speech.' },
  { value: 'someone-i-care-for', label: 'For someone I care for', detail: 'A family member, partner or friend who speaks with a difference.' },
  { value: 'clinician', label: 'I am a clinician', detail: 'A speech-language pathologist or therapist working with clients.' },
  { value: 'educator', label: 'I am an educator', detail: 'A teacher or support worker setting it up for students.' },
  { value: 'exploring', label: 'Just exploring', detail: 'Curious about how it works. No pressure.' },
];

export const GOAL_CHOICES: Choice<OnboardingGoal>[] = [
  { value: 'type-by-voice', label: 'Type by voice', detail: 'Everything said, stutters included, typed into any app.' },
  { value: 'smoother-speech', label: 'Speak more smoothly', detail: 'Delayed and pitch-shifted feedback while talking.' },
  { value: 'calls-and-meetings', label: 'Calls and meetings', detail: 'Get words across in chats, calls and meetings.' },
  { value: 'gestures', label: 'Sounds as shortcuts', detail: 'A hum or a click that types, speaks or presses keys.' },
  { value: 'caregiver-alerts', label: 'Keep someone in the loop', detail: 'Live readings and alerts for a trusted person.' },
  { value: 'therapy-practice', label: 'Practise with targets', detail: 'Vowel charts and articulation accuracy.' },
  { value: 'track-progress', label: 'Track progress', detail: 'Speaking rate, blocks and fluency over time.' },
];

export const SPEECH_CHOICES: Choice<OnboardingSpeech>[] = [
  { value: 'stuttering', label: 'Stuttering', detail: 'Repeated sounds or words, blocks, prolongations.' },
  { value: 'cluttering', label: 'Cluttering', detail: 'Fast or irregular speech that runs words together.' },
  { value: 'voice-strain', label: 'Voice strain or fatigue', detail: 'A voice that tires, cracks or feels effortful.' },
  { value: 'motor-speech', label: 'Motor speech difference', detail: 'For example dysarthria after a stroke or with a condition.' },
  { value: 'not-sure', label: 'Not sure yet', detail: 'That is fine; the app measures, it does not diagnose.' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say', detail: 'Skip this; nothing depends on it.' },
];

export const PLACE_CHOICES: Choice<OnboardingPlace>[] = [
  { value: 'work', label: 'Work', detail: 'Email, documents, team chat.' },
  { value: 'school', label: 'School or university', detail: 'Lectures, assignments, class chat.' },
  { value: 'home', label: 'Home', detail: 'Everyday messages and browsing.' },
  { value: 'clinic', label: 'Clinic or therapy', detail: 'Sessions with a speech-language pathologist.' },
  { value: 'online-calls', label: 'Online calls', detail: 'Zoom, Teams, Discord and the like.' },
  { value: 'gaming', label: 'Gaming', detail: 'Voice chat and in-game shortcuts.' },
];

export const EXPERIENCE_CHOICES: Choice<OnboardingExperience>[] = [
  { value: 'new', label: 'This is new to me', detail: 'We will start with the simplest setup.' },
  { value: 'some', label: 'I have tried a few', detail: 'Dictation, apps or feedback devices before.' },
  { value: 'experienced', label: 'I use them every day', detail: 'Show me everything, including the settings.' },
];

export function labelOf<T extends string>(choices: Choice<T>[], value: T | null | undefined): string {
  return choices.find((choice) => choice.value === value)?.label ?? '';
}

export interface Recommendation {
  mode: string;
  why: string;
  pro: boolean;
}

/** The modes worth trying first, most relevant first. Deterministic: plain rules over the answers. */
export function recommend(answers: OnboardingAnswers): Recommendation[] {
  const picks = new Map<string, Recommendation>();
  const add = (mode: string, why: string, pro = false) => {
    if (!picks.has(mode)) picks.set(mode, { mode, why, pro });
  };
  const goals = new Set(answers.goals);
  const speech = new Set(answers.speech);
  const places = new Set(answers.places);

  if (goals.has('type-by-voice') || goals.has('calls-and-meetings') || places.has('work') || places.has('school')) {
    add('ClearVoice', 'Hears you word for word, stutters included, and types it where you are working, even while minimised.');
  }
  if (goals.has('smoother-speech') || speech.has('stuttering') || speech.has('cluttering')) {
    add('Fluency Coach', 'Plays your voice back a few milliseconds late or slightly shifted, which helps many people speak more smoothly.', true);
  }
  if (goals.has('gestures') || places.has('gaming') || speech.has('motor-speech')) {
    add('Gesture Trainer', 'Teach it a short sound, then use that sound to type a phrase, speak it aloud or press a shortcut.');
  }
  if (goals.has('caregiver-alerts') || answers.role === 'someone-i-care-for') {
    add('Caregiver Link', 'A trusted person you approve by username sees live readings and gets alerts, including from your phone.', true);
  }
  if (goals.has('therapy-practice') || answers.role === 'clinician' || places.has('clinic')) {
    add('Therapy', 'Live vowel chart and articulation accuracy, with your own practice targets.', true);
  }
  if (speech.has('voice-strain') || goals.has('track-progress')) {
    add('Sensory HUD', 'Volume, pitch and strain as clear on-screen cues, so you notice fatigue before it hurts.');
  }
  if (goals.has('track-progress') || answers.role === 'clinician') {
    add('Session analytics', 'Speaking rate, blocks and fluency across sessions, saved to your account.', true);
  }
  if (answers.role === 'educator' || answers.role === 'exploring' || picks.size === 0) {
    add('Studio', 'Every measurement side by side: the best way to see what Voicematics does.');
  }
  add('ClearVoice', 'The heart of Voicematics: your words, heard exactly and typed for you.');
  return Array.from(picks.values()).slice(0, 4);
}

export function emptyAnswers(): OnboardingAnswers {
  return { role: 'myself', goals: [], speech: [], places: [], experience: null, note: '' };
}
