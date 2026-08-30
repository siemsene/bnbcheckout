// The plan board: the thing that turns run 2 from improvisation into execution.
//
// Students give each friend an ordered list of jobs. The projection underneath
// runs the real engine against that plan and shows what it would achieve, so the
// consequence of a decision is visible before the clock starts rather than
// twenty sim-minutes later.
//
// Interaction is click-to-add plus explicit reorder buttons rather than drag.
// The board already establishes click-to-assign as the keyboard-equivalent path,
// and here it is also simply faster: you are building five ordered lists, not
// positioning things in space.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CHARACTERS, CHAR_IDS, TASKS, TASK_BY_ID } from '../../engine/content';
import { checkPlan, emptyPlan } from '../../engine/planCheck';
import { projectPlan } from '../../engine/project';
import { eligible } from '../../engine/dispatch';
import { CHAR_META } from '../../content/charMeta';
import { GanttChart } from '../charts/GanttChart';
import { NetworkDiagram } from '../charts/NetworkDiagram';
import { TaskIcon } from '../board/TaskIcon';
import type { CharId, Plan } from '../../engine/types';

/**
 * The draft plan is held HERE rather than by the session screen. It used to live
 * one level up, which meant every click re-rendered the whole game tree behind
 * the overlay — the board, the house, twenty-two task cards and their live rate
 * calculations — and an edit took the better part of a second. Only the
 * committed plan needs to cross back up.
 */
export function PlanBoard({
  seed,
  onCommit,
  committed,
  msUntilStart,
  readyCount,
  playerCount,
  error,
}: {
  seed: number;
  onCommit(plan: Plan): void;
  committed: boolean;
  msUntilStart: number;
  readyCount: number;
  playerCount: number;
  error: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>(emptyPlan);
  const onChange = setPlan;

  const issues = useMemo(() => checkPlan(plan), [plan]);
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  // Projecting is a full-length headless run of the real engine — around 80ms,
  // and synchronous. Fine once, but a student reordering a lane fires several
  // edits a second, and blocking the main thread on each one makes the whole
  // board feel stuck. Debounce: validation (cheap) stays instant, the schedule
  // catches up a beat later.
  const [projection, setProjection] = useState(() => projectPlan(seed, plan));
  const [projecting, setProjecting] = useState(false);
  const slowTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Only claim to be recalculating if it takes long enough to notice; below
    // that the flicker is worse than the wait.
    slowTimer.current = window.setTimeout(() => setProjecting(true), 120);
    const run = window.setTimeout(() => {
      setProjection(projectPlan(seed, plan));
      setProjecting(false);
      window.clearTimeout(slowTimer.current);
    }, 200);
    return () => {
      window.clearTimeout(run);
      window.clearTimeout(slowTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, plan.rev]);

  const edit = (fn: (q: Record<CharId, string[]>) => void) => {
    const queues = Object.fromEntries(
      CHAR_IDS.map((c) => [c, [...(plan.queues[c] ?? [])]]),
    ) as Record<CharId, string[]>;
    fn(queues);
    onChange({ queues, rev: plan.rev + 1 });
  };

  const addTo = (charId: CharId, taskId: string) =>
    edit((q) => {
      if (!q[charId].includes(taskId)) q[charId].push(taskId);
    });
  const removeFrom = (charId: CharId, i: number) => edit((q) => q[charId].splice(i, 1));
  const move = (charId: CharId, i: number, by: number) =>
    edit((q) => {
      const j = i + by;
      if (j < 0 || j >= q[charId].length) return;
      [q[charId][i], q[charId][j]] = [q[charId][j], q[charId][i]];
    });

  const countOf = (taskId: string) =>
    CHAR_IDS.filter((c) => (plan.queues[c] ?? []).includes(taskId)).length;

  const mins = Math.floor(msUntilStart / 60000);
  const secs = Math.ceil((msUntilStart % 60000) / 1000);

  return (
    <div className="overlay">
      <div className="overlay-card plan-card">
        <div className="plan-head">
          <div>
            <h1 style={{ margin: 0 }}>Plan the second run</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--ink-soft)' }}>
              You have met the team and found the constraints the hard way. Now
              decide who does what, in what order — then watch it play out.
            </p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>
              {mins}:{String(secs).padStart(2, '0')}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
              {readyCount} of {playerCount} ready
            </div>
          </div>
        </div>

        <div className="plan-grid">
          {/* ---------------------------------------------------- the palette */}
          <div className="plan-palette panel">
            <strong style={{ fontSize: '0.9rem' }}>
              {picked ? 'Now pick whose list it goes in →' : 'Pick a job'}
            </strong>
            <div className="plan-task-list">
              {TASKS.map((t) => {
                const n = countOf(t.id);
                const need = t.minWorkers ?? 1;
                const short = need > 1 && n < need;
                return (
                  <button
                    key={t.id}
                    className={`plan-task ${picked === t.id ? 'picked' : ''} ${
                      n === 0 ? 'unplanned' : ''
                    }`}
                    onClick={() => setPicked(picked === t.id ? null : t.id)}
                    aria-pressed={picked === t.id}
                  >
                    <TaskIcon taskId={t.id} />
                    <span className="plan-task-name">
                      {t.name}
                      <em>
                        ~{t.baseMinutes}′
                        {need > 1
                          ? ` · needs all ${need}`
                          : t.maxWorkers === 1
                            ? ' · one person'
                            : ` · up to ${t.maxWorkers}`}
                        {t.requiresLicense && ' · needs a licence'}
                        {t.travel && ' · away from the house'}
                      </em>
                    </span>
                    <span className={`plan-count ${short ? 'short' : ''}`}>
                      {n === 0 ? '—' : `${n}×`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ------------------------------------------------------ the lanes */}
          <div className="plan-lanes">
            {CHAR_IDS.map((c) => {
              const q = plan.queues[c] ?? [];
              const canTake = picked != null && eligible(c, picked) && !q.includes(picked);
              return (
                <div
                  key={c}
                  className={`plan-lane panel ${canTake ? 'droppable' : ''}`}
                  style={{ ['--chip-color' as string]: CHAR_META[c].color }}
                >
                  <div className="plan-lane-head">
                    <img src={CHAR_META[c].front} alt="" aria-hidden />
                    <strong>{CHARACTERS[c].name}</strong>
                    <span className="plan-lane-count">
                      {q.length} {q.length === 1 ? 'job' : 'jobs'}
                    </span>
                  </div>

                  <ol className="plan-lane-list">
                    {q.map((taskId, i) => (
                      <li key={`${taskId}-${i}`}>
                        <span className="plan-lane-task">{TASK_BY_ID[taskId].name}</span>
                        <span className="plan-lane-btns">
                          <button
                            onClick={() => move(c, i, -1)}
                            disabled={i === 0}
                            aria-label={`Move ${TASK_BY_ID[taskId].name} earlier`}
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => move(c, i, 1)}
                            disabled={i === q.length - 1}
                            aria-label={`Move ${TASK_BY_ID[taskId].name} later`}
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => removeFrom(c, i)}
                            aria-label={`Remove ${TASK_BY_ID[taskId].name} from ${CHARACTERS[c].name}`}
                          >
                            ✕
                          </button>
                        </span>
                      </li>
                    ))}
                    {q.length === 0 && <li className="plan-lane-empty">Nothing planned</li>}
                  </ol>

                  <button
                    className="plan-lane-add"
                    disabled={!canTake}
                    onClick={() => {
                      if (picked) addTo(c, picked);
                    }}
                  >
                    {picked
                      ? canTake
                        ? `+ ${TASK_BY_ID[picked].name}`
                        : q.includes(picked)
                          ? 'already on their list'
                          : `${CHARACTERS[c].name} can’t do that one`
                      : '+ add the picked job'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ------------------------------------------------------ the verdict */}
        <div className="plan-verdict">
          <div>
            <div className="plan-verdict-big">
              {projection.finishSimMinute == null
                ? 'Does not finish'
                : `Finishes ${Math.floor(8 + projection.finishSimMinute / 60)}:${String(
                    Math.floor(projection.finishSimMinute) % 60,
                  ).padStart(2, '0')} AM`}
            </div>
            <div className="plan-verdict-sub">
              {projecting ? 'working it out… · ' : ''}
              on a morning where nothing goes wrong
              {projection.unscheduled.length > 0 &&
                ` · ${projection.unscheduled.length} job${
                  projection.unscheduled.length === 1 ? '' : 's'
                } nobody is doing`}
            </div>
          </div>
          {/* Deliberately still live after locking in. Telling the room you are
              ready should not freeze your plan — the board stays open until the
              instructor starts the run, and a student who spots a mistake in
              that window must be able to fix it. markReady is idempotent, so
              re-committing costs nothing. */}
          <button
            className="btn-big"
            onClick={() => onCommit(plan)}
            title={
              errors.length
                ? 'You can still lock this in — but the problems below will cost you.'
                : undefined
            }
          >
            {committed ? '✓ Ready — update my plan' : 'Lock it in →'}
          </button>
        </div>

        {error && (
          <p style={{ color: 'var(--danger)' }} role="alert">
            {error}
          </p>
        )}

        {(errors.length > 0 || warns.length > 0) && (
          <ul className="plan-issues">
            {errors.map((i) => (
              <li key={i.key} className="err">
                ✕ {i.text}
              </li>
            ))}
            {warns.map((i) => (
              <li key={i.key} className="warn">
                ! {i.text}
              </li>
            ))}
          </ul>
        )}

        <h3 className="plan-section">What your plan does</h3>
        <p className="plan-section-note">
          The same engine that runs the game, with the interruptions switched off.
          Gaps are people standing idle; the real morning will be worse than this,
          not better.
        </p>
        <GanttChart
          timeline={projection.timeline}
          finishSimMinute={projection.finishSimMinute}
        />

        <h3 className="plan-section">What has to happen before what</h3>
        <p className="plan-section-note">
          Every job on the clock, with the chain that decides the finish marked in
          orange. Tasks with float can slide; tasks on that chain cannot — a
          minute lost there is a minute lost off the end of the morning. This
          ignores who is free and how many can help, which is exactly why your
          plan above finishes later than it does.
        </p>
        <NetworkDiagram />
      </div>
    </div>
  );
}
