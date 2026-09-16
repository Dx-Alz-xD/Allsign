'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Check, Download, HardDrive } from 'lucide-react';
import { Modal } from '@/components/Modal';

interface DownloadSimulationProps {
  url: string | null;
  onClose: () => void;
}

const FILE_NAME = 'Voicematics-Setup.exe';
const FILE_MB = 84.2;
const DURATION_MS = 3200;

/** A download progress overlay; the real installer link is shown when the bar completes. */
export function DownloadSimulation({ url, onClose }: DownloadSimulationProps) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!url) return;
    setProgress(0);
    setDone(false);
    const state = { value: 0 };
    const run = animate(state, {
      value: 100,
      duration: DURATION_MS,
      ease: 'inOutQuad',
      onUpdate: () => setProgress(state.value),
      onComplete: () => setDone(true),
    });
    return () => {
      run.revert();
    };
  }, [url]);

  if (!url) return null;
  const downloaded = (FILE_MB * progress) / 100;

  return (
    <Modal open onClose={onClose} title={done ? 'Download ready' : 'Downloading'}>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-ember/10 ring-1 ring-ember/40">
          {done ? <Check aria-hidden className="size-5 text-ember" /> : <HardDrive aria-hidden className="size-5 text-ember" />}
        </span>
        <div>
          <p className="font-mono text-bone">{FILE_NAME}</p>
          <p className="text-xs tabular-nums text-smoke">
            {downloaded.toFixed(1)} / {FILE_MB} MB · Windows 10+, x64
          </p>
        </div>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <div ref={barRef} className="h-full rounded-full bg-ember-edge" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-4 text-sm text-smoke">
        {done ? 'This is a demonstration of the download flow. The installer is published with each desktop release:' : 'Verifying the signed installer…'}
      </p>
      {done && (
        <a href={url} className="btn-primary mt-4 w-full justify-center" download={FILE_NAME}>
          <Download aria-hidden className="size-4" />
          Get {FILE_NAME}
        </a>
      )}
    </Modal>
  );
}
