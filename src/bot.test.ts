import { beforeEach, describe, expect, it } from 'vitest';
import type { Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { createBot } from './bot.js';
import { texts } from './content.js';
import { createDatabase, type BotDatabase } from './db.js';

/**
 * Интеграционные тесты: настоящий бот grammY, настоящая SQLite в памяти,
 * а запросы к Telegram API перехватываются и записываются.
 */

const ADMIN = 1000;
const USER = { id: 42, is_bot: false, first_name: 'Анна', username: 'anna' };
// Поля getMe, которые боту не важны, в разных версиях Bot API отличаются.
const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: 'Demo',
  username: 'demo_bot',
} as UserFromGetMe;

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

let bot: Bot;
let db: BotDatabase;
let calls: ApiCall[];
let failAdmin: boolean;
let updateId = 0;

function setup(now: () => Date = () => new Date()) {
  db = createDatabase(':memory:', now);
  bot = createBot({ token: 'test', adminChatId: ADMIN, db, botInfo: BOT_INFO, now });
  calls = [];
  failAdmin = false;
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (method === 'sendMessage' && p.chat_id === ADMIN && failAdmin) {
      throw new Error('admin unavailable');
    }
    const result =
      method === 'sendMessage'
        ? { message_id: calls.length, date: 0, chat: { id: p.chat_id, type: 'private' }, text: p.text }
        : true;
    return { ok: true, result } as never;
  });
}

const chat = (from = USER) => ({ id: from.id, type: 'private' as const, first_name: from.first_name });

function text(value: string, from = USER): Update {
  const entities = value.startsWith('/')
    ? [{ type: 'bot_command' as const, offset: 0, length: value.split(' ')[0].length }]
    : undefined;
  return {
    update_id: ++updateId,
    message: { message_id: updateId, date: 0, chat: chat(from), from, text: value, entities },
  };
}

function photo(from = USER): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: chat(from),
      from,
      photo: [{ file_id: 'x', file_unique_id: 'x', width: 1, height: 1 }],
    },
  };
}

function press(data: string, from = USER): Update {
  return {
    update_id: ++updateId,
    callback_query: {
      id: String(updateId),
      from,
      chat_instance: 'ci',
      data,
      message: { message_id: 1, date: 0, chat: chat(from), from: BOT_INFO, text: 'menu' },
    },
  };
}

async function send(...updates: Update[]) {
  for (const u of updates) await bot.handleUpdate(u);
}

/** Тексты всех сообщений и правок, отправленных пользователю. */
function sentTexts(chatId = USER.id): string[] {
  return calls
    .filter((c) => (c.method === 'sendMessage' || c.method === 'editMessageText') && c.payload.chat_id === chatId)
    .map((c) => String(c.payload.text));
}

const lastText = (chatId = USER.id) => sentTexts(chatId).at(-1) ?? '';

async function fullLead(from = USER) {
  await send(
    press('lead:start', from),
    press('lead:svc:manicure', from),
    text('Анна', from),
    text('@anna', from),
    press('lead:skip', from),
    press('lead:send', from),
  );
}

describe('бот-визитка', () => {
  beforeEach(() => setup());

  it('/start показывает приветствие с названием бизнеса и меню из 4 кнопок', async () => {
    await send(text('/start'));
    const call = calls.find((c) => c.method === 'sendMessage')!;
    expect(call.payload.text).toContain('Лаванда');
    expect(call.payload.text).toContain('Здравствуйте, Анна!');
    const keyboard = (call.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
    expect(keyboard.flat().map((b) => b.text)).toEqual([
      '💅 Услуги и цены',
      '❓ Частые вопросы',
      '📝 Оставить заявку',
      '📍 Контакты',
    ]);
  });

  it('разделы меню: услуги, FAQ, ответ на вопрос, контакты', async () => {
    await send(press('menu:services'));
    expect(lastText()).toMatch(/от 1\s800 ₽/);
    await send(press('menu:faq'), press('faq:payment'));
    expect(lastText()).toContain('СБП');
    await send(press('menu:contacts'));
    expect(lastText()).toContain('+7 (900) 000-00-00');
  });

  it('полный путь заявки: сохраняется в базе и приходит администратору', async () => {
    await fullLead();
    expect(sentTexts()).toContain(texts.leadAccepted);
    const admin = lastText(ADMIN);
    expect(admin).toContain('Заявка №1');
    expect(admin).toContain('Маникюр с покрытием');
    expect(admin).toContain('@anna');
    expect(admin).toContain('https://t.me/anna');
    expect(db.getStats(new Date(0)).leadsTotal).toBe(1);
  });

  it('сводка перед отправкой содержит все поля', async () => {
    await send(press('lead:start'), press('lead:svc:brows'), text('Анна'), text('+79000000000'), text('после 18:00'));
    const summary = lastText();
    expect(summary).toContain('Проверьте заявку');
    expect(summary).toContain('Брови');
    expect(summary).toContain('+79000000000');
    expect(summary).toContain('после 18:00');
  });

  it('/cancel прерывает заявку на любом шаге', async () => {
    for (const steps of [[], [press('lead:svc:haircut')], [press('lead:svc:haircut'), text('Анна')]]) {
      setup();
      await send(press('lead:start'), ...steps, text('/cancel'));
      expect(lastText()).toBe(texts.leadCancelled);
      // после отмены текст больше не воспринимается как шаг заявки
      await send(text('Олег'));
      expect(lastText()).toBe(texts.unknownMessage);
    }
  });

  it('фото, стикер или голосовое не ломают диалог', async () => {
    await send(press('lead:start'), press('lead:svc:manicure'), photo());
    expect(lastText()).toBe(texts.pleaseSendText);
    await send(text('Анна'));
    expect(lastText()).toContain('Шаг 3 из 4');
  });

  it('пустой и слишком длинный контакт не принимаются', async () => {
    await send(press('lead:start'), press('lead:svc:manicure'), text('Анна'), text('x'.repeat(101)));
    expect(lastText()).toBe(texts.contactTooLong(100));
    await send(text('@anna'));
    expect(lastText()).toContain('Шаг 4 из 4');
  });

  it('если администратору отправить не удалось, заявка всё равно сохраняется', async () => {
    failAdmin = true;
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      await fullLead();
    } finally {
      console.error = origError;
    }
    expect(sentTexts()).toContain(texts.leadAccepted);
    expect(db.getStats(new Date(0)).leadsTotal).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('повторное нажатие «Отправить» не создаёт вторую заявку', async () => {
    await fullLead();
    await send(press('lead:send'));
    expect(db.getStats(new Date(0)).leadsTotal).toBe(1);
  });

  it('не больше 3 заявок в час от одного пользователя', async () => {
    let clock = new Date('2026-10-26T10:00:00Z');
    setup(() => clock);
    for (let i = 0; i < 3; i++) await fullLead();
    await send(press('lead:start'));
    expect(lastText()).toContain('Попробуйте снова через 60 мин.');

    clock = new Date('2026-10-26T11:00:01Z');
    await fullLead();
    expect(db.getStats(new Date(0)).leadsTotal).toBe(4);
  });

  it('/stats только для администратора', async () => {
    await send(text('/stats'));
    expect(lastText()).toBe(texts.adminOnly);

    const admin = { id: ADMIN, is_bot: false, first_name: 'Владелец', username: 'owner' };
    await fullLead();
    await send(text('/stats', admin));
    expect(lastText(ADMIN)).toContain('Заявки: сегодня 1, всего 1');
    // администратор, вызвавший /stats, в пользователи не попадает
    expect(lastText(ADMIN)).toContain('Пользователи: сегодня 1, всего 1');
  });
});
