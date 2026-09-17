import { qa, type HelpTopic } from '@/lib/help/types';

export const gestures: HelpTopic = {
  id: 'gestures',
  title: 'Gesture Trainer',
  summary: 'Short sounds that type a phrase, speak, alert a caregiver or press keys.',
  nodes: [
    qa('g-what', 'What is a gesture?', [
      'A short sound you can make reliably, such as a hum, a click or a rising note. Voicematics recognises it by its spectral fingerprint and turns it into an action: type a phrase, speak a phrase aloud, alert your caregiver, or press a key combination.',
      'It is for moments when words are hard but a sound is not.',
    ], { keywords: ['gesture', 'trigger', 'sound shortcut', 'hum', 'click', 'vocal bridge', 'vocal assist'], see: ['g-teach', 'g-actions'] }),
    qa('g-teach', 'How do I teach one?', [
      'Start the microphone, open Gesture Trainer, give the gesture a name and choose its action. Press "Record the sound", wait for the countdown, then make the sound for about half a second.',
      'Voicematics averages the sound into a fingerprint and starts listening for it straight away.',
    ], { keywords: ['teach', 'record gesture', 'new gesture', 'create trigger', 'enrol'], see: ['g-good-sounds', 'g-sensitivity'] }),
    qa('g-good-sounds', 'Which sounds work best?', [
      'Sounds that are easy for you to repeat the same way and unlike your normal speech: a low hum, a tongue click, a whistle, a sustained "sss". Two gestures should sound clearly different from each other.',
    ], { keywords: ['best sounds', 'which sound', 'reliable', 'hum', 'whistle'], see: ['g-similar'] }),
    qa('g-actions', 'What can a gesture do?', [
      'Type the phrase into whichever app has focus; speak the phrase through the speakers; send the phrase as an alert to your approved caregiver; or press a keyboard shortcut in the app you are using.',
    ], { keywords: ['actions', 'type phrase', 'speak phrase', 'alert', 'shortcut'], see: ['g-shortcut', 'cg-alerts'] }),
    qa('g-shortcut', 'How do I set a keyboard shortcut for a gesture?', [
      'Choose "Press a shortcut" as the action, click the shortcut box and press the keys themselves, for example hold Ctrl and Shift and press M. The box records the combination as you press it, like setting a key binding in a game.',
      'Escape cancels, Backspace clears. Use a letter, number or function key together with modifier keys.',
    ], { keywords: ['keybind', 'key binding', 'hotkey', 'record keys', 'alt tab', 'shortcut keys', 'press keys'], see: ['g-shortcut-fails'] }),
    qa('g-shortcut-fails', 'The shortcut does nothing in some apps', [
      'Apps running as administrator, and many games, ignore key presses from other programs. Run Voicematics as administrator too, or pick a different action.',
      'Some combinations are reserved by Windows (for example Ctrl+Alt+Delete) and cannot be pressed by any app.',
    ], { keywords: ['shortcut not working', 'games', 'administrator', 'ignored'], see: ['trouble-paste'] }),
    qa('g-sensitivity', 'It fires by itself, or not at all', [
      'Each gesture has a threshold slider (85% by default). Raise it if the gesture fires on its own from speech or noise; lower it if your sound is missed.',
      'If it is still unreliable, delete it and record the sound again a little longer and steadier.',
    ], { keywords: ['sensitivity', 'threshold', 'false trigger', 'fires randomly', 'not detected', 'missed'], see: ['g-good-sounds'] }),
    qa('g-similar', 'Two gestures get mixed up', [
      'Their fingerprints are too close. Re-record one with a clearly different sound (a hum versus a click, rather than two hums), or raise both thresholds.',
    ], { keywords: ['mixed up', 'wrong gesture', 'confused', 'similar sounds'], see: ['g-good-sounds', 'g-sensitivity'] }),
    qa('g-limit', 'How many gestures can I have?', [
      'One on Free, unlimited on Pro and Lifetime. If a plan ends, gestures beyond the Free limit are paused, not deleted, until you upgrade again.',
    ], { keywords: ['limit', 'how many', 'one gesture', 'paused'], see: ['plan-compare', 'plan-after-expiry'] }),
    qa('g-delete', 'How do I delete a gesture?', [
      'In Gesture Trainer, press the delete button next to it. It is removed from your account on every computer.',
    ], { keywords: ['delete gesture', 'remove trigger'], see: ['g-teach'] }),
    qa('g-sync', 'Do gestures follow me to another computer?', [
      'Yes. They are saved to your account and loaded wherever you sign in. Different microphones hear sounds slightly differently, so re-record one if it becomes unreliable on a new setup.',
    ], { keywords: ['sync', 'other computer', 'account gestures'], see: ['g-sensitivity'] }),
    qa('g-privacy', 'Is my gesture sound uploaded?', [
      'No audio is. A gesture is saved as 128 numbers describing the sound’s frequencies, which cannot be played back. Matching runs on your computer.',
    ], { keywords: ['privacy', 'fingerprint', 'uploaded sound'], see: ['priv-audio'] }),
  ],
};
