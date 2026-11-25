import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { GameFlow } from './screens/student/GameFlow';
import { JoinScreen } from './screens/student/JoinScreen';
import { SessionGame } from './screens/student/SessionGame';
import { InstructorAuth } from './screens/instructor/InstructorAuth';
import { Dashboard } from './screens/instructor/Dashboard';
import { SessionMonitor } from './screens/instructor/SessionMonitor';
import { AdminApprovals } from './screens/admin/AdminApprovals';
import { AdminUsage } from './screens/admin/AdminUsage';
import { firebaseEnabled } from './firebase/client';
import { Shell } from './components/brand/Shell';
import './styles/theme.css';

// The register form lives behind the sign-in card, so link straight to it.
const REGISTER_PATH = '/instructor/auth?mode=register';

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
        <>
          <Link to="/instructor" className="btn-ghost" style={{ padding: '8px 16px', borderRadius: 10, textDecoration: 'none' }}>
            Instructor sign-in
          </Link>
          <Link to={REGISTER_PATH} className="nav-cta">
            Register as an instructor
          </Link>
        </>
      }
    >
      <section className="hero">
        <img
          src="/assets/brand/hero-house.webp"
          alt="A cosy countryside cottage at eight in the morning, two cars on the gravel driveway and luggage waiting by the open front door"
        />
        <div className="hero-body">
          <h1>Five friends. One Airbnb. Two hours.</h1>
          <p>
            Checkout is at 10:00 sharp. Assign your team, discover the constraints
            the hard way, and find out what parallel actually costs.
          </p>
          <div className="hero-cta">
            {firebaseEnabled ? (
              <Link to="/join" className="btn-link btn-big">
                Join a class session
              </Link>
            ) : (
              <span className="btn-link btn-big" aria-disabled="true">
                Join a class session
              </span>
            )}
            <Link to="/play" className="btn-link btn-big btn-ghost">
              Try a practice run
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

      <section className="signup-band" aria-labelledby="signup-band-title">
        <div>
          <h2 id="signup-band-title">Teaching this term? Run it with your class.</h2>
          <p>
            An instructor account lets you open a session, watch every team plan in
            real time, and keep the Gantt and utilisation charts for the debrief.
            Register once — we verify your email, then the site admin approves you.
          </p>
        </div>
        <div className="signup-band-cta">
          {firebaseEnabled ? (
            <Link to={REGISTER_PATH} className="btn-link btn-big">
              Register as an instructor
            </Link>
          ) : (
            <span className="btn-link btn-big" aria-disabled="true">
              Register as an instructor
            </span>
          )}
          {firebaseEnabled ? (
            <span>
              Already have an account? <Link to="/instructor">Sign in</Link>
            </span>
          ) : (
            <span role="status">
              Instructor accounts aren’t configured on this deployment.
            </span>
          )}
        </div>
      </section>
    </Shell>
  );
}

function NotFound() {
  return (
    <Shell>
      <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <h1 style={{ marginTop: 0 }}>Page not found</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          That link doesn’t lead anywhere. Students join with a code from the
          classroom screen.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/join" className="btn-link">
            Join a session
          </Link>
          <Link to="/" className="btn-link btn-ghost">
            Home
          </Link>
        </div>
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
        <Route path="/admin/usage" element={<AdminUsage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
