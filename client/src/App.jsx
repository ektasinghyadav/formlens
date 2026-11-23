// App.jsx - the route table (which URL shows which page). Placeholders until later sprints.
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Auth/Login.jsx';
import FormList from './components/FormBuilder/FormList.jsx';
import FormEditor from './components/FormBuilder/FormEditor.jsx';
import FormFill from './components/FormFill/FormFill.jsx';
import ProtectedRoute from './components/Auth/ProtectedRoute.jsx';

// The dashboard (and the chart library it needs) is only downloaded when an admin opens it,
// so respondents opening a form never pay for it (NFR-1.1).
const Dashboard = lazy(() => import('./components/Dashboard/Dashboard.jsx'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* everything under /admin needs a login (FR-8.1) */}
      <Route element={<ProtectedRoute />}>
        <Route path="/admin/forms" element={<FormList />} />
        <Route path="/admin/forms/:id/view" element={<FormFill preview />} />
        <Route path="/admin/forms/:id/edit" element={<FormEditor />} />
        <Route path="/admin/forms/:id/dashboard" element={<Suspense fallback={<p className="p-6">Loading…</p>}><Dashboard /></Suspense>} />
      </Route>
      <Route path="/f/:shareLink" element={<FormFill />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
