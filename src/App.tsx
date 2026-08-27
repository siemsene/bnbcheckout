import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { GameFlow } from './screens/student/GameFlow';
import { JoinScreen } from './screens/student/JoinScreen';
import { SessionGame } from './screens/student/SessionGame';
import { InstructorAuth } from './screens/instructor/InstructorAuth';
import { Dashboard } from './screens/instructor/Dashboard';
import { SessionMonitor } from './screens/instructor/SessionMonitor';
import { AdminApprovals } from './screens/admin/AdminApprovals';
import { firebaseEnabled } from './firebase/client';
import { Shell } from './components/brand/Shell';
import './styles/theme.css';

const FEATURES = [
  {
    icon: '🔗',
    title: 'Precedence, the hard way',
    body: 'You can’t clean a bedroom before the beds are stripped. Eighteen tasks, and the dependencies bite.',
  },
  {
    icon: '🚗',
    title: 'Constraints you have to discover',
    body: 'Only two of the five can drive. One vacuum. The rules aren’t listed — your friends complain instead.',
  },
  {
    icon: '⏱️',
    title: 'Two hours in fifteen minutes',
    body: 'The whole class plans together, then races the same clock. Nobody can pause it.',
  },
  {
    icon: '📊',
    title: 'A debrief worth having',
    body: 'Every run ends in a Gantt chart of who did what, plus utilisation against finish time for the class.',
  },
];

function Landing() {
  return (
    <Shell
      nav={
        <Link to="/instructor" className="btn-ghost" style={{ padding: '8px 16px', borderRadius: 10, textDecoration: 'none' }}>
          Instructor sign-in
        </Link>
      }
    >
      <section className="hero">
        <img
          src="/assets/brand/hero-house.jpg"
          alt="A cosy countryside cottage at eight in the morning, two cars on the gravel driveway and luggage waiting by the open front door"
        />
        <div className="hero-body">
          <h1>Five friends. One Airbnb. Two hours.</h1>
          <p>
            Checkout is at 10:00 sharp. Assign your team, discover the constraints
            the hard way, and find out what parallel actually costs.
          </p>
          <div className="hero-cta">
            <Link to="/join">
              <button className="btn-big" disabled={!firebaseEnabled}>
                Join a class session
              </button>
            </Link>
            <Link to="/play">
              <button className="btn-big btn-ghost">Try a practice run</button>
            </Link>
          </div>
          {!firebaseEnabled && (
            <p style={{ fontSize: '0.8rem' }} role="status">
              Class sessions aren’t configured on this deployment — practice mode
              works offline.
            </p>
          )}
        </div>
      </section>

      <div className="feature-grid">
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <div className="feature-icon" aria-hidden>
              {f.icon}
            </div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>
    </Shell>
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
