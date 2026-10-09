import { Inject, Injectable, InjectionToken } from '@angular/core';
import { migrateQuoteV1 } from './migrate-quote';

export const APP_DATABASE_VERSION = 2;
export const APP_DATABASE_NAME = new InjectionToken<string>('APP_DATABASE_NAME', {
  providedIn: 'root',
  factory: () => 'presupuestador',
});
export const INDEXED_DB_FACTORY = new InjectionToken<IDBFactory | undefined>('INDEXED_DB_FACTORY', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.indexedDB;
    } catch {
      return undefined;
    }
  },
});

@Injectable({ providedIn: 'root' })
export class AppDatabase {
  private database?: IDBDatabase;
  private opening?: Promise<IDBDatabase>;

  constructor(
    @Inject(INDEXED_DB_FACTORY) private readonly factory: IDBFactory | undefined,
    @Inject(APP_DATABASE_NAME) private readonly name: string,
  ) {}

  async open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    if (this.opening) return this.opening;
    const opening = this.openDatabase();
    this.opening = opening;
    try {
      return await opening;
    } finally {
      if (this.opening === opening) this.opening = undefined;
    }
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!this.factory) {
        reject(new Error('IndexedDB no está disponible en este navegador.'));
        return;
      }
      const request = this.factory.open(this.name, APP_DATABASE_VERSION);
      let blocked = false;
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains('quotes'))
          db.createObjectStore('quotes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings'))
          db.createObjectStore('settings', { keyPath: 'id' });
        if (event.oldVersion < 2) {
          const cursor = request.transaction!.objectStore('quotes').openCursor();
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (!entry) return;
            const migrated = migrateQuoteV1(entry.value);
            if (migrated !== entry.value) entry.update(migrated);
            entry.continue();
          };
        }
      };
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Otra pestaña bloquea la apertura de la base. Ciérrala y reintenta.'));
      };
      request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la base local.'));
      request.onsuccess = () => {
        const db = request.result;
        // Una apertura bloqueada puede terminar mucho después de haber comunicado el error.
        if (blocked) {
          db.close();
          return;
        }
        this.database = db;
        db.onversionchange = () => {
          db.close();
          if (this.database === db) this.database = undefined;
        };
        db.onclose = () => {
          if (this.database === db) this.database = undefined;
        };
        resolve(db);
      };
    });
  }
}

/** El resultado de una petición es provisional hasta que la transacción confirma. */
export function runTransaction<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  work: (
    store: IDBObjectStore,
    result: (value: T) => void,
    abort: (error: unknown) => void,
  ) => void,
): Promise<T> {
  return runDatabaseTransaction(db, [storeName], mode, (transaction, result, abort) =>
    work(transaction.objectStore(storeName), result, abort),
  );
}

export function runDatabaseTransaction<T>(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
  work: (
    transaction: IDBTransaction,
    result: (value: T) => void,
    abort: (error: unknown) => void,
  ) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    let value: T;
    let hasResult = false;
    let failure: unknown;
    transaction.oncomplete = () =>
      hasResult ? resolve(value) : reject(new Error('La transacción terminó sin resultado.'));
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error('Transacción cancelada.'));
    const abort = (error: unknown) => {
      failure = error;
      try {
        transaction.abort();
      } catch {
        reject(error);
      }
    };
    try {
      work(
        transaction,
        (result) => {
          value = result;
          hasResult = true;
        },
        abort,
      );
    } catch (error) {
      abort(error);
    }
  });
}
