// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../service';
import { SchedulePage } from './SchedulePage';

afterEach(cleanup);

describe('schedule autosave', () => {
  it('saves the enabled switch immediately without a save button', async () => {
    const settings = defaultSettings(),
      save = vi.fn(async () => true);
    render(<SchedulePage settings={settings} busy={false} save={save} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable weekly schedule' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        ...settings,
        schedule: { ...settings.schedule, enabled: true },
      }),
    );
    await screen.findByText('All changes saved.');
    expect(screen.queryByRole('button', { name: 'Save schedule' })).toBeNull();
  });

  it('saves weekday, focus-hour and break edits as they are made', async () => {
    const settings = defaultSettings(),
      save = vi.fn(async () => true);
    render(<SchedulePage settings={settings} busy={false} save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sat' }));
    await screen.findByText('All changes saved.');
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '08:30' } });
    await screen.findByText('All changes saved.');
    fireEvent.change(screen.getByLabelText('Break starts'), { target: { value: '12:00' } });
    await screen.findByText('All changes saved.');
    fireEvent.change(screen.getByLabelText('Break ends'), { target: { value: '13:30' } });
    await screen.findByText('All changes saved.');
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '18:00' } });
    await screen.findByText('All changes saved.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable daily break' }));
    await screen.findByText('All changes saved.');
    expect(save).toHaveBeenCalledTimes(6);
    expect(save).toHaveBeenLastCalledWith({
      ...settings,
      schedule: {
        ...settings.schedule,
        days: [0, 1, 2, 3, 4, 5],
        start: '08:30',
        end: '18:00',
        breakStart: '12:00',
        breakEnd: '13:30',
        breakEnabled: false,
      },
    });
  });

  it('retains invalid drafts across polling and saves once corrected', async () => {
    const settings = defaultSettings(),
      save = vi.fn(async () => true);
    const view = render(<SchedulePage settings={settings} busy={false} save={save} />);
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '08:00' } });
    expect(screen.getByRole('alert').textContent).toContain('end time');
    expect(save).not.toHaveBeenCalled();
    view.rerender(<SchedulePage settings={structuredClone(settings)} busy={false} save={save} />);
    expect((screen.getByLabelText('End time') as HTMLInputElement).value).toBe('08:00');
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '18:00' } });
    await screen.findByText('All changes saved.');
    expect(save).toHaveBeenCalledWith({
      ...settings,
      schedule: { ...settings.schedule, end: '18:00' },
    });
  });

  it('shows failed saves and retries the retained draft', async () => {
    const settings = defaultSettings(),
      save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<SchedulePage settings={settings} busy={false} save={save} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable weekly schedule' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('All changes saved.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('All changes saved.');
    expect(save).toHaveBeenLastCalledWith({
      ...settings,
      schedule: { ...settings.schedule, enabled: true },
    });
  });

  it('shows saving progress and prevents overlapping saves', async () => {
    let finish!: (saved: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          finish = resolve;
        }),
    );
    render(<SchedulePage settings={defaultSettings()} busy={false} save={save} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable weekly schedule' }));
    expect(screen.getByRole('status').textContent).toBe('Saving changes…');
    expect(
      (screen.getByRole('checkbox', { name: 'Enable weekly schedule' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Sat' }).matches(':disabled')).toBe(true);
    expect((screen.getByLabelText('End time') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sat' }));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => finish(true));
    expect(screen.getByRole('status').textContent).toBe('All changes saved.');
  });

  it('keeps the time input focused while persisting an edit', async () => {
    let finish!: (saved: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          finish = resolve;
        }),
    );
    render(<SchedulePage settings={defaultSettings()} busy={false} save={save} />);
    const input = screen.getByLabelText('End time') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '18:00' } });
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(document.activeElement).toBe(input);
    await act(async () => finish(true));
    expect(document.activeElement).toBe(input);
    expect(input.readOnly).toBe(false);
  });
});
