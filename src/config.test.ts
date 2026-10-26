import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_';

describe('loadConfig', () => {
  it('читает обязательные и необязательные настройки', () => {
    const config = loadConfig({ BOT_TOKEN: TOKEN, ADMIN_CHAT_ID: '-1001234567890' });
    expect(config.adminChatId).toBe(-1001234567890);
    expect(config.dbPath).toBe('./data/bot.db');
    expect(config.webhookUrl).toBeUndefined();
    expect(config.port).toBe(3000);
  });

  it('понятно ругается на отсутствующие и неверные значения', () => {
    expect(() => loadConfig({})).toThrow(/BOT_TOKEN/);
    expect(() => loadConfig({ BOT_TOKEN: 'abc', ADMIN_CHAT_ID: '1' })).toThrow(ConfigError);
    expect(() => loadConfig({ BOT_TOKEN: TOKEN })).toThrow(/ADMIN_CHAT_ID/);
    expect(() => loadConfig({ BOT_TOKEN: TOKEN, ADMIN_CHAT_ID: '@me' })).toThrow(/числом/);
    expect(() => loadConfig({ BOT_TOKEN: TOKEN, ADMIN_CHAT_ID: '1', WEBHOOK_URL: 'http://x' })).toThrow(/https/);
  });
});
