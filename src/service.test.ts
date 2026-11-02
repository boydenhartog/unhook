import { describe, expect, it, vi, afterEach } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn(() => false) }));
afterEach(() => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(invoke).mockReset();
});
import {
  createService,
  createPreviewService,
  defaultSettings,
  normalizeDomain,
  validateSchedule,
} from './service';

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

describe('domain validation', () => {
  it('normalizes URLs and strips a single www alias', () => {
    expect(normalizeDomain(' https://www.YouTube.com/watch?v=123 ')).toBe('youtube.com');
  });
  it.each([
    'localhost',
    '127.0.0.1',
    '*.reddit.com',
    'https://user:pass@example.com',
    'example.com\nfacebook.com',
    'https://example.com:443',
    'example.com/path',
    'example.com?foo',
    'example.com#foo',
    'example.local',
    'example.localhost',
    'example.com\\path',
  ])('rejects unsafe or non-domain input %s', value => {
    expect(() => normalizeDomain(value)).toThrow();
  });
});

describe('preview sessions', () => {
  it('persists setup completion without claiming a real browser or system connection', async () => {
    const storage = memory();
    const service = createPreviewService(storage);
    expect((await service.getSetupStatus()).completed).toBe(false);
    await service.openBrowserSetup('brave');
    expect((await service.getSetupStatus()).browserConnected).toBe(false);
    await service.completeSetup();
    const setup = await createPreviewService(storage).getSetupStatus();
    expect(setup.completed).toBe(true);
    expect(setup.browserConnected).toBe(false);
    expect(setup.systemBlockingEnabled).toBe(false);
    expect((await service.startFocus(25)).systemActive).toBe(false);
    await expect(service.setSystemBlocking(true)).rejects.toThrow('desktop app');
  });
  it('preserves old preview settings and sessions while introducing setup', async () => {
    const storage = memory();
    storage.setItem(
      'unhook.preview.v1',
      JSON.stringify({
        settings: { ...defaultSettings(), domains: ['marktplaats.nl'] },
        manualEndsAt: 1_500_000,
        suppressedUntil: null,
      }),
    );
    const service = createPreviewService(storage, () => 1000);
    expect((await service.getStatus()).settings.domains).toEqual(['marktplaats.nl']);
    expect((await service.getStatus()).active).toBe(true);
    expect((await service.getSetupStatus()).completed).toBe(false);
  });
  it('restores a persisted manual session and expires it by wall clock', async () => {
    const storage = memory();
    let now = new Date(2026, 9, 5, 8, 0).getTime();
    const service = createPreviewService(storage, () => now);
    expect((await service.startFocus(25)).remainingSeconds).toBe(1500);
    now += 60_000;
    const restored = createPreviewService(storage, () => now);
    expect((await restored.getStatus()).remainingSeconds).toBe(1440);
    now += 24 * 60_000;
    expect((await restored.getStatus()).active).toBe(false);
  });
  it('system recovery leaves the browser preview session running', async () => {
    const service = createPreviewService(memory());
    await service.startFocus(25);
    expect((await service.restoreHosts()).active).toBe(true);
  });
  it('observes local weekday boundaries and lunch breaks', async () => {
    let now = new Date(2026, 9, 5, 9, 0).getTime();
    const service = createPreviewService(memory(), () => now);
    await service.saveSettings({
      ...defaultSettings(),
      schedule: { ...defaultSettings().schedule, enabled: true },
    });
    expect((await service.getStatus()).source).toBe('schedule');
    now = new Date(2026, 9, 5, 12, 30).getTime();
    expect((await service.getStatus()).active).toBe(false);
    now = new Date(2026, 9, 5, 13, 0).getTime();
    expect((await service.getStatus()).active).toBe(true);
    now = new Date(2026, 9, 10, 10, 0).getTime();
    expect((await service.getStatus()).active).toBe(false);
  });
  it('stopping scheduled focus suppresses both sides of the current day window', async () => {
    let now = new Date(2026, 9, 5, 10, 0).getTime();
    const storage = memory();
    const service = createPreviewService(storage, () => now);
    await service.saveSettings({
      ...defaultSettings(),
      schedule: { ...defaultSettings().schedule, enabled: true },
    });
    await service.stopFocus();
    now = new Date(2026, 9, 5, 14, 0).getTime();
    expect((await createPreviewService(storage, () => now).getStatus()).active).toBe(false);
    now = new Date(2026, 9, 6, 10, 0).getTime();
    expect((await service.getStatus()).source).toBe('schedule');
  });
  it('preserves state when preview storage cannot save a change', async () => {
    const service = createPreviewService({
      getItem: () => null,
      setItem: () => {
        throw new Error('Storage is full');
      },
    });
    await expect(service.startFocus(25)).rejects.toThrow('Storage is full');
    expect((await service.getStatus()).active).toBe(false);
  });
  it('resumes a stopped schedule after saving it disabled and enabled', async () => {
    const now = new Date(2026, 9, 5, 10, 0).getTime(),
      storage = memory();
    const service = createPreviewService(storage, () => now);
    const settings = {
      ...defaultSettings(),
      schedule: { ...defaultSettings().schedule, enabled: true },
    };
    await service.saveSettings(settings);
    await service.stopFocus();
    expect((await service.getStatus()).active).toBe(false);
    await service.saveSettings({ ...settings, schedule: { ...settings.schedule, enabled: false } });
    const resumed = await service.saveSettings(settings);
    expect(resumed.source).toBe('schedule');
    expect(resumed.remainingSeconds).toBe(2 * 3600 + 30 * 60);
    expect((await createPreviewService(storage, () => now).getStatus()).source).toBe('schedule');
  });
  it('keeps a stopped schedule paused when only the blocklist changes', async () => {
    const service = createPreviewService(memory(), () => new Date(2026, 9, 5, 10, 0).getTime());
    const settings = {
      ...defaultSettings(),
      schedule: { ...defaultSettings().schedule, enabled: true },
    };
    await service.saveSettings(settings);
    await service.stopFocus();
    expect((await service.saveSettings({ ...settings, domains: ['marktplaats.nl'] })).active).toBe(
      false,
    );
  });
  it('keeps the last domain until the manual session is ended', async () => {
    const service = createPreviewService(memory());
    await service.startFocus(25);
    await expect(service.saveSettings({ ...defaultSettings(), domains: [] })).rejects.toThrow(
      'Stop focus',
    );
    expect((await service.getStatus()).settings.domains).toHaveLength(5);
  });
  it('rejects duplicate days and ignores disabled break fields', () => {
    expect(() => validateSchedule({ ...defaultSettings().schedule, days: [0, 0] })).toThrow();
    expect(() =>
      validateSchedule({
        ...defaultSettings().schedule,
        breakEnabled: false,
        breakStart: 'bad',
        breakEnd: 'bad',
      }),
    ).not.toThrow();
  });
  it('validates duration, duplicates and invalid schedule before changing settings', async () => {
    const service = createPreviewService(memory());
    await expect(service.startFocus(0)).rejects.toThrow();
    await expect(
      service.saveSettings({
        ...defaultSettings(),
        domains: ['reddit.com', 'https://www.reddit.com'],
      }),
    ).rejects.toThrow();
    expect(() => validateSchedule({ ...defaultSettings().schedule, end: '08:00' })).toThrow();
    expect((await service.getStatus()).settings.domains).toEqual(defaultSettings().domains);
  });
});

describe('desktop setup actions', () => {
  it('requests the native login preference through its boolean contract', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const service = createService();
    await service.setLaunchAtLogin(true);
    expect(invoke).toHaveBeenLastCalledWith('set_launch_at_login', { enabled: true });
    await service.setLaunchAtLogin(false);
    expect(invoke).toHaveBeenLastCalledWith('set_launch_at_login', { enabled: false });
  });
  it('requests removal through the native service cleanup operation', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    await createService().uninstallSystemBlocker();
    expect(invoke).toHaveBeenCalledWith('uninstall_system_blocker');
  });
  it('does not claim login registration or remove native services in preview', async () => {
    const service = createPreviewService(memory());
    await service.startFocus(25);
    await expect(service.setLaunchAtLogin(true)).rejects.toThrow('desktop app');
    expect((await service.getSetupStatus()).login.state).toBe('unavailable');
    await expect(service.uninstallSystemBlocker()).rejects.toThrow('desktop app');
    expect((await service.getStatus()).active).toBe(true);
  });
});
