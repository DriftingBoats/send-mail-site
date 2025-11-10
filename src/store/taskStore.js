const fs = require('fs');
const path = require('path');

const dataDir = path.join(process.cwd(), 'data');
const storePath = path.join(dataDir, 'tasks.json');

const defaultStore = { tasks: [] };

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(defaultStore, null, 2), 'utf-8');
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('无法读取任务存储，使用空列表。', error);
    return { ...defaultStore };
  }
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function listTasks() {
  return readStore().tasks;
}

function addTask(task) {
  const store = readStore();
  store.tasks.push(task);
  writeStore(store);
  return task;
}

function updateTask(id, changes) {
  const store = readStore();
  const idx = store.tasks.findIndex((task) => task.id === id);
  if (idx === -1) {
    throw new Error(`任务 ${id} 不存在`);
  }

  store.tasks[idx] = { ...store.tasks[idx], ...changes };
  writeStore(store);

  return store.tasks[idx];
}

function removeTask(id) {
  const store = readStore();
  const idx = store.tasks.findIndex((task) => task.id === id);
  if (idx === -1) {
    throw new Error(`任务 ${id} 不存在`);
  }

  const [removed] = store.tasks.splice(idx, 1);
  writeStore(store);
  return removed;
}

module.exports = {
  listTasks,
  addTask,
  updateTask,
  removeTask,
  storePath,
};
