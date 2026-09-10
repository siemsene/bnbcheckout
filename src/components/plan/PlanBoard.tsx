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
import { checkPlan, emptyPlan } from '../../engine/planCheck';
import { projectPlan } from '../../engine/project';
import { PlanGantt } from './PlanGantt';
import { NetworkDiagram } from '../charts/NetworkDiagram';
import type { Plan } from '../../engine/types';

/**
 * The draft plan is held HERE rather than by the session screen. It used to live
 * one level up, which meant every click re-rendered the whole game tree behind
 * the overlay — the board, the house, twenty-two task cards and their live rate
 * calculations — and an edit took the better part of a second. Only the
 * committed plan needs to cross back up.
 */
export function PlanBoard({
  seed,
  initialPlan,
  onCommit,
  onDraft,
  committed,
  msUntilStart,
  readyCount,
  playerCount,
  error,
}: {
  seed: number;
  /**
   * The plan already on the sim, if any. A refresh during planning used to come
   * back to an empty board even though the checkpoint still held the work.
   */
  initialPlan?: Plan;
  onCommit(plan: Plan): void;
  /**
   * Every edit, not just the explicit commit. Run 2 is driven by whatever plan
   * is on the sim when the clock starts, and that used to be set only by "Lock
   * it in" — so a student who built a plan and never pressed the button watched
   * their friends stand around doing nothing for the whole replay.
   */
  onDraft(plan: Plan): void;
  committed: boolean;
  msUntilStart: number;
  readyCount: number;
  playerCount: number;
  error: string | null;
}) {
  const [plan, setPlan] = useState<Plan>(() => initialPlan ?? emptyPlan());
  const onChange = (next: Plan) => {
    setPlan(next);
    onDraft(next);
  };

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
              Hover or tap a name to see again what each friend is good at.
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

        {/* The board itself: drag jobs into each friend's row. Order is what
            the engine consumes, so a block snaps to when the job can actually
            start rather than sitting wherever it was dropped. */}
        <p className="plan-howto">
          Drag a job into someone's row. Further right means later in their
          order — the blocks then snap to when each job can actually start, and
          a striped stretch is someone waiting on something else to finish.
          Each name is a card: their strengths, and where they get stuck.
        </p>
        <PlanGantt plan={plan} projection={projection} onChange={onChange} />

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
