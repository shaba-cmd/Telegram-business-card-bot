import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TelegramUserInfo {
  telegramId: number;
  username?: string;
  firstName?: string;
}

export interface NewLead {
  userId: number;
  service: string;
  name: string;
  contact: string;
  comment: string | null;
}

export interface Stats {
  usersToday: number;
  usersTotal: number;
  leadsToday: number;
  leadsTotal: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  username    TEXT,
  first_name  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  service    TEXT NOT NULL,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL,
  comment    TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_user_created ON leads (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at);
`;

/**
 * Хранилище пользователей и заявок в SQLite.
 * Время хранится в ISO 8601 UTC — такие строки корректно сравниваются.
 */
export function createDatabase(path: string, now: () => Date = () => new Date()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const upsertUserStmt = db.prepare<[number, string | null, string | null, string], { id: number }>(`
    INSERT INTO users (telegram_id, username, first_name, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name
    RETURNING id
  `);

  const insertLeadStmt = db.prepare<[number, string, string, string, string | null, string]>(`
    INSERT INTO leads (user_id, service, name, contact, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const recentLeadsStmt = db.prepare<[number, string], { created_at: string }>(`
    SELECT created_at FROM leads
    WHERE user_id = ? AND created_at >= ?
    ORDER BY created_at ASC
  `);

  const countStmt = (table: 'users' | 'leads') => ({
    total: db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`),
    since: db.prepare<[string], { n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE created_at >= ?`),
  });
  const usersCount = countStmt('users');
  const leadsCount = countStmt('leads');

  return {
    /** Создаёт пользователя при первом обращении или обновляет username/имя. Возвращает внутренний id. */
    upsertUser(user: TelegramUserInfo): number {
      const row = upsertUserStmt.get(
        user.telegramId,
        user.username ?? null,
        user.firstName ?? null,
        now().toISOString(),
      );
      if (!row) throw new Error('Не удалось сохранить пользователя');
      return row.id;
    },

    /** Сохраняет заявку со статусом new. Возвращает её номер и время создания. */
    createLead(lead: NewLead): { id: number; createdAt: Date } {
      const createdAt = now();
      const result = insertLeadStmt.run(
        lead.userId,
        lead.service,
        lead.name,
        lead.contact,
        lead.comment,
        createdAt.toISOString(),
      );
      return { id: Number(result.lastInsertRowid), createdAt };
    },

    /** Время создания заявок пользователя начиная с момента since (по возрастанию). */
    recentLeadTimes(userId: number, since: Date): Date[] {
      return recentLeadsStmt.all(userId, since.toISOString()).map((r) => new Date(r.created_at));
    },

    getStats(todayStart: Date): Stats {
      const since = todayStart.toISOString();
      return {
        usersToday: usersCount.since.get(since)?.n ?? 0,
        usersTotal: usersCount.total.get()?.n ?? 0,
        leadsToday: leadsCount.since.get(since)?.n ?? 0,
        leadsTotal: leadsCount.total.get()?.n ?? 0,
      };
    },

    close(): void {
      db.close();
    },
  };
}

export type BotDatabase = ReturnType<typeof createDatabase>;
