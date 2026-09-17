/**
 * The help guide's database: predefined questions, the options under each, and the answers. HelpGuide.tsx walks
 * it on the visitor's device; nothing is sent anywhere and no model is involved.
 *
 * Every entry is a node. A node with `answer` paragraphs is an answer; every node may offer `options` that lead
 * to further nodes. `keywords` only widen the search box's matches.
 */

export interface HelpOption {
  label: string;
  to: string;
}

export interface HelpNode {
  id: string;
  title: string;
  answer?: string[];
  options?: HelpOption[];
  link?: { label: string; href: string };
  keywords?: string[];
}

export const HELP_START = 'start';
export const INSTALLER_URL = 'https://github.com/Dx-Alz-xD/Voicematics/releases/latest/download/Voicematics-Setup.exe';

const NODES: HelpNode[] = [
  {
    id: 'start',
    title: 'What do you need help with?',
    options: [
      { label: 'Getting started', to: 'setup' },
      { label: 'ClearVoice: hearing and typing my speech', to: 'clearvoice' },
      { label: 'Recognition accuracy', to: 'accuracy' },
      { label: 'Caregiver link and alerts', to: 'caregiver' },
      { label: 'Gesture Trainer', to: 'gestures' },
      { label: 'Fluency Coach, Therapy, Sensory HUD, Studio', to: 'modes' },
      { label: 'Account, plans and billing', to: 'account' },
      { label: 'Privacy', to: 'privacy' },
      { label: 'Something is not working', to: 'trouble' },
    ],
  },

  // --- Getting started ---------------------------------------------------------------------------
  {
    id: 'setup',
    title: 'Getting started',
    options: [
      { label: 'Which computers does it run on?', to: 'setup-requirements' },
      { label: 'How do I install it?', to: 'setup-install' },
      { label: 'Windows says the installer is unrecognised', to: 'setup-smartscreen' },
      { label: 'How do I sign in on the desktop app?', to: 'setup-signin' },
    ],
  },
  {
    id: 'setup-requirements',
    title: 'Which computers does it run on?',
    answer: [
      'Windows 10 or 11, 64-bit. There is no macOS or Linux build yet; the caregiver page works in any browser on any device.',
      'You need a microphone (a headset gives the cleanest results), an internet connection for signing in and for the one-time recognizer download, and about 300 MB of free disk space.',
      'A graphics card is not required, but with one the recognizer decodes a sentence in well under a second instead of a few seconds.',
    ],
    keywords: ['mac', 'linux', 'requirements', 'gpu', 'graphics'],
    options: [{ label: 'How do I install it?', to: 'setup-install' }],
  },
  {
    id: 'setup-install',
    title: 'How do I install it?',
    answer: [
      'Download Voicematics-Setup.exe and run it. It installs for your Windows user, adds a Start menu shortcut and opens the app when it finishes.',
      'On first launch, sign in with the account you created on this website. The app remembers this computer, so you will not have to sign in again.',
    ],
    link: { label: 'Download Voicematics-Setup.exe', href: INSTALLER_URL },
    keywords: ['download', 'installer', 'exe'],
    options: [
      { label: 'Windows says the installer is unrecognised', to: 'setup-smartscreen' },
      { label: 'How do I sign in on the desktop app?', to: 'setup-signin' },
    ],
  },
  {
    id: 'setup-smartscreen',
    title: 'Windows says the installer is unrecognised',
    answer: [
      'The installer is not code-signed yet, so Windows SmartScreen shows "Windows protected your PC" the first time. Click "More info", then "Run anyway".',
      'The file is built by the public GitHub release workflow from the source in the repository, and every release is listed there.',
    ],
    keywords: ['smartscreen', 'protected', 'run anyway', 'virus', 'unsigned'],
    options: [{ label: 'How do I sign in on the desktop app?', to: 'setup-signin' }],
  },
  {
    id: 'setup-signin',
    title: 'How do I sign in on the desktop app?',
    answer: [
      'Create your account here on the website first (Sign in, then Create account). In the app, sign in with the same email and password; the app then remembers this computer.',
      'If the app says it could not reach its server, the server is probably waking up: it sleeps when nobody has used it for a while and takes up to a minute to come back. The app waits and retries by itself; keep it open.',
    ],
    keywords: ['login', 'password', 'sign in', 'account'],
    options: [{ label: 'The app cannot reach its server', to: 'trouble-server' }],
  },

  // --- ClearVoice --------------------------------------------------------------------------------
  {
    id: 'clearvoice',
    title: 'ClearVoice',
    options: [
      { label: 'How does it work?', to: 'cv-how' },
      { label: 'How do I start listening?', to: 'cv-listen' },
      { label: 'What is the word-for-word transcript?', to: 'cv-raw' },
      { label: 'Direct paste: typing into other apps', to: 'cv-paste' },
      { label: 'What is the second answer under the sentence?', to: 'cv-refine' },
      { label: 'Recognizer sizes and the download', to: 'cv-models' },
    ],
  },
  {
    id: 'cv-how',
    title: 'How does ClearVoice work?',
    answer: [
      'First, a speech recognizer running inside the app on your computer writes down what you said exactly as it came out: repeats, part-words and fillers included. Nothing is corrected at that stage.',
      'Second, those words go to the Voicematics grammar engine, a set of rules (not a model) that reorders and completes them into a sentence in a few milliseconds. That sentence is shown at once.',
      'Third, if you keep "Gemini answer" on, a language model rebuilds the sentence with the last few sentences as context. It may only use words you said.',
      'With direct paste on, the finished sentence is typed into whatever app you are working in.',
    ],
    keywords: ['pipeline', 'grammar', 'whisper', 'recognizer'],
    options: [
      { label: 'How do I start listening?', to: 'cv-listen' },
      { label: 'Direct paste: typing into other apps', to: 'cv-paste' },
    ],
  },
  {
    id: 'cv-listen',
    title: 'How do I start listening?',
    answer: [
      'Open ClearVoice from the sidebar and press Listen. The first time, the app downloads the recognizer (see the sizes); after that it loads from the cache in a few seconds.',
      'Speak the way you speak. When you pause for about three-quarters of a second, that stretch is decoded and appears in the panel. Press Stop when you are done.',
      'Very long stretches are split after about 26 seconds, so a pause now and then helps.',
    ],
    keywords: ['listen', 'microphone', 'start', 'stop'],
    options: [
      { label: 'Recognizer sizes and the download', to: 'cv-models' },
      { label: 'It mishears my words', to: 'acc-tips' },
    ],
  },
  {
    id: 'cv-raw',
    title: 'What is the word-for-word transcript?',
    answer: [
      'The "Heard, word for word" panel keeps every stretch of speech exactly as the recognizer heard it, stutters and all, with the time it was said. Nothing in it is corrected; the clean sentence is in the reconstruction panel.',
      'Copy puts it on the clipboard, Save writes a text file, Clear removes it. It is stored on your computer only.',
    ],
    keywords: ['raw', 'transcript', 'stutter', 'save', 'export'],
    options: [{ label: 'It cleans up stutters I want kept', to: 'acc-raw' }],
  },
  {
    id: 'cv-paste',
    title: 'Direct paste: typing into other apps',
    answer: [
      'Turn on Direct paste in ClearVoice, click into the field you want to type in (a chat, a document, a browser) and speak. Each finished sentence is typed there, even while Voicematics is minimised.',
      'It types the grammar engine’s sentence, the fast rule-based one; the Gemini answer is only typed when you press "Type this answer".',
      'Turn it off before saying something you do not want typed. Windows only.',
    ],
    keywords: ['direct paste', 'type', 'minimised', 'focus', 'nut'],
    options: [{ label: 'Direct paste types nothing', to: 'trouble-paste' }],
  },
  {
    id: 'cv-refine',
    title: 'What is the second answer under the sentence?',
    answer: [
      'The grammar engine’s sentence is shown first. When "Gemini answer" is on in Settings, the words and that sentence are sent to the Voicematics server, where a language model (Google Gemini, or Groq when Gemini is busy) rebuilds the sentence using the last few sentences as context.',
      'It is held to a strict rule: it may only use words you said, plus small grammar words such as "the" or "is". An answer that brings in words of its own is rejected by the server, and you see the grammar engine’s sentence instead. It never delays the first answer.',
    ],
    keywords: ['gemini', 'groq', 'ai', 'model', 'second answer', 'inaccurate'],
    options: [{ label: 'What does the language model see?', to: 'priv-model' }],
  },
  {
    id: 'cv-models',
    title: 'Recognizer sizes and the download',
    answer: [
      'Three sizes, chosen next to the Listen button: Fastest (about 40 MB), Balanced (about 80 MB, the default) and Most accurate (about 250 MB). Larger is more accurate and slower to decode.',
      'The download happens once per size and is kept in the app’s cache. Progress is shown under the button; you can switch sizes at any time.',
    ],
    keywords: ['model', 'size', 'download', 'tiny', 'base', 'small', 'cache'],
    options: [
      { label: 'The download is stuck', to: 'trouble-download' },
      { label: 'It is slow', to: 'acc-speed' },
    ],
  },

  // --- Accuracy ----------------------------------------------------------------------------------
  {
    id: 'accuracy',
    title: 'Recognition accuracy',
    options: [
      { label: 'It mishears my words', to: 'acc-tips' },
      { label: 'It cleans up stutters I want kept', to: 'acc-raw' },
      { label: 'It is slow', to: 'acc-speed' },
      { label: 'Does it learn my voice?', to: 'acc-learn' },
    ],
  },
  {
    id: 'acc-tips',
    title: 'It mishears my words',
    answer: [
      'Pick "Most accurate" next to the Listen button; it is the largest recognizer and the one to use when words come out unusually.',
      'Use a headset or a microphone close to your mouth, in a quiet room, and check in Settings that the right microphone is selected.',
      'Pause between sentences so each one is decoded on its own, and keep your volume up to the end of a sentence: very quiet endings can be cut off.',
    ],
    keywords: ['wrong words', 'accuracy', 'mishear', 'inaccurate'],
    options: [{ label: 'Recognizer sizes and the download', to: 'cv-models' }],
  },
  {
    id: 'acc-raw',
    title: 'It cleans up stutters I want kept',
    answer: [
      'The recognizer is told to write speech as it comes: "I-I-I w-w-want" stays that way in the word-for-word transcript. The reconstruction panel shows the grammar engine’s clean sentence, so look at "Heard, word for word" for the original.',
      'If the recognizer still smooths something out, choose the "Most accurate" size; the smaller ones normalise more.',
    ],
    keywords: ['stutter', 'disfluency', 'raw', 'verbatim', 'grammar correction'],
    options: [{ label: 'What is the word-for-word transcript?', to: 'cv-raw' }],
  },
  {
    id: 'acc-speed',
    title: 'It is slow',
    answer: [
      'Decoding runs on your computer. With a graphics card a sentence takes well under a second. On a CPU-only machine Balanced takes a few seconds and Most accurate can take longer than the sentence itself.',
      'Choose a smaller size, close other programs that use the graphics card, and keep the laptop plugged in: power saving slows it down.',
    ],
    keywords: ['slow', 'lag', 'latency', 'gpu', 'cpu'],
    options: [{ label: 'Recognizer sizes and the download', to: 'cv-models' }],
  },
  {
    id: 'acc-learn',
    title: 'Does it learn my voice?',
    answer: [
      'No. The recognizer is fixed and runs entirely on your computer; nothing about your voice is uploaded or kept for training.',
      'Gesture Trainer is the one thing that learns from you, and only the short sounds you record on purpose, as fingerprints on your computer and in your account.',
    ],
    keywords: ['learn', 'training', 'adapt', 'personalise'],
  },

  // --- Caregiver ---------------------------------------------------------------------------------
  {
    id: 'caregiver',
    title: 'Caregiver link and alerts',
    options: [
      { label: 'What does a caregiver see?', to: 'cg-what' },
      { label: 'How do I connect a caregiver?', to: 'cg-connect' },
      { label: 'Sending an alert from my phone', to: 'cg-phone' },
      { label: 'Does the caregiver need an account?', to: 'cg-account' },
    ],
  },
  {
    id: 'cg-what',
    title: 'What does a caregiver see?',
    answer: [
      'Live voice readings (pitch, strain and blocks), every sentence ClearVoice rebuilds as it is said, and alerts: vocal blocks, fatigue, the emergency button in the desktop app, and alerts sent from your phone.',
      'Alerts sound in the caregiver’s browser and can show a notification when the tab is hidden.',
    ],
    keywords: ['telemetry', 'dashboard', 'alerts', 'monitor'],
    options: [{ label: 'How do I connect a caregiver?', to: 'cg-connect' }],
  },
  {
    id: 'cg-connect',
    title: 'How do I connect a caregiver?',
    answer: [
      'In the desktop app, open Caregiver and start the link. Share the caregiver link shown there; the caregiver opens it in any browser, on a phone or a laptop, and is connected.',
      'Readings and text travel directly between the two devices over WebRTC; the Voicematics server only introduces them. The link needs a Pro or Lifetime plan on the speaker’s account.',
    ],
    keywords: ['connect', 'link', 'room', 'webrtc', 'share'],
    options: [
      { label: 'Sending an alert from my phone', to: 'cg-phone' },
      { label: 'The page says someone is already connected', to: 'trouble-caregiver' },
    ],
  },
  {
    id: 'cg-phone',
    title: 'Sending an alert from my phone',
    answer: [
      'The desktop app’s Caregiver view shows a second link, for your own phone. Open it there once and add it to the home screen.',
      'It shows two large buttons, Emergency and Need help, and a short message. Tapping one sends the alert straight to the connected caregiver’s dashboard, with sound, whether or not you are at the computer.',
      'The phone page works while the desktop app’s link is running and a caregiver is connected; it tells you when nobody is there yet.',
    ],
    keywords: ['phone', 'emergency', 'help', 'alert', 'button'],
    options: [{ label: 'What does a caregiver see?', to: 'cg-what' }],
  },
  {
    id: 'cg-account',
    title: 'Does the caregiver need an account?',
    answer: [
      'No. A caregiver only needs the link: nothing to install and nothing to sign up for. The person using the desktop app needs a Pro or Lifetime plan.',
    ],
    keywords: ['caregiver account', 'sign up', 'install'],
    options: [{ label: 'What is in Free and what is in Pro?', to: 'acct-plans' }],
  },

  // --- Gesture Trainer -----------------------------------------------------------------------------
  {
    id: 'gestures',
    title: 'Gesture Trainer',
    options: [
      { label: 'What is a gesture?', to: 'g-what' },
      { label: 'Teaching a gesture', to: 'g-teach' },
      { label: 'Using a keyboard shortcut as the action', to: 'g-shortcut' },
      { label: 'How many can I have?', to: 'g-limit' },
    ],
  },
  {
    id: 'g-what',
    title: 'What is a gesture?',
    answer: [
      'A short sound you can make reliably, such as a hum, a click or a rising note. Voicematics recognises it by its spectral fingerprint and turns it into an action: type a phrase, say a message aloud, or press a keyboard shortcut.',
      'It is for the moments when words are hard but a sound is not.',
    ],
    keywords: ['gesture', 'trigger', 'hum', 'click', 'sound', 'vocal bridge'],
    options: [{ label: 'Teaching a gesture', to: 'g-teach' }],
  },
  {
    id: 'g-teach',
    title: 'Teaching a gesture',
    answer: [
      'Open Gesture Trainer, press "Teach a gesture", make the sound when asked, then name it and pick its action.',
      'Each gesture has a sensitivity slider: lower it if the gesture fires on its own, raise it if it is missed. Matching runs on your computer.',
    ],
    keywords: ['record', 'teach', 'sensitivity', 'threshold'],
    options: [{ label: 'Using a keyboard shortcut as the action', to: 'g-shortcut' }],
  },
  {
    id: 'g-shortcut',
    title: 'Using a keyboard shortcut as the action',
    answer: [
      'Choose the shortcut action, click the shortcut field and press the keys themselves, for example hold Alt and press Tab. The field records the combination as you press it.',
      'Escape cancels, Backspace clears the field.',
    ],
    keywords: ['shortcut', 'keybind', 'hotkey', 'alt', 'ctrl'],
  },
  {
    id: 'g-limit',
    title: 'How many gestures can I have?',
    answer: ['Free: one gesture. Pro and Lifetime: as many as you like.'],
    keywords: ['limit', 'unlimited'],
    options: [{ label: 'What is in Free and what is in Pro?', to: 'acct-plans' }],
  },

  // --- Other modes -------------------------------------------------------------------------------
  {
    id: 'modes',
    title: 'Fluency Coach, Therapy, Sensory HUD and Studio',
    options: [
      { label: 'Fluency Coach', to: 'mode-fluency' },
      { label: 'Therapy', to: 'mode-therapy' },
      { label: 'Sensory HUD', to: 'mode-sensory' },
      { label: 'Studio', to: 'mode-studio' },
    ],
  },
  {
    id: 'mode-fluency',
    title: 'Fluency Coach',
    answer: [
      'Plays your own voice back through headphones with a short delay (30 to 150 ms) or shifted in pitch. Many people who stutter speak more smoothly while hearing it.',
      'Use headphones: through speakers the delayed voice goes back into the microphone. Adjust the delay live and save the settings that suit you as presets. Pro.',
    ],
    keywords: ['daf', 'fsf', 'delayed auditory feedback', 'pitch shift', 'headphones'],
    options: [{ label: 'I hear an echo or a howl', to: 'trouble-echo' }],
  },
  {
    id: 'mode-therapy',
    title: 'Therapy',
    answer: [
      'Shows your vowels on a live vowel plane, from the formants of your voice, with targets you set for practice, so you can see whether an "ee" or an "oo" lands where it should. Pro.',
    ],
    keywords: ['vowel', 'formant', 'articulation', 'practice', 'slp'],
  },
  {
    id: 'mode-sensory',
    title: 'Sensory HUD',
    answer: [
      'A visual display of your volume, pitch and voice strain (jitter, shimmer and harmonic-to-noise ratio) with a warning before strain builds up. Free.',
    ],
    keywords: ['hud', 'strain', 'pitch', 'volume', 'jitter', 'shimmer'],
  },
  {
    id: 'mode-studio',
    title: 'Studio',
    answer: [
      'Studio puts the audio analysis, the text reconstruction and the caregiver readings side by side: a place to watch every measurement at once, or to show someone how the app works. Open on every plan.',
    ],
    keywords: ['studio', 'demo', 'overview'],
  },

  // --- Account -----------------------------------------------------------------------------------
  {
    id: 'account',
    title: 'Account, plans and billing',
    options: [
      { label: 'What is in Free and what is in Pro?', to: 'acct-plans' },
      { label: 'How do I upgrade?', to: 'acct-upgrade' },
      { label: 'The desktop licence key', to: 'acct-license' },
      { label: 'Deleting my account', to: 'acct-delete' },
    ],
  },
  {
    id: 'acct-plans',
    title: 'What is in Free and what is in Pro?',
    answer: [
      'Free: ClearVoice with on-device recognition, the grammar engine and direct paste, the Sensory HUD, Studio and one gesture.',
      'Pro ($14.99 a month or $129 a year): Fluency Coach, Therapy, unlimited gestures, the caregiver link with phone alerts, and session analytics.',
      'Lifetime ($299 once): everything in Pro, for good.',
    ],
    keywords: ['price', 'plan', 'free', 'pro', 'lifetime', 'cost'],
    options: [{ label: 'How do I upgrade?', to: 'acct-upgrade' }],
  },
  {
    id: 'acct-upgrade',
    title: 'How do I upgrade?',
    answer: [
      'Sign in here on the website, pick a plan under Pricing and complete the checkout. The desktop app picks the new plan up the next time it checks in; signing out and in again hurries it along.',
    ],
    keywords: ['upgrade', 'subscribe', 'checkout', 'payment', 'card'],
    options: [{ label: 'The desktop licence key', to: 'acct-license' }],
  },
  {
    id: 'acct-license',
    title: 'The desktop licence key',
    answer: [
      'Pro and Lifetime accounts get a licence key, shown on your dashboard here. The desktop app binds it to one computer when you sign in.',
      'To move to another computer, deactivate the licence in the app’s Account view first, then sign in on the new one.',
    ],
    keywords: ['licence', 'license', 'key', 'activate', 'deactivate', 'machine'],
  },
  {
    id: 'acct-delete',
    title: 'Deleting my account',
    answer: [
      'In the desktop app’s Account view, "Delete account" removes the account, its plan and everything saved on the server once you confirm your password.',
      'What is stored on your computer, such as the word-for-word transcript and your settings, stays until you delete it.',
    ],
    keywords: ['delete', 'remove', 'close account', 'cancel'],
  },

  // --- Privacy -----------------------------------------------------------------------------------
  {
    id: 'privacy',
    title: 'Privacy',
    options: [
      { label: 'Is my audio uploaded?', to: 'priv-audio' },
      { label: 'What does the server store?', to: 'priv-server' },
      { label: 'What does the language model see?', to: 'priv-model' },
    ],
  },
  {
    id: 'priv-audio',
    title: 'Is my audio uploaded?',
    answer: [
      'No. Recording, speech recognition, the feedback and HUD processing and gesture matching all run on your computer. Audio never leaves it.',
      'The caregiver link carries readings and text, not sound, and goes from your computer to the caregiver’s device directly.',
    ],
    keywords: ['audio', 'upload', 'cloud', 'record', 'privacy'],
  },
  {
    id: 'priv-server',
    title: 'What does the server store?',
    answer: [
      'Your account (email and a password hash), your plan and licence, and the things you choose to save: gestures, presets, therapy targets and the statistics of saved sessions.',
      'The grammar engine receives the words of each sentence to rebuild them and does not keep them.',
    ],
    keywords: ['server', 'store', 'data', 'database'],
  },
  {
    id: 'priv-model',
    title: 'What does the language model see?',
    answer: [
      'Only when "Gemini answer" is on: the words of the sentence, the grammar engine’s draft and up to six earlier sentences for context go to Google Gemini (or Groq as a backup) through the Voicematics server.',
      'Turn it off in Settings and nothing reaches a language model. Audio never does, either way.',
    ],
    keywords: ['gemini', 'groq', 'model', 'ai', 'context'],
    options: [{ label: 'What is the second answer under the sentence?', to: 'cv-refine' }],
  },

  // --- Troubleshooting -----------------------------------------------------------------------------
  {
    id: 'trouble',
    title: 'Something is not working',
    options: [
      { label: 'The app cannot reach its server', to: 'trouble-server' },
      { label: 'No microphone, or the wrong one', to: 'trouble-mic' },
      { label: 'The recognizer download is stuck', to: 'trouble-download' },
      { label: 'Direct paste types nothing', to: 'trouble-paste' },
      { label: 'I hear an echo or a howl in Fluency Coach', to: 'trouble-echo' },
      { label: 'The caregiver page says someone is already connected', to: 'trouble-caregiver' },
    ],
  },
  {
    id: 'trouble-server',
    title: 'The app cannot reach its server',
    answer: [
      'The server sleeps when nobody has used it for a while, and the first request wakes it, which can take up to a minute. The app shows that it is waking the server and retries by itself; keep it open.',
      'If it still fails, check your internet connection and whether https://voicematics-api.onrender.com/health/live opens in a browser. Some work networks block it.',
    ],
    keywords: ['server', 'offline', 'could not reach', 'connection', 'timeout'],
  },
  {
    id: 'trouble-mic',
    title: 'No microphone, or the wrong one',
    answer: [
      'Settings in the app lists the microphones Windows sees; pick your headset there. Restart Voicematics after plugging a new one in.',
      'If the list is empty, Windows Settings > Privacy & security > Microphone must allow desktop apps to use the microphone.',
    ],
    keywords: ['microphone', 'mic', 'input', 'device', 'permission'],
  },
  {
    id: 'trouble-download',
    title: 'The recognizer download is stuck',
    answer: [
      'The recognizer comes from Hugging Face’s public download servers. If the bar stalls, check the connection, press Stop and then Listen again (the download resumes from the cache), or pick a smaller size.',
      'A firewall or network that blocks huggingface.co blocks the download.',
    ],
    keywords: ['download', 'stuck', 'model', 'huggingface', 'progress'],
    options: [{ label: 'Recognizer sizes and the download', to: 'cv-models' }],
  },
  {
    id: 'trouble-paste',
    title: 'Direct paste types nothing',
    answer: [
      'Direct paste types where the text cursor is, so click into a text field of the other app first.',
      'Apps running as administrator, and some games, ignore typing from other programs. Run Voicematics as administrator too, or copy the sentence from the reconstruction panel instead.',
    ],
    keywords: ['direct paste', 'typing', 'nothing happens', 'administrator', 'focus'],
    options: [{ label: 'Direct paste: typing into other apps', to: 'cv-paste' }],
  },
  {
    id: 'trouble-echo',
    title: 'I hear an echo or a howl in Fluency Coach',
    answer: [
      'The delayed voice is coming out of speakers and back into the microphone. Use headphones, wired if you can (Bluetooth adds its own delay), and lower the output volume.',
    ],
    keywords: ['echo', 'feedback loop', 'howl', 'speakers', 'headphones'],
    options: [{ label: 'Fluency Coach', to: 'mode-fluency' }],
  },
  {
    id: 'trouble-caregiver',
    title: 'The caregiver page says someone is already connected',
    answer: [
      'One caregiver at a time per link. Close the other tab or window that has the link open; the place frees itself a few seconds after that connection drops.',
      'On the speaker’s side, only one desktop app can hold the link; starting it on a second computer replaces the first.',
    ],
    keywords: ['already connected', 'caregiver', 'room', 'taken'],
    options: [{ label: 'How do I connect a caregiver?', to: 'cg-connect' }],
  },
];

export const HELP: ReadonlyMap<string, HelpNode> = new Map(NODES.map((node) => [node.id, node]));

/** Answer nodes whose title, text or keywords contain every word of the query, best matches first. */
export function searchHelp(query: string, limit = 6): HelpNode[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
  if (words.length === 0) return [];
  const scored: Array<{ node: HelpNode; score: number }> = [];
  for (const node of NODES) {
    if (!node.answer) continue;
    const title = node.title.toLowerCase();
    const body = `${node.answer.join(' ')} ${(node.keywords ?? []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (title.includes(word)) score += 3;
      else if (body.includes(word)) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (score > 0) scored.push({ node, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.node);
}
