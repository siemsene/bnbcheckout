import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { GameFlow } from './screens/student/GameFlow';
import { JoinScreen } from './screens/student/JoinScreen';
import { SessionGame } from './screens/student/SessionGame';
import { InstructorAuth } from './screens/instructor/InstructorAuth';
import { Dashboard } from './screens/instructor/Dashboard';
import { SessionMonitor } from './screens/instructor/SessionMonitor';
import { AdminApprovals } from './screens/admin/AdminApprovals';
import { firebaseEnabled } from './firebase/client';
import './styles/theme.css';

function Landing() {
  return (
    <div className="overlay" style={{ background: 'var(--bg)' }}>
      <div className="overlay-card">
        <h1 style={{ fontSize: '2.4rem' }}>Checkout Rush</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          A project-management simulation: five friends, one Airbnb, two hours.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          <Link to="/join">
            <button className="btn-big" disabled={!firebaseEnabled}>
              Join a class session
            </button>
          </Link>
          <Link to="/play">
            <button className="btn-big btn-ghost">Practice run</button>
          </Link>
        </div>
        <p style={{ marginTop: 26, fontSize: '0.85rem' }}>
          <Link to="/instructor" style={{ color: 'var(--ink-soft)' }}>
            Instructor sign-in
          </Link>
        </p>
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
        <Route path="/join" element={<JoinScreen />} />
        <Route path="/session" element={<SessionGame />} />
        <Route path="/instructor/auth" element={<InstructorAuth />} />
        <Route path="/instructor" element={<Dashboard />} />
        <Route path="/instructor/session/:sessionId" element={<SessionMonitor />} />
        <Route path="/admin" element={<AdminApprovals />} />
      </Routes>
    </BrowserRouter>
  );
}
