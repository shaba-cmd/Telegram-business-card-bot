import 'dotenv/config';

export interface Config {
  botToken: string;
  /** Чат, куда приходят заявки: личный ID владельца или ID группы (отрицательный). */
  adminChatId: number;
  dbPath: string;
  /** Если задан — бот работает через webhook, иначе через polling. */
  webhookUrl?: string;
  webhookSecret?: string;
  port: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Читает и проверяет настройки из переменных окружения (.env). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const botToken = env.BOT_TOKEN?.trim();
  if (!botToken) {
    throw new ConfigError('Не задан BOT_TOKEN. Скопируйте .env.example в .env и вставьте токен от @BotFather.');
  }
  if (!/^\d+:[\w-]{30,}$/.test(botToken)) {
    throw new ConfigError('BOT_TOKEN выглядит некорректно. Формат: 123456789:AA... (берётся у @BotFather).');
  }

  const adminRaw = env.ADMIN_CHAT_ID?.trim();
  if (!adminRaw) {
    throw new ConfigError('Не задан ADMIN_CHAT_ID — ID чата, куда будут приходить заявки. Как узнать — см. README.');
  }
  if (!/^-?\d+$/.test(adminRaw)) {
    throw new ConfigError('ADMIN_CHAT_ID должен быть числом, например 123456789 или -1001234567890.');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError('PORT должен быть числом от 1 до 65535.');
  }

  const webhookUrl = env.WEBHOOK_URL?.trim() || undefined;
  if (webhookUrl && !webhookUrl.startsWith('https://')) {
    throw new ConfigError('WEBHOOK_URL должен начинаться с https://');
  }

  return {
    botToken,
    adminChatId: Number(adminRaw),
    dbPath: env.DB_PATH?.trim() || './data/bot.db',
    webhookUrl,
    webhookSecret: env.WEBHOOK_SECRET?.trim() || undefined,
    port,
  };
}
