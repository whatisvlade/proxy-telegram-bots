// ✅ ОБНОВЛЕННЫЙ код с поддержкой удаления клиентов через API
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// Express сервер для Railway
const app = express();
const PORT = process.env.PORT || 8080;

// Токен бота (получите у @BotFather)
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';

// ID супер-администратора (видит всех клиентов)
const SUPER_ADMIN_ID = parseInt(process.env.SUPER_ADMIN_ID) || 5361349487;

// ID менеджеров (каждый видит только своих клиентов)
const MANAGER_IDS = process.env.MANAGER_IDS ? 
  process.env.MANAGER_IDS.split(',').map(id => parseInt(id)) : 
  [5361349487];

// URL прокси сервера для автоматического обновления
const PROXY_SERVER_URL = process.env.PROXY_SERVER_URL || '';

// ✅ ДОБАВЛЕНО: Авторизация для API запросов к прокси серверу
const API_AUTH = {
  username: 'telegram_bot',
  password: 'bot_secret_2024'
};

// Путь к файлу конфигурации клиентов
const CLIENTS_CONFIG_PATH = './clients-config.json';

// Middleware для Express
app.use(express.json());

// Health check для Railway
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'running',
    service: 'telegram-bot',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    service: 'telegram-bot',
    bot_username: bot ? (bot.options.username || 'unknown') : 'not_initialized',
    clients_count: Object.keys(clientsConfig).length,
    managers_count: MANAGER_IDS.length,
    super_admin: SUPER_ADMIN_ID,
    proxy_server_url: PROXY_SERVER_URL,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Создаем бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Загружаем конфигурацию клиентов
let clientsConfig = {};

function loadClientsConfig() {
  try {
    if (fs.existsSync(CLIENTS_CONFIG_PATH)) {
      const data = fs.readFileSync(CLIENTS_CONFIG_PATH, 'utf8');
      clientsConfig = JSON.parse(data);
      
      // Миграция старых данных (добавляем manager_id если его нет)
      let needsSave = false;
      Object.keys(clientsConfig).forEach(clientName => {
        if (!clientsConfig[clientName].manager_id) {
          clientsConfig[clientName].manager_id = SUPER_ADMIN_ID;
          clientsConfig[clientName].created_at = new Date().toISOString();
          needsSave = true;
        }
      });
      
      if (needsSave) {
        saveClientsConfig();
        console.log('🔄 Миграция данных завершена');
      }
      
      console.log('✅ Конфигурация клиентов загружена');
    } else {
      console.log('📝 Создаем новый файл конфигурации');
      saveClientsConfig();
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки конфигурации:', error);
    clientsConfig = {};
  }
}

function saveClientsConfig() {
  try {
    fs.writeFileSync(CLIENTS_CONFIG_PATH, JSON.stringify(clientsConfig, null, 2));
    console.log('💾 Конфигурация клиентов сохранена');
  } catch (error) {
    console.error('❌ Ошибка сохранения конфигурации:', error);
  }
}

// Проверка ролей
function isSuperAdmin(userId) {
  return userId === SUPER_ADMIN_ID;
}

function isManager(userId) {
  return MANAGER_IDS.includes(userId);
}

function hasAccess(userId) {
  // Преобразуем все ID в числа для корректного сравнения
  const userIdNum = parseInt(userId);
  const superAdminNum = parseInt(SUPER_ADMIN_ID);
  
  // Проверяем супер админа
  if (userIdNum === superAdminNum) {
    return true;
  }
  
  // Проверяем менеджеров
  const isManagerResult = MANAGER_IDS.includes(userIdNum);
  
  return isManagerResult;
}

// Получить клиентов менеджера
function getManagerClients(managerId) {
  if (isSuperAdmin(managerId)) {
    return clientsConfig; // Супер-админ видит всех
  }
  
  const managerClients = {};
  Object.keys(clientsConfig).forEach(clientName => {
    if (clientsConfig[clientName].manager_id === managerId) {
      managerClients[clientName] = clientsConfig[clientName];
    }
  });
  return managerClients;
}

// Проверить права на клиента
function canAccessClient(userId, clientName) {
  if (isSuperAdmin(userId)) return true;
  if (!clientsConfig[clientName]) return false;
  return clientsConfig[clientName].manager_id === userId;
}

// Состояние пользователей для многошагового ввода
const userStates = {};

// Функция для конвертации прокси из формата ip:port:user:pass в http://user:pass@ip:port
function parseProxyFormat(proxyLine) {
  const parts = proxyLine.trim().split(':');
  if (parts.length === 4) {
    const [ip, port, username, password] = parts;
    return `http://${username}:${password}@${ip}:${port}`;
  }
  return null;
}

// ✅ ДОБАВЛЕНО: Функция для удаления клиента с прокси сервера
async function deleteClientFromProxyServer(clientName) {
  if (!PROXY_SERVER_URL) {
    console.log('⚠️ PROXY_SERVER_URL не указан, пропускаем удаление с сервера');
    return false;
  }

  try {
    const axios = require('axios');
    
    // Пытаемся удалить клиента через API
    const response = await axios.delete(`${PROXY_SERVER_URL}/api/delete-client/${clientName}`, {
      auth: API_AUTH,
      timeout: 10000
    });
    
    console.log(`✅ Client ${clientName} deleted from proxy server`);
    return true;
  } catch (err) {
    if (err.response?.status === 404) {
      console.log(`⚠️ Client ${clientName} not found on proxy server (already deleted)`);
      return true; // Считаем успехом, если клиента уже нет
    }
    console.log(`⚠️ Failed to delete client ${clientName} from proxy server: ${err.message}`);
    return false;
  }
}

// Главное меню с учетом роли
function getMainMenu(userId) {
  const baseMenu = [
    ['📋 Мои клиенты', '➕ Добавить клиента'],
    ['🗑 Удалить клиента', '🔄 Обновить сервер'],
    ['📊 Моя статистика', '❓ Помощь']
  ];

  if (isSuperAdmin(userId)) {
    baseMenu[0][0] = '📋 Все клиенты';
    baseMenu[2][0] = '📊 Общая статистика';
    baseMenu.push(['👥 Управление менеджерами']);
  }

  return {
    reply_markup: {
      keyboard: baseMenu,
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!hasAccess(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав доступа к этому боту.\n\n📞 Обратитесь к администратору для получения доступа.');
    return;
  }

  const role = isSuperAdmin(userId) ? 'Супер-администратор' : 'Менеджер';
  const welcomeMessage = `
🚀 *Добро пожаловать в Proxy Manager Bot!*

👤 *Ваша роль:* ${role}
🆔 *Ваш ID:* \`${userId}\`

${isSuperAdmin(userId) ? 
  '*Супер-админ функции:*\n• 👁 Просмотр всех клиентов всех менеджеров\n• 👥 Управление менеджерами\n• 📊 Общая статистика системы\n\n*Менеджер функции:*' : 
  '*Доступные функции:*'}
• 📋 Просмотр ваших клиентов
• ➕ Добавление новых клиентов
• 🗑 Удаление ваших клиентов
• 🔄 Обновление конфигурации сервера
• 📊 Ваша статистика

Выберите действие из меню ниже:
  `;

  bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'Markdown',
    ...getMainMenu(userId)
  });
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!hasAccess(userId)) {
    return;
  }

  // Обработка состояний пользователя
  if (userStates[userId]) {
    await handleUserState(chatId, userId, text);
    return;
  }

  switch (text) {
    case '📋 Мои клиенты':
    case '📋 Все клиенты':
      await showClientsList(chatId, userId);
      break;

    case '➕ Добавить клиента':
      await startAddClient(chatId, userId);
      break;

    case '🗑 Удалить клиента':
      await showDeleteClientMenu(chatId, userId);
      break;

    case '🔄 Обновить сервер':
      await updateServerConfig(chatId);
      break;

    case '📊 Моя статистика':
    case '📊 Общая статистика':
      await showStatistics(chatId, userId);
      break;

    case '👥 Управление менеджерами':
      if (isSuperAdmin(userId)) {
        await showManagersInfo(chatId);
      }
      break;

    case '❓ Помощь':
      await showHelp(chatId, userId);
      break;

    default:
      if (text && !text.startsWith('/')) {
        bot.sendMessage(chatId, '❓ Неизвестная команда. Используйте меню ниже:', getMainMenu(userId));
      }
  }
});

// Показать список клиентов (с учетом роли)
async function showClientsList(chatId, userId) {
  const managerClients = getManagerClients(userId);
  
  if (Object.keys(managerClients).length === 0) {
    const message = isSuperAdmin(userId) ? 
      '📭 В системе нет клиентов.' : 
      '📭 У вас нет добавленных клиентов.';
    bot.sendMessage(chatId, message, getMainMenu(userId));
    return;
  }

  const title = isSuperAdmin(userId) ? 
    '📋 *Все клиенты системы:*' : 
    '📋 *Ваши клиенты:*';
  
  let message = `${title}\n\n`;
  
  Object.keys(managerClients).forEach((clientName, index) => {
    const client = managerClients[clientName];
    message += `${index + 1}. *${clientName}*\n`;
    message += `   🔑 Пароль: \`${client.password}\`\n`;
    message += `   🌐 Прокси: ${client.proxies.length} шт.\n`;
    
    if (isSuperAdmin(userId)) {
      message += `   👤 Менеджер ID: \`${client.manager_id}\`\n`;
      message += `   📅 Создан: ${new Date(client.created_at).toLocaleDateString()}\n`;
    }
    message += '\n';
  });

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    ...getMainMenu(userId)
  });
}

// Начать добавление клиента
async function startAddClient(chatId, userId) {
  userStates[userId] = {
    step: 'waiting_client_name',
    data: {}
  };

  bot.sendMessage(chatId, '➕ *Добавление нового клиента*\n\nВведите имя клиента (например: client1):', {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: [['❌ Отмена']],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
}

// Показать меню удаления клиента (только свои)
async function showDeleteClientMenu(chatId, userId) {
  const managerClients = getManagerClients(userId);
  
  if (Object.keys(managerClients).length === 0) {
    const message = isSuperAdmin(userId) ? 
      '📭 Нет клиентов для удаления.' : 
      '📭 У вас нет клиентов для удаления.';
    bot.sendMessage(chatId, message, getMainMenu(userId));
    return;
  }

  const keyboard = Object.keys(managerClients).map(clientName => [clientName]);
  keyboard.push(['❌ Отмена']);

  userStates[userId] = {
    step: 'waiting_delete_client',
    data: {}
  };

  const title = isSuperAdmin(userId) ? 
    '🗑 *Удаление клиента*\n\nВыберите клиента для удаления:' :
    '🗑 *Удаление вашего клиента*\n\nВыберите клиента для удаления:';

  bot.sendMessage(chatId, title, {
    parse_mode: 'Markdown',
    reply_markup: {
      keyboard: keyboard,
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
}

// Обработка состояний пользователя
async function handleUserState(chatId, userId, text) {
  const state = userStates[userId];

  if (text === '❌ Отмена') {
    delete userStates[userId];
    bot.sendMessage(chatId, '❌ Операция отменена.', getMainMenu(userId));
    return;
  }

  switch (state.step) {
    case 'waiting_client_name':
      if (!text || text.trim() === '') {
        bot.sendMessage(chatId, '❌ Имя клиента не может быть пустым. Попробуйте еще раз:');
        return;
      }

      if (clientsConfig[text]) {
        bot.sendMessage(chatId, '❌ Клиент с таким именем уже существует. Введите другое имя:');
        return;
      }

      state.data.clientName = text.trim();
      state.step = 'waiting_password';
      
      bot.sendMessage(chatId, `✅ Имя клиента: *${text}*\n\nТеперь введите пароль для подключения к прокси серверу:`, {
        parse_mode: 'Markdown'
      });
      break;

    case 'waiting_password':
      if (!text || text.trim() === '') {
        bot.sendMessage(chatId, '❌ Пароль не может быть пустым. Попробуйте еще раз:');
        return;
      }

      state.data.password = text.trim();
      state.step = 'waiting_proxies';
      
      bot.sendMessage(chatId, `✅ Пароль установлен\n\nТеперь отправьте список прокси в формате:\n\`ip:port:username:password\`\n\nПример:\n\`31.44.190.27:9625:512sdn:M0HBKk\n31.44.188.247:9656:512sdn:M0HBKk\`\n\nОтправьте все прокси одним сообщением:`, {
        parse_mode: 'Markdown'
      });
      break;

    case 'waiting_proxies':
      if (!text || text.trim() === '') {
        bot.sendMessage(chatId, '❌ Список прокси не может быть пустым. Попробуйте еще раз:');
        return;
      }

      const proxyLines = text.trim().split('\n');
      const proxies = [];
      const invalidProxies = [];

      proxyLines.forEach((line, index) => {
        const parsedProxy = parseProxyFormat(line);
        if (parsedProxy) {
          proxies.push(parsedProxy);
        } else {
          invalidProxies.push(`Строка ${index + 1}: ${line}`);
        }
      });

      if (invalidProxies.length > 0) {
        bot.sendMessage(chatId, `❌ Найдены некорректные прокси:\n\n${invalidProxies.join('\n')}\n\nПожалуйста, исправьте и отправьте список заново:`);
        return;
      }

      if (proxies.length === 0) {
        bot.sendMessage(chatId, '❌ Не найдено ни одного валидного прокси. Попробуйте еще раз:');
        return;
      }

      // Сохраняем клиента с привязкой к менеджеру
      clientsConfig[state.data.clientName] = {
        password: state.data.password,
        proxies: proxies,
        manager_id: userId,  // ✅ Привязываем к менеджеру
        created_at: new Date().toISOString()
      };

      saveClientsConfig();
      delete userStates[userId];

      bot.sendMessage(chatId, `✅ *Клиент успешно добавлен!*\n\n👤 Имя: *${state.data.clientName}*\n🔑 Пароль: \`${state.data.password}\`\n🌐 Прокси: ${proxies.length} шт.\n👤 Менеджер: \`${userId}\`\n\n💡 Нажмите "🔄 Обновить сервер" для применения изменений!`, {
        parse_mode: 'Markdown',
        ...getMainMenu(userId)
      });
      break;

    case 'waiting_delete_client':
      if (!clientsConfig[text]) {
        bot.sendMessage(chatId, '❌ Клиент не найден. Выберите из списка:');
        return;
      }

      // Проверяем права доступа
      if (!canAccessClient(userId, text)) {
        bot.sendMessage(chatId, '❌ У вас нет прав на удаление этого клиента.');
        return;
      }

      const clientToDelete = clientsConfig[text];
      
      // ✅ ИСПРАВЛЕНО: Удаляем клиента с прокси сервера ПЕРЕД удалением из конфигурации
      const deletedFromServer = await deleteClientFromProxyServer(text);
      
      // Удаляем из локальной конфигурации
      delete clientsConfig[text];
      saveClientsConfig();
      delete userStates[userId];

      const serverStatus = deletedFromServer ? 
        '🔄 *Удален с прокси сервера*' : 
        '⚠️ *Не удалось удалить с прокси сервера*';

      bot.sendMessage(chatId, `✅ *Клиент удален!*\n\n👤 Имя: *${text}*\n🌐 Удалено прокси: ${clientToDelete.proxies.length} шт.\n${serverStatus}\n\n💡 Изменения применены мгновенно!`, {
        parse_mode: 'Markdown',
        ...getMainMenu(userId)
      });
      break;
  }
}

// ✅ ИСПРАВЛЕНО: Обновить конфигурацию сервера с Basic Auth
async function updateServerConfig(chatId) {
  try {
    saveClientsConfig();
    
    let reloadResult = null;
    
    if (PROXY_SERVER_URL) {
      try {
        // Используем axios для Basic Auth
        const axios = require('axios');
        
        const response = await axios.post(`${PROXY_SERVER_URL}/api/add-client`, {
          clientName: 'telegram_bot',
          password: API_AUTH.password,
          proxies: []
        }, {
          auth: API_AUTH,
          timeout: 10000
        });
        
        console.log('✅ Proxy server connection test successful');
        
        // Теперь обновляем всех клиентов
        for (const [clientName, clientData] of Object.entries(clientsConfig)) {
          try {
            await axios.post(`${PROXY_SERVER_URL}/api/add-client`, {
              clientName: clientName,
              password: clientData.password,
              proxies: clientData.proxies
            }, {
              auth: API_AUTH,
              timeout: 10000
            });
          } catch (err) {
            if (err.response?.status === 409) {
              console.log(`Client ${clientName} already exists, skipping...`);
            } else {
              console.log(`Failed to add client ${clientName}:`, err.message);
            }
          }
        }
        
        reloadResult = { success: true, clients: Object.keys(clientsConfig).length };
        
      } catch (err) {
        console.log('⚠️ Failed to update proxy server:', err.message);
      }
    }
    
    const message = reloadResult 
      ? `✅ *Конфигурация обновлена!*\n\n📊 Клиентов: ${Object.keys(clientsConfig).length}\n🔄 *Прокси сервер обновлен*\n\n💡 Изменения применены мгновенно!`
      : `✅ *Конфигурация сохранена!*\n\n📊 Клиентов: ${Object.keys(clientsConfig).length}\n📁 Файл: clients-config.json\n\n${PROXY_SERVER_URL ? '⚠️ Не удалось обновить прокси сервер' : '💡 Прокси сервер URL не указан'}`;
    
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('❌ Ошибка обновления конфигурации:', error);
    bot.sendMessage(chatId, '❌ Ошибка при обновлении конфигурации сервера.');
  }
}

// Показать статистику (с учетом роли)
async function showStatistics(chatId, userId) {
  const managerClients = getManagerClients(userId);
  const totalClients = Object.keys(managerClients).length;
  let totalProxies = 0;
  let clientStats = '';

  Object.keys(managerClients).forEach((clientName, index) => {
    const client = managerClients[clientName];
    totalProxies += client.proxies.length;
    clientStats += `${index + 1}. *${clientName}*: ${client.proxies.length} прокси`;
    
    if (isSuperAdmin(userId)) {
      clientStats += ` (ID: ${client.manager_id})`;
    }
    clientStats += '\n';
  });

  const title = isSuperAdmin(userId) ? 
    '📊 *Статистика всей системы*' : 
    '📊 *Ваша статистика*';

  let message = `${title}\n\n👥 Клиентов: *${totalClients}*\n🌐 Прокси: *${totalProxies}*\n\n*Детализация:*\n${clientStats || 'Нет клиентов'}`;

  if (isSuperAdmin(userId)) {
    const managerStats = {};
    Object.keys(clientsConfig).forEach(clientName => {
      const managerId = clientsConfig[clientName].manager_id;
      if (!managerStats[managerId]) {
        managerStats[managerId] = { clients: 0, proxies: 0 };
      }
      managerStats[managerId].clients++;
      managerStats[managerId].proxies += clientsConfig[clientName].proxies.length;
    });

    message += '\n*📊 Статистика по менеджерам:*\n';
    Object.keys(managerStats).forEach(managerId => {
      const stats = managerStats[managerId];
      message += `ID ${managerId}: ${stats.clients} клиентов, ${stats.proxies} прокси\n`;
    });
  }

  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    ...getMainMenu(userId)
  });
}

// Показать информацию о менеджерах (только для супер-админа)
async function showManagersInfo(chatId) {
  let message = '👥 *Управление менеджерами*\n\n';
  message += `🔑 *Супер-админ:* \`${SUPER_ADMIN_ID}\`\n\n`;
  message += '*📋 Список менеджеров:*\n';
  
  MANAGER_IDS.forEach((managerId, index) => {
    const clientCount = Object.keys(clientsConfig).filter(
      clientName => clientsConfig[clientName].manager_id === managerId
    ).length;
    
    const role = managerId === SUPER_ADMIN_ID ? ' (Супер-админ)' : '';
    message += `${index + 1}. ID: \`${managerId}\`${role} - ${clientCount} клиентов\n`;
  });

  message += '\n*💡 Для добавления менеджера:*\n';
  message += 'Добавьте его ID в переменную MANAGER_IDS в Railway';

  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown'
  });
}

// Показать помощь (с учетом роли)
async function showHelp(chatId, userId) {
  const role = isSuperAdmin(userId) ? 'супер-администратор' : 'менеджер';
  
  let helpMessage = `
❓ *Справка по использованию бота*

👤 *Ваша роль:* ${role}
🆔 *Ваш ID:* \`${userId}\`

*Основные функции:*

📋 *Список клиентов* - показывает ${isSuperAdmin(userId) ? 'всех клиентов системы' : 'только ваших клиентов'}

➕ *Добавить клиента* - пошаговое добавление нового клиента:
   1. Введите имя клиента
   2. Введите пароль для подключения
   3. Отправьте список прокси в формате \`ip:port:user:pass\`

🗑 *Удалить клиента* - удаление ${isSuperAdmin(userId) ? 'любого клиента' : 'только ваших клиентов'}

🔄 *Обновить сервер* - сохраняет конфигурацию и уведомляет прокси сервер

📊 *Статистика* - показывает ${isSuperAdmin(userId) ? 'общую статистику системы' : 'вашу статистику'}
  `;

  if (isSuperAdmin(userId)) {
    helpMessage += `
👥 *Управление менеджерами* - просмотр списка менеджеров и их статистики

*🔑 Супер-админ возможности:*
• Просмотр всех клиентов всех менеджеров
• Удаление любых клиентов
• Просмотр статистики по менеджерам
• Управление доступами
    `;
  }

  helpMessage += `
*Формат прокси:*
\`31.44.190.27:9625:512sdn:M0HBKk\`
где: IP:PORT:USERNAME:PASSWORD

*Важно:* После добавления/удаления клиентов нажмите "🔄 Обновить сервер"!
  `;

  bot.sendMessage(chatId, helpMessage, {
    parse_mode: 'Markdown',
    ...getMainMenu(userId)
  });
}

// Запуск HTTP сервера для Railway
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
  console.log('🤖 Telegram Bot с системой ролей запущен!');
  console.log(`🔑 Супер-админ: ${SUPER_ADMIN_ID}`);
  console.log(`👥 Менеджеры: ${MANAGER_IDS.join(', ')}`);
  console.log(`📁 Файл конфигурации: ${CLIENTS_CONFIG_PATH}`);
  console.log(`🌐 Прокси сервер URL: ${PROXY_SERVER_URL || 'не указан'}`);
  console.log(`🔐 API Auth: ${API_AUTH.username}:${API_AUTH.password}`);
  
  // Инициализация
  loadClientsConfig();
});

// Обработка ошибок
bot.on('error', (error) => {
  console.error('❌ Ошибка бота:', error);
});

process.on('SIGINT', () => {
  console.log('🛑 Остановка бота...');
  bot.stopPolling();
  process.exit(0);
});
