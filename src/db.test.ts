import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from './db.js';

describe('db', () => {
  it('создаёт пользователя один раз и обновляет его данные', () => {
    const db = createDatabase(':memory:');
    const id1 = db.upsertUser({ telegramId: 42, username: 'old', firstName: 'Анна' });
    const id2 = db.upsertUser({ telegramId: 42, username: 'new', firstName: 'Анна' });
    expect(id2).toBe(id1);
    expect(db.getStats(new Date(0)).usersTotal).toBe(1);
    db.close();
  });

  it('сохраняет заявку и считает статистику за сегодня и всего', () => {
    let clock = new Date('2026-10-25T10:00:00Z');
    const db = createDatabase(':memory:', () => clock);
    const userId = db.upsertUser({ telegramId: 1 });
    db.createLead({ userId, service: 'Маникюр', name: 'Анна', contact: '@anna', comment: null });

    clock = new Date('2026-10-26T10:00:00Z');
    db.upsertUser({ telegramId: 2 });
    const lead = db.createLead({ userId, service: 'Брови', name: 'Анна', contact: '@anna', comment: 'вечером' });
    expect(lead.id).toBe(2);

    expect(db.getStats(new Date('2026-10-26T00:00:00Z'))).toEqual({
      usersToday: 1,
      usersTotal: 2,
      leadsToday: 1,
      leadsTotal: 2,
    });
    expect(db.recentLeadTimes(userId, new Date('2026-10-26T09:00:00Z'))).toHaveLength(1);
    db.close();
  });

  it('данные переживают перезапуск, статус заявки по умолчанию new', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bot-db-'));
    const path = join(dir, 'nested', 'bot.db');
    try {
      const first = createDatabase(path);
      const userId = first.upsertUser({ telegramId: 7, firstName: 'Олег' });
      first.createLead({ userId, service: 'Стрижка', name: 'Олег', contact: '+79000000000', comment: null });
      first.close();

      const second = createDatabase(path);
      expect(second.getStats(new Date(0)).leadsTotal).toBe(1);
      second.close();

      const raw = new Database(path, { readonly: true });
      expect(raw.prepare('SELECT status FROM leads').get()).toEqual({ status: 'new' });
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
