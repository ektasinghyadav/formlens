// App.jsx - the route table (which URL shows which page). Placeholders until later sprints.
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Auth/Login.jsx';
import FormList from './components/FormBuilder/FormList.jsx';
import FormEditor from './components/FormBuilder/FormEditor.jsx';
import Dashboard from './components/Dashboard/Dashboard.jsx';
import FormFill from './components/FormFill/FormFill.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin/forms" element={<FormList />} />
      <Route path="/admin/forms/:id/edit" element={<FormEditor />} />
      <Route path="/admin/forms/:id/dashboard" element={<Dashboard />} />
      <Route path="/f/:shareLink" element={<FormFill />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
