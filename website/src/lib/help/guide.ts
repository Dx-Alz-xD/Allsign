/**
 * The help guide's database: predefined questions, the options under each, and the answers, organised by topic
 * (lib/help/topics). HelpGuide.tsx and the /help page read it on the visitor's device; nothing is sent anywhere
 * and no model is involved. Search is plain text matching with synonyms, word stems and typo tolerance.
 */

import { about } from '@/lib/help/topics/about';
import { account } from '@/lib/help/topics/account';
import { app } from '@/lib/help/topics/app';
import { caregivers } from '@/lib/help/topics/caregivers';
import { clearvoice } from '@/lib/help/topics/clearvoice';
import { gemini } from '@/lib/help/topics/gemini';
import { gestures } from '@/lib/help/topics/gestures';
import { modes } from '@/lib/help/topics/modes';
import { plans } from '@/lib/help/topics/plans';
import { privacy } from '@/lib/help/topics/privacy';
import { recognition } from '@/lib/help/topics/recognition';
import { setup } from '@/lib/help/topics/setup';
import { shortcuts } from '@/lib/help/topics/shortcuts';
import { trouble } from '@/lib/help/topics/trouble';
import { website } from '@/lib/help/topics/website';
import type { HelpNode, HelpTopic } from '@/lib/help/types';

export type { HelpNode, HelpOption, HelpTopic } from '@/lib/help/types';

export const HELP_START = 'start';
export const INSTALLER_URL = 'https://github.com/Dx-Alz-xD/Voicematics/releases/latest/download/Voicematics-Setup.exe';

export const HELP_TOPICS: readonly HelpTopic[] = [setup, clearvoice, recognition, gemini, caregivers, gestures, modes, app, account, plans, privacy, shortcuts, website, trouble, about];

function assemble(): Map<string, HelpNode> {
  const map = new Map<string, HelpNode>();
  map.set(HELP_START, {
    id: HELP_START,
    title: 'What do you need help with?',
    options: HELP_TOPICS.map((topic) => ({ label: topic.title, to: topic.id })),
  });
  for (const topic of HELP_TOPICS) {
    map.set(topic.id, { id: topic.id, title: topic.title, topic: topic.id, options: topic.nodes.map((node) => ({ label: node.title, to: node.id })) });
    for (const node of topic.nodes) map.set(node.id, { ...node, topic: topic.id });
  }
  // Related answers are written as ids; show their titles, and drop any that do not exist.
  for (const node of map.values()) {
    if (!node.answer || !node.options) continue;
    node.options = node.options.filter((option) => map.has(option.to)).map((option) => ({ label: map.get(option.to)!.title, to: option.to }));
  }
  return map;
}

export const HELP: ReadonlyMap<string, HelpNode> = assemble();
export const HELP_ANSWER_COUNT = Array.from(HELP.values()).filter((node) => node.answer).length;

// ---------------------------------------------------------------------------------------------------------------
// Search

const STOPWORDS = new Set(
  'a an and are as at be but by can could do does did for from get got have how i if in into is it its me my of on or our should so that the their them then there these this to too was we were what when where which who why will with would you your am im dont doesnt cant wont please help much many give get need want know tell about way'.split(
    ' ',
  ),
);

// Words people type, mapped to the words the answers use.
const SYNONYMS: Record<string, string[]> = {
  mic: ['microphone'],
  login: ['sign', 'signin'],
  logon: ['sign', 'signin'],
  logout: ['sign', 'out'],
  signup: ['create', 'account'],
  register: ['create', 'account'],
  stutter: ['stuttering', 'stutters', 'disfluency'],
  stammer: ['stuttering', 'stutter'],
  stammering: ['stuttering'],
  hotkey: ['shortcut'],
  hotkeys: ['shortcuts'],
  keybind: ['shortcut', 'keys'],
  keybinds: ['shortcut', 'keys'],
  keybinding: ['shortcut', 'keys'],
  price: ['pricing', 'plans', 'cost'],
  cost: ['pricing', 'plans', 'price'],
  pay: ['checkout', 'plan', 'billing'],
  caretaker: ['caregiver'],
  carer: ['caregiver'],
  guardian: ['caregiver'],
  parent: ['caregiver'],
  family: ['caregiver'],
  monitor: ['caregiver', 'watch'],
  watch: ['caregiver'],
  ai: ['gemini', 'model'],
  chatgpt: ['gemini', 'model', 'ai'],
  llm: ['gemini', 'model'],
  paste: ['direct', 'typed'],
  dictate: ['direct', 'paste', 'listen'],
  dictation: ['clearvoice', 'transcription'],
  license: ['licence'],
  licence: ['license'],
  minimized: ['minimised'],
  minimised: ['minimized'],
  color: ['contrast'],
  colour: ['contrast'],
  font: ['text', 'bigger'],
  uninstall: ['remove'],
  erase: ['delete'],
  remove: ['delete'],
  broken: ['not', 'working'],
  bug: ['problem', 'report'],
  sos: ['emergency'],
  panic: ['emergency'],
  911: ['emergency', 'services'],
  mobile: ['phone'],
  cellphone: ['phone'],
  iphone: ['phone'],
  android: ['phone'],
  daf: ['fluency', 'delay'],
  delay: ['daf', 'delayed'],
  secure: ['security'],
  hacked: ['security', 'password'],
  gdpr: ['data', 'export', 'delete'],
  refund: ['refund', 'money'],
  cancel: ['cancel', 'renewal'],
  whisper: ['recognizer', 'recognition'],
  recogniser: ['recognizer'],
  transcript: ['word', 'heard'],
  typo: ['wrong', 'words'],
  slow: ['speed', 'slow'],
  lag: ['slow', 'delay'],
  laggy: ['slow'],
  username: ['username'],
  handle: ['username'],
  approve: ['approval', 'approve'],
  approval: ['approve'],
  allowance: ['approval', 'approve'],
  interview: ['questions', 'answers'],
  questionnaire: ['questions', 'answers'],
  survey: ['questions', 'answers'],
  studio: ['studio'],
  pitch: ['studio', 'pitch'],
  gesture: ['gesture', 'trigger'],
  trigger: ['gesture'],
  shortcut: ['shortcut', 'keys'],
};

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9@+ ]+/g, ' ');
}

function stem(word: string): string {
  for (const suffix of ['ations', 'ation', 'ings', 'ing', 'ies', 'ied', 'ers', 'ed', 'es', 'er', 'ly', 's']) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) return suffix === 'ies' || suffix === 'ied' ? `${word.slice(0, -3)}y` : word.slice(0, -suffix.length);
  }
  return word;
}

function tokens(text: string): string[] {
  return normalise(text).split(/\s+/).filter(Boolean);
}

function editDistanceWithin(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return false;
    previous = current;
  }
  return previous[b.length] <= limit;
}

interface Indexed {
  node: HelpNode;
  title: Set<string>;
  keywords: Set<string>;
  body: Set<string>;
  phrase: string;
}

function indexWords(text: string): Set<string> {
  const set = new Set<string>();
  for (const word of tokens(text)) {
    set.add(word);
    set.add(stem(word));
  }
  return set;
}

const INDEX: Indexed[] = Array.from(HELP.values())
  .filter((node) => node.answer)
  .map((node) => ({
    node,
    title: indexWords(node.title),
    keywords: indexWords((node.keywords ?? []).join(' ')),
    body: indexWords(node.answer!.join(' ')),
    phrase: normalise(`${node.title} ${(node.keywords ?? []).join(' ')}`),
  }));

/** How well one query word matches a set of indexed words: exact, prefix, then close spelling. */
function matchStrength(word: string, words: Set<string>): number {
  const stemmed = stem(word);
  if (words.has(word) || words.has(stemmed)) return 1;
  if (word.length >= 3) {
    for (const candidate of words) {
      if (candidate.startsWith(word) || (candidate.length >= 4 && word.startsWith(candidate))) return 0.7;
    }
  }
  if (word.length >= 4) {
    const limit = word.length >= 8 ? 2 : 1;
    for (const candidate of words) {
      if (candidate.length >= 3 && editDistanceWithin(word, candidate, limit)) return 0.5;
    }
  }
  return 0;
}

/** Answers that best match the query, best first. Every important word should match something. */
export function searchHelp(query: string, limit = 8): HelpNode[] {
  const phrase = normalise(query).trim();
  const words = tokens(query).filter((word) => !STOPWORDS.has(word) && word.length > 1);
  if (words.length === 0) return [];
  const needed = Math.max(1, Math.ceil(words.length * 0.6));
  const scored: Array<{ node: HelpNode; score: number }> = [];

  for (const entry of INDEX) {
    let score = 0;
    let matched = 0;
    for (const word of words) {
      const variants = [word, ...(SYNONYMS[word] ?? [])];
      let best = 0;
      for (const variant of variants) {
        const weight = variant === word ? 1 : 0.6;
        best = Math.max(
          best,
          matchStrength(variant, entry.title) * 6 * weight,
          matchStrength(variant, entry.keywords) * 4 * weight,
          matchStrength(variant, entry.body) * 1.5 * weight,
        );
      }
      if (best > 0) {
        matched += 1;
        score += best;
      }
    }
    if (matched < needed) continue;
    if (phrase.length > 3 && entry.phrase.includes(phrase)) score += 10;
    scored.push({ node: entry.node, score: score * (matched / words.length) });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.node);
}

export function topicOf(node: HelpNode): HelpTopic | undefined {
  return HELP_TOPICS.find((topic) => topic.id === node.topic);
}
