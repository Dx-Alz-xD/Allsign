import { qa, type HelpTopic } from '@/lib/help/types';

export const privacy: HelpTopic = {
  id: 'privacy',
  title: 'Privacy and security',
  summary: 'What is uploaded, what the server keeps, and how your account is protected.',
  nodes: [
    qa('priv-audio', 'Is my audio uploaded?', [
      'No. Recording, speech recognition, feedback, the HUD and gesture matching all run on your computer. Audio never leaves it.',
    ], { keywords: ['audio uploaded', 'recording', 'cloud', 'listening', 'microphone privacy'], see: ['priv-server', 'priv-model'], link: { label: 'Read the Privacy Policy', href: '/privacy' } }),
    qa('priv-server', 'What does the server store?', [
      'Your account (email, a password hash, plan and licence), your profile (username, display name, interview answers), caregiver approvals, and what you choose to save: gestures, presets, therapy targets and session summaries.',
      'The grammar engine receives the words of each sentence to rebuild them and does not keep them.',
    ], { keywords: ['server stores', 'data stored', 'database', 'what do you keep'], see: ['priv-audio', 'priv-export'] }),
    qa('priv-model', 'What does the AI model see?', [
      'Only with "Second answer from Gemini" on: the words of a sentence, the grammar engine’s version and up to six earlier sentences go to Google Gemini (or Groq as a backup) through the Voicematics server. Never audio, never your account details.',
      'Turn it off in ClearVoice and nothing reaches a language model.',
    ], { keywords: ['ai sees', 'gemini privacy', 'groq', 'model data', 'sent to google'], see: ['gem-off'] }),
    qa('priv-answers', 'Who can see my interview answers?', [
      'Only you, on your profile. They are stored with your account to tune suggestions and are never shown to caregivers, speakers or anyone else.',
    ], { keywords: ['answers private', 'interview privacy', 'health information'], see: ['acct-change-answers'] }),
    qa('priv-username', 'Who can see my username?', [
      'People you connect with over the caregiver link: a speaker sees the username of a caregiver asking to watch, and a caregiver sees the speaker’s once approved. The site checks whether a username is taken while someone signs up, but it never lists accounts.',
    ], { keywords: ['username public', 'who sees username', 'profile public'], see: ['acct-username'] }),
    qa('priv-caregiver', 'What can the server see of the caregiver link?', [
      'The room code, which accounts are in the room, whether a caregiver is approved, and IP addresses needed to connect. Readings and sentences from the desktop app travel directly between the devices. Phone alerts pass through the server and are dropped once delivered or after 10 minutes.',
    ], { keywords: ['caregiver privacy', 'relay', 'server sees', 'webrtc privacy'], see: ['cg-direct'] }),
    qa('priv-security', 'Are my text fields safe from SQL injection?', [
      'Yes. Every database query uses bound parameters through the ORM, so text you type is always stored as text, never run as a command. Text fields are also checked for length and shape before they are saved: usernames allow only letters, digits, dots and underscores, and names reject control characters.',
      'The test suite sends classic injection strings through the profile, username, caregiver and sign-in fields to prove they are stored literally and change nothing else.',
    ], { keywords: ['sql injection', 'security', 'hack', 'safe', 'xss', 'injection'], see: ['priv-passwords'] }),
    qa('priv-passwords', 'How is my password protected?', [
      'It is hashed with Argon2id, a slow, memory-hard algorithm designed to resist cracking; the password itself is never stored. Repeated failed sign-ins are throttled.',
    ], { keywords: ['password security', 'hash', 'argon2', 'encryption', 'brute force'], see: ['priv-tokens'] }),
    qa('priv-tokens', 'How are sessions protected?', [
      'Sign-in tokens are signed and expire. They travel in request headers (or WebSocket subprotocols for the caregiver link), never in URLs, so they stay out of logs. The desktop app’s remembered sign-in only works on the computer it was issued to.',
    ], { keywords: ['token', 'session', 'jwt', 'stay signed in security'], see: ['acct-devices'] }),
    qa('priv-export', 'Can I get a copy of my data?', [
      'In the desktop app’s privacy section you can download a copy of everything the app keeps on the computer and, while signed in, in your account. Your profile page shows your account details and answers.',
    ], { keywords: ['export', 'download data', 'gdpr', 'copy of data', 'data portability'], see: ['acct-delete'] }),
    qa('priv-tracking', 'Do you track me or use cookies for ads?', [
      'No advertising IDs, no usage analytics, no crash reports and no selling of data. The website stores your sign-in token and a few preferences in your browser’s local storage.',
    ], { keywords: ['tracking', 'cookies', 'analytics', 'ads', 'sell data'], see: ['priv-server'] }),
    qa('priv-hipaa', 'Is Voicematics HIPAA compliant?', [
      'It is not offered as a HIPAA-covered service. A clinic using it with patients stays responsible for its own obligations, including whether to save sessions to accounts and whether to use the AI second answer.',
    ], { keywords: ['hipaa', 'compliance', 'clinic data', 'health records'], see: ['priv-model'] }),
    qa('priv-children', 'Can children use it?', [
      'Children can use it with a parent, carer or educator setting it up and supervising. The account should be created and managed by the adult responsible.',
    ], { keywords: ['children', 'kids', 'minors', 'school age'], see: ['acct-create'] }),
    qa('priv-local-transcript', 'Where is the word-for-word transcript kept?', [
      'Only on your computer, in the app’s storage. It is never uploaded. Clear it in ClearVoice, or erase the computer’s data from the privacy section.',
    ], { keywords: ['transcript stored', 'local data', 'history privacy'], see: ['cv-raw'] }),
  ],
};
