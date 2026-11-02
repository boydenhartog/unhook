import { describe, expect, it } from 'vitest';
import { defaultSettings } from './service';
import { remainingFocusSeconds, scheduleSummary } from './time';

describe('schedule summary', () => {
  it('summarizes the standard workweek', () => {
    expect(scheduleSummary(defaultSettings().schedule)).toBe('Monday–Friday · 09:00–17:00');
  });

  it('lists other day selections in their stored order', () => {
    const schedule = {
      ...defaultSettings().schedule,
      days: [6, 0, 2],
      start: '08:30',
      end: '16:00',
    };
    expect(scheduleSummary(schedule)).toBe('Sun, Mon, Wed · 08:30–16:00');
  });
});

describe('focus countdown', () => {
  it('does not add a second when the render clock predates a new session', () => {
    expect(remainingFocusSeconds(1_500_500, 1500, 0)).toBe(1500);
  });
  it('counts down between status polls and stops at zero', () => {
    expect(remainingFocusSeconds(1_500_000, 1500, 1250)).toBe(1499);
    expect(remainingFocusSeconds(1_500_000, 1, 1_502_000)).toBe(0);
  });
});
