// Upload middleware tests. Requirements: FR-1.1, FR-1.2. (Sprint 2)
// The middleware is mounted on a tiny throwaway app, since no real route uses it yet.
import { describe, it, expect, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rm } from 'node:fs/promises';
import { makeUpload, UPLOAD_DIR } from '../middleware/upload.js';

const app = express();
app.post('/up', makeUpload(1), (req, res) => res.json({ stored: req.file.filename, size: req.file.size }));
app.use((err, req, res, next) => res.status(500).json({ error: 'unexpected' })); // eslint-disable-line no-unused-vars

const saved = [];
afterAll(async () => {
  for (const name of saved) await rm(`${UPLOAD_DIR}${name}`, { force: true });
});

describe('makeUpload(1) - 1 MB limit', () => {
  it('accepts a small file and stores it under a random name', async () => {
    const res = await request(app).post('/up').attach('file', Buffer.alloc(1000, 'a'), '../../evil.txt');
    expect(res.status).toBe(200);
    saved.push(res.body.stored);
    expect(res.body.stored).toMatch(/^[0-9a-f-]{36}$/); // not the visitor's file name
    expect(res.body.size).toBe(1000);
  });

  it('rejects a file over the limit with HTTP 400', async () => {
    const res = await request(app).post('/up').attach('file', Buffer.alloc(2 * 1024 * 1024, 'a'), 'big.bin');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('too large');
  });
});
