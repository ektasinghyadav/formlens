// ProtectedRoute.jsx - the bouncer for admin pages. Requirements: FR-8.1, NFR-3.1.
// Not logged in -> redirect to /login. Logged in -> show a small top bar + the page.
// NOTE: this only hides pages. The real protection is the server's 401 (middleware/auth.js).
import { Navigate, Outlet, useLocation } from 'react-router-dom';
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
      <header className="flex items-center justify-between bg-gray-100 px-6 py-3">
        <span className="text-sm text-gray-700">Signed in as {admin.email}</span>
        <button type="button" onClick={logout} className="rounded border border-gray-400 px-3 py-1 text-sm">
          Log out
        </button>
      </header>
      <Outlet />
    </>
  );
}
