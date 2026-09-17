import { qa, type HelpTopic } from '@/lib/help/types';

export const account: HelpTopic = {
  id: 'account',
  title: 'Account and profile',
  summary: 'Creating an account, the questions, usernames and your profile page.',
  nodes: [
    qa('acct-create', 'How do I create an account?', [
      'Press Sign in at the top of this website and choose "Create an account". A few quick questions come first (who it is for, what should get easier, where you will use it), then you choose a username and enter your email and a password of at least 8 characters.',
      'The account starts on the Free plan with a licence key for the desktop app.',
    ], { keywords: ['sign up', 'signup', 'register', 'new account', 'join'], see: ['acct-why-questions', 'acct-username'] }),
    qa('acct-why-questions', 'Why do you ask questions before I sign up?', [
      'So the site and the app can point you to the right place first. Someone who wants to type by voice at work starts in ClearVoice; someone setting it up for a family member starts with the caregiver link.',
      'Only the first question is required. You can skip how you speak entirely, and every answer can be changed or updated later from your profile.',
      'The answers are stored with your account and are never shown to anyone else.',
    ], { keywords: ['interview', 'questions', 'survey', 'onboarding', 'why ask'], see: ['acct-change-answers', 'priv-answers'] }),
    qa('acct-change-answers', 'How do I change my answers?', [
      'Open your profile (your name at the top right), find "Your answers" and press Change. The same questions open with your current answers filled in; save to update the suggestions.',
    ], { keywords: ['edit answers', 'update interview', 'retake', 'change questions'], see: ['acct-profile'] }),
    qa('acct-profile', 'What is on my profile page?', [
      'Your name and username, your plan and licence key with the download link, the caregivers who can watch you (and requests waiting for your approval), the people you watch, your answers with suggestions, and the options to sign out or delete the account.',
    ], { keywords: ['profile', 'account page', 'dashboard', 'my account'], link: { label: 'Open your profile', href: '/account' }, see: ['acct-username', 'cg-approve-website'] }),
    qa('acct-username', 'What is my username for?', [
      'It is how people recognise you over the caregiver link. When someone asks to watch you, you see their username; when you ask to watch someone, they see yours and approve it.',
      'Usernames are 3 to 20 characters: lower-case letters, digits, dots and underscores, starting and ending with a letter or digit. A few names such as "admin" or "support" are reserved.',
    ], { keywords: ['username', 'handle', 'user name', '@'], see: ['acct-change-username', 'cg-how-approval'] }),
    qa('acct-change-username', 'Can I change my username?', [
      'Yes. On your profile press Edit next to "Name and username", type the new one and wait for "Available", then save.',
      'Caregivers you already approved keep their access; approvals are tied to accounts, not names.',
    ], { keywords: ['rename', 'change username', 'new username', 'username taken'], see: ['acct-username'] }),
    qa('acct-display-name', 'What is the display name?', [
      'An optional name shown next to your username, for example your first name. Up to 40 characters. It helps a caregiver or a speaker recognise you at a glance.',
    ], { keywords: ['display name', 'real name', 'nickname', 'name'], see: ['acct-change-username'] }),
    qa('acct-generated-username', 'I never chose a username. Where did mine come from?', [
      'Accounts created in the desktop app, or before usernames existed, get one made from the email address (for example "adalovelace" or "adalovelace4821" if that was taken). Change it any time from your profile.',
    ], { keywords: ['automatic username', 'random username', 'generated'], see: ['acct-change-username'] }),
    qa('acct-password-forgot', 'I forgot my password', [
      'Resetting a password by email is not available yet. If you are still signed in on the desktop app or this website, you can keep using the account there.',
      'Otherwise the account cannot be recovered today, so keep your password in a password manager.',
    ], { keywords: ['forgot password', 'reset password', 'lost password', 'cannot sign in'], see: ['trouble-signin'] }),
    qa('acct-email-change', 'Can I change my email address?', [
      'Not yet. The email address is the sign-in name of the account and cannot be edited today. Your username and display name can be changed at any time.',
    ], { keywords: ['change email', 'new email', 'update email'] }),
    qa('acct-signout', 'How do I sign out?', [
      'On the website: open your profile and press Sign out. This does not sign out the desktop app.',
      'In the desktop app: open Account in the sidebar and sign out there. The computer forgets its sign-in, and signing in again is needed next time.',
    ], { keywords: ['sign out', 'log out', 'logout'], see: ['acct-devices'] }),
    qa('acct-devices', 'How does the app stay signed in?', [
      'When you sign in, the desktop app registers the computer and gets a token that only works on that computer. It trades it for a fresh session whenever needed, so you do not retype your password every day.',
      'Signing out on that computer revokes the token. Up to ten computers are remembered per account; signing in on an eleventh forgets the least recently used one.',
    ], { keywords: ['remember me', 'stay signed in', 'devices', 'computers', 'session expired'], see: ['priv-tokens'] }),
    qa('acct-delete', 'How do I delete my account?', [
      'Open your profile, press "Delete account" and confirm with your password. The account is erased together with its licence, subscriptions, remembered computers, caregiver approvals, profile answers and everything saved from the app (gestures, presets, sessions, targets).',
      'It cannot be undone. The desktop app’s local data (settings, the word-for-word transcript) stays on each computer until you erase it there or uninstall.',
    ], { keywords: ['delete account', 'close account', 'remove account', 'erase', 'gdpr'], see: ['priv-export', 'setup-uninstall'] }),
    qa('acct-disabled', 'It says my account is disabled', [
      'A disabled account cannot sign in or use any feature. This only happens when an account is switched off on the server; sign-in answers the same way for a wrong password, so first make sure the password is right.',
    ], { keywords: ['disabled', 'blocked account', 'suspended'], see: ['trouble-signin'] }),
    qa('acct-two-accounts', 'Should a caregiver and a speaker share one account?', [
      'No. Each person should have their own account. The speaker approves the caregiver’s username, so both sides know who is who, and removing access later is a single click.',
      'A caregiver does not need a paid plan.',
    ], { keywords: ['share account', 'same account', 'family account'], see: ['cg-no-pro', 'cg-how-approval'] }),
  ],
};
