import { qa, type HelpTopic } from '@/lib/help/types';

export const setup: HelpTopic = {
  id: 'setup',
  title: 'Getting started',
  summary: 'Installing the app, signing in and the first few minutes.',
  nodes: [
    qa('setup-what', 'What is Voicematics, in one minute?', [
      'An assistive speech platform for people who stutter or speak differently. The desktop app hears you word for word, types what you said (or a tidied sentence) into any app, coaches fluency with auditory feedback, turns short sounds into actions, and shows your voice as clear on-screen cues.',
      'Around it: this website for your account and profile, a caregiver console where people you approve can follow along, and an alert button for your phone.',
      'Your audio is analysed on your computer and never uploaded.',
    ], { keywords: ['overview', 'introduction', 'what does it do', 'explain'], see: ['setup-requirements', 'setup-install', 'modes-overview'], link: { label: 'Read the About page', href: '/about' } }),
    qa('setup-requirements', 'Which computers does it run on?', [
      'Windows 10 or 11, 64-bit. There is no macOS or Linux installer yet. The website, the caregiver console and the phone alert button work in any modern browser on any device.',
      'You need a microphone (a headset gives the cleanest results), an internet connection for signing in and for the one-time download of the speech recognizer, and about 300 MB of free disk space for the largest recognizer.',
      'A graphics card is not required, but with one a sentence is transcribed in well under a second instead of a few seconds.',
    ], { keywords: ['windows', 'mac', 'macos', 'linux', 'system requirements', 'specs', 'gpu', 'ram'], see: ['setup-install', 'acc-speed'] }),
    qa('setup-install', 'How do I install it?', [
      'Download Voicematics-Setup.exe from this website and run it. It installs for your Windows user, adds a Start menu shortcut and opens the app when it finishes.',
      'On first launch, sign in with your Voicematics account. The app remembers the computer, so you will not be asked again unless you sign out.',
    ], { keywords: ['download', 'installer', 'setup', 'exe'], see: ['setup-smartscreen', 'setup-signin'], link: { label: 'Download for Windows', href: 'https://github.com/Dx-Alz-xD/Voicematics/releases/latest/download/Voicematics-Setup.exe' } }),
    qa('setup-smartscreen', 'Windows says the installer is unrecognised', [
      'The installer is not code-signed yet, so Windows SmartScreen shows "Windows protected your PC" the first time. Click "More info", then "Run anyway".',
      'Every release is built by a public GitHub workflow from the source in the repository and listed on the releases page.',
    ], { keywords: ['smartscreen', 'protected your pc', 'unknown publisher', 'warning', 'antivirus', 'blocked'], see: ['trouble-antivirus'] }),
    qa('setup-signin', 'How do I sign in on the desktop app?', [
      'Create your account on this website first; it asks a few quick questions and then creates the account. In the app, sign in with the same email and password.',
      'You can also create an account in the app itself; you get a username made from your email, and the website offers the questions the first time you sign in there.',
      'If the app says it could not reach its server, the server is waking up. It sleeps when nobody has used it for a while and takes up to a minute to come back. The app waits and retries by itself.',
    ], { keywords: ['log in', 'login', 'sign in', 'desktop', 'app', 'account'], see: ['acct-create', 'trouble-server'] }),
    qa('setup-first-run', 'What should I do first after installing?', [
      '1. Open Settings (the gear) and pick your microphone under Audio. Use the test to check the bars move when you talk.',
      '2. Open ClearVoice in the sidebar and press "Listen to my voice". The first time, the speech recognizer downloads once.',
      '3. Say a sentence and watch it appear word for word, then as a tidied sentence underneath.',
      '4. When that works, try Direct paste: turn it on, click into a text box in another app and speak.',
    ], { keywords: ['first time', 'start', 'begin', 'tutorial', 'walkthrough', 'onboarding'], see: ['cv-listen', 'cv-paste', 'setup-microphone'] }),
    qa('setup-microphone', 'How do I choose my microphone?', [
      'In the desktop app open Settings, then Audio. Pick the input device, press the test button and speak normally: the level bars should move. Nothing is recorded during the test.',
      'If the list only shows "System default", Windows has not given the app permission to list devices yet; allow microphone access when asked, or choose the device in Windows sound settings.',
    ], { keywords: ['mic', 'microphone', 'input', 'audio device', 'headset', 'select'], see: ['trouble-no-mic', 'setup-headset'] }),
    qa('setup-headset', 'Do I need a headset?', [
      'Not for ClearVoice, Gesture Trainer or the Sensory HUD, though a microphone close to your mouth is always more accurate.',
      'For the Fluency Coach, yes: the delayed voice has to reach your ears through headphones, otherwise it comes out of the speakers and back into the microphone as an echo. Wired headphones add the least delay.',
    ], { keywords: ['headphones', 'headset', 'earbuds', 'bluetooth', 'speaker'], see: ['fl-echo', 'acc-tips'] }),
    qa('setup-offline', 'Does it work offline?', [
      'Partly. Voice analysis, the Fluency Coach, gestures and speech recognition (once downloaded) run on your computer. Signing in, the grammar-tidied sentence, the Gemini answer, saving to your account and the caregiver link need the internet.',
      'If the connection drops, the app keeps your last confirmed plan for up to seven days.',
    ], { keywords: ['offline', 'no internet', 'without internet', 'airplane'], see: ['trouble-server'] }),
    qa('setup-languages', 'Which languages does it understand?', [
      'English. The speech recognizer, the grammar rules and the second answer are all built for English today. Other languages are not supported yet.',
    ], { keywords: ['language', 'spanish', 'hindi', 'french', 'german', 'english only', 'accent'] }),
    qa('setup-updates', 'How do I update the app?', [
      'Download the latest installer from this website and run it over the existing installation. Your account, settings and transcript are kept.',
      'The version number is at the bottom of the sidebar in the app.',
    ], { keywords: ['update', 'upgrade app', 'new version', 'version'] }),
    qa('setup-uninstall', 'How do I uninstall it?', [
      'In Windows, open Settings, Apps, find Voicematics and choose Uninstall. Your account and anything saved to it stay on the server; delete the account from your profile on this website if you want those gone too.',
      'To remove what the app stored on the computer first, use the privacy section in the app to erase this computer’s data before uninstalling.',
    ], { keywords: ['uninstall', 'remove', 'delete app'], see: ['acct-delete'] }),
    qa('setup-multiple-computers', 'Can I use it on more than one computer?', [
      'You can sign in on as many computers as you like; gestures, presets and targets saved to your account follow you.',
      'A paid licence is active on one computer at a time. Move it from the Account view in the app on the computer that has it, then sign in on the new one.',
    ], { keywords: ['two computers', 'laptop and desktop', 'multiple devices', 'transfer'], see: ['plan-license-move'] }),
    qa('setup-low-end', 'Will it run on an older laptop?', [
      'Yes, with the smaller recognizer. Choose "Fastest" next to the Listen button: it is about 40 MB and decodes quickly on a processor alone. Voice analysis itself is light.',
      'Keep the laptop plugged in; power-saving modes slow the recognizer down.',
    ], { keywords: ['slow computer', 'old laptop', 'weak', 'cpu only', 'performance'], see: ['acc-speed', 'cv-models'] }),
  ],
};
