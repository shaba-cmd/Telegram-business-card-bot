import { describe, expect, it } from 'vitest';
import { escapeHtml, formatDateTime, sanitizeText, startOfDay } from './utils.js';

describe('sanitizeText', () => {
  it('схлопывает пробелы и убирает невидимые символы', () => {
    expect(sanitizeText('  Анна ​  Петрова\n')).toBe('Анна Петрова');
    expect(sanitizeText('a\u0000b‮c')).toBe('abc');
  });

  it('в многострочном режиме сохраняет абзацы', () => {
    expect(sanitizeText('  первая  строка \r\n\r\n\r\n\r\nвторая ', true)).toBe('первая строка\n\nвторая');
  });
});

describe('escapeHtml', () => {
  it('экранирует спецсимволы HTML', () => {
    expect(escapeHtml('<b>"Tom" & Jerry</b>')).toBe('&lt;b&gt;&quot;Tom&quot; &amp; Jerry&lt;/b&gt;');
  });
});

describe('time', () => {
  it('начало суток по Москве', () => {
    // 26.10.2026 01:30 МСК = 25.10.2026 22:30 UTC → сутки начались 25.10 в 21:00 UTC
    expect(startOfDay(new Date('2026-10-25T22:30:00Z'), 'Europe/Moscow').toISOString()).toBe(
      '2026-10-25T21:00:00.000Z',
    );
  });

  it('форматирует время заявки', () => {
    expect(formatDateTime(new Date('2026-10-26T11:05:00Z'), 'Europe/Moscow')).toBe('26.10.2026, 14:05');
  });
});
