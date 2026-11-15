// Smoke test: the Axios instance points at the versioned API path. (Sprint 0)
import { describe, it, expect } from 'vitest';
import api from '../api/client.js';

describe('api client', () => {
  it('uses /api/v1 as base URL', () => {
    expect(api.defaults.baseURL).toBe('/api/v1');
  });
});
