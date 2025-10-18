// telegram-bot.js — Telegram Bot для управления прокси клиентами (FIXED FORMAT)
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// ====== КОНФИГУРАЦИЯ С ПОДДЕРЖКОЙ RAILWAY ПЕРЕМЕННЫХ ======
const BOT_TOKEN = process.env.BOT_TOKEN;

// ✅ ПОДДЕРЖКА РАЗНЫХ ФОРМАТОВ ПЕРЕМЕННЫХ
let ADMIN_IDS = [];
let SUPER_ADMIN_ID = null;
let MANAGER_IDS = [];

// Вариант 1: Единая переменная ADMIN_IDS
if (process.env.ADMIN_IDS) {
  ADMIN_IDS = process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())).filter(Boolean);
  SUPER_ADMIN_ID = ADMIN_IDS[0];
  MANAGER_IDS = ADMIN_IDS.slice(1);
}
// Вариант 2: Отдельные переменные SUPER_ADMIN и MANAGER_IDS
else {
  if (process.env.SUPER_ADMIN) {
    SUPER_ADMIN_ID = parseInt(process.env.SUPER_ADMIN.trim());
    ADMIN_IDS.push(SUPER_ADMIN_ID);
  }
  
  if (process.env.MANAGER_IDS) {
    MANAGER_IDS = process.env.MANAGER_IDS.split(',').map(id => parseInt(id.trim())).filter(Boolean);
    ADMIN_IDS.push(...MANAGER_IDS);
  }
}

console.log('🔐 ОТЛАДКА АВТОРИЗАЦИИ:');
console.log(`   BOT_TOKEN: ${BOT_TOKEN ? 'УСТАНОВЛЕН' : 'НЕ УСТАНОВЛЕН'}`);
console.log(`   ADMIN_IDS env: "${process.env.ADMIN_IDS || 'НЕ УСТАНОВЛЕНА'}"`);
console.log(`   SUPER_ADMIN env: "${process.env.SUPER_ADMIN || 'НЕ УСТАНОВЛЕНА'}"`);
console.log(`   MANAGER_IDS env: "${process.env.MANAGER_IDS || 'НЕ УСТАНОВЛЕНА'}"`);
console.log(`   ADMIN_IDS array: [${ADMIN_IDS.join(', ')}]`);
console.log(`   SUPER_ADMIN_ID: ${SUPER_ADMIN_ID || 'НЕ УСТАНОВЛЕН'}`);
console.log(`   MANAGER_IDS: [${MANAGER_IDS.join(', ')}]`);

const PROXY_SERVER_URL = process.env.PROXY_SERVER_URL || 'http://localhost:8080';
const API_AUTH = Buffer.from(`${process.env.API_USERNAME || 'telegram_bot'}:${process.env.API_PASSWORD || 'bot_secret_2024'}`).toString('base64');

const CONFIG_FILE = path.join(__dirname, 'clients-config.json');
const PORT = process.env.PORT || 8080;

// ====== ИНИЦИАЛИЗАЦИЯ ======
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
app.use(express.json({ limit: '10mb' }));

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

async function updateProxyServer() {
  try {
    const fetch = (await import('node-fetch')).default;
    
    console.log('🔄 Начинаем синхронизацию с прокси сервером...');
    console.log(`🌐 Прокси сервер URL: ${PROXY_SERVER_URL}`);
    
    // Получаем текущих клиентов с прокси сервера
    console.log('📥 Получаем список клиентов с прокси сервера...');
    const currentResponse = await fetch(`${PROXY_SERVER_URL}/api/clients`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    
    if (!currentResponse.ok) {
      const errorText = await currentResponse.text();
      console.error(`❌ Failed to get current clients: ${currentResponse.status} ${errorText}`);
      throw new Error(`Failed to get current clients: ${currentResponse.status}`);
    }
    
    const currentData = await currentResponse.json();
    const currentClients = Object.keys(currentData.clients || {});
    const localClients = Object.keys(clientsConfig);
    
    console.log(`📊 Синхронизация: Local=${localClients.length}, Remote=${currentClients.length}`);
    console.log(`📋 Local clients: [${localClients.join(', ')}]`);
    console.log(`📋 Remote clients: [${currentClients.join(', ')}]`);
    
    // Удаляем клиентов, которых нет в локальной конфигурации
    for (const clientName of currentClients) {
      if (!localClients.includes(clientName)) {
        console.log(`🗑 Удаляем клиента с прокси сервера: ${clientName}`);
        const deleteResponse = await fetch(`${PROXY_SERVER_URL}/api/delete-client/${clientName}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 15000
        });
        
        if (!deleteResponse.ok) {
          const errorText = await deleteResponse.text();
          console.error(`❌ Failed to delete client ${clientName}: ${deleteResponse.status} ${errorText}`);
        } else {
          console.log(`✅ Клиент ${clientName} успешно удален с прокси сервера`);
        }
      }
    }
    
    // Добавляем/обновляем клиентов из локальной конфигурации
    for (const [clientName, config] of Object.entries(clientsConfig)) {
      console.log(`🔍 Обрабатываем клиента: ${clientName}`);
      console.log(`   Логин: ${config.login}`);
      console.log(`   Пароль: ${config.password}`);
      console.log(`   Прокси: ${config.proxies.length} шт.`);
      
      if (config.proxies.length > 0) {
        console.log(`   Первый прокси: ${config.proxies[0]}`);
        console.log(`   Последний прокси: ${config.proxies[config.proxies.length - 1]}`);
      }
      
      if (!currentClients.includes(clientName)) {
        console.log(`➕ Добавляем клиента на прокси сервер: ${clientName}`);
        
        // ✅ ИСПРАВЛЕНО: Используем login вместо clientName для авторизации
        const requestBody = {
          clientName: clientName,
          login: config.login,
          password: config.password,
          proxies: config.proxies
        };
        
        console.log(`📤 Отправляем данные на ${PROXY_SERVER_URL}/api/add-client:`);
        console.log(JSON.stringify(requestBody, null, 2));
        
        const addResponse = await fetch(`${PROXY_SERVER_URL}/api/add-client`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          timeout: 15000
        });
        
        if (addResponse.ok) {
          const responseData = await addResponse.json();
          console.log(`✅ Клиент ${clientName} успешно добавлен на прокси сервер`);
          console.log(`📥 Ответ сервера:`, JSON.stringify(responseData, null, 2));
        } else {
          const errorText = await addResponse.text();
          console.error(`❌ Failed to add client ${clientName}: ${addResponse.status} ${errorText}`);
          return { success: false, error: `Failed to add client ${clientName}: ${addResponse.status} ${errorText}` };
        }
      } else {
        console.log(`✅ Клиент ${clientName} уже существует на прокси сервере`);
      }
    }
    
    console.log('✅ Синхронизация с прокси сервером завершена успешно');
    return { success: true };
    
  } catch (error) {
    console.error('⚠️ Ошибка синхронизации с прокси сервером:', error.message);
    console.error('📋 Stack trace:', error.stack);
    return { success: false, error: error.message };
  }
}

// ====== ФУНКЦИИ АВТОРИЗАЦИИ С ОТЛАДКОЙ ======
function isAuthorized(userId) {
  const authorized = ADMIN_IDS.includes(userId);
  console.log(`🔍 Проверка авторизации: userId=${userId}, authorized=${authorized}`);
  return authorized;
}

function isSuperAdmin(userId) {
  const isSuperAdm = userId === SUPER_ADMIN_ID;
  console.log(`👑 Проверка супер-админа: userId=${userId}, SUPER_ADMIN_ID=${SUPER_ADMIN_ID}, result=${isSuperAdm}`);
  return isSuperAdm;
}

function isManager(userId) {
  const isManagerResult = MANAGER_IDS.includes(userId);
  console.log(`👥 Проверка менеджера: userId=${userId}, MANAGER_IDS=[${MANAGER_IDS.join(', ')}], result=${isManagerResult}`);
  return isManagerResult;
}

function getUserRole(userId) {
  if (isSuperAdmin(userId)) return 'Супер-админ';
  if (isManager(userId)) return 'Менеджер';
  return 'Не авторизован';
}

// ====== ФУНКЦИИ ПАРСИНГА ПРОКСИ ======
function parseProxyList(proxyText) {
  const lines = proxyText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const proxies = [];
  const errors = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(':');
    
    if (parts.length === 4) {
      const [host, port, user, pass] = parts;
      const proxyUrl = `http://${user}:${pass}@${host}:${port}`;
      proxies.push(proxyUrl);
      console.log(`✅ Парсинг прокси ${i + 1}: ${host}:${port} -> ${proxyUrl}`);
    } else {
      const error = `Строка ${i + 1}: "${line}" - неверный формат (нужно host:port:user:pass)`;
      errors.push(error);
      console.log(`❌ ${error}`);
    }
  }
  
  console.log(`📊 Парсинг завершен: ${proxies.length} успешно, ${errors.length} ошибок`);
  return { proxies, errors };
}

// ====== ОБРАБОТЧИК ВСЕХ СООБЩЕНИЙ (ДЛЯ ОТЛАДКИ) ======
bot.on('message', (msg) => {
  const userId = msg.from.id;
  const username = msg.from.username || 'без username';
  const firstName = msg.from.first_name || 'без имени';
  
  console.log(`\n📨 ПОЛУЧЕНО СООБЩЕНИЕ:`);
  console.log(`   От: ${firstName} (@${username})`);
  console.log(`   ID: ${userId}`);
  console.log(`   Текст: "${msg.text ? msg.text.substring(0, 100) : 'не текст'}${msg.text && msg.text.length > 100 ? '...' : ''}"`);
  console.log(`   Авторизован: ${isAuthorized(userId)}`);
  console.log(`   Роль: ${getUserRole(userId)}`);
});

// ====== КОМАНДЫ БОТА ======
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const role = getUserRole(userId);
  
  console.log(`🚀 Команда /start от userId=${userId}, роль=${role}`);
  
  if (!isAuthorized(userId)) {
    const debugMessage = `
❌ **У вас нет доступа к этому боту.**

🔍 **Отладочная информация:**
• Ваш ID: \`${userId}\`
• ADMIN_IDS env: \`"${process.env.ADMIN_IDS || 'НЕ УСТАНОВЛЕНА'}"\`
• SUPER_ADMIN env: \`"${process.env.SUPER_ADMIN || 'НЕ УСТАНОВЛЕНА'}"\`
• MANAGER_IDS env: \`"${process.env.MANAGER_IDS || 'НЕ УСТАНОВЛЕНА'}"\`
• Настроенные админы: \`[${ADMIN_IDS.join(', ')}]\`
• Супер-админ: \`${SUPER_ADMIN_ID || 'НЕ УСТАНОВЛЕН'}\`

📝 **Для получения доступа (выберите один способ):**

**Способ 1:** Добавьте переменную \`ADMIN_IDS\`
• Значение: \`${userId}\`

**Способ 2:** Установите \`SUPER_ADMIN\`
• Значение: \`${userId}\`

**Способ 3:** Добавьте в \`MANAGER_IDS\`
• Значение: \`${userId}\`
    `;
    return bot.sendMessage(msg.chat.id, debugMessage, { parse_mode: 'Markdown' });
  }
  
  const welcomeMessage = `
🤖 **Добро пожаловать в Proxy Manager Bot!**

👤 Ваша роль: **${role}**
🆔 Ваш ID: \`${userId}\`

📋 **Доступные команды:**
/clients - Список всех клиентов
/addclient - Добавить клиента (быстро)
/addclientbulk - Добавить клиента со списком прокси
/deleteclient - Удалить клиента
/addproxy - Добавить прокси к клиенту
/status - Статус системы
/debug - Отладочная информация
/sync - Принудительная синхронизация с прокси сервером

🔧 **Админские команды:**
${isSuperAdmin(userId) ? '/manageadmins - Управление администраторами' : ''}
/restart - Перезапуск бота (только супер-админ)
  `;
  
  bot.sendMessage(msg.chat.id, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/debug/, async (msg) => {
  const userId = msg.from.id;
  
  const debugInfo = `
🔍 **Отладочная информация:**

👤 **Ваши данные:**
• ID: \`${userId}\`
• Username: @${msg.from.username || 'нет'}
• Имя: ${msg.from.first_name || 'нет'}

🔐 **Переменные окружения:**
• ADMIN_IDS: \`"${process.env.ADMIN_IDS || 'НЕ УСТАНОВЛЕНА'}"\`
• SUPER_ADMIN: \`"${process.env.SUPER_ADMIN || 'НЕ УСТАНОВЛЕНА'}"\`
• MANAGER_IDS: \`"${process.env.MANAGER_IDS || 'НЕ УСТАНОВЛЕНА'}"\`

📊 **Обработанные значения:**
• ADMIN_IDS массив: \`[${ADMIN_IDS.join(', ')}]\`
• Супер-админ: \`${SUPER_ADMIN_ID || 'НЕ УСТАНОВЛЕН'}\`
• Менеджеры: \`[${MANAGER_IDS.join(', ')}]\`

✅ **Статус доступа:**
• Авторизован: ${isAuthorized(userId) ? '✅ ДА' : '❌ НЕТ'}
• Супер-админ: ${isSuperAdmin(userId) ? '✅ ДА' : '❌ НЕТ'}
• Менеджер: ${isManager(userId) ? '✅ ДА' : '❌ НЕТ'}
• Роль: ${getUserRole(userId)}

🌐 **Настройки сервера:**
• Прокси сервер: \`${PROXY_SERVER_URL}\`
• Порт бота: \`${PORT}\`
• BOT_TOKEN: ${BOT_TOKEN ? '✅ УСТАНОВЛЕН' : '❌ НЕ УСТАНОВЛЕН'}
  `;
  
  bot.sendMessage(msg.chat.id, debugInfo, { parse_mode: 'Markdown' });
});

bot.onText(/\/clients/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }
  
  if (Object.keys(clientsConfig).length === 0) {
    return bot.sendMessage(msg.chat.id, '📝 Клиенты не найдены. Используйте /addclient для добавления.');
  }
  
  let message = '👥 **Список клиентов:**\n\n';
  
  for (const [clientName, config] of Object.entries(clientsConfig)) {
    message += `🔹 **${clientName}**\n`;
    message += `   └ Логин: \`${config.login}\`\n`;
    message += `   └ Пароль: \`${config.password}\`\n`;
    message += `   └ Прокси: ${config.proxies.length} шт.\n\n`;
  }
  
  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// ✅ КОМАНДА: Быстрое добавление клиента (ОБНОВЛЕНО)
bot.onText(/\/addclient/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }
  
  console.log(`➕ Команда /addclient от userId=${userId}`);
  
  const instructionMessage = `
➕ **Добавление нового клиента**

📋 **Два способа добавления:**

**1️⃣ Быстрое добавление (без прокси):**
\`имя_клиента логин пароль\`
Пример: \`client1 user123 mypassword123\`

**2️⃣ Полное добавление (с прокси):**
Используйте команду /addclientbulk

💡 **Выберите способ и введите данные:**
  `;
  
  bot.sendMessage(msg.chat.id, instructionMessage, { parse_mode: 'Markdown' });
  
  bot.once('message', async (response) => {
    if (response.from.id !== userId) return;
    
    console.log(`📝 Получен ответ для добавления клиента: "${response.text}"`);
    
    const parts = response.text.trim().split(' ');
    if (parts.length !== 3) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный формат. Используйте: `имя_клиента логин пароль`\n\nДля добавления с прокси используйте /addclientbulk', { parse_mode: 'Markdown' });
    }
    
    const [clientName, login, password] = parts;
    
    if (clientsConfig[clientName]) {
      return bot.sendMessage(msg.chat.id, `❌ Клиент **${clientName}** уже существует.`, { parse_mode: 'Markdown' });
    }
    
    clientsConfig[clientName] = {
      login,
      password,
      proxies: []
    };
    
    await saveConfig();
    console.log(`✅ Клиент ${clientName} добавлен локально`);
    
    const updateResult = await updateProxyServer();
    
    if (updateResult.success) {
      bot.sendMessage(msg.chat.id, `✅ Клиент **${clientName}** успешно добавлен!\n\n🔑 Логин: \`${login}\`\n🔐 Пароль: \`${password}\`\n📊 Прокси: 0 шт.\n\nИспользуйте /addproxy для добавления прокси или /addclientbulk для массового добавления.`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, `⚠️ Клиент добавлен локально, но не удалось обновить прокси сервер.\n\nОшибка: ${updateResult.error || 'Unknown error'}`, { parse_mode: 'Markdown' });
    }
  });
});

// ✅ КОМАНДА: Добавление клиента со списком прокси (ИСПРАВЛЕНО)
bot.onText(/\/addclientbulk/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }
  
  console.log(`📦 Команда /addclientbulk от userId=${userId}`);
  
  const instructionMessage = `
📦 **Добавление клиента со списком прокси**

📋 **ПРАВИЛЬНЫЙ ФОРМАТ:**
Строка 1: \`имя_клиента\`
Строка 2: \`логин\`
Строка 3: \`пароль\`
Строки 4+: список прокси в формате \`host:port:user:pass\`

📝 **Пример:**
\`\`\`
client1
user123
mypassword123
31.129.21.214:9379:gNzocE:fnKaHc
45.91.65.201:9524:gNzocE:fnKaHc
45.91.65.235:9071:gNzocE:fnKaHc
\`\`\`

💡 **Введите данные в указанном формате:**
  `;
  
  bot.sendMessage(msg.chat.id, instructionMessage, { parse_mode: 'Markdown' });
  
  bot.once('message', async (response) => {
    if (response.from.id !== userId) return;
    
    console.log(`📦 Получен ответ для массового добавления клиента`);
    console.log(`📝 Длина сообщения: ${response.text.length} символов`);
    
    const lines = response.text.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);
    console.log(`📋 Количество строк: ${lines.length}`);
    
    if (lines.length < 3) {
      return bot.sendMessage(msg.chat.id, '❌ Недостаточно данных. Нужно минимум 3 строки:\n1. Имя клиента\n2. Логин\n3. Пароль\n4+ Прокси (опционально)', { parse_mode: 'Markdown' });
    }
    
    // ✅ ИСПРАВЛЕНО: Правильный парсинг по строкам
    const clientName = lines[0].trim();
    const login = lines[1].trim();
    const password = lines[2].trim();
    
    console.log(`👤 Клиент: ${clientName}`);
    console.log(`🔑 Логин: ${login}`);
    console.log(`🔐 Пароль: ${password}`);
    
    if (clientsConfig[clientName]) {
      return bot.sendMessage(msg.chat.id, `❌ Клиент **${clientName}** уже существует.`, { parse_mode: 'Markdown' });
    }
    
    // Парсим прокси (строки 4 и далее)
    const proxyLines = lines.slice(3);
    console.log(`🌐 Строк с прокси: ${proxyLines.length}`);
    
    let proxies = [];
    let errors = [];
    
    if (proxyLines.length > 0) {
      const parseResult = parseProxyList(proxyLines.join('\n'));
      proxies = parseResult.proxies;
      errors = parseResult.errors;
    }
    
    // Создаем клиента с правильной структурой
    clientsConfig[clientName] = {
      login,
      password,
      proxies
    };
    
    await saveConfig();
    console.log(`✅ Клиент ${clientName} добавлен локально с ${proxies.length} прокси`);
    
    // Обновляем прокси сервер
    const updateResult = await updateProxyServer();
    
    let resultMessage = `✅ Клиент **${clientName}** успешно добавлен!\n\n`;
    resultMessage += `🔑 Логин: \`${login}\`\n`;
    resultMessage += `🔐 Пароль: \`${password}\`\n`;
    resultMessage += `📊 Прокси: ${proxies.length} шт.\n`;
    
    if (errors.length > 0) {
      resultMessage += `\n⚠️ **Ошибки в прокси:**\n`;
      errors.slice(0, 5).forEach(error => {
        resultMessage += `• ${error}\n`;
      });
      if (errors.length > 5) {
        resultMessage += `• ... и еще ${errors.length - 5} ошибок\n`;
      }
    }
    
    if (!updateResult.success) {
      resultMessage += `\n⚠️ Клиент добавлен локально, но не удалось обновить прокси сервер.\nОшибка: ${updateResult.error || 'Unknown error'}`;
    }
    
    bot.sendMessage(msg.chat.id, resultMessage, { parse_mode: 'Markdown' });
  });
});

// ✅ КОМАНДА: Принудительная синхронизация
bot.onText(/\/sync/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }
  
  console.log(`🔄 Команда /sync от userId=${userId}`);
  
  bot.sendMessage(msg.chat.id, '🔄 Начинаем принудительную синхронизацию с прокси сервером...', { parse_mode: 'Markdown' });
  
  const updateResult = await updateProxyServer();
  
  if (updateResult.success) {
    bot.sendMessage(msg.chat.id, '✅ Синхронизация завершена успешно!', { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(msg.chat.id, `❌ Ошибка синхронизации:\n\n\`${updateResult.error || 'Unknown error'}\``, { parse_mode: 'Markdown' });
  }
});

bot.onText(/\/status/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }
  
  const totalClients = Object.keys(clientsConfig).length;
  const totalProxies = Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0);
  
  let message = `📊 **Статус системы**\n\n`;
  message += `👥 Всего клиентов: ${totalClients}\n`;
  message += `🌐 Всего прокси: ${totalProxies}\n`;
  message += `🔗 Прокси сервер: ${PROXY_SERVER_URL}\n\n`;
  
  if (totalClients > 0) {
    message += `📋 **Детали по клиентам:**\n`;
    for (const [clientName, config] of Object.entries(clientsConfig)) {
      message += `• **${clientName}** (${config.login}): ${config.proxies.length} прокси\n`;
    }
  }
  
  const connectionOk = await testRailwayConnection();
  message += `\n🔌 Соединение с прокси сервером: ${connectionOk ? '✅ OK' : '❌ Ошибка'}`;
  
  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// ====== HTTP СЕРВЕР ======
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Telegram Proxy Manager Bot (FIXED FORMAT)</h1>
    <p>Bot is running with correct client format: clientName + login + password + proxies!</p>
    <p>ADMIN_IDS env: "${process.env.ADMIN_IDS || 'NOT SET'}"</p>
    <p>SUPER_ADMIN env: "${process.env.SUPER_ADMIN || 'NOT SET'}"</p>
    <p>MANAGER_IDS env: "${process.env.MANAGER_IDS || 'NOT SET'}"</p>
    <p>Parsed ADMIN_IDS: [${ADMIN_IDS.join(', ')}]</p>
    <p>Super Admin: ${SUPER_ADMIN_ID || 'NOT SET'}</p>
    <p>Managers: [${MANAGER_IDS.join(', ')}]</p>
    <p>Total clients: ${Object.keys(clientsConfig).length}</p>
    <p>Total proxies: ${Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0)}</p>
    <p>Proxy Server URL: ${PROXY_SERVER_URL}</p>
  `);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    clients: Object.keys(clientsConfig).length,
    proxies: Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0),
    adminIds: ADMIN_IDS,
    superAdmin: SUPER_ADMIN_ID,
    managers: MANAGER_IDS,
    proxyServerUrl: PROXY_SERVER_URL,
    envVars: {
      ADMIN_IDS: process.env.ADMIN_IDS || 'NOT SET',
      SUPER_ADMIN: process.env.SUPER_ADMIN || 'NOT SET',
      MANAGER_IDS: process.env.MANAGER_IDS || 'NOT SET'
    }
  });
});

// ====== ЗАПУСК ======
async function startBot() {
  await loadConfig();
  await testRailwayConnection();
  await updateProxyServer();
  
  app.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
  });
  
  console.log('🤖 Telegram Bot с правильным форматом клиентов запущен!');
  console.log(`🔑 Супер-админ: ${SUPER_ADMIN_ID}`);
  console.log(`👥 Менеджеры: ${MANAGER_IDS.join(', ')}`);
  console.log(`📁 Файл конфигурации: ${CONFIG_FILE}`);
  console.log(`🌐 Прокси сервер URL: ${PROXY_SERVER_URL}`);
}

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
