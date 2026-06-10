// bot/index.js - Telegram Bot
const TelegramBot = require('node-telegram-bot-api');
const db = require('../db');

function startBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminId = String(process.env.ADMIN_USER_ID);

  if (!token) {
    console.warn('⚠️  No TELEGRAM_BOT_TOKEN set, bot disabled');
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log('🤖 Telegram bot started');

  // ── Helper: only admins can use these commands ──────────────────────────
  function isAdmin(chatId) {
    return String(chatId) === adminId;
  }

  // ── /start ───────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    // Check if this chat belongs to a company that registered with this Telegram ID
    const result = await db.query(
      'SELECT * FROM companies WHERE telegram_chat_id = $1',
      [String(chatId)]
    );

    if (result.rows.length > 0) {
      const company = result.rows[0];
      const statusEmoji = { approved: '✅', pending: '⏳', rejected: '❌' }[company.payment_status] || '❓';
      bot.sendMessage(chatId,
        `Welcome back, *${company.name}*!\n\n` +
        `Status: ${statusEmoji} ${company.payment_status}\n\n` +
        (company.payment_status === 'approved'
          ? `Your website: ${process.env.BASE_URL}/view/${company.id}`
          : 'Your account is pending admin approval.'),
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(chatId,
        `👋 Welcome to *3D Viewer SaaS*!\n\n` +
        `To register your company, send your company name like this:\n\n` +
        `*/register Your Company Name*`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // ── /register <Company Name> ─────────────────────────────────────────────
  bot.onText(/\/register (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const companyName = match[1].trim();

    // Check if already registered
    const existing = await db.query(
      'SELECT id FROM companies WHERE telegram_chat_id = $1',
      [String(chatId)]
    );
    if (existing.rows.length > 0) {
      return bot.sendMessage(chatId, '⚠️ You already have a registered account. Use /status to check it.');
    }

    // Create company record
    try {
      const result = await db.query(
        `INSERT INTO companies (name, email, telegram_chat_id, payment_status)
         VALUES ($1, $2, $3, 'pending') RETURNING id`,
        [companyName, `telegram_${chatId}@placeholder.com`, String(chatId)]
      );
      const companyId = result.rows[0].id;

      bot.sendMessage(chatId,
        `✅ *Registration received!*\n\n` +
        `Company: *${companyName}*\n` +
        `Status: ⏳ Pending approval\n\n` +
        `An admin will review your request and approve or reject it.`,
        { parse_mode: 'Markdown' }
      );

      // Notify admin
      if (adminId) {
        bot.sendMessage(adminId,
          `🆕 *New company registration!*\n\n` +
          `Company: *${companyName}*\n` +
          `ID: \`${companyId}\`\n` +
          `Telegram Chat ID: \`${chatId}\`\n\n` +
          `Use:\n/approve ${companyId}\n/reject ${companyId}`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (err) {
      console.error('Registration error:', err);
      bot.sendMessage(chatId, '❌ Registration failed. Please try again.');
    }
  });

  // ── /status ──────────────────────────────────────────────────────────────
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const result = await db.query(
      'SELECT * FROM companies WHERE telegram_chat_id = $1',
      [String(chatId)]
    );

    if (result.rows.length === 0) {
      return bot.sendMessage(chatId, 'You are not registered. Use /register to sign up.');
    }

    const company = result.rows[0];
    const statusEmoji = { approved: '✅', pending: '⏳', rejected: '❌' }[company.payment_status] || '❓';

    bot.sendMessage(chatId,
      `*Your Account Status*\n\n` +
      `Company: *${company.name}*\n` +
      `Status: ${statusEmoji} ${company.payment_status}\n` +
      `Plan: ${company.plan}\n` +
      (company.payment_status === 'approved'
        ? `\n🔗 Your website:\n${process.env.BASE_URL}/view/${company.id}`
        : ''),
      { parse_mode: 'Markdown' }
    );
  });

  // ── /pending  (ADMIN ONLY) ───────────────────────────────────────────────
  bot.onText(/\/pending/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '🚫 Admin only.');

    const result = await db.query(
      `SELECT id, name, email, created_at FROM companies WHERE payment_status = 'pending' ORDER BY created_at`
    );

    if (result.rows.length === 0) {
      return bot.sendMessage(chatId, '✅ No pending registrations.');
    }

    let text = `⏳ *Pending Registrations (${result.rows.length})*\n\n`;
    result.rows.forEach(c => {
      text += `ID: \`${c.id}\`  |  *${c.name}*\n`;
      text += `/approve ${c.id}  or  /reject ${c.id}\n\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // ── /approve <id>  (ADMIN ONLY) ─────────────────────────────────────────
  bot.onText(/\/approve (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '🚫 Admin only.');

    const companyId = match[1];
    const result = await db.query(
      `UPDATE companies SET payment_status = 'approved' WHERE id = $1 RETURNING *`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return bot.sendMessage(chatId, `❌ Company ID ${companyId} not found.`);
    }

    const company = result.rows[0];
    bot.sendMessage(chatId, `✅ Approved: *${company.name}* (ID: ${companyId})`, { parse_mode: 'Markdown' });

    // Notify the company
    if (company.telegram_chat_id) {
      bot.sendMessage(company.telegram_chat_id,
        `🎉 *Your account has been approved!*\n\n` +
        `You can now log in and upload your 3D products:\n` +
        `${process.env.BASE_URL}/dashboard/${company.id}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // ── /reject <id>  (ADMIN ONLY) ──────────────────────────────────────────
  bot.onText(/\/reject (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '🚫 Admin only.');

    const companyId = match[1];
    const result = await db.query(
      `UPDATE companies SET payment_status = 'rejected' WHERE id = $1 RETURNING *`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return bot.sendMessage(chatId, `❌ Company ID ${companyId} not found.`);
    }

    const company = result.rows[0];
    bot.sendMessage(chatId, `❌ Rejected: *${company.name}* (ID: ${companyId})`, { parse_mode: 'Markdown' });

    if (company.telegram_chat_id) {
      bot.sendMessage(company.telegram_chat_id,
        `❌ Unfortunately your account registration was not approved.\n` +
        `Please contact support for more information.`
      );
    }
  });

  // ── /list  (ADMIN: list all companies) ──────────────────────────────────
  bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return bot.sendMessage(chatId, '🚫 Admin only.');

    const result = await db.query(
      `SELECT id, name, payment_status, plan, created_at FROM companies ORDER BY created_at DESC LIMIT 20`
    );

    if (result.rows.length === 0) {
      return bot.sendMessage(chatId, 'No companies registered yet.');
    }

    let text = `📋 *All Companies*\n\n`;
    result.rows.forEach(c => {
      const emoji = { approved: '✅', pending: '⏳', rejected: '❌' }[c.payment_status] || '❓';
      text += `${emoji} [${c.id}] *${c.name}* — ${c.plan}\n`;
    });

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  return bot;
}

module.exports = { startBot };
