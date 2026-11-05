import { createServer } from 'node:http';
import { webhookCallback } from 'grammy';
import { BOT_COMMANDS, createBot } from './bot.js';
import { ConfigError, loadConfig } from './config.js';
import { business } from './content.js';
import { createDatabase } from './db.js';

async function main() {
  const config = loadConfig();
  const db = createDatabase(config.dbPath);
  const bot = createBot({ token: config.botToken, adminChatId: config.adminChatId, db });

  await bot.init();
  await bot.api.setMyCommands(BOT_COMMANDS);
  console.log(`[start] ${business.name}: бот @${bot.botInfo.username} запущен, база ${config.dbPath}`);

  let stop: () => Promise<void>;

  if (config.webhookUrl) {
    // Продакшен-вариант: Telegram сам присылает обновления на HTTPS-адрес.
    const handle = webhookCallback(bot, 'http', { secretToken: config.webhookSecret });
    const path = new URL(config.webhookUrl).pathname;
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === path) {
        handle(req, res).catch((error) => {
          console.error('[webhook] ошибка обработки:', error);
          if (!res.headersSent) res.writeHead(500).end();
        });
        return;
      }
      res.writeHead(req.url === '/health' ? 200 : 404).end(req.url === '/health' ? 'ok' : undefined);
    });
    await bot.api.setWebhook(config.webhookUrl, {
      secret_token: config.webhookSecret,
      allowed_updates: ['message', 'callback_query'],
    });
    server.listen(config.port, () => console.log(`[start] webhook ${config.webhookUrl}, порт ${config.port}`));
    stop = () => new Promise((resolve) => server.close(() => resolve()));
  } else {
    // Разработка и Docker без домена: бот сам опрашивает Telegram.
    await bot.api.deleteWebhook();
    void bot.start({
      allowed_updates: ['message', 'callback_query'],
      onStart: () => console.log('[start] режим polling'),
    });
    stop = () => bot.stop();
  }

  const shutdown = async (signal: string) => {
    console.log(`[stop] получен ${signal}, останавливаемся…`);
    await stop();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    console.error(`[config] ${error.message}`);
  } else {
    console.error('[start] не удалось запустить бота:', error);
  }
  process.exit(1);
});
