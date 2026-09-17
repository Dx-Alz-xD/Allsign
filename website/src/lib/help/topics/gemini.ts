import { qa, type HelpTopic } from '@/lib/help/types';

export const gemini: HelpTopic = {
  id: 'gemini',
  title: 'The Gemini second answer',
  summary: 'The optional AI-cleaned sentence, what it may and may not do, and switching it off.',
  nodes: [
    qa('gem-what', 'What is the Gemini answer?', [
      'A second version of your sentence, shown under the quick answer. Google Gemini (or Groq when Gemini is busy) cleans up your exact words using the last few sentences as context, for example "I want to go the store" becomes "I want to go to the store".',
      'It is labelled "Higher confidence · Gemini" and arrives a few seconds after the quick answer, which is never delayed.',
    ], { keywords: ['gemini', 'ai answer', 'second answer', 'context aware', 'higher confidence', 'groq'], see: ['gem-rules', 'gem-off'] }),
    qa('gem-rules', 'Can Gemini change what I said?', [
      'It may remove repeats and fillers, fix word order and add small grammar words such as "the", "to" or "is". It may not add any other word.',
      'The server checks every content word of its answer against the words you said. If it brings in a word of its own, it is asked again; if it still does, you see the grammar rules’ sentence instead of a guess.',
    ], { keywords: ['wrong words', 'wrong answer', 'gemini wrong', 'invent words', 'hallucinate', 'accurate', 'made up', 'changed meaning', 'grounding'], see: ['gem-same', 'gem-what'] }),
    qa('gem-off', 'How do I switch it off?', [
      'In ClearVoice, turn off "Second answer from Gemini" under the text box. Nothing you say goes to an AI model while it is off; the quick answer and your exact words still work.',
    ], { keywords: ['turn off gemini', 'disable ai', 'no ai', 'switch off'], see: ['priv-model'] }),
    qa('gem-same', 'Why is the Gemini answer the same as the quick answer?', [
      'Because the grammar rules already got it right, or because there was nothing to add. It then says "Same as the quick answer".',
      'It can also mean Gemini tried to add words you did not say and was overruled; the model name then reads "grammar-engine".',
    ], { keywords: ['same answer', 'identical', 'no difference', 'grammar-engine'], see: ['gem-rules'] }),
    qa('gem-slow', 'The Gemini answer takes a long time', [
      'It usually arrives in one to three seconds. When Gemini is overloaded the server moves to a lighter Gemini model and then to Groq, which can add a few seconds. The quick answer is always there first.',
    ], { keywords: ['slow gemini', 'waiting', 'reading in context', 'delay'], see: ['gem-models'] }),
    qa('gem-models', 'Which model wrote my answer?', [
      'The model name is shown under each answer, for example a Gemini Flash model, a lighter Flash-Lite model when the first is busy, or a Groq model as the last fallback. "grammar-engine" means the rules’ sentence was used.',
    ], { keywords: ['which model', 'flash', 'flash lite', 'groq', 'llama'], see: ['gem-slow'] }),
    qa('gem-failed', 'It says Gemini did not give a usable answer', [
      'The model answered in a way the server could not use, or every provider was busy. The quick answer is unaffected; the next sentence tries again.',
      '"Too many Gemini requests this minute" means the per-minute allowance ran out; wait a moment.',
    ], { keywords: ['gemini error', 'unusable', 'failed', 'too many requests', 'rate limit'], see: ['trouble-gemini'] }),
    qa('gem-paste', 'Can direct paste type the Gemini answer?', [
      'Yes. Set "What gets typed" to "Gemini answer". Answers are typed in the order you spoke, even if a later one comes back first, and the quick answer is typed if Gemini is off or fails.',
    ], { keywords: ['paste gemini', 'type ai answer'], see: ['cv-paste-choice'] }),
    qa('gem-context', 'What context does it use?', [
      'Up to six of your previous sentences from the same session, so it can resolve words like "it" or "there". Starting a new session clears that history.',
    ], { keywords: ['context', 'previous sentences', 'history', 'conversation'], see: ['priv-model'] }),
  ],
};
