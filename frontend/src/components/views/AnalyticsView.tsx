'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChartNoAxesColumn, Save, Trash2 } from 'lucide-react';
import type { SessionAnalytics, SessionSummary } from '@shared/types';
import { buttonStyles } from '@/components/modals/Modal';
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
  const { backendOnline, pipeline, live, recordSession } = useSession();
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
      pipeline.reset();
      await load();
    }
  };

  const remove = async (session: SessionAnalytics) => {
    await api.sessions.remove(session.id);
    await load();
  };

  return (
    <div className="space-y-6">
      <section aria-label="Current session" className="glass flex flex-wrap items-center gap-6 rounded-2xl px-5 py-4">
        <Stat label="This session" value={live ? formatDuration(current.sessionDurationSeconds) : 'Microphone off'} />
        <Stat label="Speaking rate" value={`${Math.round(current.wpm)} WPM`} />
        <Stat label="Blocks" value={String(current.stutterCount)} />
        <Stat label="Fluency" value={`${Math.round(current.fluencyPercentage)}%`} />
        <button type="button" onClick={() => void save()} disabled={!live || !backendOnline} className={`${buttonStyles.secondary} ml-auto`}>
          <Save aria-hidden className="size-4" />
          Save and start a new session
        </button>
        {notice && <p className="w-full text-sm text-mist">{notice}</p>}
      </section>

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-mist">{label}</p>
      <p className="font-display text-xl font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
