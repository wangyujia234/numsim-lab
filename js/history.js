const KEY = "numsim.history.v1";
const MAX = 20;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(entry) {
  const list = loadHistory();
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toISOString(),
    ...entry,
  });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  return loadHistory();
}

export function getHistoryEntry(id) {
  return loadHistory().find((e) => e.id === id) || null;
}

export function clearHistory() {
  localStorage.removeItem(KEY);
}
