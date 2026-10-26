import { Bot, GrammyError, HttpError, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { contacts, faq, services, texts, timeZone } from './content.js';
import type { BotDatabase } from './db.js';
import { cancelLead, createLeadFlow, LeadSessions } from './leadFlow.js';
import {
  cb,
  contactsKeyboard,
  faqAnswerKeyboard,
  faqKeyboard,
  mainMenuKeyboard,
  servicesKeyboard,
  showScreen,
} from './ui.js';
import { escapeHtml, startOfDay } from './utils.js';

export interface CreateBotOptions {
  token: string;
  adminChatId: number;
  db: BotDatabase;
  /** Для тестов: данные бота без запроса getMe */
  botInfo?: UserFromGetMe;
  now?: () => Date;
}

const priceFormatter = new Intl.NumberFormat('ru-RU');

export function servicesText(): string {
  const list = services.map(
    (s) => `<b>${escapeHtml(s.title)}</b> — от ${priceFormatter.format(s.priceFrom)} ₽\n${escapeHtml(s.description)}`,
  );
  return [texts.servicesTitle, '', list.join('\n\n')].join('\n');
}

export function contactsText(): string {
  return [
    texts.contactsTitle,
    '',
    `📍 ${escapeHtml(contacts.address)}`,
    `📞 ${escapeHtml(contacts.phone)}`,
    `🕘 ${escapeHtml(contacts.hours)}`,
    contacts.website ? `🌐 ${escapeHtml(contacts.website)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createBot({ token, adminChatId, db, botInfo, now = () => new Date() }: CreateBotOptions): Bot {
  const bot = new Bot(token, { botInfo });
  const sessions = new LeadSessions(() => now().getTime());

  const isAdmin = (ctx: Context) => ctx.chat?.id === adminChatId || ctx.from?.id === adminChatId;

  // /stats — только для администратора, работает и в личке, и в группе для заявок.
  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply(texts.adminOnly);
      return;
    }
    const stats = db.getStats(startOfDay(now(), timeZone));
    await ctx.reply(
      [
        '<b>Статистика</b>',
        '',
        `👤 Пользователи: сегодня ${stats.usersToday}, всего ${stats.usersTotal}`,
        `📝 Заявки: сегодня ${stats.leadsToday}, всего ${stats.leadsTotal}`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  // Дальше — только личные сообщения: в группе администратора бот молчит.
  const pm = bot.chatType('private');

  // Запоминаем каждого, кто пишет боту, — для статистики.
  pm.use(async (ctx, next) => {
    try {
      db.upsertUser({ telegramId: ctx.from.id, username: ctx.from.username, firstName: ctx.from.first_name });
    } catch (error) {
      console.error('[db] не удалось сохранить пользователя:', error);
    }
    await next();
  });

  pm.command('start', async (ctx) => {
    sessions.clear(ctx.from.id);
    const name = ctx.from.first_name ? escapeHtml(ctx.from.first_name) : undefined;
    await ctx.reply(texts.welcome(name), { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
  });

  pm.command('help', async (ctx) => {
    await ctx.reply(texts.help, { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
  });

  pm.command('cancel', async (ctx) => {
    if (!(await cancelLead(ctx, sessions))) {
      await ctx.reply(texts.nothingToCancel, { reply_markup: mainMenuKeyboard() });
    }
  });

  // Меню. Переход в меню прерывает незаконченную заявку.
  pm.callbackQuery(cb.main, async (ctx) => {
    sessions.clear(ctx.from.id);
    await ctx.answerCallbackQuery();
    await showScreen(ctx, texts.mainMenu, mainMenuKeyboard());
  });

  pm.callbackQuery(cb.services, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showScreen(ctx, servicesText(), servicesKeyboard());
  });

  pm.callbackQuery(cb.faq, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showScreen(ctx, texts.faqTitle, faqKeyboard());
  });

  pm.callbackQuery(/^faq:(.+)$/, async (ctx) => {
    const item = faq.find((f) => f.id === ctx.match[1]);
    await ctx.answerCallbackQuery();
    if (!item) {
      await showScreen(ctx, texts.faqTitle, faqKeyboard());
      return;
    }
    await showScreen(ctx, `<b>${escapeHtml(item.question)}</b>\n\n${escapeHtml(item.answer)}`, faqAnswerKeyboard());
  });

  pm.callbackQuery(cb.contacts, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showScreen(ctx, contactsText(), contactsKeyboard());
  });

  pm.use(createLeadFlow({ db, sessions, adminChatId, now }));

  // Текст вне диалога заявки.
  pm.on('message:text', async (ctx) => {
    await ctx.reply(texts.unknownMessage, { reply_markup: mainMenuKeyboard() });
  });

  // Фото, стикеры, голосовые и всё остальное вместо текста.
  pm.on('message', async (ctx) => {
    await ctx.reply(texts.pleaseSendText);
  });

  // Нажатие на устаревшую или неизвестную кнопку.
  pm.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery({ text: texts.leadExpired });
  });

  bot.catch(async (err) => {
    const { ctx, error } = err;
    if (error instanceof GrammyError) {
      console.error(`[bot] ошибка Telegram API в обновлении ${ctx.update.update_id}:`, error.description);
    } else if (error instanceof HttpError) {
      console.error(`[bot] сетевая ошибка в обновлении ${ctx.update.update_id}:`, error);
    } else {
      console.error(`[bot] ошибка в обновлении ${ctx.update.update_id}:`, error);
    }
    try {
      if (ctx.chat?.type === 'private') await ctx.reply(texts.error);
    } catch {
      // не удалось даже ответить — уже залогировано выше
    }
  });

  return bot;
}

/** Команды для меню Telegram (кнопка «/» рядом с полем ввода). */
export const BOT_COMMANDS = [
  { command: 'start', description: 'Главное меню' },
  { command: 'help', description: 'Что умеет бот' },
  { command: 'cancel', description: 'Прервать заявку' },
];
