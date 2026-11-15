// middleware/auth.js - the "ticket check" for protected routes.
// Requirements: FR-8.1, NFR-3.1. Built in Sprint 1.
// Reads "Authorization: Bearer <jwt>", verifies the signature and expiry, and puts the
// admin's id on req.adminId for later steps (e.g. ownership checks in Sprint 2).
// Any problem -> 401 with one generic message (we don't tell attackers why it failed).
import jwt from 'jsonwebtoken';

export default function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.adminId = payload.adminId;
    next();
  } catch {
    // bad signature, malformed token, or expired: all look the same to the caller
    res.status(401).json({ error: 'Authentication required' });
  }
}
