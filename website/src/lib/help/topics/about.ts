import { qa, type HelpTopic } from '@/lib/help/types';

export const about: HelpTopic = {
  id: 'about',
  title: 'About Voicematics',
  summary: 'Who it is for, what it is not, and where to learn more.',
  nodes: [
    qa('about-who', 'Who is Voicematics for?', [
      'People who stutter or clutter, people with voice strain or motor speech differences, the family and friends who support them, and the clinicians and educators who work with them.',
    ], { keywords: ['who is it for', 'audience', 'stuttering', 'speech difference'], see: ['setup-what', 'modes-overview'], link: { label: 'Read the About page', href: '/about' } }),
    qa('about-medical', 'Is Voicematics a medical device?', [
      'No. It is an assistive communication tool. It has not been cleared by the FDA or any other medical regulator, and it does not diagnose, treat or monitor any condition. Measurements are indicators for your own awareness and can support, not replace, professional care.',
    ], { keywords: ['medical device', 'fda', 'diagnosis', 'treatment', 'clinical'], see: ['cg-emergency'], link: { label: 'Terms of Service', href: '/terms' } }),
    qa('about-ai', 'Does Voicematics use AI?', [
      'In two places only. Whisper turns your audio into words on your own computer. Gemini writes the optional second answer in ClearVoice, and is not allowed to add words you did not say.',
      'Everything else, including voice measurements, feedback, gestures, the grammar rules and this help guide, is deterministic code and fixed data.',
    ], { keywords: ['ai', 'artificial intelligence', 'machine learning', 'model', 'chatbot'], see: ['gem-rules', 'about-help-guide'] }),
    qa('about-help-guide', 'Is this help guide an AI chatbot?', [
      'No. It is a fixed set of questions and answers written by the Voicematics team, searched on your device. Nothing you type here is sent anywhere, and no model reads it.',
    ], { keywords: ['chatbot', 'assistant', 'is this ai', 'help bot'], see: ['about-ai'], link: { label: 'Browse every answer', href: '/help' } }),
    qa('about-mac', 'Will there be a Mac or Linux version?', [
      'The desktop app is built with cross-platform tools, but only the Windows installer is released today. The website, caregiver console and phone alert button already work on any device.',
    ], { keywords: ['mac', 'macos', 'linux', 'roadmap', 'ios', 'android'], see: ['setup-requirements'] }),
    qa('about-contact', 'How do I contact the Voicematics team?', [
      'Open an issue on the Voicematics GitHub repository (github.com/Dx-Alz-xD/Voicematics). Describe what you were doing and what happened; never post your password or licence key there.',
    ], { keywords: ['contact', 'support', 'email', 'help desk', 'feedback'], see: ['a11y-report'] }),
    qa('about-open-source', 'Where is the app built?', [
      'Every release of the desktop app is built by a public GitHub workflow and published on the GitHub releases page, where you can see each version.',
    ], { keywords: ['github', 'source', 'open source', 'releases', 'build'], see: ['setup-smartscreen'] }),
  ],
};
