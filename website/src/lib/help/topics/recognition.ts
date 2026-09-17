import { qa, type HelpTopic } from '@/lib/help/types';

export const recognition: HelpTopic = {
  id: 'accuracy',
  title: 'Recognition accuracy',
  summary: 'Getting the speech recognizer to hear you exactly, and how fast it is.',
  nodes: [
    qa('acc-tips', 'How do I get the most accurate transcription?', [
      'Choose "Most accurate" next to the Listen button; it is the largest recognizer and the best with unusual speech.',
      'Use a headset or a microphone close to your mouth in a quiet room, and check in Settings that the right microphone is selected.',
      'Pause briefly between sentences so each is transcribed on its own, and keep your volume up to the end of a sentence: very quiet endings can be cut.',
    ], { keywords: ['accuracy', 'accurate', 'better recognition', 'mishears', 'wrong words', 'improve', 'inaccurate'], see: ['acc-raw', 'acc-noise', 'cv-models'] }),
    qa('acc-raw', 'It smooths out my stutters. I want them kept', [
      'The recognizer is told to write speech exactly as it comes, so "I-I-I w-w-want" stays that way in "Heard, word for word". The panels below it show tidied versions on purpose.',
      'If a stutter still disappears, choose "Most accurate": the smaller sizes tend to normalise more. To send your exact words to other apps, set "What gets typed" to "Exactly what I said".',
    ], { keywords: ['stutter removed', 'keep stutters', 'verbatim', 'fillers removed', 'repeats removed', 'raw text'], see: ['cv-raw', 'cv-paste-choice'] }),
    qa('acc-fillers', 'Are "um" and "uh" kept?', [
      'Yes, in "Heard, word for word" and in what direct paste types when it is set to "Exactly what I said". The quick answer and the Gemini answer leave them out.',
    ], { keywords: ['um', 'uh', 'filler words', 'hesitation'], see: ['acc-raw'] }),
    qa('acc-blocks', 'What happens during a long block or silence?', [
      'A pause of about three-quarters of a second ends a stretch of speech and sends it to be transcribed. A block longer than that splits the sentence in two; both halves are kept in order.',
      'A short silent block inside a word stays in the same stretch.',
    ], { keywords: ['block', 'silence', 'pause splits', 'sentence split', 'cut off'], see: ['cv-listen'] }),
    qa('acc-noise', 'It picks up background noise or other voices', [
      'The recognizer transcribes what the microphone hears, so a television or someone nearby can end up in the transcript. Move closer to the microphone, use a headset, or lower the other sound.',
      'Very short noises (under about a third of a second) are ignored.',
    ], { keywords: ['noise', 'background', 'other people', 'tv', 'music', 'fan'], see: ['acc-tips'] }),
    qa('acc-names', 'It gets names and special words wrong', [
      'Names, brands and technical terms are the hardest for any recognizer. "Most accurate" helps most. Check the text before sending, or type those words in the text box.',
      'For a phrase you use often, a gesture in Gesture Trainer can type it exactly every time.',
    ], { keywords: ['names', 'jargon', 'technical words', 'spelling', 'proper nouns'], see: ['g-what'] }),
    qa('acc-speed', 'Transcription is slow', [
      'Transcription runs on your computer. With a graphics card a sentence takes well under a second; on a processor alone, Balanced takes a few seconds and Most accurate can take longer than the sentence itself.',
      'Choose a smaller size, close other programs using the graphics card, and keep a laptop plugged in: power saving slows it down.',
    ], { keywords: ['recognizer slow', 'recognition slow', 'slow', 'lag', 'delay', 'takes long', 'transcribing', 'performance'], see: ['acc-gpu', 'cv-models'] }),
    qa('acc-gpu', 'Does it use my graphics card?', [
      'Yes, when Windows and the graphics driver support WebGPU. The listening status says "Listening on the graphics card" when it does; otherwise it runs on the processor.',
      'Updating the graphics driver often makes WebGPU available.',
    ], { keywords: ['gpu', 'graphics card', 'webgpu', 'nvidia', 'amd', 'intel'], see: ['acc-speed'] }),
    qa('acc-download', 'How big is the download and where does it go?', [
      'Fastest is about 40 MB, Balanced about 80 MB and Most accurate about 250 MB. Each downloads once, from the model host, and is kept in the app’s cache on your computer.',
    ], { keywords: ['download size', 'disk space', 'cache', 'model files'], see: ['trouble-model-download'] }),
    qa('acc-learn', 'Does it learn my voice over time?', [
      'No. The recognizer is fixed and runs entirely on your computer; nothing about your voice is uploaded or kept for training.',
      'Gesture Trainer is the one thing that learns from you, and only the short sounds you record on purpose.',
    ], { keywords: ['learn', 'train', 'adapt', 'personalise', 'voice training'], see: ['priv-audio', 'g-what'] }),
    qa('acc-accent', 'Does it work with my accent?', [
      'The recognizer was trained on many English accents and usually copes well. If it struggles, "Most accurate" and a close microphone make the biggest difference.',
    ], { keywords: ['accent', 'dialect', 'pronunciation'], see: ['acc-tips'] }),
    qa('acc-motor-speech', 'Does it work with dysarthria or other motor speech differences?', [
      'It can help, especially with "Most accurate" and a close microphone, but slurred or very quiet speech is harder to transcribe. Gesture Trainer is often more reliable for common phrases: one sound, one exact phrase.',
    ], { keywords: ['dysarthria', 'slurred', 'motor speech', 'stroke', 'parkinsons'], see: ['g-what', 'acc-tips'] }),
  ],
};
