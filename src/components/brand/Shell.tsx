// Shared page frame for the non-game screens (landing, dashboard, admin), so
// they read as one product rather than three unrelated pages.

import { Link } from 'react-router-dom';
import { Logo } from './Logo';

export function Shell({
  children,
  tagline,
  nav,
}: {
  children: React.ReactNode;
  tagline?: string;
  nav?: React.ReactNode;
}) {
  return (
    <div className="shell">
      <header className="shell-bar">
        <Link to="/" className="brand" aria-label="Checkout Rush home">
          <Logo size={38} tagline={tagline} />
        </Link>
        {nav && <nav>{nav}</nav>}
      </header>
      <main className="shell-main">{children}</main>
      <footer className="shell-foot">
        Checkout Rush — a project-management simulation for the classroom.
      </footer>
    </div>
  );
}
