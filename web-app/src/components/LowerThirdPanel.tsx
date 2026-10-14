import { Eye, EyeOff, Lock, Save, TextCursorInput, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { LOWER_THIRD_LIMITS, LOWER_THIRD_STYLES } from '../studio/lowerThird';
import type { LowerThirdPreset, LowerThirdSettings } from '../studio/lowerThird';

interface Props {
  allowed: boolean;
  settings: LowerThirdSettings;
  live: boolean;
  presets: LowerThirdPreset[];
  actions: {
    setLowerThird: (patch: Partial<LowerThirdSettings>) => void;
    showLowerThird: () => void;
    hideLowerThird: () => void;
    saveLowerThirdPreset: () => void;
    deleteLowerThirdPreset: (index: number) => void;
    playLowerThirdPreset: (index: number) => void;
  };
}

/** Host studio panel for the animated lower-third banner (a Pro/Business feature; see lowerThird.ts). */
export function LowerThirdPanel({ allowed, settings, live, presets, actions }: Props) {
  const navigate = useNavigate();

  if (!allowed) {
    return (
      <div className="panel">
        <label className="studio-section-label">
          <TextCursorInput size={14} /> Lower third
        </label>
        <p className="field-hint">A banner that slides in over the picture with a name, title or any text. It is on the Pro and Business plans.</p>
        <button type="button" className="icon-btn icon-btn--small" aria-label="Lower third (Pro plan)" onClick={() => navigate('/billing')}>
          <Lock size={14} /> Lower third · Pro
        </button>
      </div>
    );
  }

  const hasTitle = settings.title.trim().length > 0;
  return (
    <div className="panel" data-testid="lower-third-panel">
      <label className="studio-section-label" htmlFor="lowerThirdTitle">
        <TextCursorInput size={14} /> Lower third
      </label>
      <input
        id="lowerThirdTitle"
        type="text"
        placeholder="Name or title, e.g. Priya Sharma"
        maxLength={LOWER_THIRD_LIMITS.title}
        value={settings.title}
        onChange={(e) => actions.setLowerThird({ title: e.target.value })}
      />
      <label htmlFor="lowerThirdSubtitle">Second line (optional)</label>
      <input
        id="lowerThirdSubtitle"
        type="text"
        placeholder="Role, topic or any text"
        maxLength={LOWER_THIRD_LIMITS.subtitle}
        value={settings.subtitle}
        onChange={(e) => actions.setLowerThird({ subtitle: e.target.value })}
      />

      <label id="lowerThirdStyleLabel">Look</label>
      <div className="segmented" role="group" aria-labelledby="lowerThirdStyleLabel">
        {LOWER_THIRD_STYLES.map((st) => (
          <button key={st.id} type="button" className={settings.style === st.id ? 'active' : ''} aria-pressed={settings.style === st.id} onClick={() => actions.setLowerThird({ style: st.id })}>
            {st.label}
          </button>
        ))}
      </div>

      <label htmlFor="lowerThirdAutoHide">Hide by itself</label>
      <select id="lowerThirdAutoHide" value={settings.autoHideSec} onChange={(e) => actions.setLowerThird({ autoHideSec: Number(e.target.value) })}>
        {LOWER_THIRD_LIMITS.autoHideChoices.map((sec) => (
          <option key={sec} value={sec}>
            {sec === 0 ? 'Never (until I hide it)' : `After ${sec} seconds`}
          </option>
        ))}
      </select>

      <div className="studio-toolbar">
        {live ? (
          <button type="button" className="icon-btn icon-btn--small" onClick={actions.hideLowerThird}>
            <EyeOff size={14} /> Hide lower third
          </button>
        ) : (
          <button type="button" className="icon-btn icon-btn--small icon-btn--accent" disabled={!hasTitle} onClick={actions.showLowerThird}>
            <Eye size={14} /> Show lower third
          </button>
        )}
        {live && (
          <button type="button" className="icon-btn icon-btn--small" disabled={!hasTitle} onClick={actions.showLowerThird}>
            Replay
          </button>
        )}
        <button type="button" className="icon-btn icon-btn--small" disabled={!hasTitle} onClick={actions.saveLowerThirdPreset}>
          <Save size={14} /> Save text
        </button>
      </div>

      {presets.length > 0 && (
        <>
          <label id="lowerThirdSavedLabel">Saved: click to show</label>
          <div className="studio-toolbar" role="group" aria-labelledby="lowerThirdSavedLabel">
            {presets.map((p, i) => (
              <span key={`${p.title}|${p.subtitle}`} className="lower-third-chip">
                <button type="button" className="icon-btn icon-btn--small" onClick={() => actions.playLowerThirdPreset(i)}>
                  {p.title}
                </button>
                <button type="button" className="icon-btn icon-btn--small icon-btn--danger" aria-label={`Delete saved text ${p.title}`} onClick={() => actions.deleteLowerThirdPreset(i)}>
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
