// Автоматическая покупка прокси через PROXY6.net API при добавлении клиента

// telegram-bot.js — Telegram Bot для управления прокси клиентами (SIMPLE FORMAT)
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

// ====== КОНФИГУРАЦИЯ PROXY6.NET API ======
const PROXY6_API_KEY = process.env.PROXY6_API_KEY;
const PROXY6_BASE_URL = 'https://px6.link/api';
const AUTO_BUY_PROXIES = process.env.AUTO_BUY_PROXIES === 'true';
const DEFAULT_PROXY_COUNT = parseInt(process.env.DEFAULT_PROXY_COUNT) || 30;
const DEFAULT_PROXY_PERIOD = parseInt(process.env.DEFAULT_PROXY_PERIOD) || 7;
const DEFAULT_PROXY_COUNTRY = process.env.DEFAULT_PROXY_COUNTRY || 'ru';
const DEFAULT_PROXY_VERSION = parseInt(process.env.DEFAULT_PROXY_VERSION) || 3; // 3 = IPv4 Shared

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

// ====== ФУНКЦИИ РАБОТЫ С PROXY6.NET API ======
async function buyProxiesFromProxy6(clientName, count = DEFAULT_PROXY_COUNT, period = DEFAULT_PROXY_PERIOD, country = DEFAULT_PROXY_COUNTRY, version = DEFAULT_PROXY_VERSION) {
  if (!PROXY6_API_KEY) {
    console.log('⚠️ PROXY6_API_KEY не установлен, пропускаем покупку прокси');
    return { success: false, error: 'PROXY6_API_KEY не установлен' };
  }

  try {
    const fetch = (await import('node-fetch')).default;
    
    console.log(`🛒 Покупаем прокси через PROXY6.net для клиента ${clientName}`);
    console.log(`📊 Параметры: count=${count}, period=${period}, country=${country}, version=${version}`);

    // Сначала проверяем цену
    const priceUrl = `${PROXY6_BASE_URL}/${PROXY6_API_KEY}/getprice?count=${count}&period=${period}&version=${version}`;
    console.log(`💰 Проверяем цену: ${priceUrl}`);

    const priceResponse = await fetch(priceUrl, {
      method: 'GET',
      timeout: 10000
    });

    if (!priceResponse.ok) {
      throw new Error(`HTTP ${priceResponse.status}: ${priceResponse.statusText}`);
    }

    const priceData = await priceResponse.json();
    console.log(`💰 Ответ цены:`, JSON.stringify(priceData, null, 2));

    if (priceData.status !== 'yes') {
      throw new Error(`Ошибка получения цены: ${priceData.error || 'Unknown error'}`);
    }

    console.log(`💰 Стоимость: ${priceData.price} ${priceData.currency}, баланс: ${priceData.balance}`);

    // Проверяем доступность прокси для страны
    const countUrl = `${PROXY6_BASE_URL}/${PROXY6_API_KEY}/getcount?country=${country}&version=${version}`;
    console.log(`📊 Проверяем доступность: ${countUrl}`);

    const countResponse = await fetch(countUrl, {
      method: 'GET',
      timeout: 10000
    });

    if (!countResponse.ok) {
      throw new Error(`HTTP ${countResponse.status}: ${countResponse.statusText}`);
    }

    const countData = await countResponse.json();
    console.log(`📊 Ответ доступности:`, JSON.stringify(countData, null, 2));

    if (countData.status !== 'yes') {
      throw new Error(`Ошибка проверки доступности: ${countData.error || 'Unknown error'}`);
    }

    if (countData.count < count) {
      throw new Error(`Недостаточно прокси. Доступно: ${countData.count}, требуется: ${count}`);
    }

    console.log(`📊 Доступно прокси: ${countData.count}`);

    // Покупаем прокси
    const buyUrl = `${PROXY6_BASE_URL}/${PROXY6_API_KEY}/buy?count=${count}&period=${period}&country=${country}&version=${version}&descr=${encodeURIComponent(clientName)}`;
    console.log(`🛒 Покупаем прокси: ${buyUrl}`);

    const buyResponse = await fetch(buyUrl, {
      method: 'GET',
      timeout: 15000
    });

    if (!buyResponse.ok) {
      throw new Error(`HTTP ${buyResponse.status}: ${buyResponse.statusText}`);
    }

    const buyData = await buyResponse.json();
    console.log(`🛒 Ответ покупки:`, JSON.stringify(buyData, null, 2));

    if (buyData.status !== 'yes') {
      throw new Error(`Ошибка покупки: ${buyData.error || 'Unknown error'}`);
    }

    // Конвертируем купленные прокси в нужный формат
    const proxies = [];
    if (buyData.list) {
      for (const [id, proxyData] of Object.entries(buyData.list)) {
        const proxyUrl = `http://${proxyData.user}:${proxyData.pass}@${proxyData.host}:${proxyData.port}`;
        proxies.push(proxyUrl);
        console.log(`✅ Прокси добавлен: ${proxyData.host}:${proxyData.port}`);
      }
    }

    console.log(`✅ Успешно куплено ${proxies.length} прокси для клиента ${clientName}`);
    console.log(`💰 Потрачено: ${buyData.price} ${buyData.currency}, остаток баланса: ${buyData.balance}`);

    return {
      success: true,
      proxies: proxies,
      orderInfo: {
        orderId: buyData.order_id,
        count: buyData.count,
        price: buyData.price,
        currency: buyData.currency,
        balance: buyData.balance,
        period: buyData.period,
        country: buyData.country
      }
    };

  } catch (error) {
    console.error('❌ Ошибка покупки прокси через PROXY6.net:', error.message);
    return { success: false, error: error.message };
  }
}

async function checkProxy6Balance() {
  if (!PROXY6_API_KEY) {
    return { success: false, error: 'PROXY6_API_KEY не установлен' };
  }

  try {
    const fetch = (await import('node-fetch')).default;
    
    const balanceUrl = `${PROXY6_BASE_URL}/${PROXY6_API_KEY}`;
    console.log(`💰 Проверяем баланс PROXY6: ${balanceUrl}`);

    const response = await fetch(balanceUrl, {
      method: 'GET',
      timeout: 10000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.status !== 'yes') {
      throw new Error(`Ошибка API: ${data.error || 'Unknown error'}`);
    }

    return {
      success: true,
      balance: data.balance,
      currency: data.currency,
      userId: data.user_id
    };

  } catch (error) {
    console.error('❌ Ошибка проверки баланса PROXY6:', error.message);
    return { success: false, error: error.message };
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
      console.log(`   Пароль: ${config.password}`);
      console.log(`   Прокси: ${config.proxies.length} шт.`);

      if (config.proxies.length > 0) {
        console.log(`   Первый прокси: ${config.proxies[0]}`);
        console.log(`   Последний прокси: ${config.proxies[config.proxies.length - 1]}`);
      }

      if (!currentClients.includes(clientName)) {
        console.log(`➕ Добавляем клиента на прокси сервер: ${clientName}`);

        // ✅ ИСПРАВЛЕНО: Используем clientName как логин для авторизации
        const requestBody = {
          clientName: clientName,
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

// ====== ФУНКЦИЯ ДОБАВЛЕНИЯ ПРОКСИ К СУЩЕСТВУЮЩЕМУ КЛИЕНТУ ======
async function addProxyToClient(clientName, proxyList) {
  try {
    const fetch = (await import('node-fetch')).default;

    console.log(`➕ Добавляем прокси к клиенту ${clientName}`);
    console.log(`📊 Количество прокси: ${proxyList.length}`);

    for (const proxy of proxyList) {
      console.log(`🌐 Добавляем прокси: ${proxy}`);

      const requestBody = {
        clientName: clientName,
        proxy: proxy
      };

      const addResponse = await fetch(`${PROXY_SERVER_URL}/api/add-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        timeout: 15000
      });

      if (addResponse.ok) {
        const responseData = await addResponse.json();
        console.log(`✅ Прокси добавлен: ${proxy}`);
      } else {
        const errorText = await addResponse.text();
        console.error(`❌ Failed to add proxy ${proxy}: ${addResponse.status} ${errorText}`);
        return { success: false, error: `Failed to add proxy ${proxy}: ${addResponse.status} ${errorText}` };
      }
    }

    console.log(`✅ Все прокси добавлены к клиенту ${clientName}`);
    return { success: true };

  } catch (error) {
    console.error('⚠️ Ошибка добавления прокси:', error.message);
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

// ====== ФУНКЦИЯ СОЗДАНИЯ КЛАВИАТУРЫ ======
function createMainKeyboard() {
  return {
    keyboard: [
      [
        { text: '➕ Добавить клиента' },
        { text: '🗑️ Удалить клиента' }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
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
/addclient - Добавить клиента с прокси (ПРОСТОЙ ФОРМАТ)
/deleteclient - Удалить клиента
/addproxy - Добавить прокси к существующему клиенту
/removeproxy - Удалить прокси у клиента
/status - Статус системы
/debug - Отладочная информация
/sync - Принудительная синхронизация с прокси сервером
/health-detailed - Детальная информация о памяти, CPU, клиентах
/api-stats - Полная статистика по всем клиентам

🛒 **PROXY6.net команды:**
/proxy6-balance - Проверить баланс PROXY6.net
/buy-proxies - Купить прокси для существующего клиента

🔧 **Админские команды:**
${isSuperAdmin(userId) ? '/manageadmins - Управление администраторами' : ''}
/restart - Перезапуск бота (только супер-админ)
  `;

  bot.sendMessage(msg.chat.id, welcomeMessage, { 
    parse_mode: 'Markdown',
    reply_markup: createMainKeyboard()
  });
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
    message += `   └ Пароль: \`${config.password}\`\n`;
    message += `   └ Прокси: ${config.proxies.length} шт.\n\n`;
  }

  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// ✅ КОМАНДА: Добавление клиента с прокси (УПРОЩЕННЫЙ ФОРМАТ)
bot.onText(/\/addclient/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`➕ Команда /addclient от userId=${userId}`);

  let instructionMessage = `
➕ **Добавление клиента с прокси (ПРОСТОЙ ФОРМАТ)**

📋 **Формат:**
Строка 1: \`логин пароль\`
Строки 2+: список прокси в формате \`host:port:user:pass\`

📝 **Пример:**
\`\`\`
client1 mypassword123
31.129.21.214:9379:gNzocE:fnKaHc
45.91.65.201:9524:gNzocE:fnKaHc
45.91.65.235:9071:gNzocE:fnKaHc
\`\`\`
`;

  // Добавляем информацию об автопокупке прокси
  if (AUTO_BUY_PROXIES && PROXY6_API_KEY) {
    instructionMessage += `
🛒 **Автопокупка прокси включена!**
• Если не указать прокси, автоматически купим ${DEFAULT_PROXY_COUNT} прокси
• Страна: ${DEFAULT_PROXY_COUNTRY.toUpperCase()}
• Период: ${DEFAULT_PROXY_PERIOD} дней
• Тип: IPv4 Shared
`;
  }

  instructionMessage += `\n💡 **Введите данные в указанном формате:**`;

  bot.sendMessage(msg.chat.id, instructionMessage, { parse_mode: 'Markdown' });

  bot.once('message', async (response) => {
    if (response.from.id !== userId) return;

    console.log(`📦 Получен ответ для добавления клиента`);
    console.log(`📝 Длина сообщения: ${response.text.length} символов`);

    const lines = response.text.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);
    console.log(`📋 Количество строк: ${lines.length}`);

    if (lines.length < 1) {
      return bot.sendMessage(msg.chat.id, '❌ Пустое сообщение. Введите логин, пароль и прокси.', { parse_mode: 'Markdown' });
    }

    // ✅ УПРОЩЕННЫЙ ФОРМАТ: Первая строка = логин пароль
    const firstLineParts = lines[0].split(' ');
    console.log(`👤 Первая строка: "${lines[0]}"`);
    console.log(`🔍 Части: [${firstLineParts.join(', ')}]`);

    if (firstLineParts.length !== 2) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный формат первой строки. Используйте: `логин пароль`', { parse_mode: 'Markdown' });
    }

    const [clientName, password] = firstLineParts;
    console.log(`👤 Логин (clientName): ${clientName}`);
    console.log(`🔐 Пароль: ${password}`);

    if (clientsConfig[clientName]) {
      return bot.sendMessage(msg.chat.id, `❌ Клиент **${clientName}** уже существует.`, { parse_mode: 'Markdown' });
    }

    // Парсим прокси (строки 2 и далее)
    const proxyLines = lines.slice(1);
    console.log(`🌐 Строк с прокси: ${proxyLines.length}`);

    let proxies = [];
    let errors = [];
    let orderInfo = null;

    if (proxyLines.length > 0) {
      const parseResult = parseProxyList(proxyLines.join('\n'));
      proxies = parseResult.proxies;
      errors = parseResult.errors;
    }

    // Автоматическая покупка прокси через PROXY6.net если включена
    if (AUTO_BUY_PROXIES && proxies.length === 0) {
      console.log(`🛒 Автоматическая покупка прокси включена для клиента ${clientName}`);
      
      bot.sendMessage(msg.chat.id, `🛒 Покупаем ${DEFAULT_PROXY_COUNT} прокси через PROXY6.net...`, { parse_mode: 'Markdown' });
      
      const buyResult = await buyProxiesFromProxy6(clientName);
      
      if (buyResult.success) {
        proxies = buyResult.proxies;
        orderInfo = buyResult.orderInfo;
        console.log(`✅ Автоматически куплено ${proxies.length} прокси`);
      } else {
        console.log(`❌ Не удалось купить прокси автоматически: ${buyResult.error}`);
        errors.push(`Автопокупка прокси: ${buyResult.error}`);
      }
    }

    // Создаем клиента с упрощенной структурой
    clientsConfig[clientName] = {
      password,
      proxies
    };

    await saveConfig();
    console.log(`✅ Клиент ${clientName} добавлен локально с ${proxies.length} прокси`);

    // Обновляем прокси сервер
    const updateResult = await updateProxyServer();

    let resultMessage = `✅ Клиент **${clientName}** успешно добавлен!\n\n`;
    resultMessage += `🔑 Логин: \`${clientName}\`\n`;
    resultMessage += `🔐 Пароль: \`${password}\`\n`;
    resultMessage += `📊 Прокси: ${proxies.length} шт.\n`;

    // Добавляем информацию о покупке прокси
    if (orderInfo) {
      resultMessage += `\n🛒 **Информация о покупке прокси:**\n`;
      resultMessage += `• Заказ №: ${orderInfo.orderId}\n`;
      resultMessage += `• Потрачено: ${orderInfo.price} ${orderInfo.currency}\n`;
      resultMessage += `• Остаток баланса: ${orderInfo.balance} ${orderInfo.currency}\n`;
      resultMessage += `• Период: ${orderInfo.period} дней\n`;
      resultMessage += `• Страна: ${orderInfo.country.toUpperCase()}\n`;
    }

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

// ✅ КОМАНДА: Добавление прокси к существующему клиенту
bot.onText(/\/addproxy/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`🌐 Команда /addproxy от userId=${userId}`);

  if (Object.keys(clientsConfig).length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ Нет клиентов. Сначала добавьте клиента командой /addclient');
  }

  // Показываем список клиентов
  let clientsList = '👥 **Выберите клиента:**\n\n';
  const clientNames = Object.keys(clientsConfig);

  for (const [index, clientName] of clientNames.entries()) {
    const config = clientsConfig[clientName];
    clientsList += `${index + 1}. **${clientName}** (${config.proxies.length} прокси)\n`;
  }

  clientsList += `\n💡 **Введите номер клиента или имя:**`;

  bot.sendMessage(msg.chat.id, clientsList, { parse_mode: 'Markdown' });

  bot.once('message', async (clientResponse) => {
    if (clientResponse.from.id !== userId) return;

    const clientInput = clientResponse.text.trim();
    let selectedClient = null;

    // Проверяем, это номер или имя
    if (/^\d+$/.test(clientInput)) {
      const clientIndex = parseInt(clientInput) - 1;
      if (clientIndex >= 0 && clientIndex < clientNames.length) {
        selectedClient = clientNames[clientIndex];
      }
    } else {
      if (clientsConfig[clientInput]) {
        selectedClient = clientInput;
      }
    }

    if (!selectedClient) {
      return bot.sendMessage(msg.chat.id, '❌ Клиент не найден. Используйте /addproxy для повторной попытки.');
    }

    console.log(`👤 Выбран клиент: ${selectedClient}`);

    const proxyInstructionMessage = `
🌐 **Добавление прокси к клиенту "${selectedClient}"**

📋 **Формат:**
Каждая строка: \`host:port:user:pass\`

📝 **Пример:**
\`\`\`
31.129.21.214:9379:gNzocE:fnKaHc
45.91.65.201:9524:gNzocE:fnKaHc
45.91.65.235:9071:gNzocE:fnKaHc
\`\`\`

💡 **Введите список прокси:**
    `;

    bot.sendMessage(msg.chat.id, proxyInstructionMessage, { parse_mode: 'Markdown' });

    bot.once('message', async (proxyResponse) => {
      if (proxyResponse.from.id !== userId) return;

      console.log(`🌐 Получен список прокси для клиента ${selectedClient}`);

      const parseResult = parseProxyList(proxyResponse.text);
      const { proxies, errors } = parseResult;

      if (proxies.length === 0) {
        return bot.sendMessage(msg.chat.id, '❌ Не найдено валидных прокси. Проверьте формат: host:port:user:pass');
      }

      // Добавляем прокси к локальной конфигурации
      clientsConfig[selectedClient].proxies.push(...proxies);
      await saveConfig();

      console.log(`✅ Добавлено ${proxies.length} прокси к клиенту ${selectedClient} локально`);

      // Добавляем прокси на прокси сервер
      const addResult = await addProxyToClient(selectedClient, proxies);

      let resultMessage = `✅ Добавлено **${proxies.length}** прокси к клиенту **${selectedClient}**!\n\n`;
      resultMessage += `📊 Всего прокси у клиента: ${clientsConfig[selectedClient].proxies.length} шт.\n`;

      if (errors.length > 0) {
        resultMessage += `\n⚠️ **Ошибки в прокси:**\n`;
        errors.slice(0, 5).forEach(error => {
          resultMessage += `• ${error}\n`;
        });
        if (errors.length > 5) {
          resultMessage += `• ... и еще ${errors.length - 5} ошибок\n`;
        }
      }

      if (!addResult.success) {
        resultMessage += `\n⚠️ Прокси добавлены локально, но не удалось обновить прокси сервер.\nОшибка: ${addResult.error || 'Unknown error'}`;
      }

      bot.sendMessage(msg.chat.id, resultMessage, { parse_mode: 'Markdown' });
    });
  });
});

// ✅ КОМАНДА: Удаление клиента
bot.onText(/\/deleteclient/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`🗑️ Команда /deleteclient от userId=${userId}`);

  if (Object.keys(clientsConfig).length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ Нет клиентов для удаления.');
  }

  // Показываем список клиентов для удаления
  let clientsList = '🗑️ **Удаление клиента**\n\n👥 **Выберите клиента для удаления:**\n\n';
  const clientNames = Object.keys(clientsConfig);

  for (const [index, clientName] of clientNames.entries()) {
    const config = clientsConfig[clientName];
    clientsList += `${index + 1}. **${clientName}** (${config.proxies.length} прокси)\n`;
  }

  clientsList += `\n💡 **Введите номер клиента или имя:**`;

  bot.sendMessage(msg.chat.id, clientsList, { parse_mode: 'Markdown' });

  bot.once('message', async (clientResponse) => {
    if (clientResponse.from.id !== userId) return;

    const clientInput = clientResponse.text.trim();
    let selectedClient = null;

    // Проверяем, это номер или имя
    if (/^\d+$/.test(clientInput)) {
      const clientIndex = parseInt(clientInput) - 1;
      if (clientIndex >= 0 && clientIndex < clientNames.length) {
        selectedClient = clientNames[clientIndex];
      }
    } else {
      if (clientsConfig[clientInput]) {
        selectedClient = clientInput;
      }
    }

    if (!selectedClient) {
      return bot.sendMessage(msg.chat.id, '❌ Клиент не найден. Используйте /deleteclient для повторной попытки.');
    }

    console.log(`🗑️ Выбран для удаления клиент: ${selectedClient}`);

    // Подтверждение удаления
    const confirmMessage = `
⚠️ **ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ**

🗑️ Клиент: **${selectedClient}**
📊 Прокси: ${clientsConfig[selectedClient].proxies.length} шт.

❗ **Это действие нельзя отменить!**

💡 **Введите "ДА" для подтверждения или любой другой текст для отмены:**
    `;

    bot.sendMessage(msg.chat.id, confirmMessage, { parse_mode: 'Markdown' });

    bot.once('message', async (confirmResponse) => {
      if (confirmResponse.from.id !== userId) return;

      const confirmation = confirmResponse.text.trim().toLowerCase();

      if (confirmation !== 'да' && confirmation !== 'yes' && confirmation !== 'y') {
        return bot.sendMessage(msg.chat.id, '❌ Удаление отменено.');
      }

      console.log(`🗑️ Подтверждено удаление клиента: ${selectedClient}`);

      // Удаляем клиента из локальной конфигурации
      const deletedConfig = clientsConfig[selectedClient];
      delete clientsConfig[selectedClient];
      await saveConfig();

      console.log(`✅ Клиент ${selectedClient} удален из локальной конфигурации`);

      // Удаляем клиента с прокси сервера
      try {
        const fetch = (await import('node-fetch')).default;

        const deleteResponse = await fetch(`${PROXY_SERVER_URL}/api/delete-client/${selectedClient}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 15000
        });

        let resultMessage = `✅ Клиент **${selectedClient}** успешно удален!\n\n`;
        resultMessage += `📊 Удалено прокси: ${deletedConfig.proxies.length} шт.\n`;

        if (deleteResponse.ok) {
          console.log(`✅ Клиент ${selectedClient} успешно удален с прокси сервера`);
          resultMessage += `🌐 Клиент также удален с прокси сервера.`;
        } else {
          const errorText = await deleteResponse.text();
          console.error(`❌ Failed to delete client from proxy server: ${deleteResponse.status} ${errorText}`);
          resultMessage += `⚠️ Клиент удален локально, но не удалось удалить с прокси сервера.\nОшибка: ${deleteResponse.status} ${errorText}`;
        }

        bot.sendMessage(msg.chat.id, resultMessage, { parse_mode: 'Markdown' });

      } catch (error) {
        console.error('⚠️ Ошибка удаления клиента с прокси сервера:', error.message);

        const errorMessage = `✅ Клиент **${selectedClient}** удален локально!\n\n`;
        errorMessage += `📊 Удалено прокси: ${deletedConfig.proxies.length} шт.\n`;
        errorMessage += `⚠️ Не удалось удалить с прокси сервера: ${error.message}`;

        bot.sendMessage(msg.chat.id, errorMessage, { parse_mode: 'Markdown' });
      }
    });
  });
});

// ✅ КОМАНДА: Удаление прокси у клиента
bot.onText(/\/removeproxy/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`🗑️ Команда /removeproxy от userId=${userId}`);

  if (Object.keys(clientsConfig).length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ Нет клиентов. Сначала добавьте клиента командой /addclient');
  }

  // Показываем список клиентов
  let clientsList = '🗑️ **Удаление прокси**\n\n👥 **Выберите клиента:**\n\n';
  const clientNames = Object.keys(clientsConfig);

  for (const [index, clientName] of clientNames.entries()) {
    const config = clientsConfig[clientName];
    clientsList += `${index + 1}. **${clientName}** (${config.proxies.length} прокси)\n`;
  }

  clientsList += `\n💡 **Введите номер клиента или имя:**`;

  bot.sendMessage(msg.chat.id, clientsList, { parse_mode: 'Markdown' });

  bot.once('message', async (clientResponse) => {
    if (clientResponse.from.id !== userId) return;

    const clientInput = clientResponse.text.trim();
    let selectedClient = null;

    // Проверяем, это номер или имя
    if (/^\d+$/.test(clientInput)) {
      const clientIndex = parseInt(clientInput) - 1;
      if (clientIndex >= 0 && clientIndex < clientNames.length) {
        selectedClient = clientNames[clientIndex];
      }
    } else {
      if (clientsConfig[clientInput]) {
        selectedClient = clientInput;
      }
    }

    if (!selectedClient) {
      return bot.sendMessage(msg.chat.id, '❌ Клиент не найден. Используйте /removeproxy для повторной попытки.');
    }

    const clientProxies = clientsConfig[selectedClient].proxies;

    if (clientProxies.length === 0) {
      return bot.sendMessage(msg.chat.id, `❌ У клиента **${selectedClient}** нет прокси для удаления.`, { parse_mode: 'Markdown' });
    }

    console.log(`🗑️ Выбран клиент для удаления прокси: ${selectedClient}`);

    // Показываем список прокси
    let proxyList = `🗑️ **Удаление прокси у клиента "${selectedClient}"**\n\n📋 **Выберите прокси для удаления:**\n\n`;

    for (const [index, proxy] of clientProxies.entries()) {
      // Показываем только host:port для удобства
      const proxyParts = proxy.replace('http://', '').split('@');
      const hostPort = proxyParts[1] || proxy;
      proxyList += `${index + 1}. \`${hostPort}\`\n`;
    }

    proxyList += `\n💡 **Введите номер прокси для удаления или "ALL" для удаления всех:**`;

    bot.sendMessage(msg.chat.id, proxyList, { parse_mode: 'Markdown' });

    bot.once('message', async (proxyResponse) => {
      if (proxyResponse.from.id !== userId) return;

      const proxyInput = proxyResponse.text.trim();

      if (proxyInput.toLowerCase() === 'all') {
        // Удаляем все прокси
        console.log(`🗑️ Удаляем все прокси у клиента ${selectedClient}`);

        const confirmMessage = `
⚠️ **ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ ВСЕХ ПРОКСИ**

🗑️ Клиент: **${selectedClient}**
📊 Будет удалено: **${clientProxies.length}** прокси

❗ **Это действие нельзя отменить!**

💡 **Введите "ДА" для подтверждения или любой другой текст для отмены:**
        `;

        bot.sendMessage(msg.chat.id, confirmMessage, { parse_mode: 'Markdown' });

        bot.once('message', async (confirmResponse) => {
          if (confirmResponse.from.id !== userId) return;

          const confirmation = confirmResponse.text.trim().toLowerCase();

          if (confirmation !== 'да' && confirmation !== 'yes' && confirmation !== 'y') {
            return bot.sendMessage(msg.chat.id, '❌ Удаление отменено.');
          }

          // Удаляем все прокси
          const deletedCount = clientProxies.length;
          clientsConfig[selectedClient].proxies = [];
          await saveConfig();

          // Синхронизируем с прокси сервером
          const updateResult = await updateProxyServer();

          let resultMessage = `✅ Удалены **все прокси** у клиента **${selectedClient}**!\n\n`;
          resultMessage += `📊 Удалено: ${deletedCount} прокси\n`;

          if (!updateResult.success) {
            resultMessage += `⚠️ Прокси удалены локально, но не удалось обновить прокси сервер.\nОшибка: ${updateResult.error || 'Unknown error'}`;
          }

          bot.sendMessage(msg.chat.id, resultMessage, { parse_mode: 'Markdown' });
        });

      } else if (/^\d+$/.test(proxyInput)) {
        // Удаляем конкретный прокси по номеру
        const proxyIndex = parseInt(proxyInput) - 1;

        if (proxyIndex < 0 || proxyIndex >= clientProxies.length) {
          return bot.sendMessage(msg.chat.id, '❌ Неверный номер прокси. Используйте /removeproxy для повторной попытки.');
        }

        const proxyToDelete = clientProxies[proxyIndex];
        const proxyParts = proxyToDelete.replace('http://', '').split('@');
        const hostPort = proxyParts[1] || proxyToDelete;

        console.log(`🗑️ Удаляем прокси ${proxyIndex + 1}: ${hostPort}`);

        // Удаляем прокси из массива
        clientProxies.splice(proxyIndex, 1);
        await saveConfig();

        // Синхронизируем с прокси сервером
        const updateResult = await updateProxyServer();

        let resultMessage = `✅ Прокси удален у клиента **${selectedClient}**!\n\n`;
        resultMessage += `🗑️ Удален: \`${hostPort}\`\n`;
        resultMessage += `📊 Осталось прокси: ${clientProxies.length} шт.\n`;

        if (!updateResult.success) {
          resultMessage += `⚠️ Прокси удален локально, но не удалось обновить прокси сервер.\nОшибка: ${updateResult.error || 'Unknown error'}`;
        }

        bot.sendMessage(msg.chat.id, resultMessage, { parse_mode: 'Markdown' });

      } else {
        return bot.sendMessage(msg.chat.id, '❌ Неверный ввод. Введите номер прокси или "ALL".');
      }
    });
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
      message += `• **${clientName}**: ${config.proxies.length} прокси\n`;
    }
  }

  const connectionOk = await testRailwayConnection();
  message += `\n🔌 Соединение с прокси сервером: ${connectionOk ? '✅ OK' : '❌ Ошибка'}`;

  bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// ✅ КОМАНДА: Детальная информация о памяти, CPU, клиентах
bot.onText(/\/health-detailed/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`🔍 Команда /health-detailed от userId=${userId}`);

  try {
    const fetch = (await import('node-fetch')).default;

    // Получаем детальную информацию с прокси сервера
    const healthResponse = await fetch(`${PROXY_SERVER_URL}/health-detailed`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    let serverHealthInfo = '';
    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      serverHealthInfo = `
🖥️ **Информация о прокси сервере:**
• CPU: ${healthData.cpu || 'N/A'}%
• Память: ${healthData.memory || 'N/A'}
• Uptime: ${healthData.uptime || 'N/A'}
• Активные соединения: ${healthData.activeConnections || 'N/A'}
• Всего запросов: ${healthData.totalRequests || 'N/A'}
`;
    } else {
      serverHealthInfo = `⚠️ Не удалось получить детальную информацию с прокси сервера (${healthResponse.status})`;
    }

    // Локальная информация
    const totalClients = Object.keys(clientsConfig).length;
    const totalProxies = Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0);
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();

    let message = `🔍 **Детальная информация системы**\n\n`;

    message += `🤖 **Telegram Bot:**\n`;
    message += `• Память RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB\n`;
    message += `• Память Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB\n`;
    message += `• Uptime: ${Math.floor(uptime / 3600)}ч ${Math.floor((uptime % 3600) / 60)}м\n`;
    message += `• Клиентов: ${totalClients}\n`;
    message += `• Прокси: ${totalProxies}\n\n`;

    message += serverHealthInfo;

    message += `\n📊 **Детали по клиентам:**\n`;
    if (totalClients > 0) {
      for (const [clientName, config] of Object.entries(clientsConfig)) {
        message += `• **${clientName}**: ${config.proxies.length} прокси\n`;
      }
    } else {
      message += `• Нет клиентов\n`;
    }

    const connectionOk = await testRailwayConnection();
    message += `\n🔌 Соединение с прокси сервером: ${connectionOk ? '✅ OK' : '❌ Ошибка'}`;

    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('⚠️ Ошибка получения детальной информации:', error.message);
    bot.sendMessage(msg.chat.id, `❌ Ошибка получения детальной информации:\n\n\`${error.message}\``, { parse_mode: 'Markdown' });
  }
});

// ✅ КОМАНДА: Полная статистика по всем клиентам
// ✅ КОМАНДА: Проверка баланса PROXY6.net
bot.onText(/\/proxy6-balance/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`💰 Команда /proxy6-balance от userId=${userId}`);

  if (!PROXY6_API_KEY) {
    return bot.sendMessage(msg.chat.id, '❌ PROXY6_API_KEY не установлен. Установите переменную окружения для работы с PROXY6.net', { parse_mode: 'Markdown' });
  }

  bot.sendMessage(msg.chat.id, '💰 Проверяем баланс PROXY6.net...', { parse_mode: 'Markdown' });

  const balanceResult = await checkProxy6Balance();

  if (balanceResult.success) {
    let message = `💰 **Баланс PROXY6.net**\n\n`;
    message += `• Баланс: **${balanceResult.balance} ${balanceResult.currency}**\n`;
    message += `• ID аккаунта: \`${balanceResult.userId}\`\n\n`;
    
    if (AUTO_BUY_PROXIES) {
      message += `🛒 **Настройки автопокупки:**\n`;
      message += `• Автопокупка: ✅ Включена\n`;
      message += `• Количество: ${DEFAULT_PROXY_COUNT} прокси\n`;
      message += `• Период: ${DEFAULT_PROXY_PERIOD} дней\n`;
      message += `• Страна: ${DEFAULT_PROXY_COUNTRY.toUpperCase()}\n`;
      message += `• Тип: IPv4 Shared\n`;
    } else {
      message += `🛒 **Автопокупка:** ❌ Отключена\n`;
      message += `💡 Установите \`AUTO_BUY_PROXIES=true\` для включения`;
    }

    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(msg.chat.id, `❌ Ошибка проверки баланса PROXY6.net:\n\n\`${balanceResult.error}\``, { parse_mode: 'Markdown' });
  }
});

// ✅ КОМАНДА: Покупка прокси для существующего клиента
bot.onText(/\/buy-proxies/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`🛒 Команда /buy-proxies от userId=${userId}`);

  if (!PROXY6_API_KEY) {
    return bot.sendMessage(msg.chat.id, '❌ PROXY6_API_KEY не установлен. Установите переменную окружения для работы с PROXY6.net', { parse_mode: 'Markdown' });
  }

  if (Object.keys(clientsConfig).length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ Нет клиентов. Сначала добавьте клиента командой /addclient');
  }

  // Показываем список клиентов
  let clientsList = '🛒 **Покупка прокси для клиента**\n\n👥 **Выберите клиента:**\n\n';
  const clientNames = Object.keys(clientsConfig);

  for (const [index, clientName] of clientNames.entries()) {
    const config = clientsConfig[clientName];
    clientsList += `${index + 1}. **${clientName}** (${config.proxies.length} прокси)\n`;
  }

  clientsList += `\n💡 **Введите номер клиента или имя:**`;

  bot.sendMessage(msg.chat.id, clientsList, { parse_mode: 'Markdown' });

  bot.once('message', async (clientResponse) => {
    if (clientResponse.from.id !== userId) return;

    const clientInput = clientResponse.text.trim();
    let selectedClient = null;

    // Проверяем, это номер или имя
    if (/^\d+$/.test(clientInput)) {
      const clientIndex = parseInt(clientInput) - 1;
      if (clientIndex >= 0 && clientIndex < clientNames.length) {
        selectedClient = clientNames[clientIndex];
      }
    } else {
      if (clientsConfig[clientInput]) {
        selectedClient = clientInput;
      }
    }

    if (!selectedClient) {
      return bot.sendMessage(msg.chat.id, '❌ Клиент не найден. Используйте /buy-proxies для повторной попытки.');
    }

    console.log(`🛒 Выбран клиент для покупки прокси: ${selectedClient}`);

    bot.sendMessage(msg.chat.id, `🛒 Покупаем ${DEFAULT_PROXY_COUNT} прокси для клиента **${selectedClient}**...`, { parse_mode: 'Markdown' });

    const buyResult = await buyProxiesFromProxy6(selectedClient);

    if (buyResult.success) {
      // Добавляем купленные прокси к клиенту
      clientsConfig[selectedClient].proxies.push(...buyResult.proxies);
      await saveConfig();

      // Добавляем прокси на прокси сервер
      const addResult = await addProxyToClient(selectedClient, buyResult.proxies);

      let resultMessage = `✅ Куплено **${buyResult.proxies.length}** прокси для клиента **${selectedClient}**!\n\n`;
      resultMessage += `📊 Всего прокси у клиента: ${clientsConfig[selectedClient].proxies.length} шт.\n\n`;
      
      resultMessage += `🛒 **Информация о покупке:**\n`;
      resultMessage += `• Заказ №: ${buyResult.orderInfo.orderId}\n`;
      resultMessage += `• Потрачено: ${buyResult.orderInfo.price} ${buyResult.orderInfo.currency}\n`;
      resultMessage += `• Остаток баланса: ${buyResult.orderInfo.balance} ${buyResult.orderInfo.currency}\n`;
      resultMessage += `• Период: ${buyResult.orderInfo.period} дней\n`;
      resultMessage += `• Страна: ${buyResult.orderInfo.country.toUpperCase()}\n`;

      if (!addResult.success) {
        resultMessage += `\n⚠️ Прокси куплены и добавлены локально, но не удалось обновить прокси сервер.\nОшибка: ${addResult.error || 'Unknown error'}`;
      }

      bot.sendMessage(msg.chat.id, resultMessage, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(msg.chat.id, `❌ Ошибка покупки прокси:\n\n\`${buyResult.error}\``, { parse_mode: 'Markdown' });
    }
  });
});

bot.onText(/\/api-stats/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`📊 Команда /api-stats от userId=${userId}`);

  try {
    const fetch = (await import('node-fetch')).default;

    // Получаем полную статистику с прокси сервера
    const statsResponse = await fetch(`${PROXY_SERVER_URL}/api/stats`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    if (!statsResponse.ok) {
      const errorText = await statsResponse.text();
      return bot.sendMessage(msg.chat.id, `❌ Ошибка получения статистики с прокси сервера:\n\n\`${statsResponse.status}: ${errorText}\``, { parse_mode: 'Markdown' });
    }

    const statsData = await statsResponse.json();

    let message = `📊 **Полная статистика по всем клиентам**\n\n`;

    message += `🌐 **Общая информация:**\n`;
    message += `• Всего клиентов: ${statsData.totalClients || 0}\n`;
    message += `• Всего прокси: ${statsData.totalProxies || 0}\n`;
    message += `• Активных соединений: ${statsData.activeConnections || 0}\n`;
    message += `• Всего запросов: ${statsData.totalRequests || 0}\n`;
    message += `• Успешных запросов: ${statsData.successfulRequests || 0}\n`;
    message += `• Ошибок: ${statsData.errorRequests || 0}\n\n`;

    if (statsData.clients && Object.keys(statsData.clients).length > 0) {
      message += `👥 **Статистика по клиентам:**\n`;
      for (const [clientName, clientStats] of Object.entries(statsData.clients)) {
        message += `\n🔹 **${clientName}**\n`;
        message += `   └ Прокси: ${clientStats.proxiesCount || 0} шт.\n`;
        message += `   └ Запросов: ${clientStats.requests || 0}\n`;
        message += `   └ Успешных: ${clientStats.successful || 0}\n`;
        message += `   └ Ошибок: ${clientStats.errors || 0}\n`;
        message += `   └ Последняя активность: ${clientStats.lastActivity || 'N/A'}\n`;

        if (clientStats.topProxies && clientStats.topProxies.length > 0) {
          message += `   └ Топ прокси:\n`;
          clientStats.topProxies.slice(0, 3).forEach((proxy, index) => {
            message += `      ${index + 1}. ${proxy.host}:${proxy.port} (${proxy.requests} запросов)\n`;
          });
        }
      }
    } else {
      message += `👥 **Клиенты:** Нет данных\n`;
    }

    // Разбиваем длинное сообщение на части если нужно
    if (message.length > 4000) {
      const parts = [];
      let currentPart = '';
      const lines = message.split('\n');

      for (const line of lines) {
        if ((currentPart + line + '\n').length > 4000) {
          parts.push(currentPart);
          currentPart = line + '\n';
        } else {
          currentPart += line + '\n';
        }
      }

      if (currentPart) {
        parts.push(currentPart);
      }

      for (let i = 0; i < parts.length; i++) {
        const partMessage = i === 0 ? parts[i] : `📊 **Статистика (часть ${i + 1})**\n\n${parts[i]}`;
        await bot.sendMessage(msg.chat.id, partMessage, { parse_mode: 'Markdown' });

        // Небольшая задержка между сообщениями
        if (i < parts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } else {
      bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    }

  } catch (error) {
    console.error('⚠️ Ошибка получения статистики:', error.message);
    bot.sendMessage(msg.chat.id, `❌ Ошибка получения статистики:\n\n\`${error.message}\``, { parse_mode: 'Markdown' });
  }
});

// ====== ОБРАБОТЧИКИ КНОПОК ======
bot.onText(/^➕ Добавить клиента$/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`➕ Кнопка "Добавить клиента" от userId=${userId}`);

  let instructionMessage = `
➕ **Добавление клиента с прокси (ПРОСТОЙ ФОРМАТ)**

📋 **Формат:**
Строка 1: \`логин пароль\`
Строки 2+: список прокси в формате \`host:port:user:pass\`

📝 **Пример:**
\`\`\`
client1 mypassword123
31.129.21.214:9379:gNzocE:fnKaHc
45.91.65.201:9524:gNzocE:fnKaHc
45.91.65.235:9071:gNzocE:fnKaHc
\`\`\`
`;

  // Добавляем информацию об автопокупке прокси
  if (AUTO_BUY_PROXIES && PROXY6_API_KEY) {
    instructionMessage += `
🛒 **Автопокупка прокси включена!**
• Если не указать прокси, автоматически купим ${DEFAULT_PROXY_COUNT} прокси
• Страна: ${DEFAULT_PROXY_COUNTRY.toUpperCase()}
• Период: ${DEFAULT_PROXY_PERIOD} дней
• Тип: IPv4 Shared
`;
  }

  instructionMessage += `\n💡 **Введите данные в указанном формате:**`;

  bot.sendMessage(msg.chat.id, instructionMessage, { parse_mode: 'Markdown' });

  bot.once('message', async (response) => {
    if (response.from.id !== userId) return;

    console.log(`📦 Получен ответ для добавления клиента`);
    console.log(`📝 Длина сообщения: ${response.text.length} символов`);

    const lines = response.text.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);
    console.log(`📋 Количество строк: ${lines.length}`);

    if (lines.length < 1) {
      return bot.sendMessage(msg.chat.id, '❌ Пустое сообщение. Введите логин, пароль и прокси.', { parse_mode: 'Markdown' });
    }

    // ✅ УПРОЩЕННЫЙ ФОРМАТ: Первая строка = логин пароль
    const firstLineParts = lines[0].split(' ');
    console.log(`👤 Первая строка: "${lines[0]}"`);
    console.log(`🔍 Части: [${firstLineParts.join(', ')}]`);

    if (firstLineParts.length !== 2) {
      return bot.sendMessage(msg.chat.id, '❌ Неверный формат первой строки. Используйте: `логин пароль`', { parse_mode: 'Markdown' });
    }

    const [clientName, password] = firstLineParts;
    console.log(`👤 Логин (clientName): ${clientName}`);
    console.log(`🔐 Пароль: ${password}`);

    if (clientsConfig[clientName]) {
      return bot.sendMessage(msg.chat.id, `❌ Клиент **${clientName}** уже существует.`, { parse_mode: 'Markdown' });
    }

    // Парсим прокси (строки 2 и далее)
    const proxyLines = lines.slice(1);
    console.log(`🌐 Строк с прокси: ${proxyLines.length}`);

    let proxies = [];
    let errors = [];
    let orderInfo = null;

    if (proxyLines.length > 0) {
      const parseResult = parseProxyList(proxyLines.join('\n'));
      proxies = parseResult.proxies;
      errors = parseResult.errors;
    }

    // Автоматическая покупка прокси через PROXY6.net если включена
    if (AUTO_BUY_PROXIES && proxies.length === 0) {
      console.log(`🛒 Автоматическая покупка прокси включена для клиента ${clientName}`);
      
      bot.sendMessage(msg.chat.id, `🛒 Покупаем ${DEFAULT_PROXY_COUNT} прокси через PROXY6.net...`, { parse_mode: 'Markdown' });
      
      const buyResult = await buyProxiesFromProxy6(clientName);
      
      if (buyResult.success) {
        proxies = buyResult.proxies;
        orderInfo = buyResult.orderInfo;
        console.log(`✅ Автоматически куплено ${proxies.length} прокси`);
      } else {
        console.log(`❌ Не удалось купить прокси автоматически: ${buyResult.error}`);
        errors.push(`Автопокупка прокси: ${buyResult.error}`);
      }
    }

    // Создаем клиента с упрощенной структурой
    clientsConfig[clientName] = {
      password,
      proxies
    };

    await saveConfig();
    console.log(`✅ Клиент ${clientName} добавлен локально с ${proxies.length} прокси`);

    // Обновляем прокси сервер
    const updateResult = await updateProxyServer();

    let resultMessage = `✅ Клиент **${clientName}** успешно добавлен!\n\n`;
    resultMessage += `🔑 Логин: \`${clientName}\`\n`;
    resultMessage += `🔐 Пароль: \`${password}\`\n`;
    resultMessage += `📊 Прокси: ${proxies.length} шт.\n`;

    // Добавляем информацию о покупке прокси
    if (orderInfo) {
      resultMessage += `\n🛒 **Информация о покупке прокси:**\n`;
      resultMessage += `• Заказ №: ${orderInfo.orderId}\n`;
      resultMessage += `• Потрачено: ${orderInfo.price} ${orderInfo.currency}\n`;
      resultMessage += `• Остаток баланса: ${orderInfo.balance} ${orderInfo.currency}\n`;
      resultMessage += `• Период: ${orderInfo.period} дней\n`;
      resultMessage += `• Страна: ${orderInfo.country.toUpperCase()}\n`;
    }

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

    bot.sendMessage(msg.chat.id, resultMessage, { 
      parse_mode: 'Markdown',
      reply_markup: createMainKeyboard()
    });
  });
});

bot.onText(/^🗑️ Удалить клиента$/, async (msg) => {
  const userId = msg.from.id;
  if (!isAuthorized(userId)) {
    return bot.sendMessage(msg.chat.id, `❌ Нет доступа. Ваш ID: ${userId}. Используйте /debug для диагностики.`);
  }

  console.log(`🗑️ Кнопка "Удалить клиента" от userId=${userId}`);

  if (Object.keys(clientsConfig).length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ Нет клиентов для удаления.', {
      reply_markup: createMainKeyboard()
    });
  }

  // Показываем список клиентов для удаления
  let clientsList = '🗑️ **Удаление клиента**\n\n👥 **Выберите клиента для удаления:**\n\n';
  const clientNames = Object.keys(clientsConfig);

  for (const [index, clientName] of clientNames.entries()) {
    const config = clientsConfig[clientName];
    clientsList += `${index + 1}. **${clientName}** (${config.proxies.length} прокси)\n`;
  }

  clientsList += `\n💡 **Введите номер клиента или имя:**`;

  bot.sendMessage(msg.chat.id, clientsList, { parse_mode: 'Markdown' });

  bot.once('message', async (clientResponse) => {
    if (clientResponse.from.id !== userId) return;

    const clientInput = clientResponse.text.trim();
    let selectedClient = null;

    // Проверяем, это номер или имя
    if (/^\d+$/.test(clientInput)) {
      const clientIndex = parseInt(clientInput) - 1;
      if (clientIndex >= 0 && clientIndex < clientNames.length) {
        selectedClient = clientNames[clientIndex];
      }
    } else {
      if (clientsConfig[clientInput]) {
        selectedClient = clientInput;
      }
    }

    if (!selectedClient) {
      return bot.sendMessage(msg.chat.id, '❌ Клиент не найден. Попробуйте еще раз.', {
        reply_markup: createMainKeyboard()
      });
    }

    console.log(`🗑️ Выбран для удаления клиент: ${selectedClient}`);

    // Подтверждение удаления
    const confirmMessage = `
⚠️ **ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ**

🗑️ Клиент: **${selectedClient}**
📊 Прокси: ${clientsConfig[selectedClient].proxies.length} шт.

❗ **Это действие нельзя отменить!**

💡 **Введите "ДА" для подтверждения или любой другой текст для отмены:**
    `;

    bot.sendMessage(msg.chat.id, confirmMessage, { parse_mode: 'Markdown' });

    bot.once('message', async (confirmResponse) => {
      if (confirmResponse.from.id !== userId) return;

      const confirmation = confirmResponse.text.trim().toLowerCase();

      if (confirmation !== 'да' && confirmation !== 'yes' && confirmation !== 'y') {
        return bot.sendMessage(msg.chat.id, '❌ Удаление отменено.', {
          reply_markup: createMainKeyboard()
        });
      }

      console.log(`🗑️ Подтверждено удаление клиента: ${selectedClient}`);

      // Удаляем клиента из локальной конфигурации
      const deletedConfig = clientsConfig[selectedClient];
      delete clientsConfig[selectedClient];
      await saveConfig();

      console.log(`✅ Клиент ${selectedClient} удален из локальной конфигурации`);

      // Удаляем клиента с прокси сервера
      try {
        const fetch = (await import('node-fetch')).default;

        const deleteResponse = await fetch(`${PROXY_SERVER_URL}/api/delete-client/${selectedClient}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 15000
        });

        let resultMessage = `✅ Клиент **${selectedClient}** успешно удален!\n\n`;
        resultMessage += `📊 Удалено прокси: ${deletedConfig.proxies.length} шт.\n`;

        if (deleteResponse.ok) {
          console.log(`✅ Клиент ${selectedClient} успешно удален с прокси сервера`);
          resultMessage += `🌐 Клиент также удален с прокси сервера.`;
        } else {
          const errorText = await deleteResponse.text();
          console.error(`❌ Failed to delete client from proxy server: ${deleteResponse.status} ${errorText}`);
          resultMessage += `⚠️ Клиент удален локально, но не удалось удалить с прокси сервера.\nОшибка: ${deleteResponse.status} ${errorText}`;
        }

        bot.sendMessage(msg.chat.id, resultMessage, { 
          parse_mode: 'Markdown',
          reply_markup: createMainKeyboard()
        });

      } catch (error) {
        console.error('⚠️ Ошибка удаления клиента с прокси сервера:', error.message);

        const errorMessage = `✅ Клиент **${selectedClient}** удален локально!\n\n`;
        errorMessage += `📊 Удалено прокси: ${deletedConfig.proxies.length} шт.\n`;
        errorMessage += `⚠️ Не удалось удалить с прокси сервера: ${error.message}`;

        bot.sendMessage(msg.chat.id, errorMessage, { 
          parse_mode: 'Markdown',
          reply_markup: createMainKeyboard()
        });
      }
    });
  });
});

// ====== HTTP СЕРВЕР ======
app.get('/', (req, res) => {
  res.send(`
    <h1>🤖 Telegram Proxy Manager Bot (SIMPLE FORMAT + PROXY6.net)</h1>
    <p>Bot is running with simple format: login + password + proxies!</p>
    <p>ADMIN_IDS env: "${process.env.ADMIN_IDS || 'NOT SET'}"</p>
    <p>SUPER_ADMIN env: "${process.env.SUPER_ADMIN || 'NOT SET'}"</p>
    <p>MANAGER_IDS env: "${process.env.MANAGER_IDS || 'NOT SET'}"</p>
    <p>Parsed ADMIN_IDS: [${ADMIN_IDS.join(', ')}]</p>
    <p>Super Admin: ${SUPER_ADMIN_ID || 'NOT SET'}</p>
    <p>Managers: [${MANAGER_IDS.join(', ')}]</p>
    <p>Total clients: ${Object.keys(clientsConfig).length}</p>
    <p>Total proxies: ${Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0)}</p>
    <p>Proxy Server URL: ${PROXY_SERVER_URL}</p>
    <hr>
    <h2>🛒 PROXY6.net Integration</h2>
    <p>PROXY6_API_KEY: ${PROXY6_API_KEY ? 'SET' : 'NOT SET'}</p>
    <p>Auto Buy Proxies: ${AUTO_BUY_PROXIES ? 'ENABLED' : 'DISABLED'}</p>
    <p>Default Proxy Count: ${DEFAULT_PROXY_COUNT}</p>
    <p>Default Proxy Period: ${DEFAULT_PROXY_PERIOD} days</p>
    <p>Default Proxy Country: ${DEFAULT_PROXY_COUNTRY.toUpperCase()}</p>
    <p>Default Proxy Version: ${DEFAULT_PROXY_VERSION} (IPv4 Shared)</p>
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
    proxy6Integration: {
      apiKeySet: !!PROXY6_API_KEY,
      autoBuyEnabled: AUTO_BUY_PROXIES,
      defaultCount: DEFAULT_PROXY_COUNT,
      defaultPeriod: DEFAULT_PROXY_PERIOD,
      defaultCountry: DEFAULT_PROXY_COUNTRY,
      defaultVersion: DEFAULT_PROXY_VERSION
    },
    envVars: {
      ADMIN_IDS: process.env.ADMIN_IDS || 'NOT SET',
      SUPER_ADMIN: process.env.SUPER_ADMIN || 'NOT SET',
      MANAGER_IDS: process.env.MANAGER_IDS || 'NOT SET',
      PROXY6_API_KEY: PROXY6_API_KEY ? 'SET' : 'NOT SET',
      AUTO_BUY_PROXIES: process.env.AUTO_BUY_PROXIES || 'NOT SET'
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

  console.log('🤖 Telegram Bot с простым форматом запущен!');
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
