// Records: the long game. Achievements (each a small permanent bonus) in rows
// by act, and act challenges: replay a finished act with a twist while your
// game waits, for a bigger permanent bonus.
import { useState } from 'react';
import { useGame } from '../store';
import { send } from '../simClient';
import { audio } from '../audio/engine';
import { ROW_NAMES } from '../../sim/achievements';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'Finale'];

export function Records() {
  const snap = useGame((s) => s.snap)!;
  const [confirm, setConfirm] = useState<string | null>(null);
  const done = snap.achievements.filter((a) => a.done).length;
  const chDone = snap.challenges.filter((c) => c.done).length;
  return (
    <div className="records">
      <h2>Records</h2>
      <div className="rec-sum">
        <span>
          Achievements <b>{done} / {snap.achievements.length}</b>
        </span>
        <span>
          From achievements <b>×{snap.achBonus.toFixed(2)}</b> Variation income
        </span>
        <span>
          Challenges <b>{chDone} / {snap.challenges.length}</b>
        </span>
        <span title="Completed acts, challenges and the virus campaign">
          Other permanent bonuses <b>×{snap.evolvability.toFixed(2)}</b>
        </span>
      </div>
      {ROW_NAMES.map((name, row) => {
        const items = snap.achievements.filter((a) => a.act === row);
        if (!items.length) return null;
        return (
          <div key={name} className="ach-row">
            <span className="rn">{name}</span>
            {items.map((a) => (
              <div key={a.id} className={'ach' + (a.done ? ' done' : '')} title={a.done ? 'Earned: +2% Variation income' : 'Not yet earned'}>
                <b>
                  {a.done ? '✓ ' : ''}
                  {a.name}
                </b>
                <span>{a.text}</span>
              </div>
            ))}
          </div>
        );
      })}
      <h3>Act challenges</h3>
      <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 720 }}>
        Replay an act you have finished, with a twist. Your game waits exactly where it is and comes back when the challenge ends (or when you abandon it). Finishing one is a permanent bonus to Variation income.
      </div>
      <div className="ch-list">
        {snap.challenges.map((c) => (
          <div key={c.id} className={'ch' + (c.done ? ' done' : '')}>
            <div className="faint" style={{ fontSize: 10.5, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Act {ROMAN[c.act]}
            </div>
            <div className="t">{c.name}</div>
            <div className="x">{c.text}</div>
            <div className="f">
              <span style={{ color: c.done ? 'var(--accent)' : 'var(--text-3)' }}>{c.done ? `Finished · +${Math.round(c.bonus * 100)}%` : `Reward: +${Math.round(c.bonus * 100)}% Variation income`}</span>
              {c.running ? (
                <span className="chip">Playing now</span>
              ) : confirm === c.id ? (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className="btn ghost sm" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn primary sm"
                    onClick={() => {
                      audio.chime('unlock');
                      setConfirm(null);
                      send({ type: 'actChallenge', id: c.id });
                    }}
                  >
                    Start now
                  </button>
                </span>
              ) : (
                <button className="btn sm" disabled={!c.available} title={c.available ? 'Your game waits while you play it' : snap.challengeRun ? 'Finish or abandon the current challenge first' : `Play past Act ${ROMAN[c.act]} first`} onClick={() => setConfirm(c.id)}>
                  {c.done ? 'Play again' : 'Start'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
