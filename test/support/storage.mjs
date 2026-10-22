import { IDBFactory } from "fake-indexeddb";

// A browser database adapter that can simulate unavailable storage and aborts
// after a successful put request (before the transaction commits).
export function controlledDatabase() {
  const factory = new IDBFactory();
  const state = { unavailable: false, failWrites: false };
  const indexedDB = {
    open(...args) {
      if (state.unavailable)
        throw new DOMException("Storage denied", "SecurityError");
      const request = factory.open(...args);
      request.addEventListener("success", () => {
        const db = request.result;
        const transaction = db.transaction.bind(db);
        db.transaction = (...args) => {
          const tx = transaction(...args);
          if (args[1] === "readwrite" && state.failWrites) {
            const objectStore = tx.objectStore.bind(tx);
            tx.objectStore = (name) => {
              const store = objectStore(name);
              const put = store.put.bind(store);
              store.put = (...args) => {
                const write = put(...args);
                write.addEventListener("success", () => tx.abort());
                return write;
              };
              return store;
            };
          }
          return tx;
        };
      });
      return request;
    },
  };
  return { indexedDB, state };
}
