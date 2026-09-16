'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChartNoAxesColumn, Check, Copy, FileText, LoaderCircle, Save, Trash2 } from 'lucide-react';
import type { AgentStatus, ClinicalReport, SessionAnalytics, SessionSummary } from '@shared/types';
import { LockedFeature } from '@/components/account/PlanGate';
import { buttonStyles } from '@/components/modals/Modal';
import { useAccount } from '@/components/providers/AccountProvider';
import { useSession } from '@/components/providers/SessionProvider';
import { EmptyState } from '@/components/views/EmptyState';
import { usePolled } from '@/hooks/usePolled';
import { api } from '@/lib/api/client';
import { getProfilePreset } from '@/lib/profiles';

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

/** Sessions recorded by the backend, plus the one in progress. */
export function AnalyticsView() {
  const { has } = useAccount();
  const { pipeline, live } = useSession();
  const current = usePolled(() => pipeline.getSessionStats(), 1);

  if (!has('analytics')) {
    return (
      <div className="space-y-6">
        <CurrentSession live={live} stats={current} />
        <LockedFeature feature="analytics">
          <p>
            Every session is saved to your account with its speaking rate, blocks and fluency, so you can see how they change
            over weeks. Pro also writes clinical reports to share with your speech-language pathologist.
          </p>
        </LockedFeature>
      </div>
    );
  }
  return <SessionHistory />;
}

type SessionStats = ReturnType<ReturnType<typeof useSession>['pipeline']['getSessionStats']>;

function CurrentSession({ live, stats, children }: { live: boolean; stats: SessionStats; children?: ReactNode }) {
  return (
    <section aria-label="Current session" className="glass flex flex-wrap items-center gap-6 rounded-2xl px-5 py-4">
      <Stat label="This session" value={live ? formatDuration(stats.sessionDurationSeconds) : 'Microphone off'} />
      <Stat label="Speaking rate" value={`${Math.round(stats.wpm)} WPM`} />
      <Stat label="Blocks" value={String(stats.stutterCount)} />
      <Stat label="Fluency" value={`${Math.round(stats.fluencyPercentage)}%`} />
      {children}
    </section>
  );
}

function SessionHistory() {
  const { has } = useAccount();
  const { backendOnline, pipeline, live, recordSession, startNewSession } = useSession();
  const [sessions, setSessions] = useState<SessionAnalytics[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = usePolled(() => pipeline.getSessionStats(), 1);

  const load = useCallback(async () => {
    try {
      const [list, roll] = await Promise.all([api.sessions.list({ limit: 50 }), api.sessions.summary()]);
      setSessions(list);
      setSummary(roll);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  // Reload when the backend comes up and when the microphone stops, which records the session.
  useEffect(() => {
    if (backendOnline && !live) void load();
  }, [backendOnline, live, load]);

  const save = async () => {
    const saved = await recordSession();
    setNotice(saved ? 'Session saved.' : 'Sessions shorter than five seconds are not saved.');
    if (saved) {
      startNewSession();
      await load();
    }
  };

  const remove = async (session: SessionAnalytics) => {
    await api.sessions.remove(session.id);
    await load();
  };

  return (
    <div className="space-y-6">
      <CurrentSession live={live} stats={current}>
        <button type="button" onClick={() => void save()} disabled={!live || !backendOnline} className={`${buttonStyles.secondary} ml-auto`}>
          <Save aria-hidden className="size-4" />
          Save and start a new session
        </button>
        {notice && <p className="w-full text-sm text-mist">{notice}</p>}
      </CurrentSession>

      {has('clinical_reports') ? (
        <ClinicalReportPanel />
      ) : (
        <LockedFeature feature="clinical_reports">
          <p>A summary of a session&apos;s voice measurements to share with your speech-language pathologist.</p>
        </LockedFeature>
      )}

      {summary && summary.sessions > 0 && (
        <section aria-label="All sessions" className="glass flex flex-wrap items-center gap-6 rounded-2xl px-5 py-4">
          <Stat label="Sessions" value={String(summary.sessions)} />
          <Stat label="Total time" value={formatDuration(summary.totalSeconds)} />
          <Stat label="Average rate" value={`${Math.round(summary.averageWpm)} WPM`} />
          <Stat label="Average fluency" value={`${Math.round(summary.averageFluencyPercentage)}%`} />
          <Stat label="Blocks" value={String(summary.totalStutters)} />
        </section>
      )}

      {sessions.length === 0 ? (
        <EmptyState icon={ChartNoAxesColumn} title="No sessions yet">
          {backendOnline === false
            ? 'Session history needs the backend.'
            : 'Speaking rate, blocks, and fluency trends appear here after your first recorded session. Sessions save when you stop the microphone.'}
        </EmptyState>
      ) : (
        <section aria-label="Session history" className="glass rounded-2xl">
          <table className="w-full text-left text-sm">
            <thead className="text-mist">
              <tr>
                <th className="px-5 py-3 font-bold">When</th>
                <th className="px-3 py-3 font-bold">Profile</th>
                <th className="px-3 py-3 font-bold">Length</th>
                <th className="px-3 py-3 font-bold">Rate</th>
                <th className="px-3 py-3 font-bold">Blocks</th>
                <th className="px-3 py-3 font-bold">Fluency</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-ink">
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td className="px-5 py-3 tabular-nums">{new Date(session.recordedAt).toLocaleString()}</td>
                  <td className="px-3 py-3">{session.profileMode ? getProfilePreset(session.profileMode).label : '—'}</td>
                  <td className="px-3 py-3 tabular-nums">{formatDuration(session.sessionDurationSeconds)}</td>
                  <td className="px-3 py-3 tabular-nums">{Math.round(session.wpm)} WPM</td>
                  <td className="px-3 py-3 tabular-nums">{session.stutterCount}</td>
                  <td className="px-3 py-3 tabular-nums">{Math.round(session.fluencyPercentage)}%</td>
                  <td className="px-3 py-3 text-right">
                    <button type="button" onClick={() => void remove(session)} aria-label="Delete session" className="rounded-lg p-2 text-mist hover:bg-white/10 hover:text-warn">
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function describeReduction(index: number): string {
  if (index > 0) return `${Math.round(index * 100)}% fewer blocks per minute once feedback was on`;
  if (index < 0) return `${Math.round(-index * 100)}% more blocks per minute once feedback was on`;
  return 'No change, or no stretch without feedback to compare with';
}

function reportText(report: ClinicalReport): string {
  return [
    `Voicematics clinical report (${new Date().toLocaleString()})`,
    `Session length: ${report.session_duration_minutes.toFixed(1)} min`,
    `Stuttering reduction index: ${report.stuttering_reduction_index.toFixed(2)} (${describeReduction(report.stuttering_reduction_index)})`,
    `Vocal fatigue: ${report.vocal_fatigue_alert ? 'flagged' : 'not flagged'}`,
    `Recommended DAF delay: ${report.recommended_daf_delay_ms > 0 ? `${report.recommended_daf_delay_ms} ms` : 'none'}`,
    '',
    report.slp_summary_paragraph,
  ].join('\n');
}

/** Writes a report for the current session with the backend's report agent. */
function ClinicalReportPanel() {
  const { getSessionLog } = useSession();
  const { offline } = useAccount();
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [report, setReport] = useState<ClinicalReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.agent
      .status()
      .then((status) => !cancelled && setAgent(status))
      .catch(() => !cancelled && setAgent(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const write = async () => {
    const log = getSessionLog();
    if (!log || log.samples.length === 0) {
      setError('Talk with the microphone on for a little while first: the report is built from this session’s voice measurements.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setReport(await api.agent.generateReport(log));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(reportText(report)).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const unavailable = agent !== null && !agent.available;

  return (
    <section aria-labelledby="report-heading" className="glass rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="report-heading" className="text-xl font-semibold text-ink">
          Clinical report
        </h2>
        <button type="button" onClick={() => void write()} disabled={busy || unavailable || offline} className={buttonStyles.primary}>
          {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : <FileText aria-hidden className="size-4" />}
          {busy ? 'Writing the report' : 'Write a report for this session'}
        </button>
      </div>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-mist">
        The numbers are calculated from this session&apos;s voice measurements (jitter, shimmer, strain, pitch, blocks and feedback
        settings; never audio). They are sent to the Voicematics server, where a language model from Google Gemini or Groq writes
        the summary paragraph. It is not a diagnosis.
      </p>
      {unavailable && <p className="mt-3 text-warn">Report writing is not set up on this Voicematics server.</p>}
      {error && (
        <p role="alert" className="mt-3 text-warn">
          {error}
        </p>
      )}
      {report && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <ReportFact label="Session length" value={`${report.session_duration_minutes.toFixed(1)} min`} />
            <ReportFact label="Vocal fatigue" value={report.vocal_fatigue_alert ? 'Flagged' : 'Not flagged'} warn={report.vocal_fatigue_alert} />
            <ReportFact
              label="Stuttering reduction"
              value={report.stuttering_reduction_index.toFixed(2)}
              detail={describeReduction(report.stuttering_reduction_index)}
            />
            <ReportFact
              label="Suggested DAF delay"
              value={report.recommended_daf_delay_ms > 0 ? `${report.recommended_daf_delay_ms} ms` : 'None'}
            />
          </dl>
          <p className="mt-4 max-w-prose leading-relaxed text-ink">{report.slp_summary_paragraph}</p>
          <button type="button" onClick={() => void copy()} className={`${buttonStyles.secondary} mt-4 h-9 px-3 text-sm`}>
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            {copied ? 'Copied' : 'Copy report'}
          </button>
        </div>
      )}
    </section>
  );
}

function ReportFact({ label, value, detail, warn = false }: { label: string; value: string; detail?: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-mist">{label}</dt>
      <dd className={`font-display text-xl font-semibold tabular-nums ${warn ? 'text-warn' : 'text-ink'}`}>{value}</dd>
      {detail && <dd className="text-sm text-mist">{detail}</dd>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-mist">{label}</p>
      <p className="font-display text-xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
