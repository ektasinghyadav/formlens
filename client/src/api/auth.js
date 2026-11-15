// api/auth.js - Axios wrappers for the auth endpoints. Requirement: FR-8.1.
import api from './client.js';

export const register = (email, password) => api.post('/auth/register', { email, password });
export const login = (email, password) => api.post('/auth/login', { email, password });
export const getMe = () => api.get('/auth/me');
