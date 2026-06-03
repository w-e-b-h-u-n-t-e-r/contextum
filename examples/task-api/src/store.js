import { randomUUID } from "node:crypto";

const tasks = new Map();

export function listTasks() {
  return [...tasks.values()];
}

export function getTask(id) {
  return tasks.get(id) ?? null;
}

export function createTask({ title }) {
  const task = {
    id: randomUUID(),
    title,
    done: false,
    createdAt: new Date().toISOString(),
  };
  tasks.set(task.id, task);
  return task;
}

export function updateTask(id, patch) {
  const task = tasks.get(id);
  if (!task) return null;

  const updated = {
    ...task,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.done !== undefined ? { done: patch.done } : {}),
  };
  tasks.set(id, updated);
  return updated;
}

export function deleteTask(id) {
  return tasks.delete(id);
}
