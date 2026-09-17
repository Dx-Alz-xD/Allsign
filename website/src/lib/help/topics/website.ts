import { qa, type HelpTopic } from '@/lib/help/types';

export const website: HelpTopic = {
  id: 'website',
  title: 'Using this website',
  summary: 'The demo, your profile, the caregiver pages and this help guide.',
  nodes: [
    qa('web-demo', 'What is the live demo on the home page?', [
      'A simulator of the desktop app in your browser: ClearVoice cleaning up stuttered speech, Gesture Trainer matching a sound, the Fluency Coach’s feedback and the HUD. It uses no microphone and sends nothing except the words you type to the grammar engine.',
    ], { keywords: ['demo', 'simulator', 'try it', 'live demo'], link: { label: 'Open the demo', href: '/#simulator' } }),
    qa('web-help-page', 'Can I read all the answers at once?', [
      'Yes. The help page lists every question by topic with a search box, and this guide opens from any page with the Help button.',
    ], { keywords: ['help page', 'faq', 'all questions', 'browse'], link: { label: 'Open the help page', href: '/help' } }),
    qa('web-search-tips', 'The search did not find my question', [
      'Try fewer words or the name of the feature ("direct paste", "caregiver", "gesture"). Search ignores small words and tolerates typos. You can also browse by topic from the start of the guide.',
    ], { keywords: ['search', 'not found', 'no results'], see: ['web-help-page'] }),
    qa('web-browsers', 'Which browsers does the website support?', [
      'Current versions of Chrome, Edge, Firefox and Safari, on computers and phones. The caregiver console needs WebRTC, which all of them support.',
    ], { keywords: ['browser', 'chrome', 'safari', 'firefox', 'edge', 'supported'], see: ['cg-connect'] }),
    qa('web-homescreen', 'How do I put the alert button on my phone’s home screen?', [
      'Open the alert button page on your phone. On iPhone, tap Share and "Add to Home Screen". On Android, open the browser menu and choose "Add to Home screen" or "Install". The page then opens like an app.',
    ], { keywords: ['home screen', 'install on phone', 'shortcut phone', 'pwa'], see: ['cg-phone'], link: { label: 'Open the alert button', href: '/alert' } }),
    qa('web-signed-out-caregiver', 'Why does the caregiver console ask me to sign in?', [
      'Because a room code alone is not enough to watch someone. Sign in (a free account is fine) so the speaker can see your username and approve it.',
    ], { keywords: ['caregiver sign in', 'console locked'], see: ['cg-how-approval'] }),
    qa('web-profile-link', 'Where is my profile?', [
      'Your name and avatar at the top right of every page. Signed out, it shows Sign in instead.',
    ], { keywords: ['profile link', 'account link', 'avatar'], see: ['acct-profile'], link: { label: 'Open your profile', href: '/account' } }),
    qa('web-waking', 'The website says it is waking the server', [
      'The free-tier server sleeps after a while without visitors. The first request wakes it within about a minute; the page keeps checking and continues by itself.',
    ], { keywords: ['waking', 'checking the server', 'server offline website'], see: ['trouble-server'] }),
    qa('web-about', 'Where can I read how everything fits together?', [
      'The About page explains the whole system: the desktop app, the modes, caregivers and approval, what stays on your computer, and where AI is and is not used.',
    ], { keywords: ['about', 'how it works', 'architecture', 'overview'], link: { label: 'Read the About page', href: '/about' } }),
    qa('web-legal', 'Where are the terms and the privacy policy?', [
      'Linked at the bottom of every page, and in the desktop app. They say the same thing in both places.',
    ], { keywords: ['terms', 'privacy policy', 'legal'], link: { label: 'Privacy Policy', href: '/privacy' } }),
  ],
};
