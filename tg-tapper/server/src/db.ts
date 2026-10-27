import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newPlayer, type PlayerState } from '../../shared/game.ts';

export interface UserRow {
  id: number;
  state: PlayerState;
  lastSyncAt: number;
}

export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      state TEXT NOT NULL,
      last_sync INTEGER NOT NULL,
      ref_by INTEGER,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      charge_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      product TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      created INTEGER NOT NULL
    );
  `);

  const getStmt = db.prepare('SELECT id, state, last_sync FROM users WHERE id = ?');
  const insertStmt = db.prepare('INSERT INTO users (id, username, state, last_sync, ref_by, created) VALUES (?, ?, ?, ?, ?, ?)');
  const saveStmt = db.prepare('UPDATE users SET state = ?, last_sync = ? WHERE id = ?');
  const payStmt = db.prepare('INSERT OR IGNORE INTO payments (charge_id, user_id, product, amount, currency, created) VALUES (?, ?, ?, ?, ?, ?)');

  const get = (id: number): UserRow | null => {
    const row = getStmt.get(id) as { id: number; state: string; last_sync: number } | undefined;
    if (!row) return null;
    // Merge with defaults so new fields added to PlayerState appear for old users.
    return { id: row.id, state: { ...newPlayer(), ...JSON.parse(row.state) }, lastSyncAt: row.last_sync };
  };

  return {
    get,
    create(id: number, username: string | undefined, state: PlayerState, refBy: number | null, now: number): UserRow {
      insertStmt.run(id, username ?? null, JSON.stringify(state), now, refBy, now);
      return { id, state, lastSyncAt: now };
    },
    save(u: UserRow) {
      saveStmt.run(JSON.stringify(u.state), u.lastSyncAt, u.id);
    },
    /** Returns false when this charge was already recorded (duplicate update). */
    recordPayment(chargeId: string, userId: number, product: string, amount: number, currency: string) {
      return payStmt.run(chargeId, userId, product, amount, currency, Date.now()).changes > 0;
    },
    /** Runs fn inside a transaction (node:sqlite is synchronous, so this is atomic). */
    tx<T>(fn: () => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export type Db = ReturnType<typeof openDb>;
