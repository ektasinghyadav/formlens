// app.js - builds the Express app (does not start listening; server.js does).
// Requirements: NFR-5.1 (module boundaries), NFR-5.2 (plain Express app).
// Keeping "build" and "listen" separate lets tests use the app without opening a port.
import express from 'express';
import authRoutes from './routes/auth.js';
import formRoutes from './routes/forms.js';
import sessionRoutes from './routes/sessions.js';
import eventRoutes from './routes/events.js';
import analyticsRoutes from './routes/analytics.js';

const app = express();

// Understand JSON request bodies.
app.use(express.json());

// CORS: only the React dev server (CLIENT_ORIGIN) may call the API from a browser.
// Written by hand (a few lines) to avoid adding a dependency outside the approved stack.
app.use((req, res, next) => {
  const origin = process.env.CLIENT_ORIGIN;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204); // browser "pre-flight" check
  next();
});

// All endpoints live under /api/v1 (SPEC section 6).
const api = express.Router();
api.get('/health', (req, res) => res.json({ status: 'ok' }));
api.use('/auth', authRoutes);
api.use('/forms', formRoutes);
api.use('/sessions', sessionRoutes);
api.use('/events', eventRoutes);
api.use('/analytics', analyticsRoutes);
app.use('/api/v1', api);

// Central error handler: one place that turns errors into JSON replies.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
});

export default app;
