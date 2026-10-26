/**
 * Диалог «Оставить заявку» — простая машина состояний без внешних плагинов:
 * услуга → имя → контакт → комментарий → подтверждение.
 *
 * Черновики заявок хранятся в памяти: если бот перезапустится посреди
 * диалога, пользователь просто начнёт заново. Сами заявки — в SQLite.
 */
import { Composer, type Context } from 'grammy';
import { leadLabels, services, texts, timeZone, type Service } from './content.js';
import type { BotDatabase } from './db.js';
import {
  cancelKeyboard,
  cb,
  commentKeyboard,
  confirmKeyboard,
  leadServicesKeyboard,
  mainMenuKeyboard,
  removeButtons,
  showScreen,
} from './ui.js';
import { escapeHtml, formatDateTime, sanitizeText } from './utils.js';

export type LeadStep = 'service' | 'name' | 'contact' | 'comment' | 'confirm';

export interface LeadDraft {
  step: LeadStep;
  service?: Service;
  name?: string;
  contact?: string;
  comment?: string | null;
  updatedAt: number;
}

export const LIMITS = {
  name: 64,
  contact: 100,
  comment: 500,
} as const;

/** Не более 3 заявок в час от одного пользователя. */
export const RATE_LIMIT = {
  maxLeads: 3,
  windowMs: 60 * 60 * 1000,
} as const;

/** Через сколько неактивности черновик заявки забывается. */
const DRAFT_TTL_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Валидация                                                           */
/* ------------------------------------------------------------------ */

export type FieldResult = { ok: true; value: string } | { ok: false; error: string };

export function validateName(raw: string): FieldResult {
  const value = sanitizeText(raw);
  if (!value) return { ok: false, error: texts.nameEmpty };
  if (value.length > LIMITS.name) return { ok: false, error: texts.nameTooLong(LIMITS.name) };
  return { ok: true, value };
}

export function validateContact(raw: string): FieldResult {
  const value = sanitizeText(raw);
  if (!value) return { ok: false, error: texts.contactEmpty };
  if (value.length > LIMITS.contact) return { ok: false, error: texts.contactTooLong(LIMITS.contact) };
  return { ok: true, value };
}

export function validateComment(raw: string): FieldResult {
  const value = sanitizeText(raw, true);
  if (value.length > LIMITS.comment) return { ok: false, error: texts.commentTooLong(LIMITS.comment) };
  return { ok: true, value };
}

/**
 * Проверяет лимит заявок. Возвращает null, если отправлять можно,
 * иначе — через сколько минут освободится место.
 */
export function rateLimitWait(recentLeadTimes: Date[], now: Date): number | null {
  const windowStart = now.getTime() - RATE_LIMIT.windowMs;
  const inWindow = recentLeadTimes.filter((t) => t.getTime() > windowStart).sort((a, b) => a.getTime() - b.getTime());
  if (inWindow.length < RATE_LIMIT.maxLeads) return null;
  const freesAt = inWindow[inWindow.length - RATE_LIMIT.maxLeads].getTime() + RATE_LIMIT.windowMs;
  return Math.max(1, Math.ceil((freesAt - now.getTime()) / 60_000));
}

/* ------------------------------------------------------------------ */
/* Черновики                                                           */
/* ------------------------------------------------------------------ */

export class LeadSessions {
  private drafts = new Map<number, LeadDraft>();

  constructor(private readonly now: () => number = Date.now) {}

  get(userId: number): LeadDraft | undefined {
    const draft = this.drafts.get(userId);
    if (draft && this.now() - draft.updatedAt > DRAFT_TTL_MS) {
      this.drafts.delete(userId);
      return undefined;
    }
    return draft;
  }

  start(userId: number): LeadDraft {
    this.cleanup();
    const draft: LeadDraft = { step: 'service', updatedAt: this.now() };
    this.drafts.set(userId, draft);
    return draft;
  }

  update(userId: number, patch: Partial<LeadDraft>): LeadDraft | undefined {
    const draft = this.get(userId);
    if (!draft) return undefined;
    Object.assign(draft, patch, { updatedAt: this.now() });
    return draft;
  }

  clear(userId: number): boolean {
    return this.drafts.delete(userId);
  }

  private cleanup(): void {
    const now = this.now();
    for (const [id, draft] of this.drafts) {
      if (now - draft.updatedAt > DRAFT_TTL_MS) this.drafts.delete(id);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Тексты                                                              */
/* ------------------------------------------------------------------ */

export function formatSummary(draft: LeadDraft): string {
  return [
    texts.leadSummaryTitle,
    '',
    `${leadLabels.service}: ${escapeHtml(draft.service?.title ?? '')}`,
    `${leadLabels.name}: ${escapeHtml(draft.name ?? '')}`,
    `${leadLabels.contact}: ${escapeHtml(draft.contact ?? '')}`,
    `${leadLabels.comment}: ${draft.comment ? escapeHtml(draft.comment) : leadLabels.noComment}`,
  ].join('\n');
}

export interface LeadOwner {
  id: number;
  username?: string;
  firstName?: string;
}

/** Сообщение владельцу о новой заявке. */
export function formatAdminMessage(
  leadId: number,
  draft: LeadDraft,
  owner: LeadOwner,
  createdAt: Date,
): string {
  const displayName = escapeHtml(owner.firstName || draft.name || 'пользователь');
  const profile = owner.username
    ? `<a href="https://t.me/${owner.username}">@${escapeHtml(owner.username)}</a>`
    : `<a href="tg://user?id=${owner.id}">${displayName}</a> (ID ${owner.id})`;

  return [
    `🆕 <b>${leadLabels.number}${leadId}</b>`,
    '',
    `<b>${leadLabels.service}:</b> ${escapeHtml(draft.service?.title ?? '')}`,
    `<b>${leadLabels.name}:</b> ${escapeHtml(draft.name ?? '')}`,
    `<b>${leadLabels.contact}:</b> ${escapeHtml(draft.contact ?? '')}`,
    `<b>${leadLabels.comment}:</b> ${draft.comment ? escapeHtml(draft.comment) : leadLabels.noComment}`,
    `<b>${leadLabels.profile}:</b> ${profile}`,
    `<b>${leadLabels.time}:</b> ${formatDateTime(createdAt, timeZone)}`,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Обработчики                                                         */
/* ------------------------------------------------------------------ */

export interface LeadFlowDeps {
  db: BotDatabase;
  sessions: LeadSessions;
  adminChatId: number;
  now?: () => Date;
}

const html = { parse_mode: 'HTML' as const };

/** Отменяет заявку. Возвращает false, если активной заявки не было. */
export async function cancelLead(ctx: Context, sessions: LeadSessions): Promise<boolean> {
  const userId = ctx.from?.id;
  if (userId === undefined || !sessions.clear(userId)) return false;
  await ctx.reply(texts.leadCancelled, { reply_markup: mainMenuKeyboard() });
  return true;
}

export function createLeadFlow({ db, sessions, adminChatId, now = () => new Date() }: LeadFlowDeps): Composer<Context> {
  const flow = new Composer<Context>();

  const userIdOf = (ctx: Context): number => db.upsertUser({
    telegramId: ctx.from!.id,
    username: ctx.from!.username,
    firstName: ctx.from!.first_name,
  });

  /** Минуты ожидания, если пользователь исчерпал лимит заявок. */
  const limitFor = (ctx: Context): number | null => {
    const current = now();
    return rateLimitWait(db.recentLeadTimes(userIdOf(ctx), new Date(current.getTime() - RATE_LIMIT.windowMs)), current);
  };

  const expired = async (ctx: Context) => {
    await ctx.answerCallbackQuery({ text: texts.leadExpired, show_alert: true });
    await removeButtons(ctx);
  };

  // Шаг 0: начало заявки из главного меню или из списка услуг.
  flow.callbackQuery(cb.leadStart, async (ctx) => {
    await ctx.answerCallbackQuery();
    const wait = limitFor(ctx);
    if (wait !== null) {
      await ctx.reply(texts.leadRateLimited(wait), { reply_markup: mainMenuKeyboard() });
      return;
    }
    sessions.start(ctx.from.id);
    await showScreen(ctx, texts.leadChooseService, leadServicesKeyboard());
  });

  // Шаг 1: выбор услуги.
  flow.callbackQuery(/^lead:svc:(.+)$/, async (ctx) => {
    const draft = sessions.get(ctx.from.id);
    const service = services.find((s) => s.id === ctx.match[1]);
    if (!draft || draft.step !== 'service' || !service) return expired(ctx);

    sessions.update(ctx.from.id, { service, step: 'name' });
    await ctx.answerCallbackQuery();
    // Оставляем в истории выбранную услугу, кнопки убираем.
    try {
      await ctx.editMessageText(`${texts.leadChooseService}\n\n✅ ${escapeHtml(service.title)}`, html);
    } catch {
      await removeButtons(ctx);
    }
    await ctx.reply(texts.leadAskName, { ...html, reply_markup: cancelKeyboard() });
  });

  // Шаг 4: пропуск комментария.
  flow.callbackQuery(cb.leadSkip, async (ctx) => {
    const draft = sessions.get(ctx.from.id);
    if (!draft || draft.step !== 'comment') return expired(ctx);
    const updated = sessions.update(ctx.from.id, { comment: null, step: 'confirm' })!;
    await ctx.answerCallbackQuery();
    await removeButtons(ctx);
    await ctx.reply(formatSummary(updated), { ...html, reply_markup: confirmKeyboard() });
  });

  // Отмена кнопкой на любом шаге.
  flow.callbackQuery(cb.leadCancel, async (ctx) => {
    await ctx.answerCallbackQuery();
    await removeButtons(ctx);
    if (!(await cancelLead(ctx, sessions))) {
      await ctx.reply(texts.nothingToCancel, { reply_markup: mainMenuKeyboard() });
    }
  });

  // Подтверждение и отправка.
  flow.callbackQuery(cb.leadSend, async (ctx) => {
    const draft = sessions.get(ctx.from.id);
    if (!draft || draft.step !== 'confirm' || !draft.service || !draft.name || !draft.contact) return expired(ctx);

    // Очищаем черновик сразу, чтобы двойное нажатие не создало две заявки.
    sessions.clear(ctx.from.id);
    await ctx.answerCallbackQuery();
    await removeButtons(ctx);

    const wait = limitFor(ctx);
    if (wait !== null) {
      await ctx.reply(texts.leadRateLimited(wait), { reply_markup: mainMenuKeyboard() });
      return;
    }

    const lead = db.createLead({
      userId: userIdOf(ctx),
      service: draft.service.title,
      name: draft.name,
      contact: draft.contact,
      comment: draft.comment ?? null,
    });
    console.log(`[lead] новая заявка №${lead.id} от ${ctx.from.id}: ${draft.service.title}`);

    await ctx.reply(texts.leadAccepted, { reply_markup: mainMenuKeyboard() });

    // Заявка уже в базе: если уведомление не дошло, она не потеряется.
    try {
      const message = formatAdminMessage(
        lead.id,
        draft,
        { id: ctx.from.id, username: ctx.from.username, firstName: ctx.from.first_name },
        lead.createdAt,
      );
      await ctx.api.sendMessage(adminChatId, message, { ...html, link_preview_options: { is_disabled: true } });
    } catch (error) {
      console.error(`[lead] не удалось отправить заявку №${lead.id} администратору:`, error);
    }
  });

  // Текстовые шаги: имя, контакт, комментарий.
  flow.on('message:text', async (ctx, next) => {
    const draft = sessions.get(ctx.from.id);
    if (!draft) return next();

    switch (draft.step) {
      case 'name': {
        const result = validateName(ctx.message.text);
        if (!result.ok) return void (await ctx.reply(result.error, { reply_markup: cancelKeyboard() }));
        sessions.update(ctx.from.id, { name: result.value, step: 'contact' });
        await ctx.reply(texts.leadAskContact, { ...html, reply_markup: cancelKeyboard() });
        return;
      }
      case 'contact': {
        const result = validateContact(ctx.message.text);
        if (!result.ok) return void (await ctx.reply(result.error, { reply_markup: cancelKeyboard() }));
        sessions.update(ctx.from.id, { contact: result.value, step: 'comment' });
        await ctx.reply(texts.leadAskComment, { ...html, reply_markup: commentKeyboard() });
        return;
      }
      case 'comment': {
        const result = validateComment(ctx.message.text);
        if (!result.ok) return void (await ctx.reply(result.error, { reply_markup: commentKeyboard() }));
        const updated = sessions.update(ctx.from.id, { comment: result.value || null, step: 'confirm' })!;
        await ctx.reply(formatSummary(updated), { ...html, reply_markup: confirmKeyboard() });
        return;
      }
      case 'service':
      case 'confirm':
        await ctx.reply(texts.useButtons);
        return;
    }
  });

  return flow;
}
