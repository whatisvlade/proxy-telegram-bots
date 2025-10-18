// telegram-bot.js — Telegram Bot для управления прокси клиентами
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// ====== КОНФИГУРАЦИЯ ======
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(Boolean);
const SUPER_ADMIN_ID = ADMIN_IDS[0]; // Первый ID = супер-админ
const MANAGER_IDS = ADMIN_IDS.slice(1); // Остальные = менеджеры

const PROXY_SERVER_URL = process.env.PROXY_SERVER_URL || 'http://localhost:8080';
const API_AUTH = Buffer.from(`${process.env.API_USERNAME || 'telegram_bot'}:${process.env.API_PASSWORD || 'bot_secret_2024'}`).toString('base64');

const CONFIG_FILE = path.join(__dirname, 'clients-config.json');
const PORT = process.env.PORT || 8080;

// ====== ИНИЦИАЛИЗАЦИЯ ======
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
app.use(express.json());

let clientsConfig = {};

// ====== ФУНКЦИИ УПРАВЛЕНИЯ КОНФИГУРАЦИЕЙ ======
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    clientsConfig = JSON.parse(data);
    console.log('📁 Конфигурация загружена из файла');
  } catch (error) {
    console.log('📝 Создаем новый файл конфигурации');
    clientsConfig = {};
    await saveConfig();
  }
}

async function saveConfig() {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(clientsConfig, null, 2));
    console.log('💾 Конфигурация клиентов сохранена');
  } catch (error) {
    console.error('❌ Ошибка сохранения конфигурации:', error.message);
  }
}

// ====== ФУНКЦИИ РАБОТЫ С ПРОКСИ СЕРВЕРОМ ======
async function testRailwayConnection() {
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${PROXY_SERVER_URL}/status`, {
      method: 'GET',
      timeout: 10000
    });
    
    if (response.ok) {
      console.log('✅ Proxy server connection test successful');
      return true;
    } else {
      console.error('❌ Proxy server returned:', response.status, response.statusText);
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to connect to proxy server:', error.message);
    return false;
  }
}

// ✅ ИСПРАВЛЕНО: Добавлена защита от дублирования запросов
const pendingRequests = new Set();

async function updateProxyServer() {
  const requestKey = 'update_proxy_server';
  
  // Проверяем, не выполняется ли уже такой запрос
  if (pendingRequests.has(requestKey)) {
    console.log('⏳ Update proxy server request already in progress, skipping...');
    return { success: false, message: 'Request already in progress' };
  }
  
  pendingRequests.add(requestKey);
  
  try {
    const fetch = (await import('node-fetch')).default;
    
    // Получаем текущих клиентов с прокси сервера
    const currentResponse = await fetch(`${PROXY_SERVER_URL}/api/clients`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${API_AUTH}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    
    if (!currentResponse.ok) {
      throw new Error(`Failed to get current clients: ${currentResponse.status}`);
    }
    
    const currentData = await currentResponse.json();
    const currentClients = Object.keys(currentData.clients || {});
    const localClients = Object.keys(clientsConfig);
    
    console.log(`🔄 Синхронизация: Local=${localClients.length}, Remote=${currentClients.length}`);
    
    // Удаляем клиентов, которых нет в локальной конфигурации
    for (const clientName of currentClients) {
      if (!localClients.includes(clientName)) {
        console.log(`🗑 Удаляем клиента с прокси сервера: ${clientName}`);
        await fetch(`${PROXY_SERVER_URL}/api/delete-client/${clientName}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Basic ${API_AUTH}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        });
      }
    }
    
    // Добавляем/обновляем клиентов из локальной конфигурации
    for (const [clientName, config] of Object.entries(clientsConfig)) {
      if (!currentClients.includes(clientName)) {
        console.log(`➕ Добавляем клиента на прокси сервер: ${clientName}`);
        const addResponse = await fetch(`${PROXY_SERVER_URL}/api/add-client`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${API_AUTH}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            clientName,
            password: config.password,
            proxies: config.proxies
          }),
          timeout: 15000
        });
        
        if (!addResponse.ok) {
          const errorText = await addResponse.text();
          console.error(`❌ Failed to add client ${clientName}:`, addResponse.status, errorText);
        }
      }
    }
    
    console.log('✅ Proxy server updated successfully');
    return { success: true };
    
  } catch (error) {
    console.error('⚠️ Failed to update proxy server:', error.message);
    return { success: false, error: error.message };
  } finally {
    pendingRequests.delete(requestKey);
  }
}

// ====== ФУНКЦИИ АВТОРИЗАЦИИ ======
function isAuthorized(userId) {
  return ADMIN_IDS.includes(userId);
}

function isSuperAdmin(userId) {
  return userId === SUPER_ADMIN_ID;
}

function isManager(userId) {
  return MANAGER_IDS.includes(userId);
}

function getUserRole(userId) {
  if (isSuperAdmin(userId)) return 'Супер-админ';
  if (isManager(userId)) return 'Менеджер';
  return 'Не авторизован';
}

// ====== КОМАНДЫ БОТА ======
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const role = getUserRole(userId);
  
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, '❌ У вас нет доступа к этому боту.');
  }
  
  const welcomeMessage = `
🤖 **Добро пожаловать в Proxy Manager Bot!**

👤 Ваша роль: **${role}**
🆔 Ваш ID: \`${userId}\`

📋 **Доступные команды:**
/clients - Список всех клиентов
/add_client - Добавить нового клиента
/delete_client - Удалить клиента
/add_proxy - Добавить прокси к клиенту
/remove_proxy - Удалить прокси у клиента
/rotate_proxy - Ротировать прокси клиента
/status - Статус системы

🔧 **Админские команды:**
${isSuperAdmin(userId) ? '/manage_admins - Управление администраторами' : ''}
/restart - Перезапуск бота (только супер-админ)
  `;
  
  bot.sendMessage(msg.chat.id, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/clients/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) return;
  
  if (Object.keys(clientsConfig).length === 0) {
    return bot.sendMessage(msg.chat.id, '📝 Клиенты не найдены. Используйте /add_client для добавления.');
  }
  
  let message = '👥 **Список клиентов:**\n\n';
  
  for (const [clientName, config] of Object.entries(clientsConfig)) {
    message += `🔹 **${clientName}**\n`;
    message += `   └ Пароль: \`${config.password}\`\n`;
    message += `   └ Прокси: ${config.proxies.length} шт.\n\n`;
  }
  
  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/add_client/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) return;
  
  bot.sendMessage(msg.chat.id, '➕ **Добавление нового клиента**\n\nВведите данные в формате:\n`имя_клиента пароль`\n\nПример: `client1 mypassword123`', { parse_mode: 'Markdown' });
  
  bot.once('message', async (response) => {
    if (response.from.id !== userId) return;
    
    const parts = response.text.trim().split(' ');
    if (parts.length !== 2) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный формат. Используйте: `имя_клиента пароль`', { parse_mode: 'Markdown' });
    }
    
    const [clientName, password] = parts;
    
    if (clientsConfig[clientName]) {
      return bot.sendMessage(msg.chat.id, `❌ Клиент **${clientName}** уже существует.`, { parse_mode: 'Markdown' });
    }
    
    clientsConfig[clientName] = {
      password,
      proxies: []
    };
    
    await saveConfig();
    
    // ✅ ИСПРАВЛЕНО: Обновляем прокси сервер с защитой от дублирования
    const updateResult = await updateProxyServer();
    
    if (updateResult.success) {
      bot.sendMessage(msg.chat.id, `✅ Клиент **${clientName}** успешно добавлен!\n\n🔑 Пароль: \`${password}\`\n📊 Прокси: 0 шт.\n\nИспользуйте /add_proxy для добавления прокси.`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, `⚠️ Клиент добавлен локально, но не удалось обновить прокси сервер.\n\nОшибка: ${updateResult.error || 'Unknown error'}`, { parse_mode: 'Markdown' });
    }
  });
});

bot.onText(/\/delete_client/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) return;
  
  if (Object.keys(clientsConfig).length === 0) {
    return bot.sendMessage(msg.chat.id, '📝 Нет клиентов для удаления.');
  }
  
  const clientsList = Object.keys(clientsConfig).map(name => `• ${name}`).join('\n');
  bot.sendMessage(msg.chat.id, `🗑 **Удаление клиента**\n\nДоступные клиенты:\n${clientsList}\n\nВведите имя клиента для удаления:`, { parse_mode: 'Markdown' });
  
  bot.once('message', async (response) => {
    if (response.from.id !== userId) return;
    
    const clientName = response.text.trim();
    
    if (!clientsConfig[clientName]) {
      return bot.sendMessage(msg.chat.id, `❌ Клиент **${clientName}** не найден.`, { parse_mode: 'Markdown' });
    }
    
    const proxiesCount = clientsConfig[clientName].proxies.length;
    delete clientsConfig[clientName];
    
    await saveConfig();
    
    // ✅ ИСПРАВЛЕНО: Обновляем прокси сервер с защитой от дублирования
    const updateResult = await updateProxyServer();
    
    if (updateResult.success) {
      bot.sendMessage(msg.chat.id, `✅ Клиент **${clientName}** успешно удален!\n\n📊 Удалено прокси: ${proxiesCount} шт.`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, `⚠️ Клиент удален локально, но не удалось обновить прокси сервер.\n\nОшибка: ${updateResult.error || 'Unknown error'}`, { parse_mode: 'Markdown' });
    }
  });
});

bot.onText(/\/add_proxy/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) return;
  
  if (Object.keys(clientsConfig).length === 0) {
    return bot.sendMessage(msg.chat.id, '📝 Сначала добавьте клиента с помощью /add_client');
  }
  
  const clientsList = Object.keys(clientsConfig).map(name => `• ${name}`).join('\n');
  bot.sendMessage(msg.chat.id, `➕ **Добавление прокси**\n\nДоступные клиенты:\n${clientsList}\n\nВведите данные в формате:\n\`имя_клиента host:port:user:pass\`\n\nПример: \`client1 31.44.190.27:9625:512sdn:M0HBKk\``, { parse_mode: 'Markdown' });
  
  bot.once('message', async (response) => {
    if (response.from.id !== userId) return;
    
    const parts = response.text.trim().split(' ');
    if (parts.length !== 2) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный формат. Используйте: `имя_клиента host:port:user:pass`', { parse_mode: 'Markdown' });
    }
    
    const [clientName, proxyString] = parts;
    
    if (!clientsConfig[clientName]) {
      return bot.sendMessage(msg.chat.id, `❌ Клиент **${clientName}** не найден.`, { parse_mode: 'Markdown' });
    }
    
    // Парсим прокси в формат http://user:pass@host:port
    const proxyParts = proxyString.split(':');
    if (proxyParts.length !== 4) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный формат прокси. Используйте: `host:port:user:pass`', { parse_mode: 'Markdown' });
    }
    
    const [host, port, user, pass] = proxyParts;
    const proxyUrl = `http://${user}:${pass}@${host}:${port}`;
    
    if (clientsConfig[clientName].proxies.includes(proxyUrl)) {
      return bot.sendMessage(msg.chat.id, `❌ Прокси **${host}:${port}** уже существует у клиента **${clientName}**.`, { parse_mode: 'Markdown' });
    }
    
    clientsConfig[clientName].proxies.push(proxyUrl);
    await saveConfig();
    
    // ✅ ИСПРАВЛЕНО: Обновляем прокси сервер с защитой от дублирования
    const updateResult = await updateProxyServer();
    
    if (updateResult.success) {
      bot.sendMessage(msg.chat.id, `✅ Прокси добавлен к клиенту **${clientName}**!\n\n🌐 Прокси: \`${host}:${port}\`\n📊 Всего прокси: ${clientsConfig[clientName].proxies.length} шт.`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, `⚠️ Прокси добавлен локально, но не удалось обновить прокси сервер.\n\nОшибка: ${updateResult.error || 'Unknown error'}`, { parse_mode: 'Markdown' });
    }
  });
});

bot.onText(/\/status/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) return;
  
  const totalClients = Object.keys(clientsConfig).length;
  const totalProxies = Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0);
  
  let message = `📊 **Статус системы**\n\n`;
  message += `👥 Всего клиентов: ${totalClients}\n`;
  message += `🌐 Всего прокси: ${totalProxies}\n`;
  message += `🔗 Прокси сервер: ${PROXY_SERVER_URL}\n\n`;
  
  if (totalClients > 0) {
    message += `📋 **Детали по клиентам:**\n`;
    for (const [clientName, config] of Object.entries(clientsConfig)) {
      message += `• **${clientName}**: ${config.proxies.length} прокси\n`;
    }
  }
  
  // Проверяем соединение с прокси сервером
  const connectionOk = await testRailwayConnection();
  message += `\n🔌 Соединение с прокси сервером: ${connectionOk ? '✅ OK' : '❌ Ошибка'}`;
  
  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// ====== HTTP СЕРВЕР ======
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Telegram Proxy Manager Bot</h1>
    <p>Bot is running and ready to manage proxy clients!</p>
    <p>Total clients: ${Object.keys(clientsConfig).length}</p>
    <p>Total proxies: ${Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0)}</p>
  `);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    clients: Object.keys(clientsConfig).length,
    proxies: Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0)
  });
});

// ====== ЗАПУСК ======
async function startBot() {
  await loadConfig();
  
  // Тестируем соединение с прокси сервером
  await testRailwayConnection();
  
  // Синхронизируем с прокси сервером
  await updateProxyServer();
  
  app.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
  });
  
  console.log('🤖 Telegram Bot с системой ролей запущен!');
  console.log(`🔑 Супер-админ: ${SUPER_ADMIN_ID}`);
  console.log(`👥 Менеджеры: ${MANAGER_IDS.join(', ')}`);
  console.log(`📁 Файл конфигурации: ${CONFIG_FILE}`);
  console.log(`🌐 Прокси сервер URL: ${PROXY_SERVER_URL}`);
  console.log(`🔐 API Auth: ${process.env.API_USERNAME || 'telegram_bot'}:${process.env.API_PASSWORD || 'bot_secret_2024'}`);
}

// Обработка ошибок
bot.on('error', (error) => {
  console.error('❌ Telegram Bot Error:', error.message);
});

bot.on('polling_error', (error) => {
  console.error('❌ Polling Error:', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

startBot().catch(console.error);
