// Shared by the extension worker and the explicitly simulated browser preview.
// Local calendar days, not UTC timestamps or elapsed 24-hour intervals, own tasks.
const MAX_TEXT_LENGTH = 500;
const MAX_TASKS = 100;
const MAX_VISIT_IDS = 128;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validId = value => typeof value === 'string' && UUID.test(value);

export class ReflectionError extends Error {}

export function localDay(now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime()))
    throw new ReflectionError('The current date is unavailable.');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

const validText = value =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_TEXT_LENGTH;
const previousDay = now => {
  const date = new Date(now);
  date.setDate(date.getDate() - 1);
  return localDay(date);
};

export function publicReflection(state) {
  return {
    day: state.day,
    tasks: state.tasks.map(task => ({ ...task })),
    currentTaskId: state.currentTaskId,
    attempts: state.attempts,
  };
}

export function normalizeReflection(value, now = new Date(), createId = () => crypto.randomUUID()) {
  const day = localDay(now);
  const sameDay = value?.day === day;
  const seen = new Set();
  const tasks = [];
  if (Array.isArray(value?.tasks)) {
    if (value.tasks.length > MAX_TASKS)
      throw new ReflectionError(
        'Your saved task list exceeds the 100-task limit. Your tasks have been kept, but this list cannot be loaded.',
      );
    for (const task of value.tasks) {
      if (
        !validId(task?.id) ||
        seen.has(task.id) ||
        !validText(task.text) ||
        !validDay(task.day) ||
        typeof task.completed !== 'boolean'
      )
        continue;
      // Finished tasks from previous days no longer clutter Today. Unfinished
      // tasks survive until the user explicitly carries them into a new day.
      if (task.completed && task.day < day) continue;
      seen.add(task.id);
      tasks.push({ id: task.id, text: task.text.trim(), day: task.day, completed: task.completed });
    }
  } else if (!validDay(value?.day) && validText(value?.intention)) {
    // Legacy storage has no date. Never present this stale intention as today's
    // choice: preserve it as an optional carry-over, with no selected task.
    const taskId = createId();
    if (!validId(taskId))
      throw new ReflectionError('A task could not be created. Please try again.');
    tasks.push({
      id: taskId,
      text: value.intention.trim(),
      day: previousDay(now),
      completed: false,
    });
  }
  const current =
    sameDay &&
    tasks.find(task => task.id === value?.currentTaskId && task.day === day && !task.completed);
  return {
    day,
    tasks,
    currentTaskId: current ? current.id : null,
    attempts:
      sameDay && Number.isSafeInteger(value?.attempts) && value.attempts >= 0 ? value.attempts : 0,
    visitIds:
      sameDay && Array.isArray(value?.visitIds)
        ? [...new Set(value.visitIds.filter(validId))].slice(-MAX_VISIT_IDS)
        : [],
  };
}

const requireText = text => {
  if (!validText(text))
    throw new ReflectionError('Enter what you want to do, using up to 500 characters.');
  return text.trim();
};

function requireTask(state, taskId, today = true) {
  if (!validId(taskId))
    throw new ReflectionError('This task is no longer available. Refresh your task list.');
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new ReflectionError('This task is no longer available. Refresh your task list.');
  if (today && task.day !== state.day)
    throw new ReflectionError(
      'A new day has started. Carry this task into today before changing it.',
    );
  return task;
}

function addTask(state, text, createId) {
  const trimmed = requireText(text);
  if (state.tasks.length >= MAX_TASKS)
    throw new ReflectionError(
      'Your list has reached 100 tasks. Finish unfinished tasks; completed tasks clear on the next day.',
    );
  const taskId = createId();
  if (!validId(taskId) || state.tasks.some(task => task.id === taskId))
    throw new ReflectionError('A task could not be created. Please try again.');
  state.tasks.push({ id: taskId, text: trimmed, day: state.day, completed: false });
  state.currentTaskId = taskId;
}

export function applyReflectionMessage(
  value,
  message,
  now = new Date(),
  createId = () => crypto.randomUUID(),
) {
  const state = normalizeReflection(value, now, createId);
  switch (message?.type) {
    case 'reflectionRead':
      break;
    case 'reflectionVisit': {
      if (!validId(message.visitId)) throw new ReflectionError('Invalid reflection visit.');
      if (!state.visitIds.includes(message.visitId)) {
        if (state.attempts === Number.MAX_SAFE_INTEGER)
          throw new ReflectionError('The pause count cannot be increased.');
        state.attempts += 1;
        state.visitIds = [...state.visitIds, message.visitId].slice(-MAX_VISIT_IDS);
      }
      break;
    }
    case 'reflectionAdd':
      addTask(state, message.text, createId);
      break;
    case 'reflectionEdit':
      requireTask(state, message.taskId).text = requireText(message.text);
      break;
    case 'reflectionSelect': {
      const task = requireTask(state, message.taskId);
      if (task.completed)
        throw new ReflectionError('This task is complete. Undo completion before choosing it.');
      state.currentTaskId = task.id;
      break;
    }
    case 'reflectionComplete': {
      const task = requireTask(state, message.taskId);
      task.completed = true;
      if (state.currentTaskId === task.id) state.currentTaskId = null;
      break;
    }
    case 'reflectionUndo':
      requireTask(state, message.taskId).completed = false;
      break;
    case 'reflectionCarry': {
      const task = requireTask(state, message.taskId, false);
      if (task.completed || task.day === state.day)
        throw new ReflectionError(
          'Choose an unfinished task from another day to carry into today.',
        );
      task.day = state.day;
      state.currentTaskId = task.id;
      break;
    }
    default:
      throw new ReflectionError('Unknown task action.');
  }
  return { state, reflection: publicReflection(state) };
}
