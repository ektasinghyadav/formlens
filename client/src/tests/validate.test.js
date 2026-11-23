// Unit tests for the respondent-side checks. Requirement: FR-2.2. (Sprint 3)
import { describe, it, expect } from 'vitest';
import { validateAnswer } from '../components/FormFill/validate.js';

const field = (type, extra = {}) => ({ field_type: type, is_required: false, validations: null, ...extra });

describe('validateAnswer', () => {
  it('requires a value only when the field is required', () => {
    expect(validateAnswer(field('text', { is_required: true }), '   ')).toMatch(/required/);
    expect(validateAnswer(field('text'), '')).toBe('');
  });
  it('checks email format, for email fields and for text fields set to email', () => {
    expect(validateAnswer(field('email'), 'nope')).toMatch(/valid email/);
    expect(validateAnswer(field('email'), 'a@b.co')).toBe('');
    expect(validateAnswer(field('text', { validations: { format: 'email' } }), 'nope')).toMatch(/valid email/);
  });
  it('rejects email shapes that only look right', () => {
    for (const bad of ['a@b', 'a@b.c', 'a@@b.com', 'a b@c.com', 'a@b..com', '.a@b.com', 'a@b.com.']) {
      expect(validateAnswer(field('email'), bad), bad).toMatch(/valid email/);
    }
    for (const ok of ['a@b.co', 'first.last@mail.example.org', 'x+tag@site.in']) expect(validateAnswer(field('email'), ok), ok).toBe('');
  });
  it('checks a 10-digit phone number', () => {
    const phone = field('text', { validations: { format: 'phone' } });
    for (const bad of ['98765', '98765432101', '98765 43210', '+919876543210', '98765abc10', '12345.6789']) {
      expect(validateAnswer(phone, bad), bad).toMatch(/10-digit/);
    }
    expect(validateAnswer(phone, '9876543210')).toBe('');
    expect(validateAnswer(phone, '')).toBe(''); // optional and empty is fine
  });
  it('checks numbers', () => {
    expect(validateAnswer(field('number'), 'abc')).toMatch(/number/);
    expect(validateAnswer(field('number'), '-12.5')).toBe('');
  });
  it('only accepts listed dropdown options', () => {
    const f = field('dropdown', { validations: { options: ['a', 'b'] } });
    expect(validateAnswer(f, 'c')).toMatch(/listed options/);
    expect(validateAnswer(f, 'a')).toBe('');
  });
  it('checks file size against the field limit', () => {
    const f = field('file', { validations: { maxFileSizeMB: 1 } });
    expect(validateAnswer(f, '', { size: 2 * 1024 * 1024 })).toMatch(/too large/);
    expect(validateAnswer(f, '', { size: 1000 })).toBe('');
    expect(validateAnswer({ ...f, is_required: true }, '', undefined)).toMatch(/required/);
  });
});
