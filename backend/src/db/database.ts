import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BACKEND_CONFIG } from '../config.ts';

let dbInstance: DatabaseSync | null = null;

export function getDatabase(customPath?: string): DatabaseSync {
  if (!dbInstance || customPath) {
    const targetPath = customPath || BACKEND_CONFIG.DB_PATH;
    const dbDir = path.dirname(targetPath);
    if (!fs.existsSync(dbDir) && dbDir !== '.' && targetPath !== ':memory:') {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const db = new DatabaseSync(targetPath);
    db.exec('PRAGMA foreign_keys = ON;');
    if (targetPath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
    }
    if (!customPath) {
      dbInstance = db;
    } else {
      return db;
    }
  }
  return dbInstance;
}

export function runMigrations(db: DatabaseSync): void {
  const schemaSqlPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
  const schemaSql = fs.readFileSync(schemaSqlPath, 'utf-8');
  db.exec(schemaSql);
}
