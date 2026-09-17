import { qa, type HelpTopic } from '@/lib/help/types';

export const trouble: HelpTopic = {
  id: 'trouble',
  title: 'Something is not working',
  summary: 'Fixes for the problems people run into most.',
  nodes: [
    qa('trouble-server', 'The app or website cannot reach its server', [
      'The server sleeps when nobody has used it for a while, and the first request wakes it, which takes up to a minute. Both the app and this website show that the server is waking and retry by themselves; keep them open.',
      'If it still fails, check your internet connection and whether https://voicematics-api.onrender.com/health/live opens in a browser. Some work and school networks block it.',
    ], { keywords: ['server offline', 'could not reach', 'waking up', 'connection error', 'timeout', 'backend offline'], see: ['setup-offline'] }),
    qa('trouble-signin', 'I cannot sign in', [
      '"Invalid email or password" is the same message for an unknown email and a wrong password, so check both. Passwords are case-sensitive.',
      'After several failed attempts, sign-in pauses for a while ("Too many failed sign-in attempts"); wait and try again. If the server is waking up, give it a minute.',
    ], { keywords: ['cannot log in', 'invalid password', 'wrong password', 'too many attempts', 'locked out'], see: ['acct-password-forgot', 'trouble-server'] }),
    qa('trouble-still-free', 'I upgraded but the app still shows Free', [
      'The app re-checks your plan every few minutes and whenever it regains focus. To apply it straight away, sign out in the app and sign back in.',
      'Make sure the app is signed in to the same account you upgraded on this website.',
    ], { keywords: ['still free', 'upgrade not showing', 'pro not working', 'plan not updated'], see: ['plan-upgrade'] }),
    qa('trouble-license', 'The app says the licence is bound to another computer', [
      'A paid licence works on one computer at a time. On the computer that has it, open Account in the app and deactivate the licence; then sign in on this one.',
    ], { keywords: ['hardware mismatch', 'licence invalid', 'another computer', 'license error'], see: ['plan-license-move'] }),
    qa('trouble-no-mic', 'The app does not hear me', [
      'Check the microphone in Settings, Audio: pick the right device and run the test. Make sure the app is not muted (Ctrl+Shift+M or the microphone button).',
      'In Windows Settings, Privacy and security, Microphone: allow desktop apps to use the microphone.',
      'If listening stops with "Listening did not start", the message says why, for example that the chosen microphone is unavailable.',
    ], { keywords: ['microphone not working', 'no input', 'not hearing', 'mic permission', 'muted', 'listening did not start'], see: ['setup-microphone'] }),
    qa('trouble-model-download', 'The speech recognizer download is stuck', [
      'It is a one-time download of 40 to 250 MB, so it can take a while on a slow connection; the percentage shows progress. If it stalls, stop listening and start again: finished files are kept.',
      'Firewalls that block the model host prevent the download; try another network once, after which it loads from the cache.',
    ], { keywords: ['download stuck', 'model loading', 'preparing the speech model', 'progress stuck'], see: ['acc-download'] }),
    qa('trouble-recognizer-error', 'The recognizer shows an error', [
      'Stop listening, pick a smaller size, and start again. If the graphics card driver is the problem, the recognizer falls back to the processor on the next start.',
      '"Still loading the speech model; that sentence was not transcribed" means you spoke before it finished loading; wait for "Listening".',
    ], { keywords: ['recognizer error', 'webgpu error', 'transcription failed', 'not transcribed'], see: ['acc-gpu'] }),
    qa('trouble-paste', 'Direct paste types nothing', [
      'Direct paste types where the text cursor is, so click into a text field of the other app first. Check that listening is on: the panel warns when direct paste is on but listening is off.',
      'Apps running as administrator, and some games, ignore typing from other programs. Run Voicematics as administrator too, or copy from "Heard, word for word".',
    ], { keywords: ['paste not working', 'nothing typed', 'direct paste broken', 'typing not working'], see: ['cv-paste', 'cv-special-characters'] }),
    qa('trouble-paste-wrong-window', 'It typed into the wrong window', [
      'Direct paste always types into whichever window has keyboard focus. Switch direct paste off (or mute with Ctrl+Shift+M) before changing windows, and click into the right field before speaking.',
    ], { keywords: ['wrong window', 'typed in wrong place', 'focus'], see: ['sc-mute'] }),
    qa('trouble-echo', 'I hear an echo or a howl in Fluency Coach', [
      'The delayed voice is coming out of the speakers and back into the microphone. Use headphones, wired if you can, and lower the output volume.',
    ], { keywords: ['echo', 'howl', 'feedback noise'], see: ['fl-echo'] }),
    qa('trouble-caregiver-connect', 'The caregiver cannot connect', [
      'Check that the speaker is connected as the speaker with the same room code, and that the caregiver is signed in and approved (the console says which it is waiting for).',
      'If both are in the room but the connection never completes, a strict firewall may be blocking the direct connection. A TURN relay can be set in the app under Settings, Network.',
    ], { keywords: ['caregiver not connecting', 'connecting forever', 'firewall', 'turn server', 'nat'], see: ['cg-waiting', 'cg-denied'] }),
    qa('trouble-caregiver-taken', 'The caregiver page says someone is already connected', [
      'One caregiver connection per room at a time. Close the other tab or device that has the room open; the place frees itself a few seconds after that connection drops.',
    ], { keywords: ['already connected', 'role taken', 'room busy', '4409'], see: ['cg-one-at-a-time'] }),
    qa('trouble-alerts-missing', 'Alerts from my phone are not arriving', [
      'The caregiver must be approved and have the console open; until then alerts are held for 10 minutes. The phone page shows Held, Sent or Delivered for each alert.',
      'Make sure the phone is signed in to the speaker’s account and uses the same room code as the desktop app.',
    ], { keywords: ['alerts not arriving', 'phone alert missing', 'no alert', 'not delivered'], see: ['cg-phone-status', 'cg-phone-other-account'] }),
    qa('trouble-gemini', 'The Gemini answer never appears', [
      'Check that "Second answer from Gemini" is on in ClearVoice. If it says Gemini is unavailable, the server has no AI provider configured; if it says too many requests, wait a minute.',
      'The quick answer and your exact words keep working regardless.',
    ], { keywords: ['gemini missing', 'no second answer', 'ai not working'], see: ['gem-failed'] }),
    qa('trouble-antivirus', 'My antivirus warns about the app', [
      'Direct paste and gesture shortcuts press keys in other apps, which some security tools flag as automation. The installer is also not code-signed yet. Allow Voicematics if you trust the download from this website.',
    ], { keywords: ['antivirus', 'defender', 'virus', 'malware warning', 'false positive'], see: ['setup-smartscreen'] }),
    qa('trouble-cpu', 'The app uses a lot of CPU or battery', [
      'Speech recognition is the heaviest part. Choose a smaller recognizer, stop listening when you do not need it, and keep a laptop plugged in. Voice analysis alone is light.',
    ], { keywords: ['cpu', 'battery', 'fan', 'hot', 'heavy'], see: ['acc-speed'] }),
    qa('trouble-404', 'A page on this website says it went silent', [
      'That is the 404 page: the address does not exist, usually because of an old link or a typo. Use the links on that page, or search the help from there.',
    ], { keywords: ['404', 'page not found', 'went silent', 'broken link'] }),
  ],
};
