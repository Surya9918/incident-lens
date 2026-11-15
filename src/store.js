import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class IncidentStore {
  constructor(path, { maxIncidents = 500, retentionDays = 7 } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.maxIncidents = maxIncidents; this.retentionDays = retentionDays;
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL); CREATE INDEX IF NOT EXISTS incidents_created ON incidents(created_at);');
    this.prune();
  }
  prune() {
    this.db.prepare('DELETE FROM incidents WHERE created_at < ?').run(Date.now() - this.retentionDays * 86400000);
    this.db.prepare('DELETE FROM incidents WHERE id NOT IN (SELECT id FROM incidents ORDER BY created_at DESC, id DESC LIMIT ?)').run(this.maxIncidents);
  }
  create(incident, result) {
    const id = randomUUID(), createdAt = Date.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO incidents VALUES (?, ?, ?, ?, ?, ?)').run(id, createdAt, incident.title, result.status, JSON.stringify(incident), JSON.stringify(result));
      this.prune(); this.db.exec('COMMIT');
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
    return { id, createdAt, incident, result };
  }
  list(limit = 30, offset = 0) {
    this.prune();
    return this.db.prepare('SELECT id, created_at AS createdAt, title, status FROM incidents ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(limit, offset);
  }
  get(id) {
    this.prune();
    const row = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
    return row ? { id: row.id, createdAt: row.created_at, incident: JSON.parse(row.payload), result: JSON.parse(row.result) } : null;
  }
  delete(id) { return this.db.prepare('DELETE FROM incidents WHERE id = ?').run(id).changes > 0; }
  close() { this.db.close(); }
}
