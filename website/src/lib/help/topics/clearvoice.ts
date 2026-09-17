import { qa, type HelpTopic } from '@/lib/help/types';

export const clearvoice: HelpTopic = {
  id: 'clearvoice',
  title: 'ClearVoice and direct paste',
  summary: 'Hearing you word for word, the tidied sentence, and typing into other apps.',
  nodes: [
    qa('cv-what', 'What does ClearVoice do?', [
      'It listens, writes down exactly what you said (stutters, repeats and fillers included), shows a tidied sentence built by grammar rules and, if you like, a second cleaned-up answer from Gemini. With direct paste on, it types into whatever app you are working in.',
    ], { keywords: ['clearvoice', 'clear voice', 'speech to text', 'dictation', 'transcription'], see: ['cv-how', 'cv-listen', 'cv-paste'] }),
    qa('cv-how', 'How does a sentence get from my voice to the screen?', [
      'First, a speech recognizer running on your computer writes down what you said exactly as it came out. Nothing is corrected at that stage, and the audio never leaves the computer.',
      'Second, those words go to the Voicematics grammar engine, a set of rules (not a model) that drops repeats and fillers and puts the words in order in a few milliseconds. That "quick answer" appears at once.',
      'Third, with "Second answer from Gemini" on, a language model cleans up the sentence using your last few sentences as context. It may only use words you said.',
    ], { keywords: ['pipeline', 'how it works', 'process', 'steps'], see: ['cv-raw', 'gem-what', 'cv-quick'] }),
    qa('cv-listen', 'How do I start listening?', [
      'Open ClearVoice from the sidebar and press "Listen to my voice". The first time, the app downloads the speech recognizer (see the sizes); after that it loads from the cache in a few seconds.',
      'Speak the way you speak. When you pause for about three-quarters of a second, that stretch is transcribed. Press "Stop listening" when you are done.',
      'Very long stretches are cut after about 26 seconds, so a pause now and then helps.',
    ], { keywords: ['listen', 'start', 'record', 'microphone on', 'begin'], see: ['cv-models', 'acc-tips'] }),
    qa('cv-models', 'Which recognizer size should I choose?', [
      'Three sizes, next to the Listen button: Fastest (about 40 MB), Balanced (about 80 MB, the default) and Most accurate (about 250 MB). Larger hears unusual speech better and takes longer per sentence.',
      'Each size downloads once and is kept in the app’s cache. Stop listening to switch.',
    ], { keywords: ['model size', 'tiny', 'base', 'small', 'accuracy setting', 'fastest', 'most accurate'], see: ['acc-speed', 'acc-tips'] }),
    qa('cv-raw', 'Where do I see exactly what I said?', [
      'The "Heard, word for word" panel keeps every stretch of speech exactly as the recognizer heard it, with the time, how long you spoke and how long it took to transcribe. Nothing in it is corrected.',
      'Copy puts it on the clipboard, Save writes a text file, Clear removes it. It is stored on your computer only, up to the last 500 entries.',
    ], { keywords: ['raw', 'transcript', 'verbatim', 'word for word', 'history', 'save transcript', 'export'], see: ['acc-raw'] }),
    qa('cv-quick', 'What is the quick answer?', [
      'The sentence the grammar engine builds from your words: repeats, part-words and fillers removed, word order fixed, capitalised and punctuated. It takes a few milliseconds and involves no AI.',
      'Below it you can see which words were treated as repeats or fillers (dashed) and the sentence’s syntax tree.',
    ], { keywords: ['quick answer', 'grammar', 'tidied', 'rules', 'nltk', 'cfg', 'syntax tree'], see: ['cv-quick-wrong', 'gem-what'] }),
    qa('cv-quick-wrong', 'The quick answer changed what I meant', [
      'The grammar rules only know common sentence patterns, so an unusual sentence can come out oddly worded. Your exact words are always in "Heard, word for word".',
      'Turn on the Gemini answer for a context-aware rebuild, or set direct paste to type "Exactly what I said".',
    ], { keywords: ['wrong sentence', 'grammar wrong', 'changed meaning', 'bad output'], see: ['cv-paste-choice', 'gem-what'] }),
    qa('cv-paste', 'How do I type into other apps?', [
      'Turn on Direct paste in ClearVoice; it starts listening by itself. Click into the field you want to type in (a chat, a document, an email) and speak. What you say is typed there, even while Voicematics is minimised.',
      'Turn it off before saying something you do not want typed.',
    ], { keywords: ['direct paste', 'type into', 'other apps', 'minimised', 'minimized', 'dictate into word', 'slack', 'discord'], see: ['cv-paste-choice', 'trouble-paste'] }),
    qa('cv-paste-choice', 'What gets typed: my exact words or the tidy sentence?', [
      'You choose under "What gets typed": Exactly what I said (the default: word for word, stutters included, typed the moment it is recognised), Quick answer (the grammar rules’ sentence, milliseconds later) or Gemini answer (a few seconds later, in the order you spoke; the quick answer if Gemini is off or fails).',
    ], { keywords: ['what gets typed', 'exact words', 'verbatim paste', 'paste option', 'raw paste'], see: ['cv-paste'] }),
    qa('cv-paste-again', 'Can I type the last sentence again?', [
      'Yes. "Type the last one now" types the most recent entry of whichever choice is selected under "What gets typed", into the app that has focus.',
    ], { keywords: ['retype', 'type again', 'repeat last'], see: ['cv-paste-choice'] }),
    qa('cv-paste-minimised', 'Does direct paste work while the app is minimised?', [
      'Yes. Listening, transcription and typing keep running in the background. Click into the target app first so it has keyboard focus.',
    ], { keywords: ['background', 'minimised', 'minimized', 'hidden window'], see: ['trouble-paste'] }),
    qa('cv-textbox', 'Can I type the words instead of speaking?', [
      'Yes. The "Words as they were said" box takes typed or pasted text, fillers and repeats included. Press Enter or "Rebuild sentence" to get the quick and Gemini answers, and direct paste types it like speech.',
    ], { keywords: ['type words', 'text box', 'manual input', 'paste text'], see: ['cv-quick'] }),
    qa('cv-special-characters', 'Some characters come out wrong when typed', [
      'Direct paste types plain text of up to 200 characters key by key. Longer text, or text with characters outside plain ASCII (curly quotes, accents, emoji), goes through the clipboard for a moment instead, and whatever you had copied comes back afterwards.',
      'If an app blocks pasting, that longer or accented text may not arrive there. Keyboard layouts other than US English can also turn some symbols into different keys.',
    ], { keywords: ['symbols', 'punctuation missing', 'question mark', 'clipboard', 'accents', 'keyboard layout'], see: ['trouble-paste'] }),
    qa('cv-caregiver-sentences', 'Do caregivers see my sentences?', [
      'Only caregivers you approved, while they are connected. They see each sentence the grammar engine rebuilds, as it is ready.',
    ], { keywords: ['caregiver sees text', 'share sentences'], see: ['cg-what'] }),
  ],
};
