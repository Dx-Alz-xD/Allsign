import { qa, type HelpTopic } from '@/lib/help/types';

export const caregivers: HelpTopic = {
  id: 'caregiver',
  title: 'Caregivers, approval and alerts',
  summary: 'Letting a trusted person follow along, approving them, and alerts from your phone.',
  nodes: [
    qa('cg-what', 'What does a caregiver see?', [
      'Once you approve them: live voice readings (volume, speaking rate, pitch, blocks and strain), every sentence ClearVoice rebuilds as you say it, and alerts (vocal blocks, fatigue, gesture alerts, the emergency button in the app and alerts from your phone).',
      'Never audio. Alerts sound in the caregiver’s browser and can show a notification when the tab is hidden.',
    ], { keywords: ['caregiver', 'what they see', 'monitor', 'dashboard', 'telemetry'], see: ['cg-how-approval', 'cg-connect'] }),
    qa('cg-how-approval', 'How does approval work?', [
      'A room code alone shows nothing. The caregiver signs in on the caregiver console and enters your room code; you get a request with their username in the desktop app and on your profile. Until you approve, they see nothing at all.',
      'Approval is per account and lasts until you remove it, so they connect straight away next time. You can also approve someone by username before they ask.',
    ], { keywords: ['access', 'give access', 'let someone watch', 'approve', 'approval', 'allow', 'permission', 'user allowance', 'security', 'room code safe'], see: ['cg-approve-app', 'cg-approve-website', 'cg-remove'] }),
    qa('cg-connect', 'How do I connect a caregiver?', [
      '1. In the desktop app open Caregiver Link, keep "speaker" selected and press Connect. Share the room code or the caregiver link shown there.',
      '2. The caregiver opens the console on this website, signs in and enters the code (the link fills it in).',
      '3. Approve their username when the request appears. They connect at once.',
      'Sharing as the speaker needs Pro or Lifetime; the caregiver can use a free account.',
    ], { keywords: ['connect caregiver', 'share', 'room code', 'link', 'pair'], see: ['cg-how-approval', 'cg-no-pro'], link: { label: 'Open the caregiver console', href: '/caregiver' } }),
    qa('cg-approve-app', 'How do I approve a request in the desktop app?', [
      'While you are connected as the speaker, requests appear in Caregiver Link with the person’s username and display name. Press Approve to let them in or Deny to turn them away.',
      'The same list, with a field to approve someone by username, is on that screen too.',
    ], { keywords: ['approve in app', 'access request', 'deny', 'desktop approval'], see: ['cg-how-approval'] }),
    qa('cg-approve-website', 'How do I approve or remove caregivers on the website?', [
      'Open your profile. Under Caregivers you see requests waiting for approval (Approve or Deny), the people who can watch you (Remove), and a field to approve someone by username.',
    ], { keywords: ['profile caregivers', 'website approval', 'manage caregivers'], see: ['acct-profile'], link: { label: 'Open your profile', href: '/account' } }),
    qa('cg-remove', 'How do I stop someone watching me?', [
      'Remove them on your profile or in Caregiver Link. If they are connected, they are disconnected immediately, and they cannot reconnect unless you approve them again.',
      'Changing your room code alone does not revoke an approval; removing the person does.',
    ], { keywords: ['remove caregiver', 'revoke', 'stop watching', 'block', 'kick'], see: ['cg-how-approval'] }),
    qa('cg-denied', 'The console says the speaker has not approved me', [
      'The speaker denied the request, or removed your access. Ask them to approve your username; they can do it on their profile or in the app. Your username is shown at the top of the console.',
    ], { keywords: ['denied', 'not approved', 'removed access', 'forbidden', '4403'], see: ['cg-how-approval'] }),
    qa('cg-waiting', 'The console keeps waiting for approval', [
      '"Waiting for the speaker to open Caregiver Link" means nobody is sharing with that room code right now: check the code, and ask the speaker to connect as the speaker.',
      '"The speaker has been asked to approve your username" means the request is with them; it connects the moment they approve.',
    ], { keywords: ['waiting', 'pending', 'stuck', 'not connecting', 'waiting for speaker'], see: ['cg-connect', 'trouble-caregiver-connect'] }),
    qa('cg-no-pro', 'Does a caregiver need a paid plan?', [
      'No. A caregiver needs a free account, so the speaker can see who is asking and approve them. The speaker needs Pro or Lifetime to share.',
    ], { keywords: ['caregiver account', 'free caregiver', 'caregiver plan', 'do caregivers pay'], see: ['cg-connect'] }),
    qa('cg-signin-required', 'Why do caregivers have to sign in now?', [
      'So that nobody can watch someone just by guessing or overhearing a room code. Signing in gives each caregiver a username the speaker can recognise, approve and remove.',
    ], { keywords: ['why sign in', 'room code dangerous', 'security', 'privacy caregiver'], see: ['cg-how-approval'] }),
    qa('cg-phone', 'How do I send alerts from my phone?', [
      'In the desktop app, open Caregiver Link and connect as the speaker. It shows an "Alert button for your phone" link: open it on your phone, sign in with the same account and add the page to your home screen.',
      'The page has a large Emergency button, quick messages (Please come here, I need help, I am okay, Please call me, I need a break) and a box for your own message. One tap reaches your approved caregivers, whether or not the desktop app is open.',
    ], { keywords: ['phone', 'alert button', 'emergency button', 'mobile', 'sos'], see: ['cg-phone-status', 'cg-emergency'], link: { label: 'Open the alert button', href: '/alert' } }),
    qa('cg-phone-status', 'What do Sent, Held and Delivered mean on the phone page?', [
      'Sent: a caregiver was connected and the alert went to them. Delivered: their dashboard confirmed it is showing. Held ("No caregiver connected yet"): nobody was connected, so the server keeps the alert for up to 10 minutes and delivers it the moment an approved caregiver connects.',
      '"Not sent" explains why, for example that the connection dropped; send it again if it matters.',
    ], { keywords: ['delivered', 'held', 'sent', 'status', 'not sent', 'confirmation'], see: ['cg-phone'] }),
    qa('cg-phone-other-account', 'The phone page says the room belongs to another account', [
      'The phone must be signed in to the same account as the desktop app that is sharing in that room. Sign out on the phone and sign in with the speaker’s account.',
    ], { keywords: ['another account', 'wrong account', 'phone account'], see: ['cg-phone'] }),
    qa('cg-emergency', 'Does the emergency alert call emergency services?', [
      'No. It notifies your approved caregivers only. In an emergency, call your local emergency number, such as 911, 112 or 999.',
      'Alerts depend on networks and devices and can be delayed or fail, so do not rely on Voicematics as your only way to get help.',
    ], { keywords: ['911', 'emergency services', 'ambulance', 'police', 'call for help'], see: ['about-medical'] }),
    qa('cg-alerts', 'Which alerts are sent automatically?', [
      'A vocal block, and high vocal strain, are sent as they happen while the microphone is on. Gesture alerts are sent when you make that gesture. Emergency alerts come from the button in the app, its shortcut (Ctrl+Shift+A) or your phone.',
    ], { keywords: ['automatic alerts', 'block alert', 'fatigue alert', 'strain alert'], see: ['cg-what', 'g-actions'] }),
    qa('cg-notifications', 'How does a caregiver get notified when the tab is hidden?', [
      'On the console, press "Notify me when this tab is hidden" and allow notifications in the browser. Keep "Alert sound on" for a chime. On a phone, keep the console open in the browser.',
    ], { keywords: ['notifications', 'sound', 'chime', 'background tab'], see: ['cg-what'] }),
    qa('cg-desktop-caregiver', 'Can a caregiver watch from the desktop app instead?', [
      'Yes. In Caregiver Link choose "caregiver" and enter the speaker’s room code. The same approval applies.',
    ], { keywords: ['desktop caregiver', 'watch in app'], see: ['cg-how-approval'] }),
    qa('cg-one-at-a-time', 'Can more than one caregiver watch at once?', [
      'One caregiver connection per room at a time. Several people can be approved; whoever connects first uses the room, and anyone else sees that someone is already connected until they leave. A browser tab that reconnects takes its own place back.',
    ], { keywords: ['multiple caregivers', 'two caregivers', 'already connected', 'role taken'], see: ['trouble-caregiver-taken'] }),
    qa('cg-direct', 'Does my data go through the Voicematics server?', [
      'Readings, sentences and alerts from the desktop app travel directly between the two devices, encrypted, through a relay only if a direct path fails. The server introduces the devices and checks approval. Alerts from your phone are the exception: they pass through the server, which does not keep them after delivery.',
    ], { keywords: ['peer to peer', 'webrtc', 'server sees', 'encrypted'], see: ['priv-caregiver'] }),
  ],
};
