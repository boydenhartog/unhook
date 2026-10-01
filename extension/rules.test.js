import { describe, expect, it } from 'vitest';
import { effectiveState, makeRules, blockedDomain } from './rules.js';

const now = 1_000_000;
const active = { version: 1, domains: ['marktplaats.nl'], active: true, endsAt: now + 60_000, updatedAt: now };

describe('app-controlled browser blocking', () => {
  it('blocks the exact website and www alias without matching lookalike domains', () => {
    const state = effectiveState(active, now);
    expect(blockedDomain('https://www.marktplaats.nl/listing', state)).toBe('marktplaats.nl');
    expect(blockedDomain('https://marktplaats.nl/', state)).toBe('marktplaats.nl');
    expect(blockedDomain('https://marktplaats.nl.:443/', state)).toBe('marktplaats.nl');
    expect(blockedDomain('https://marktplaats.nl.example.com/', state)).toBeNull();
    expect(blockedDomain('https://help.marktplaats.nl/', state)).toBeNull();
    expect(blockedDomain('https://example.com/?marktplaats.nl', state)).toBeNull();
    expect(makeRules(state)).toHaveLength(2);
    expect(makeRules(state)[0].condition.regexFilter).toBe('^https?://(www\\.)?marktplaats\\.nl\\.?(:[0-9]+)?/');
  });
  it('releases blocks on stop, deadline, and a stale or absent launcher', () => {
    for (const state of [null, { ...active, active: false }, { ...active, endsAt: now }, { ...active, updatedAt: now - 15_001 }]) {
      expect(makeRules(effectiveState(state, now))).toEqual([]);
    }
  });
  it('rejects malformed bridge data instead of generating broad rules', () => {
    for (const state of [{ ...active, domains: ['.*'] }, { ...active, domains: ['example.com/path'] }, { ...active, version: 2 }, { ...active, endsAt: null }, { ...active, updatedAt: now + 1000 }]) {
      expect(() => effectiveState(state, now)).toThrow();
    }
  });
});
