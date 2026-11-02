import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createReflectionStore, installReflectionMessages } from './reflection.js';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const sender = url => ({
  id: 'test',
  tab: { id: 1 },
  frameId: 0,
  url: url ?? 'chrome-extension://test/blocked.html',
});
function fixture() {
  const saved = {};
  const listeners = [];
  let now = new Date(2026, 9, 5, 11, 0);
  let nextId = 1000;
  const options = { now: () => now, createId: () => id(nextId++) };
  const api = {
    storage: {
      local: {
        get: vi.fn(async key => structuredClone({ [key]: saved[key] })),
        set: vi.fn(async values => Object.assign(saved, structuredClone(values))),
      },
    },
    runtime: {
      id: 'test',
      getURL: path => `chrome-extension://test/${path}`,
      onMessage: { addListener: listener => listeners.push(listener) },
    },
  };
  const request = (message, origin = sender()) =>
    new Promise(resolve => {
      const handled = listeners[0](message, origin, resolve);
      if (!handled) resolve(undefined);
    });
  return {
    api,
    saved,
    request,
    options,
    setNow: date => {
      now = date;
    },
  };
}
const empty = { day: '2026-10-05', tasks: [], currentTaskId: null, attempts: 0 };

describe('daily reflection storage', () => {
  it('starts today fresh and persists trimmed tasks across worker restarts', async () => {
    const { api, options } = fixture();
    const store = createReflectionStore(api, options);
    expect(await store.read()).toEqual(empty);
    expect(await store.visit(id(1))).toEqual({ ...empty, attempts: 1 });
    const added = await store.add('  Finish my proposal  ');
    expect(added.tasks).toEqual([
      { id: id(1000), text: 'Finish my proposal', day: empty.day, completed: false },
    ]);
    expect(added.currentTaskId).toBe(id(1000));
    expect(await createReflectionStore(api, options).read()).toEqual(added);
  });

  it('resets the current task and pauses at local midnight and offers unfinished carry-over only', async () => {
    const { api, options, setNow } = fixture();
    const store = createReflectionStore(api, options);
    await store.visit(id(1));
    await store.add('Completed yesterday');
    await store.complete(id(1000));
    await store.add('Unfinished yesterday');
    setNow(new Date(2026, 9, 6, 0, 0));
    const today = await store.read();
    expect(today).toEqual({
      day: '2026-10-06',
      tasks: [{ id: id(1001), text: 'Unfinished yesterday', day: '2026-10-05', completed: false }],
      currentTaskId: null,
      attempts: 0,
    });
    await expect(store.select(id(1001))).rejects.toThrow(/carry/i);
    await expect(store.edit(id(1001), 'Edited old draft')).rejects.toThrow(/carry/i);
    const carried = await store.carry(id(1001));
    expect(carried.tasks[0].day).toBe('2026-10-06');
    expect(carried.currentTaskId).toBe(id(1001));
    expect((await store.visit(id(1))).attempts).toBe(1);
  });

  it('offers explicit carry-over after a clock or timezone change moves today backwards', async () => {
    const { api, options, setNow } = fixture();
    const store = createReflectionStore(api, options);
    await store.visit(id(1));
    await store.add('Task chosen on Monday');
    setNow(new Date(2026, 9, 4, 23, 0));
    const sunday = await store.read();
    expect(sunday).toEqual({
      day: '2026-10-04',
      tasks: [{ id: id(1000), text: 'Task chosen on Monday', day: '2026-10-05', completed: false }],
      currentTaskId: null,
      attempts: 0,
    });
    await expect(store.select(id(1000))).rejects.toThrow(/carry/i);
    const carried = await store.carry(id(1000));
    expect(carried.tasks).toEqual([
      { id: id(1000), text: 'Task chosen on Monday', day: '2026-10-04', completed: false },
    ]);
    expect(carried.currentTaskId).toBe(id(1000));
    await expect(store.carry(id(1000))).rejects.toThrow(/another day/i);
  });

  it('uses local calendar dates across daylight-saving transitions, rather than UTC or 24-hour timers', async () => {
    const { api, options, setNow } = fixture();
    const store = createReflectionStore(api, options);
    setNow(new Date(2026, 9, 25, 0, 5));
    expect((await store.visit(id(1))).day).toBe('2026-10-25');
    setNow(new Date(2026, 9, 25, 23, 59));
    expect((await store.visit(id(2))).attempts).toBe(2);
    setNow(new Date(2026, 9, 26, 0, 0));
    expect(await store.read()).toMatchObject({ day: '2026-10-26', attempts: 0 });
  });

  it('honors Amsterdam local midnight and its 25-hour autumn day with UTC timestamps', () => {
    const script = `import { applyReflectionMessage, localDay } from './extension/reflection-state.js';
      const times = ['2026-10-24T22:05:00Z', '2026-10-25T22:59:00Z', '2026-10-25T23:00:00Z'];
      let state;
      const results = times.map((time, index) => {
        const result = applyReflectionMessage(state, {type:'reflectionVisit', visitId:'00000000-0000-4000-8000-'+String(index).padStart(12,'0')}, new Date(time));
        state = result.state;
        return {day:localDay(new Date(time)), attempts:result.reflection.attempts};
      });
      process.stdout.write(JSON.stringify(results));`;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: 'Europe/Amsterdam' },
      encoding: 'utf8',
    });
    expect(JSON.parse(result)).toEqual([
      { day: '2026-10-25', attempts: 1 },
      { day: '2026-10-25', attempts: 2 },
      { day: '2026-10-26', attempts: 1 },
    ]);
  });

  it('completes and undoes tasks without stealing the current task', async () => {
    const { api, options } = fixture();
    const store = createReflectionStore(api, options);
    await store.add('First');
    await store.add('Second');
    await store.select(id(1000));
    expect((await store.complete(id(1000))).currentTaskId).toBeNull();
    await expect(store.select(id(1000))).rejects.toThrow(/complete/i);
    await store.select(id(1001));
    const undone = await store.undo(id(1000));
    expect(undone.tasks[0].completed).toBe(false);
    expect(undone.currentTaskId).toBe(id(1001));
    expect((await store.edit(id(1001), '  Revised second  ')).tasks[1].text).toBe('Revised second');
  });

  it('migrates an undated legacy intention into an optional previous-day task and resets the lifetime count', async () => {
    const { api, options, saved } = fixture();
    saved.unhookReflection = {
      intention: '  From last Friday  ',
      attempts: 340,
      visitIds: [id(1)],
    };
    const migrated = await createReflectionStore(api, options).read();
    expect(migrated).toEqual({
      ...empty,
      tasks: [{ id: id(1000), text: 'From last Friday', day: '2026-10-04', completed: false }],
    });
    expect(await createReflectionStore(api, options).read()).toEqual(migrated);
    expect((await createReflectionStore(api, options).visit(id(1))).attempts).toBe(1);
  });

  it('serializes concurrent visits and task changes without losing either change', async () => {
    const { api, options } = fixture();
    const store = createReflectionStore(api, options);
    const results = await Promise.all([
      store.visit(id(1)),
      store.add('Write'),
      store.visit(id(2)),
      store.add('Read'),
      store.visit(id(3)),
    ]);
    expect(results.at(-1)).toMatchObject({
      attempts: 3,
      currentTaskId: id(1001),
      tasks: [{ text: 'Write' }, { text: 'Read' }],
    });
    expect(await createReflectionStore(api, options).visit(id(3))).toEqual(results.at(-1));
  });

  it('deduplicates reloads across restarts and retains only 128 recent visit IDs', async () => {
    const { api, saved, options } = fixture();
    const store = createReflectionStore(api, options);
    await store.visit(id(1));
    expect((await createReflectionStore(api, options).visit(id(1))).attempts).toBe(1);
    for (let index = 2; index <= 129; index++) await store.visit(id(index));
    expect(saved.unhookReflection.visitIds).toHaveLength(128);
    expect((await store.visit(id(1))).attempts).toBe(130);
  });

  it('bounds task count without silently deleting unfinished tasks', async () => {
    const { api, options, setNow } = fixture();
    const store = createReflectionStore(api, options);
    for (let index = 0; index < 100; index++) await store.add(`Task ${index}`);
    await expect(store.add('Too many')).rejects.toThrow(/100/);
    setNow(new Date(2026, 9, 6));
    expect((await store.read()).tasks).toHaveLength(100);
    await expect(store.add('Still too many')).rejects.toThrow(/100/);
    await store.carry(id(1000));
    await store.complete(id(1000));
    setNow(new Date(2026, 9, 7));
    expect((await store.add('Room after completed task expires')).tasks).toHaveLength(100);
  });

  it('refuses an oversized saved list without scanning or overwriting its unfinished tasks', async () => {
    const { api, options, saved } = fixture();
    saved.unhookReflection = {
      ...empty,
      tasks: Array.from({ length: 101 }, (_, index) => ({
        id: id(index),
        text: `Preserve ${index}`,
        day: empty.day,
        completed: false,
      })),
    };
    const original = structuredClone(saved.unhookReflection);
    await expect(createReflectionStore(api, options).read()).rejects.toThrow(/100-task limit/);
    expect(saved.unhookReflection).toEqual(original);
    expect(api.storage.local.set).not.toHaveBeenCalled();
  });

  it('bounds text and task/visit IDs without writing invalid input', async () => {
    const { api, options } = fixture();
    const store = createReflectionStore(api, options);
    await expect(store.add('   ')).rejects.toThrow(/500/);
    await expect(store.add('a'.repeat(501))).rejects.toThrow(/500/);
    await expect(store.add(null)).rejects.toThrow();
    await expect(store.visit('arbitrary URL or text')).rejects.toThrow();
    await expect(store.edit('untrusted-id', 'Write')).rejects.toThrow();
    await expect(store.select(id(9000))).rejects.toThrow(/available/i);
    expect(api.storage.local.set).not.toHaveBeenCalled();
    expect((await store.add('a'.repeat(500))).tasks[0].text).toHaveLength(500);
  });

  it('rejects unsafe counter growth and recovers from malformed saved values', async () => {
    const { api, options, saved } = fixture();
    saved.unhookReflection = { ...empty, attempts: Number.MAX_SAFE_INTEGER, visitIds: [] };
    await expect(createReflectionStore(api, options).visit(id(1))).rejects.toThrow();
    saved.unhookReflection = {
      day: 'bad',
      tasks: [{ id: 'bad', text: 'unsafe' }],
      attempts: -1,
      visitIds: 'wrong',
    };
    expect(await createReflectionStore(api, options).visit(id(1))).toEqual({
      ...empty,
      attempts: 1,
    });
  });

  it('surfaces storage failure and allows subsequent operations to retry', async () => {
    const { api, options } = fixture();
    const store = createReflectionStore(api, options);
    api.storage.local.set.mockRejectedValueOnce(new Error('disk error'));
    await expect(store.visit(id(1))).rejects.toThrow();
    expect((await store.visit(id(1))).attempts).toBe(1);
    api.storage.local.get.mockRejectedValueOnce(new Error('disk error'));
    await expect(store.add('Write')).rejects.toThrow();
    expect((await store.add('Write')).tasks[0].text).toBe('Write');
  });
});

describe('reflection runtime messages', () => {
  it('accepts daily task actions only from this extension’s exact top-level blocked page', async () => {
    const { api, request, options } = fixture();
    installReflectionMessages(api, options);
    expect(
      await request(
        { type: 'reflectionVisit', visitId: id(1) },
        sender('chrome-extension://test/blocked.html?site=x#step'),
      ),
    ).toEqual({ ok: true, reflection: { ...empty, attempts: 1 } });
    expect(await request({ type: 'reflectionAdd', text: 'Return to writing' })).toMatchObject({
      ok: true,
      reflection: { currentTaskId: id(1000) },
    });
    expect(
      await request({ type: 'reflectionEdit', taskId: id(1000), text: 'Write proposal' }),
    ).toMatchObject({ ok: true, reflection: { tasks: [{ text: 'Write proposal' }] } });
    expect(await request({ type: 'reflectionComplete', taskId: id(1000) })).toMatchObject({
      ok: true,
      reflection: { currentTaskId: null },
    });
    expect(await request({ type: 'reflectionUndo', taskId: id(1000) })).toMatchObject({ ok: true });
    expect(await request({ type: 'reflectionSelect', taskId: id(1000) })).toMatchObject({
      ok: true,
      reflection: { currentTaskId: id(1000) },
    });
    expect(await request({ type: 'reflectionRead' })).toMatchObject({
      ok: true,
      reflection: { attempts: 1 },
    });
  });

  it('rejects hostile senders without accessing storage', async () => {
    const { api, request, options } = fixture();
    installReflectionMessages(api, options);
    const invalid = [
      undefined,
      {},
      { ...sender(), id: 'other' },
      { ...sender(), frameId: 1 },
      { ...sender(), tab: undefined },
      { ...sender(), tab: { id: -1 } },
      sender('https://example.com/blocked.html'),
      sender('chrome-extension://test/popup.html'),
      sender('chrome-extension://test/blocked.html/evil'),
      sender('chrome-extension://test/blocked.html.evil'),
      sender('chrome-extension://other/blocked.html'),
    ];
    for (const origin of invalid) {
      const response = await request({ type: 'reflectionAdd', text: 'Write' }, origin ?? {});
      expect(response.ok).toBe(false);
      expect(response.error).toEqual(expect.any(String));
    }
    expect(api.storage.local.get).not.toHaveBeenCalled();
  });

  it('returns actionable validation errors, generic storage errors, and ignores unrelated messages', async () => {
    const { api, request, options } = fixture();
    installReflectionMessages(api, options);
    expect(await request({ type: 'reflectionAdd', text: '' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('500'),
    });
    api.storage.local.get.mockRejectedValueOnce(new Error('sensitive storage detail'));
    expect(await request({ type: 'reflectionVisit', visitId: id(1) })).toEqual({
      ok: false,
      error: 'Your tasks could not be saved. Please try again.',
    });
    expect(await request({ type: 'getState' })).toBeUndefined();
    expect(await request(null)).toBeUndefined();
  });
});
