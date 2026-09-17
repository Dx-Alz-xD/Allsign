import { qa, type HelpTopic } from '@/lib/help/types';

export const shortcuts: HelpTopic = {
  id: 'shortcuts',
  title: 'Shortcuts and accessibility',
  summary: 'Global shortcuts, and adapting the app to how you use it.',
  nodes: [
    qa('sc-list', 'What are the global shortcuts?', [
      'They work even when Voicematics is not the window in front: Ctrl+Shift+M mutes or unmutes the microphone, Ctrl+Shift+A raises the emergency alert, and Ctrl+Shift+P switches Studio on and off.',
    ], { keywords: ['shortcuts', 'hotkeys', 'keyboard shortcuts', 'ctrl shift', 'global'], see: ['sc-change'] }),
    qa('sc-change', 'How do I change a shortcut?', [
      'Open Settings, then Shortcuts. Press Change next to the action and press the new combination; Reset returns it to the default. If another program already uses the combination, the app says so.',
    ], { keywords: ['change shortcut', 'rebind', 'custom hotkey', 'conflict'], see: ['sc-list'] }),
    qa('sc-mute', 'How do I pause listening quickly?', [
      'Press Ctrl+Shift+M from anywhere, or the microphone button in the top bar. When the app is in the background, a notification confirms the change.',
    ], { keywords: ['mute', 'pause', 'stop microphone', 'privacy quick'], see: ['sc-list'] }),
    qa('a11y-keyboard', 'Can I use it without a mouse?', [
      'Yes. Every control is reachable with the keyboard, focus is always visible, and a "Skip to content" link starts each page. Shortcut fields record keys when focused and activated with Enter.',
    ], { keywords: ['keyboard only', 'no mouse', 'tab navigation', 'focus'], see: ['a11y-screen-reader'] }),
    qa('a11y-screen-reader', 'Does it work with a screen reader?', [
      'Controls are labelled, live results (new sentences, alerts, approval changes) are announced, and charts have text equivalents. It is tested to aim for WCAG 2.1 AA.',
    ], { keywords: ['screen reader', 'nvda', 'jaws', 'narrator', 'blind', 'aria'], see: ['a11y-report'] }),
    qa('a11y-contrast', 'Can I make text bigger or higher contrast?', [
      'In the app open Settings, then Display: turn on high contrast (or follow Windows) and enlarge text up to 200%. The layout reflows rather than just zooming.',
    ], { keywords: ['bigger text', 'font size', 'high contrast', 'zoom', 'low vision'], see: ['a11y-motion'] }),
    qa('a11y-motion', 'Can I turn off animations?', [
      'Both the app and this website follow your system’s "reduce motion" setting and show everything without animation when it is on.',
    ], { keywords: ['animations', 'reduce motion', 'motion sickness', 'vestibular'], see: ['a11y-contrast'] }),
    qa('a11y-aac', 'Can I use it with an AAC device, switch access or eye tracking?', [
      'Yes. Nothing restricts other assistive technology, and gestures can turn a single reliable sound into a phrase or a key press for a switch-style workflow.',
    ], { keywords: ['aac', 'switch access', 'eye tracking', 'eye gaze', 'assistive technology'], see: ['g-what'] }),
    qa('a11y-pace', 'Does anything penalise slow speech or pauses?', [
      'No. Nothing times out on pauses, repetitions or blocks, and nothing scores you against a norm. Analytics are for you only.',
    ], { keywords: ['slow speech', 'pauses', 'timeout', 'pressure', 'judged'], see: ['an-what'] }),
    qa('a11y-report', 'How do I report an accessibility problem?', [
      'Tell the Voicematics team what you were trying to do and what got in the way. Accessibility barriers are treated as high-priority bugs, and any information can be provided in another format on request.',
    ], { keywords: ['report barrier', 'accessibility bug', 'feedback', 'alternative format'], see: ['about-contact'] }),
  ],
};
