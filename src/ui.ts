import { InlineKeyboard, type Context } from 'grammy';
import { buttons, contacts, faq, services } from './content.js';

/** callback_data всех кнопок. Короткие строки: у Telegram лимит 64 байта. */
export const cb = {
  main: 'menu:main',
  services: 'menu:services',
  faq: 'menu:faq',
  faqItem: (id: string) => `faq:${id}`,
  contacts: 'menu:contacts',
  leadStart: 'lead:start',
  leadService: (id: string) => `lead:svc:${id}`,
  leadSkip: 'lead:skip',
  leadSend: 'lead:send',
  leadCancel: 'lead:cancel',
} as const;

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(buttons.services, cb.services)
    .row()
    .text(buttons.faq, cb.faq)
    .row()
    .text(buttons.lead, cb.leadStart)
    .row()
    .text(buttons.contacts, cb.contacts);
}

export function servicesKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(buttons.lead, cb.leadStart).row().text(buttons.back, cb.main);
}

export function faqKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const item of faq) keyboard.text(item.question, cb.faqItem(item.id)).row();
  return keyboard.text(buttons.back, cb.main);
}

export function faqAnswerKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(buttons.back, cb.faq).row().text(buttons.mainMenu, cb.main);
}

export function contactsKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (contacts.website) keyboard.url(buttons.website, contacts.website).row();
  return keyboard.text(buttons.back, cb.main);
}

export function leadServicesKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const service of services) keyboard.text(service.title, cb.leadService(service.id)).row();
  return keyboard.text(buttons.cancel, cb.leadCancel);
}

export function cancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(buttons.cancel, cb.leadCancel);
}

export function commentKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(buttons.skip, cb.leadSkip).row().text(buttons.cancel, cb.leadCancel);
}

export function confirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(buttons.send, cb.leadSend).text(buttons.cancel, cb.leadCancel);
}

/**
 * Показывает «экран» меню: при нажатии на inline-кнопку редактирует
 * текущее сообщение, иначе отправляет новое. Если отредактировать
 * не получилось (сообщение слишком старое или текст не изменился),
 * отправляет новое сообщение.
 */
export async function showScreen(ctx: Context, text: string, keyboard: InlineKeyboard): Promise<void> {
  const options = { parse_mode: 'HTML' as const, reply_markup: keyboard, link_preview_options: { is_disabled: true } };
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, options);
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes('message is not modified')) return;
    }
  }
  await ctx.reply(text, options);
}

/** Убирает кнопки у сообщения, на котором нажали кнопку, чтобы их нельзя было нажать повторно. */
export async function removeButtons(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery?.message) return;
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch {
    // сообщение могло быть удалено или уже без кнопок — это не ошибка
  }
}
