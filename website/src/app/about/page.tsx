import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Accessibility,
  AudioLines,
  AudioWaveform,
  Bell,
  Braces,
  CircleHelp,
  Cloud,
  Cpu,
  Ear,
  Eye,
  Fingerprint,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  MessageSquareText,
  Mic,
  MonitorSmartphone,
  Radio,
  Send,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Waves,
  type LucideIcon,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'About',
  description: 'What Voicematics is, who it is for, how a sound becomes text, what stays on your computer, and how caregivers fit in.',
};

const PIPELINE: { icon: LucideIcon; title: string; where: string; text: string }[] = [
  { icon: Mic, title: 'Capture', where: 'Your computer', text: 'An AudioWorklet reads the microphone, filters it and cuts it into 10 ms frames. Nothing is recorded to disk.' },
  { icon: Ear, title: 'Hear, word for word', where: 'Your computer', text: 'Whisper runs on your graphics card or processor and writes down exactly what was said: repeats, part-words and fillers stay in.' },
  { icon: AudioLines, title: 'Measure', where: 'Your computer', text: 'Workers compute pitch, formants, jitter, shimmer, strain, speaking rate and blocks a hundred times a second.' },
  { icon: Braces, title: 'Rebuild', where: 'Voicematics server', text: 'A formal grammar tidies the words into a sentence in milliseconds. Optionally, Gemini writes a second answer that may not add words you did not say.' },
  { icon: Send, title: 'Deliver', where: 'Where you choose', text: 'Typed into the app you are using (even while minimised), spoken aloud, or shared with a caregiver you approved.' },
];

const MODES: { icon: LucideIcon; name: string; plan: 'Free' | 'Pro'; who: string; text: string }[] = [
  { icon: MessageSquareText, name: 'ClearVoice', plan: 'Free', who: 'People who stutter or clutter, at work, school and online', text: 'Hears you exactly, keeps a word-for-word transcript, and types what you said, the grammar-tidied sentence or Gemini’s answer into any text field.' },
  { icon: Waves, name: 'Fluency Coach', plan: 'Pro', who: 'People who stutter, with or without a clinician', text: 'Delayed and frequency-shifted auditory feedback, adjustable live from 30 to 150 ms, with presets you can save.' },
  { icon: Fingerprint, name: 'Gesture Trainer', plan: 'Free', who: 'Anyone for whom some words are hard to get out', text: 'Teach a short sound such as a hum or a click, then use it to type a phrase, speak it aloud, alert a caregiver or press a key combination.' },
  { icon: HeartPulse, name: 'Therapy', plan: 'Pro', who: 'Practice between sessions with a speech-language pathologist', text: 'A live vowel chart from your formants, articulation accuracy for every attempt, and your own practice targets.' },
  { icon: Eye, name: 'Sensory HUD', plan: 'Free', who: 'People who want to see their voice', text: 'Volume, pitch and strain as clear on-screen cues, so fatigue and blocks are noticed before they hurt.' },
  { icon: LayoutDashboard, name: 'Studio', plan: 'Free', who: 'Demonstrations, classrooms and the curious', text: 'Every measurement, the rebuilt text and the caregiver view side by side on one screen.' },
];

const STORAGE: { icon: LucideIcon; title: string; items: string[] }[] = [
  { icon: Cpu, title: 'Stays on your computer', items: ['Microphone audio', 'Speech recognition (Whisper)', 'All voice measurements, live', 'The word-for-word transcript', 'Settings and shortcuts'] },
  { icon: Server, title: 'On the Voicematics server', items: ['Account, profile and plan', 'Caregiver approvals', 'Gestures, presets, targets you save', 'Session summaries (with analytics)', 'Words, only while a sentence is rebuilt'] },
  { icon: Cloud, title: 'Sent to an AI model', items: ['Only with the second answer on', 'The words of one sentence', 'Up to six earlier sentences', 'Never audio, never your account'] },
];

const STACK = [
  ['Desktop', 'Electron, Next.js, React, Web Audio worklets and workers'],
  ['Recognition', 'Whisper through Transformers.js and ONNX Runtime (WebGPU or WASM)'],
  ['Analysis', 'FFT, YIN pitch, LPC formants, jitter, shimmer, HNR'],
  ['Rebuilding', 'FastAPI, an NLTK context-free grammar, Gemini with a grounding check'],
  ['Caregivers', 'WebRTC data channels, a signalling relay with account approval'],
  ['Accounts', 'PostgreSQL, Argon2id password hashing, signed session tokens'],
];

function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-bold uppercase tracking-wider text-ember">{eyebrow}</p>
      <h2 className="mt-2 font-display text-3xl font-bold text-bone sm:text-4xl">{title}</h2>
      {text && <p className="mt-3 text-lg text-smoke">{text}</p>}
    </div>
  );
}

export default function AboutPage() {
  return (
    <main className="pb-10">
      <section className="relative isolate overflow-hidden pb-16 pt-32 sm:pt-40">
        <div aria-hidden className="pointer-events-none absolute -right-40 top-10 -z-10 size-[36rem] rounded-full bg-crimson/15 blur-[120px]" />
        <div aria-hidden className="pointer-events-none absolute -left-40 bottom-0 -z-10 size-[28rem] rounded-full bg-ember/10 blur-[100px]" />
        <div className="mx-auto max-w-6xl px-6">
          <p className="badge">
            <AudioWaveform aria-hidden className="size-3.5 text-ember" />
            About Voicematics
          </p>
          <h1 className="mt-6 max-w-4xl font-display text-4xl font-bold leading-[1.05] text-bone sm:text-6xl">
            Being heard exactly, <span className="ember-text">stutters and all.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-smoke sm:text-xl">
            Voicematics is an assistive speech platform for people who stutter or speak differently. It hears you word for word, types for you in any app, coaches
            fluency, turns small sounds into actions, and keeps the people you trust in the loop, while your audio never leaves your computer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/#pricing" className="btn-primary">
              Get started
            </Link>
            <Link href="/help" className="btn-secondary">
              <CircleHelp aria-hidden className="size-4" />
              Browse the answers
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-2">
          <SectionTitle eyebrow="Why it exists" title="Most voice tools are built for fluent speech" />
          <div className="space-y-4 text-lg leading-relaxed text-smoke">
            <p>
              Dictation software smooths speech over. It drops repeated sounds, guesses at blocked words and rewrites what it did not expect, which is exactly wrong for
              someone whose speech has repetitions, prolongations or pauses. Many people end up typing everything instead, or not speaking up at all.
            </p>
            <p>
              Voicematics starts from the opposite end: it records what you actually said, precisely, then lets <em className="text-bone">you</em> decide whether the
              world sees it word for word, tidied by rules, or cleaned up by an AI that is not allowed to put words in your mouth.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionTitle eyebrow="The pieces" title="One account, four places" />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: MonitorSmartphone, title: 'The desktop app', text: 'Windows. Listens, measures, rebuilds and types. Where every mode lives.' },
            { icon: Sparkles, title: 'This website', text: 'Your account, profile, plan and licence, the help guide, and a live demo.' },
            { icon: Radio, title: 'The caregiver console', text: 'A browser page where approved caregivers watch readings, alerts and sentences.' },
            { icon: Smartphone, title: 'The phone alert button', text: 'One tap on your phone reaches your caregivers, even with the app closed.' },
          ].map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-2xl border border-white/10 bg-onyx/80 p-5">
              <span className="grid size-10 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
                <Icon aria-hidden className="size-5 text-ember" />
              </span>
              <p className="mt-4 font-display text-lg font-semibold text-bone">{title}</p>
              <p className="mt-1 text-sm text-smoke">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionTitle eyebrow="How it works" title="From a sound to a sentence, in five steps" text="Everything before the rebuild happens on your computer, in real time." />
        <ol className="relative mt-12 grid gap-4 lg:grid-cols-5">
          <div aria-hidden className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-ember/60 to-transparent lg:block" />
          {PIPELINE.map(({ icon: Icon, title, where, text }, index) => (
            <li key={title} className="relative rounded-2xl border border-white/10 bg-onyx p-5">
              <span className="relative grid size-14 place-items-center rounded-2xl bg-obsidian ring-1 ring-ember/50 shadow-ember-soft">
                <Icon aria-hidden className="size-6 text-ember" />
              </span>
              <p className="mt-4 text-xs font-bold uppercase tracking-wider text-smoke">
                {index + 1} · {where}
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-bone">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-smoke">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionTitle eyebrow="The modes" title="Six modes, picked from the sidebar" text="Each one changes what the app does while you speak. Switch any time." />
        <ul className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MODES.map(({ icon: Icon, name, plan, who, text }) => (
            <li key={name} className="flex flex-col rounded-2xl border border-white/10 bg-onyx/80 p-6 transition hover:border-ember/50">
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
                  <Icon aria-hidden className="size-5 text-ember" />
                </span>
                <span className={`badge ${plan === 'Pro' ? 'border-ember/40 text-ember' : ''}`}>{plan}</span>
              </div>
              <p className="mt-4 font-display text-xl font-semibold text-bone">{name}</p>
              <p className="mt-1 text-sm text-ember/90">{who}</p>
              <p className="mt-3 text-sm leading-relaxed text-smoke">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 rounded-3xl border border-white/10 bg-onyx/70 p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:p-12">
          <div>
            <SectionTitle eyebrow="Caregivers" title="Someone in the loop, only if you say so" />
            <p className="mt-4 text-smoke">
              A family member, partner or clinician can watch your voice readings, receive your alerts and read your sentences live, from any browser. They sign in, you
              approve their username once, and you can remove them any time. A room code alone shows nothing.
            </p>
            <Link href="/caregiver" className="btn-primary mt-6">
              Open the caregiver console
            </Link>
          </div>
          <ol className="space-y-4">
            {[
              { icon: KeyRound, title: 'They sign in', text: 'A free account is enough for a caregiver. Their username is how you recognise them.' },
              { icon: Radio, title: 'They enter your room code', text: 'You share it from Caregiver Link in the desktop app, or send a link that fills it in.' },
              { icon: ShieldCheck, title: 'You approve them', text: 'A request appears in your app and your profile. Until you approve, they see nothing.' },
              { icon: Bell, title: 'Alerts reach them', text: 'Blocks, strain, gesture alerts and emergencies, including from the button on your phone.' },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
                  <Icon aria-hidden className="size-5 text-ember" />
                </span>
                <span>
                  <span className="block font-semibold text-bone">{title}</span>
                  <span className="mt-0.5 block text-sm text-smoke">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionTitle eyebrow="Privacy by architecture" title="Where every piece of data lives" text="Not a promise in a policy: the audio path simply has no upload." />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {STORAGE.map(({ icon: Icon, title, items }, index) => (
            <div key={title} className={`rounded-2xl border p-6 ${index === 0 ? 'border-ember/50 bg-ember/[0.06]' : 'border-white/10 bg-onyx/80'}`}>
              <p className="flex items-center gap-2 font-display text-lg font-semibold text-bone">
                <Icon aria-hidden className="size-5 text-ember" />
                {title}
              </p>
              <ul className="mt-4 space-y-2 text-sm text-smoke">
                {items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ember" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-smoke">
          The full detail is in the{' '}
          <Link href="/privacy" className="text-ember hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionTitle eyebrow="AI, honestly" title="Two models, each kept in its lane" />
            <div className="mt-4 space-y-4 text-smoke">
              <p>
                <strong className="text-bone">Whisper</strong> turns your audio into words on your own computer. It is prompted to keep disfluencies, and it never sends
                audio anywhere.
              </p>
              <p>
                <strong className="text-bone">Gemini</strong> writes the optional second answer in ClearVoice. Before its sentence is shown, the server checks every
                content word against what you actually said; if it invented one, it is asked again, and if it still does, you get the grammar rules&apos; sentence
                instead.
              </p>
              <p>
                Everything else (measurements, feedback, gestures, the grammar, and the help guide on this site) is deterministic code and fixed data, with no model
                involved.
              </p>
            </div>
          </div>
          <div>
            <SectionTitle eyebrow="Built with" title="The stack" />
            <dl className="mt-6 divide-y divide-white/[0.06] rounded-2xl border border-white/10 bg-onyx/80">
              {STACK.map(([label, value]) => (
                <div key={label} className="grid gap-1 px-5 py-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="text-sm font-semibold text-bone">{label}</dt>
                  <dd className="text-sm text-smoke">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-8 rounded-3xl border border-white/10 bg-onyx/70 p-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:p-12">
          <span className="grid size-16 place-items-center rounded-2xl bg-ember/10 ring-1 ring-ember/40">
            <Accessibility aria-hidden className="size-8 text-ember" />
          </span>
          <div>
            <h2 className="font-display text-2xl font-bold text-bone">Built to be used however you communicate</h2>
            <p className="mt-2 text-smoke">
              Keyboard and screen-reader friendly, high contrast and text up to 200%, shortcuts you record yourself, and nothing that penalises pauses, repeats or slow
              speech. Voicematics is an assistive tool, not a medical device, and it works alongside the professionals who support you.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-8 pt-8 text-center">
        <h2 className="font-display text-3xl font-bold text-bone sm:text-4xl">Ready to be heard exactly?</h2>
        <p className="mx-auto mt-3 max-w-xl text-smoke">Create a free account in a minute, then download the desktop app. Upgrade only if you need Pro.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/#pricing" className="btn-primary">
            See plans
          </Link>
          <Link href="/terms" className="btn-secondary">
            Terms of Service
          </Link>
        </div>
      </section>
    </main>
  );
}
