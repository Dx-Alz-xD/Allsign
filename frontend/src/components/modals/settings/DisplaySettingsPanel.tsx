'use client';

import { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { buttonStyles } from '@/components/modals/Modal';
import { SettingSection, Switch } from '@/components/modals/settings/controls';
import { useSettings } from '@/components/providers/SettingsProvider';
import { TEXT_SCALE, clampTextScale } from '@/lib/settings/schema';

export function DisplaySettingsPanel() {
  const { settings, highContrast, systemHighContrast, updateDisplay } = useSettings();
  const { textScale } = settings.display;
  const [draftScale, setDraftScale] = useState(textScale);
  const contrastHelpId = useId();
  const sliderId = useId();

  useEffect(() => setDraftScale(textScale), [textScale]);

  // The whole interface rescales on commit, so the slider only commits when the pointer or key is released.
  const commit = (value: number) => {
    const next = clampTextScale(value);
    setDraftScale(next);
    if (next !== textScale) updateDisplay({ textScale: next });
  };

  return (
    <div className="space-y-10">
      <SettingSection
        title="Contrast"
        description="High contrast uses a pure black background, brighter text, and solid borders. Every text color reaches at least 7:1 contrast."
      >
        <Switch
          checked={highContrast}
          onChange={(value) => updateDisplay({ highContrast: value })}
          label="High contrast"
          describedBy={contrastHelpId}
        />
        <p id={contrastHelpId} className="text-sm text-mist">
          {settings.display.highContrast === null ? (
            `Following your system setting, which is ${systemHighContrast ? 'on' : 'off'}.`
          ) : (
            <>
              Set by you.{' '}
              <button type="button" onClick={() => updateDisplay({ highContrast: null })} className={buttonStyles.link}>
                Follow my system setting instead
              </button>
            </>
          )}
        </p>
      </SettingSection>

      <SettingSection
        title="Text size"
        description="Scales text and controls together, from 100% to 200%, and rearranges the layout so nothing gets cut off."
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => commit(textScale - TEXT_SCALE.step)}
            disabled={textScale <= TEXT_SCALE.min}
            aria-label="Make text smaller"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/15 text-ink transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Minus aria-hidden className="size-5" />
          </button>
          <label htmlFor={sliderId} className="sr-only">
            Text size
          </label>
          <input
            id={sliderId}
            type="range"
            min={TEXT_SCALE.min}
            max={TEXT_SCALE.max}
            step={TEXT_SCALE.step}
            value={draftScale}
            aria-valuetext={`${draftScale}%`}
            onChange={(event) => setDraftScale(Number(event.target.value))}
            onPointerUp={(event) => commit(Number(event.currentTarget.value))}
            onKeyUp={(event) => commit(Number(event.currentTarget.value))}
            onBlur={(event) => commit(Number(event.currentTarget.value))}
            className="h-2 min-w-0 flex-1 cursor-pointer accent-neon-cyan"
          />
          <button
            type="button"
            onClick={() => commit(textScale + TEXT_SCALE.step)}
            disabled={textScale >= TEXT_SCALE.max}
            aria-label="Make text larger"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/15 text-ink transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus aria-hidden className="size-5" />
          </button>
          <output htmlFor={sliderId} className="w-16 shrink-0 text-right font-display text-2xl font-bold tabular-nums text-ink">
            {draftScale}%
          </output>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm text-mist">Preview</p>
          <p className="mt-1 font-display font-semibold leading-snug text-ink" style={{ fontSize: `${(1.25 * draftScale) / textScale}rem` }}>
            I want to go to the store.
          </p>
        </div>

        <button
          type="button"
          onClick={() => commit(TEXT_SCALE.min)}
          disabled={textScale === TEXT_SCALE.min}
          className={buttonStyles.secondary}
        >
          Reset to 100%
        </button>
      </SettingSection>
    </div>
  );
}
