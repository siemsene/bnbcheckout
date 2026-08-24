// Local (practice-mode) game flow: lobby -> planning -> running -> results.
// The Firebase session wrapper will reuse this with a session-provided seed.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { setSimSpeed, useSimStore } from '../../state/simStore';
import { Lobby } from './Lobby';
import { SimScreen } from './SimScreen';
import { Results } from './Results';

export function GameFlow({ seed }: { seed?: number }) {
  const phase = useSimStore((s) => s.phase);
  const sim = useSimStore((s) => s.sim);
  const newGame = useSimStore((s) => s.newGame);
  const [runNo, setRunNo] = useState(0);
  const [params] = useSearchParams();

  useEffect(() => {
    // Practice-only debug/demo speed override, e.g. /play?speed=64
    const speed = Number(params.get('speed'));
    setSimSpeed(Number.isFinite(speed) && speed > 0 ? speed : 8);
    const seedParam = Number(params.get('seed'));
    newGame(
      seed ?? (Number.isFinite(seedParam) && seedParam > 0 ? seedParam : (Math.random() * 2 ** 31) | 0),
    );
  }, [newGame, seed, runNo, params]);

  if (!sim) return null;
  return (
    <>
      <SimScreen />
      {phase === 'lobby' && <Lobby />}
      {phase === 'done' && <Results onPlayAgain={() => setRunNo((n) => n + 1)} />}
    </>
  );
}
