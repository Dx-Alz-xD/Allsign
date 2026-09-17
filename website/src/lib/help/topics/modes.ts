import { qa, type HelpTopic } from '@/lib/help/types';

export const modes: HelpTopic = {
  id: 'modes',
  title: 'Fluency Coach, Therapy, Sensory HUD and Studio',
  summary: 'Auditory feedback, practice targets, on-screen cues and the everything-at-once view.',
  nodes: [
    qa('modes-overview', 'What are the modes?', [
      'Six modes sit in the sidebar of the desktop app: ClearVoice (hear, tidy and type), Fluency Coach (auditory feedback), Gesture Trainer (sounds as actions), Therapy (vowel and articulation practice), Sensory HUD (your voice as on-screen cues) and Studio (everything side by side).',
      'Pick one to change what the app does while you speak; switch any time.',
    ], { keywords: ['modes', 'profiles', 'sidebar', 'which mode'], see: ['fl-what', 'g-what', 'th-what', 'hud-what', 'studio-what'] }),
    qa('fl-what', 'What is the Fluency Coach?', [
      'It plays your own voice back into your headphones a little late (delayed auditory feedback, DAF) and, if you like, slightly higher or lower (frequency-shifted feedback, FSF). Many people who stutter speak more smoothly while hearing it.',
      'It is part of Pro and needs headphones.',
    ], { keywords: ['fluency', 'daf', 'fsf', 'delayed auditory feedback', 'frequency shift', 'stutter help'], see: ['fl-start', 'fl-echo'] }),
    qa('fl-start', 'What settings should I start with?', [
      'A common starting point for stuttering is a delay of 50 to 75 ms with no pitch shift. The delay goes from 30 to 150 ms; raise it in small steps if blocks continue.',
      'Pitch shift goes up to half an octave (six semitones) either way; a downward shift adds a chorus-like effect some people find helpful.',
      'These are starting points, not prescriptions. A speech-language pathologist can tune them with you.',
    ], { keywords: ['settings', 'delay', 'milliseconds', 'recommend', 'best setting', 'semitones'], see: ['fl-presets'] }),
    qa('fl-presets', 'Can I save my feedback settings?', [
      'Yes. In the Fluency Coach, give the current settings a name and save them as a preset. Presets are stored in your account and follow you to other computers.',
    ], { keywords: ['preset', 'save settings', 'profiles'], see: ['fl-start'] }),
    qa('fl-echo', 'I hear an echo or a howl', [
      'The delayed voice is coming out of the speakers and back into the microphone. Use headphones, wired if you can (Bluetooth adds its own delay), and lower the output volume.',
    ], { keywords: ['echo', 'howl', 'feedback loop', 'speakers', 'screech'], see: ['setup-headset'] }),
    qa('fl-no-sound', 'I cannot hear the feedback', [
      'Start the microphone first, then switch feedback on in the Fluency Coach. Check the output device in Settings, Audio, and the feedback volume slider. If the app is muted (the microphone button in the top bar or Ctrl+Shift+M), nothing plays.',
    ], { keywords: ['no sound', 'cannot hear', 'silent', 'feedback not working'], see: ['fl-echo', 'sc-list'] }),
    qa('fl-when-stop', 'When should I stop using feedback?', [
      'Stop if you feel dizzy, short of breath, uncomfortable or anxious, and talk to your clinician before continuing. Feedback is a practice aid, not a treatment.',
    ], { keywords: ['dizzy', 'uncomfortable', 'safety', 'side effects'], see: ['about-medical'] }),
    qa('th-what', 'What is Therapy mode?', [
      'A practice space for vowels and articulation. A live vowel chart shows where your voice lands from its formants, with a target vowel highlighted and an accuracy score for each attempt.',
      'Choose the speaker profile that fits your voice (adult lower or higher voice) or build your own targets from your voice. It is part of Pro.',
    ], { keywords: ['therapy', 'vowel', 'formants', 'articulation', 'practice', 'slp'], see: ['th-targets', 'th-clinician'] }),
    qa('th-targets', 'How do I add my own targets?', [
      'In Therapy, choose "Your own targets", say the vowel the way you want to aim for and save it. Targets are stored in your account.',
    ], { keywords: ['custom target', 'own targets', 'add vowel'], see: ['th-what'] }),
    qa('th-clinician', 'Can my speech-language pathologist use it with me?', [
      'Yes, as a practice aid between or during sessions. The measurements are approximate and are not a clinical assessment; your clinician decides what they mean for you.',
    ], { keywords: ['clinician', 'therapist', 'slp', 'speech pathologist', 'session'], see: ['about-medical'] }),
    qa('hud-what', 'What is the Sensory HUD?', [
      'Your voice as clear on-screen cues: volume, pitch and a vocal strain index, with blocks and fatigue flagged as they happen. Free on every plan.',
    ], { keywords: ['sensory hud', 'hud', 'visual cues', 'strain', 'volume meter'], see: ['hud-strain'] }),
    qa('hud-strain', 'What does the strain index mean?', [
      'A 0 to 100 indicator built from jitter, shimmer and the harmonics-to-noise ratio. Rising values suggest the voice is working harder; above about 75 it is a good moment to rest.',
      'It is a heuristic for your own awareness, not a validated clinical score.',
    ], { keywords: ['strain', 'fatigue', 'jitter', 'shimmer', 'hnr', 'tired voice'], see: ['about-medical'] }),
    qa('studio-what', 'What is Studio?', [
      'Every measurement, the rebuilt text and the caregiver view side by side on one wide screen, for demonstrations, classrooms or simply seeing everything at once. Free on every plan; Ctrl+Shift+P switches it on and off.',
      'Without a microphone it plays a demonstration signal and sends demo sentences through the real grammar engine.',
    ], { keywords: ['studio', 'pitch demo', 'demo mode', 'presentation', 'dashboard'], see: ['sc-list'] }),
    qa('an-what', 'What are session analytics?', [
      'When you stop the microphone, a summary of the session (speaking rate, blocks, fluency) is saved to your account, and the Analytics view shows trends across sessions. Part of Pro.',
    ], { keywords: ['analytics', 'progress', 'history', 'sessions', 'statistics', 'trends'], see: ['plan-compare'] }),
  ],
};
