// client.js - the one shared Axios instance. Every API call goes through it.
// baseURL is /api/v1; in dev the Vite proxy sends it on to Express (see vite.config.js).
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1' });

// The JWT lives only in this variable (browser memory), never in localStorage, so a
// script injected into the page cannot read it from storage. Refreshing the page clears it.
let authToken = null;

export function setAuthToken(token) {
  authToken = token;
}

// Interceptor = a step every request passes through. This one attaches the ticket.
api.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

export default api;
