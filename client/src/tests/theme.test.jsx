// @vitest-environment jsdom
// Light/dark toggle tests. (post-sprint UI change, D-27)
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { storedTheme } from '../theme.js';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  window.matchMedia = () => ({ matches: false }); // the computer prefers light
});
afterEach(cleanup);

describe('ThemeToggle', () => {
  it('starts from the computer setting, flips on click, and remembers the choice', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(storedTheme()).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(storedTheme()).toBe('light');
  });

  it('offers light mode when the computer prefers dark', () => {
    window.matchMedia = () => ({ matches: true });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy();
  });

  it('still works when storage is blocked', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
    try {
      render(<ThemeToggle />);
      fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally { Storage.prototype.setItem = real; }
  });
});
