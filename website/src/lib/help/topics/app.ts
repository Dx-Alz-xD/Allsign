import { qa, type HelpTopic } from '@/lib/help/types';

export const app: HelpTopic = {
  id: 'app',
  title: 'Desktop app basics',
  summary: 'Finding your way around the app: the sidebar, the microphone, settings and your data.',
  nodes: [
    qa('app-layout', 'How is the app laid out?', [
      'The sidebar lists the modes at the top (ClearVoice, Fluency Coach, Gesture Trainer, Therapy, Sensory HUD, Studio) and, below them, Analytics, Caregiver Link, Account, Settings and Accessibility. The top bar has your plan, Settings and the microphone mute button.',
      'On a narrow window the sidebar folds into the menu button at the top left.',
    ], { keywords: ['layout', 'sidebar', 'navigation', 'menu', 'where is'], see: ['modes-overview', 'app-settings'] }),
    qa('app-microphone', 'What does "Start microphone" do?', [
      'It opens the microphone for analysis: the HUD readings, blocks, gestures and feedback start working. Nothing is recorded. "Listen to my voice" in ClearVoice starts the microphone by itself when needed.',
      'Stopping the microphone saves a session summary to your account if you are on Pro.',
    ], { keywords: ['start microphone', 'stop microphone', 'session bar', 'analysis'], see: ['cv-listen', 'an-what'] }),
    qa('app-status', 'What do the status panels on the home screen mean?', [
      'Direct paste: whether your words are being typed into other apps. Remote connection: whether a caregiver device is connected. Processing latency: how long each 10 ms frame of audio takes to analyse, which should stay under 15 ms.',
    ], { keywords: ['status', 'latency', 'remote connection', 'home screen'], see: ['cv-paste', 'cg-connect'] }),
    qa('app-settings', 'What is in Settings?', [
      'Audio (input and output devices, with a microphone test), Display (high contrast and text size), Network (the servers used to connect caregiver devices) and Shortcuts (the global keyboard shortcuts).',
    ], { keywords: ['settings', 'preferences', 'options', 'gear'], see: ['setup-microphone', 'a11y-contrast', 'sc-change', 'app-network'] }),
    qa('app-network', 'What are the network settings for?', [
      'They control how two devices find each other for the caregiver link. The default STUN server works for most home networks. On strict work or school networks, add a TURN relay (address, username and password) so the connection can go through it.',
    ], { keywords: ['network settings', 'stun', 'turn', 'relay', 'firewall'], see: ['trouble-caregiver-connect'] }),
    qa('app-output', 'How do I choose where sound comes out?', [
      'In Settings, Audio, pick the output device for feedback and spoken phrases. If Windows does not let apps choose, the system default device is used.',
    ], { keywords: ['output device', 'speakers', 'headphones', 'sound output'], see: ['fl-no-sound'] }),
    qa('app-account-view', 'What is in the Account view?', [
      'Your plan and what it includes, your licence key and the computer it is active on (with the option to move it), the computers signed in to your account, and the options to sign out or delete the account.',
    ], { keywords: ['account view', 'licence in app', 'deactivate', 'computers'], see: ['plan-license-move', 'acct-delete'] }),
    qa('app-erase-local', 'How do I erase what the app stored on this computer?', [
      'Open Privacy (at the bottom of the sidebar) and use the option to erase this computer’s data. Settings, the word-for-word transcript and saved preferences in the app are removed; your account is untouched.',
    ], { keywords: ['erase local data', 'clear data', 'reset app', 'factory reset'], see: ['priv-export', 'acct-delete'] }),
    qa('app-terms', 'Why does the app ask me to acknowledge the terms?', [
      'When the terms change in a way that matters, the app asks once so you can read what changed. Your answer is remembered on that computer.',
    ], { keywords: ['terms prompt', 'i understand', 'acknowledge'], link: { label: 'Read the Terms of Service', href: '/terms' } }),
    qa('app-version', 'Which version do I have?', [
      'The version number is shown at the bottom of the sidebar. Compare it with the latest release on this website’s download link.',
    ], { keywords: ['version', 'build number', 'about app'], see: ['setup-updates'] }),
    qa('app-notifications', 'Why did I get a Windows notification from Voicematics?', [
      'When Voicematics is in the background it confirms things you did from a shortcut (for example muting), and shows alerts from a connected caregiver or speaker. Windows notification settings control whether they appear.',
    ], { keywords: ['notification', 'popup', 'toast', 'windows notification'], see: ['sc-mute'] }),
    qa('app-offline-banner', 'The app says Voicematics is offline', [
      'It cannot reach the server right now, often because it is waking up. Things that run on the computer keep working; saving gestures and caregiver sharing wait until it reconnects.',
    ], { keywords: ['offline', 'backend offline', 'cannot save'], see: ['trouble-server'] }),
  ],
};
