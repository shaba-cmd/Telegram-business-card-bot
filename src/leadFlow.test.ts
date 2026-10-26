import { describe, expect, it } from 'vitest';
import { services } from './content.js';
import {
  formatAdminMessage,
  LeadSessions,
  LIMITS,
  rateLimitWait,
  validateComment,
  validateContact,
  validateName,
} from './leadFlow.js';

describe('валидация полей заявки', () => {
  it('имя: обрезает пробелы, не пустое, ограничено по длине', () => {
    expect(validateName('  Анна  ')).toEqual({ ok: true, value: 'Анна' });
    expect(validateName('   ').ok).toBe(false);
    expect(validateName('а'.repeat(LIMITS.name + 1)).ok).toBe(false);
  });

  it('контакт: не пустой и не длиннее 100 символов', () => {
    expect(validateContact('@anna_beauty')).toEqual({ ok: true, value: '@anna_beauty' });
    expect(validateContact('+7 900 000-00-00').ok).toBe(true);
    expect(validateContact('​').ok).toBe(false);
    expect(validateContact('1'.repeat(100)).ok).toBe(true);
    expect(validateContact('1'.repeat(101)).ok).toBe(false);
  });

  it('комментарий: можно пустой, длина ограничена', () => {
    expect(validateComment('  ')).toEqual({ ok: true, value: '' });
    expect(validateComment('x'.repeat(LIMITS.comment + 1)).ok).toBe(false);
  });
});

describe('rateLimitWait', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it('пропускает до трёх заявок в час', () => {
    expect(rateLimitWait([], now)).toBeNull();
    expect(rateLimitWait([minutesAgo(10), minutesAgo(5)], now)).toBeNull();
  });

  it('четвёртую заявку блокирует и говорит, сколько ждать', () => {
    expect(rateLimitWait([minutesAgo(50), minutesAgo(20), minutesAgo(5)], now)).toBe(10);
  });

  it('старые заявки за пределами часа не считаются', () => {
    expect(rateLimitWait([minutesAgo(70), minutesAgo(20), minutesAgo(5)], now)).toBeNull();
  });
});

describe('LeadSessions', () => {
  it('забывает черновик после часа неактивности', () => {
    let t = 0;
    const sessions = new LeadSessions(() => t);
    sessions.start(1);
    expect(sessions.get(1)?.step).toBe('service');
    t = 61 * 60 * 1000;
    expect(sessions.get(1)).toBeUndefined();
  });
});

describe('formatAdminMessage', () => {
  const draft = {
    step: 'confirm' as const,
    service: services[0],
    name: '<Анна>',
    contact: '@anna',
    comment: null,
    updatedAt: 0,
  };

  it('содержит все поля, экранирует HTML и ссылку на профиль', () => {
    const text = formatAdminMessage(12, draft, { id: 42, username: 'anna' }, new Date('2026-10-26T11:05:00Z'));
    expect(text).toContain('Заявка №12');
    expect(text).toContain(services[0].title);
    expect(text).toContain('&lt;Анна&gt;');
    expect(text).toContain('https://t.me/anna');
    expect(text).toContain('26.10.2026, 14:05');
    expect(text).toContain('Комментарий:</b> —');
  });

  it('без username даёт ссылку по ID', () => {
    const text = formatAdminMessage(1, draft, { id: 42, firstName: 'Анна' }, new Date());
    expect(text).toContain('tg://user?id=42');
  });
});
