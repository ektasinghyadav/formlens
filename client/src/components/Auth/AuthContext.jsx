// AuthContext.jsx - holds "who is logged in" for the whole app. Requirement: FR-8.1.
// React context = a shared box any component can read, so we don't pass props down by hand.
// The token is kept in memory only (see api/client.js): refresh the page and you log in again.
import { createContext, useContext, useState } from 'react';
import { login as apiLogin, getMe } from '../../api/auth.js';
import { setAuthToken } from '../../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null); // { adminId, email } or null

  async function login(email, password) {
    const { data } = await apiLogin(email, password);
    setAuthToken(data.token);
    const me = await getMe(); // also proves the token works
    setAdmin(me.data);
  }

  function logout() {
    setAuthToken(null);
    setAdmin(null);
  }

  return <AuthContext.Provider value={{ admin, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
