// The Checkout Rush mark, hand-authored so it stays crisp at every size and
// recolours with the theme. Same geometry as public/favicon.svg — keep them in
// step if either changes.

export function LogoMark({
  size = 40,
  badge = true,
}: {
  size?: number;
  /** Draw the rounded-square plate behind the house (off for dark surfaces). */
  badge?: boolean;
}) {
  const house = badge ? 'var(--bg-panel)' : 'var(--bg-deep)';
  const cut = badge ? 'var(--bg-deep)' : 'var(--bg)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Checkout Rush"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {badge && <rect width="64" height="64" rx="15" fill="var(--bg-deep)" />}
      <path d="M32 12 56 33H8Z" fill={house} />
      <path d="M14 33h36v17a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z" fill={house} />
      {/* Door sits left of centre so the clock never clips it. */}
      <rect x="21" y="40" width="9" height="13" rx="2.5" fill={cut} />
      <circle cx="47" cy="45" r="12.5" fill={cut} />
      <circle cx="47" cy="45" r="9.5" fill="var(--accent-warm)" />
      <g stroke={cut} strokeWidth="2.4" strokeLinecap="round">
        <path d="M47 45V39.5" />
        <path d="M47 45l-4 3" />
      </g>
    </svg>
  );
}

/** Mark + wordmark, for page headers. */
export function Logo({
  size = 40,
  badge = true,
  tagline,
}: {
  size?: number;
  badge?: boolean;
  tagline?: string;
}) {
  return (
    <span className="brand">
      <LogoMark size={size} badge={badge} />
      <span className="brand-text">
        <span className="brand-name">Checkout Rush</span>
        {tagline && <span className="brand-tagline">{tagline}</span>}
      </span>
    </span>
  );
}
