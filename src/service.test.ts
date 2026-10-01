import { describe, expect, it } from 'vitest';
import { createPreviewService, defaultSettings, normalizeDomain, validateSchedule } from './service';

const memory = () => { const values = new Map<string,string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key,value); } }; };

describe('domain validation', () => {
  it('normalizes URLs and strips a single www alias', () => {
    expect(normalizeDomain(' https://www.YouTube.com/watch?v=123 ')).toBe('youtube.com');
  });
  it.each(['localhost', '127.0.0.1', '*.reddit.com', 'https://user:pass@example.com', 'example.com\nfacebook.com', 'https://example.com:443', 'example.com/path', 'example.com?foo', 'example.com#foo', 'example.local', 'example.localhost', 'example.com\\path'])('rejects unsafe or non-domain input %s', value => {
    expect(() => normalizeDomain(value)).toThrow();
  });
});

describe('preview sessions', () => {
  it('restores a persisted manual session and expires it by wall clock', async () => {
    const storage = memory(); let now = new Date(2026, 9, 5, 8, 0).getTime();
    const service = createPreviewService(storage, () => now);
    expect((await service.startFocus(25)).remainingSeconds).toBe(1500);
    now += 60_000;
    const restored = createPreviewService(storage, () => now);
    expect((await restored.getStatus()).remainingSeconds).toBe(1440);
    now += 24 * 60_000;
    expect((await restored.getStatus()).active).toBe(false);
  });
  it('observes local weekday boundaries and lunch breaks', async () => {
    let now = new Date(2026, 9, 5, 9, 0).getTime();
    const service = createPreviewService(memory(), () => now);
    await service.saveSettings({ ...defaultSettings(), schedule: { ...defaultSettings().schedule, enabled: true } });
    expect((await service.getStatus()).source).toBe('schedule');
    now = new Date(2026, 9, 5, 12, 30).getTime();
    expect((await service.getStatus()).active).toBe(false);
    now = new Date(2026, 9, 5, 13, 0).getTime();
    expect((await service.getStatus()).active).toBe(true);
    now = new Date(2026, 9, 10, 10, 0).getTime();
    expect((await service.getStatus()).active).toBe(false);
  });
  it('stopping scheduled focus suppresses both sides of the current day window', async () => {
    let now = new Date(2026, 9, 5, 10, 0).getTime(); const storage = memory();
    const service = createPreviewService(storage, () => now);
    await service.saveSettings({ ...defaultSettings(), schedule: { ...defaultSettings().schedule, enabled: true } });
    await service.stopFocus();
    now = new Date(2026, 9, 5, 14, 0).getTime();
    expect((await createPreviewService(storage, () => now).getStatus()).active).toBe(false);
    now = new Date(2026, 9, 6, 10, 0).getTime();
    expect((await service.getStatus()).source).toBe('schedule');
  });
  it('preserves state when preview storage cannot save a change', async () => {
    const service = createPreviewService({ getItem: () => null, setItem: () => { throw new Error('Storage is full'); } });
    await expect(service.startFocus(25)).rejects.toThrow('Storage is full');
    expect((await service.getStatus()).active).toBe(false);
  });
  it('keeps the last domain until the manual session is ended', async () => {
    const service = createPreviewService(memory());
    await service.startFocus(25);
    await expect(service.saveSettings({ ...defaultSettings(), domains: [] })).rejects.toThrow('Stop focus');
    expect((await service.getStatus()).settings.domains).toHaveLength(5);
  });
  it('rejects duplicate days and ignores disabled break fields', () => {
    expect(() => validateSchedule({ ...defaultSettings().schedule, days: [0, 0] })).toThrow();
    expect(() => validateSchedule({ ...defaultSettings().schedule, breakEnabled: false, breakStart: 'bad', breakEnd: 'bad' })).not.toThrow();
  });
  it('validates duration, duplicates and invalid schedule before changing settings', async () => {
    const service = createPreviewService(memory());
    await expect(service.startFocus(0)).rejects.toThrow();
    await expect(service.saveSettings({ ...defaultSettings(), domains: ['reddit.com', 'https://www.reddit.com'] })).rejects.toThrow();
    expect(() => validateSchedule({ ...defaultSettings().schedule, end: '08:00' })).toThrow();
    expect((await service.getStatus()).settings.domains).toEqual(defaultSettings().domains);
  });
});
