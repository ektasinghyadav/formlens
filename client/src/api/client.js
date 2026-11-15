// client.js - the one shared Axios instance. Every API call goes through it.
// baseURL is /api/v1; in dev the Vite proxy sends it on to Express (see vite.config.js).
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1' });

export default api;
