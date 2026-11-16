// ProtectedRoute.jsx - the bouncer for admin pages. Requirements: FR-8.1, NFR-3.1.
// Not logged in -> redirect to /login. Logged in -> show a small top bar + the page.
// NOTE: this only hides pages. The real protection is the server's 401 (middleware/auth.js).
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import Brand from '../Brand.jsx';
import { useAuth } from './AuthContext.jsx';

export default function ProtectedRoute() {
  const { admin, logout } = useAuth();
  const location = useLocation();

  if (!admin) {
    // remember where they wanted to go, so login can send them back there
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <>
      <header className="bar">
        <div className="bar-inner">
          <Link to="/admin/forms" className="brand" aria-label="FormLens, your forms"><Brand /></Link>
          <nav className="bar-nav" aria-label="Main">
            <Link to="/admin/forms" className="link link-quiet">Forms</Link>
          </nav>
          <div className="bar-user">
            <span>Signed in as {admin.email}</span>
            <button type="button" onClick={logout} className="btn btn-quiet btn-small">Log out</button>
          </div>
        </div>
      </header>
      <Outlet />
    </>
  );
}
