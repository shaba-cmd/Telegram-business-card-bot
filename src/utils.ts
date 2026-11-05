/** Экранирует текст для parse_mode HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Очищает пользовательский ввод: убирает управляющие и невидимые символы,
 * схлопывает пробелы, обрезает края. Переносы строк сохраняются, если
 * multiline = true (для комментария).
 */
export function sanitizeText(text: string, multiline = false): string {
  let result = text
    .normalize('NFC')
    // управляющие символы, кроме перевода строки и табуляции
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // zero-width и направляющие символы, которыми можно испортить отображение
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '');

  if (multiline) {
    result = result
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    result = result.replace(/\s+/g, ' ');
  }
  return result.trim();
}

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/** «26.10.2026, 14:05» в заданном часовом поясе. */
export function formatDateTime(date: Date, timeZone: string): string {
  let formatter = dateTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    dateTimeFormatters.set(timeZone, formatter);
  }
  return formatter.format(date);
}

/** Момент начала текущих суток (00:00) в заданном часовом поясе. */
export function startOfDay(now: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;

  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - offset);
}
