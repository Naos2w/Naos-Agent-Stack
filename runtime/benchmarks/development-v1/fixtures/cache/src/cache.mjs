export function createAsyncCache(load) {
  const pending = new Map();
  return key => {
    if (!pending.has(key)) pending.set(key, Promise.resolve().then(() => load(key)));
    return pending.get(key);
  };
}
