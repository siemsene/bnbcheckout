// Local (practice-mode) game flow: lobby -> planning -> running -> results.
// The Firebase session wrapper will reuse this with a session-provided seed.

import { useEffect, useState } from 'react';
import { useSimStore } from '../../state/simStore';
import { Lobby } from './Lobby';
import { SimScreen } from './SimScreen';
import { Results } from './Results';

export function GameFlow({ seed }: { seed?: number }) {
  const phase = useSimStore((s) => s.phase);
  const sim = useSimStore((s) => s.sim);
  const newGame = useSimStore((s) => s.newGame);
  const [runNo, setRunNo] = useState(0);

  useEffect(() => {
    newGame(seed ?? ((Math.random() * 2 ** 31) | 0));
  }, [newGame, seed, runNo]);

  if (!sim) return null;
  return (
    <>
      <SimScreen />
      {phase === 'lobby' && <Lobby />}
      {phase === 'done' && <Results onPlayAgain={() => setRunNo((n) => n + 1)} />}
    </>
  );
}
