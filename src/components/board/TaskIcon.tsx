// Hand-authored SVG task icons — uniform stroke, CSS-recolorable, with <title>
// for accessibility. (Per the asset routing table, icons are never generated.)

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const PATHS: Record<string, { title: string; el: React.ReactNode }> = {
  'strip-beds': {
    title: 'Strip beds',
    el: (
      <>
        <path {...STROKE} d="M3 17v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" />
        <path {...STROKE} d="M3 17h18M6 9V7m4 4c3-3 8 1 11-2" />
      </>
    ),
  },
  'make-breakfast': {
    title: 'Make breakfast',
    el: (
      <>
        <circle {...STROKE} cx="10" cy="13" r="6" />
        <path {...STROKE} d="M16 13h6M10 4v2m-4-1 1 2m7-2-1 2" />
      </>
    ),
  },
  'eat-breakfast': {
    title: 'Eat together',
    el: (
      <>
        <circle {...STROKE} cx="12" cy="12" r="5" />
        <path {...STROKE} d="M4 6v6m-1.5-6v3a1.5 1.5 0 0 0 3 0V6M20 6v12m0-12c-1.5 1-2 2.5-2 4h2" />
      </>
    ),
  },
  'clean-bedroom-1': { title: 'Clean bedroom 1', el: broom('1') },
  'clean-bedroom-2': { title: 'Clean bedroom 2', el: broom('2') },
  'clean-bedroom-3': { title: 'Clean bedroom 3', el: broom('3') },
  'clean-bathroom': {
    title: 'Clean bathroom',
    el: (
      <>
        <path {...STROKE} d="M4 12h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-2Z" />
        <path {...STROKE} d="M6 12V6a2 2 0 0 1 4 0M14 8l.7 1.5L16 10l-1.3.5L14 12l-.7-1.5L12 10l1.3-.5L14 8Z" />
      </>
    ),
  },
  'tidy-kitchen': {
    title: 'Tidy kitchen',
    el: (
      <>
        <circle {...STROKE} cx="12" cy="12" r="7" />
        <circle {...STROKE} cx="12" cy="12" r="3.5" />
        <path {...STROKE} d="M19 19l2 2" />
      </>
    ),
  },
  'clean-living-room': {
    title: 'Clean living room',
    el: (
      <>
        <path {...STROKE} d="M4 16v-4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
        <path {...STROKE} d="M4 16h16M6 10V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2M6 16v2m12-2v2" />
      </>
    ),
  },
  'pack-bag-1': { title: 'Pack luggage 1', el: bag() },
  'pack-bag-2': { title: 'Pack luggage 2', el: bag() },
  'pack-bag-3': { title: 'Pack luggage 3', el: bag() },
  'fetch-car-a': { title: 'Fetch car A', el: car('A') },
  'fetch-car-b': { title: 'Fetch car B', el: car('B') },
  'buy-snacks': {
    title: 'Buy snacks',
    el: (
      <>
        <path {...STROKE} d="M5 8h14l-1.5 12h-11L5 8Z" />
        <path {...STROKE} d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
  },
  'load-car-a': { title: 'Load car A', el: loadCar('A') },
  'load-car-b': { title: 'Load car B', el: loadCar('B') },
  garbage: {
    title: 'Take out garbage',
    el: (
      <>
        <path {...STROKE} d="M6 7h12l-1 13H7L6 7Z" />
        <path {...STROKE} d="M4 7h16M10 7V5h4v2m-4 4v6m4-6v6" />
      </>
    ),
  },
  'final-walkthrough': {
    title: 'Final walkthrough',
    el: (
      <>
        <circle {...STROKE} cx="8" cy="8" r="3.5" />
        <path {...STROKE} d="M8 11.5V20m0-5h6m-6 3h4M15 5l1 1 3-3" />
      </>
    ),
  },
};

function broom(n: string) {
  return (
    <>
      <path {...STROKE} d="M14 3 8 12" />
      <path {...STROKE} d="M8 12c-3 1-4 4-4 7 3 0 6-1 7-4l-3-3Z" />
      <text x="16" y="20" fontSize="9" fontWeight="700" fill="currentColor">
        {n}
      </text>
    </>
  );
}

function bag() {
  return (
    <>
      <rect {...STROKE} x="5" y="8" width="14" height="12" rx="2" />
      <path {...STROKE} d="M9 8V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3M5 13h14" />
    </>
  );
}

function loadCar(label: string) {
  return (
    <>
      <rect {...STROKE} x="3" y="11" width="7" height="7" rx="1" />
      <rect {...STROKE} x="6" y="5" width="6" height="6" rx="1" />
      <path {...STROKE} d="M13 15h7m-3.5-3.5V15" />
      <text x="14" y="9" fontSize="8" fontWeight="700" fill="currentColor">
        {label}
      </text>
    </>
  );
}

function car(label: string) {
  return (
    <>
      <path {...STROKE} d="M4 16v-3l2-5h10l3 5v3" />
      <path {...STROKE} d="M4 16h17M7 16v2m11-2v2" />
      <text x="10" y="14" fontSize="8" fontWeight="700" fill="currentColor">
        {label}
      </text>
    </>
  );
}

export function TaskIcon({ taskId }: { taskId: string }) {
  const spec = PATHS[taskId];
  if (!spec) return <div className="task-icon" />;
  return (
    <svg className="task-icon" viewBox="0 0 24 24" role="img" aria-hidden>
      <title>{spec.title}</title>
      {spec.el}
    </svg>
  );
}
