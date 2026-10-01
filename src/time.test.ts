import { describe, expect, it } from 'vitest';
import { remainingFocusSeconds } from './time';

describe('focus countdown', () => {
  it('does not add a second when the render clock predates a new session', () => {
    expect(remainingFocusSeconds(1_500_500, 1500, 0)).toBe(1500);
  });
  it('counts down between status polls and stops at zero', () => {
    expect(remainingFocusSeconds(1_500_000, 1500, 1250)).toBe(1499);
    expect(remainingFocusSeconds(1_500_000, 1, 1_502_000)).toBe(0);
  });
});
