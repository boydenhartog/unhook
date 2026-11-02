import { applyReflectionMessage, ReflectionError } from './reflection-state.js';
import { isBlockedPageSender } from './page-sender.js';

const STORAGE_KEY = 'unhookReflection';
const MESSAGE_TYPES = new Set([
  'reflectionRead',
  'reflectionVisit',
  'reflectionAdd',
  'reflectionEdit',
  'reflectionSelect',
  'reflectionComplete',
  'reflectionUndo',
  'reflectionCarry',
]);

// The single worker owns all writes. Reading inside the queue prevents multiple
// blocked tabs from overwriting each other's visits or task changes.
export function createReflectionStore(
  api,
  { now = () => Date.now(), createId = () => crypto.randomUUID() } = {},
) {
  let queue = Promise.resolve();
  const update = message => {
    const result = queue.then(async () => {
      const saved = await api.storage.local.get(STORAGE_KEY);
      const { state, reflection } = applyReflectionMessage(
        saved[STORAGE_KEY],
        message,
        now(),
        createId,
      );
      if (JSON.stringify(state) !== JSON.stringify(saved[STORAGE_KEY])) {
        await api.storage.local.set({ [STORAGE_KEY]: state });
      }
      return reflection;
    });
    queue = result.catch(() => {});
    return result;
  };
  return {
    read: () => update({ type: 'reflectionRead' }),
    visit: visitId => update({ type: 'reflectionVisit', visitId }),
    add: text => update({ type: 'reflectionAdd', text }),
    edit: (taskId, text) => update({ type: 'reflectionEdit', taskId, text }),
    select: taskId => update({ type: 'reflectionSelect', taskId }),
    complete: taskId => update({ type: 'reflectionComplete', taskId }),
    undo: taskId => update({ type: 'reflectionUndo', taskId }),
    carry: taskId => update({ type: 'reflectionCarry', taskId }),
  };
}

export function installReflectionMessages(api, options) {
  const store = createReflectionStore(api, options);
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (!MESSAGE_TYPES.has(message?.type)) return false;
    if (!isBlockedPageSender(api, sender)) {
      respond({ ok: false, error: 'Task requests must come from the Unhook blocked page.' });
      return false;
    }
    let result;
    switch (message.type) {
      case 'reflectionRead':
        result = store.read();
        break;
      case 'reflectionVisit':
        result = store.visit(message.visitId);
        break;
      case 'reflectionAdd':
        result = store.add(message.text);
        break;
      case 'reflectionEdit':
        result = store.edit(message.taskId, message.text);
        break;
      case 'reflectionSelect':
        result = store.select(message.taskId);
        break;
      case 'reflectionComplete':
        result = store.complete(message.taskId);
        break;
      case 'reflectionUndo':
        result = store.undo(message.taskId);
        break;
      case 'reflectionCarry':
        result = store.carry(message.taskId);
        break;
    }
    void result
      .then(reflection => respond({ ok: true, reflection }))
      .catch(error => {
        respond({
          ok: false,
          error:
            error instanceof ReflectionError
              ? error.message
              : 'Your tasks could not be saved. Please try again.',
        });
      });
    return true;
  });
  return store;
}
