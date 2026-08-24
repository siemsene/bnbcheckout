import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { GameFlow } from './screens/student/GameFlow';
import './styles/theme.css';

function Landing() {
  return (
    <div className="overlay" style={{ background: 'var(--bg)' }}>
      <div className="overlay-card">
        <h1 style={{ fontSize: '2.4rem' }}>Checkout Rush</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          A project-management simulation: five friends, one Airbnb, two hours.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20 }}>
          <Link to="/play">
            <button className="btn-big">Practice run</button>
          </Link>
          <button className="btn-big btn-ghost" disabled title="Coming soon">
            Join a class session
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/play" element={<GameFlow />} />
      </Routes>
    </BrowserRouter>
  );
}
