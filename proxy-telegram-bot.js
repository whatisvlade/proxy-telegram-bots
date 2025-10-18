const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// Токен бота (получите у @BotFather)
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';

// ID администраторов (замените на ваши Telegram ID)
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [123456789];

// URL прокси сервера для автоматического обновления (опционально)
const PROXY_SERVER_URL = process.env.PROXY_SERVER_URL || '';

// Путь к файлу конфигурации клиентов
const CLIENTS_CONFIG_PATH = './clients-config.json';

// Создаем бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Загружаем конфигурацию клиентов
let clientsConfig = {};

function loadClientsConfig() {
  try {
    if (fs.existsSync(CLIENTS_CONFIG_PATH)) {
      const data = fs.readFileSync(CLIENTS_CONFIG_PATH, 'utf8');
      clientsConfig = JSON.parse(data);
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

// Проверка прав администратора
function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// Состояние пользователей для многошагового ввода
const userStates = {};

// Функция для конвертации прокси из формата ip:port:user:pass в http://user:pass@ip:port
function convertProxyFormat(proxyLine) {
  const parts = proxyLine.trim().split(':');
  if (parts.length === 4) {
    const [ip, port, username, password] = parts;
    return `http://${username}:${password}@${ip}:${port}`;
  }
  return null;
}

// Главное меню
function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['📋 Список клиентов', '➕ Добавить клиента'],
        ['🗑 Удалить клиента', '🔄 Обновить сервер'],
        ['📊 Статистика', '❓ Помощь']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAdmin(userId)) {
    bot.sendMessage(chatId, '❌ У вас нет прав доступа к этому боту.');
    return;
  }

  const welcomeMessage = `
🚀 *Добро пожаловать в Proxy Manager Bot!*

Этот бот позволяет управлять клиентами и прокси на вашем Railway сервере.

*Доступные функции:*
• 📋 Просмотр списка клиентов
• ➕ Добавление новых клиентов
• 🗑 Удаление клиентов
• 🔄 Обновление конфигурации сервера
• 📊 Просмотр статистики

Выберите действие из меню ниже:
  `;

  bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'Markdown',
    ...getMainMenu()
  });
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!isAdmin(userId)) {
    return;
  }

  // Обработка состояний пользователя
  if (userStates[userId]) {
    await handleUserState(chatId, userId, text);
    return;
  }

  switch (text) {
    case '📋 Список клиентов':
      await showClientsList(chatId);
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

    case '📊 Статистика':
      await showStatistics(chatId);
      break;

    case '❓ Помощь':
      await showHelp(chatId);
      break;

    default:
      if (text && !text.startsWith('/')) {
        bot.sendMessage(chatId, '❓ Неизвестная команда. Используйте меню ниже:', getMainMenu());
      }
  }
});

// Показать список клиентов
async function showClientsList(chatId) {
  if (Object.keys(clientsConfig).length === 0) {
    bot.sendMessage(chatId, '📭 Список клиентов пуст.', getMainMenu());
    return;
  }

  let message = '📋 *Список клиентов:*\n\n';
  
  Object.keys(clientsConfig).forEach((clientName, index) => {
    const client = clientsConfig[clientName];
    message += `${index + 1}. *${clientName}*\n`;
    message += `   🔑 Пароль: \`${client.password}\`\n`;
    message += `   🌐 Прокси: ${client.proxies.length} шт.\n\n`;
  });

  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    ...getMainMenu()
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

// Показать меню удаления клиента
async function showDeleteClientMenu(chatId, userId) {
  if (Object.keys(clientsConfig).length === 0) {
    bot.sendMessage(chatId, '📭 Нет клиентов для удаления.', getMainMenu());
    return;
  }

  const keyboard = Object.keys(clientsConfig).map(clientName => [clientName]);
  keyboard.push(['❌ Отмена']);

  userStates[userId] = {
    step: 'waiting_delete_client',
    data: {}
  };

  bot.sendMessage(chatId, '🗑 *Удаление клиента*\n\nВыберите клиента для удаления:', {
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
    bot.sendMessage(chatId, '❌ Операция отменена.', getMainMenu());
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
        const convertedProxy = convertProxyFormat(line);
        if (convertedProxy) {
          proxies.push(convertedProxy);
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

      // Сохраняем клиента
      clientsConfig[state.data.clientName] = {
        password: state.data.password,
        proxies: proxies
      };

      saveClientsConfig();
      delete userStates[userId];

      bot.sendMessage(chatId, `✅ *Клиент успешно добавлен!*\n\n👤 Имя: *${state.data.clientName}*\n🔑 Пароль: \`${state.data.password}\`\n🌐 Прокси: ${proxies.length} шт.\n\n💡 Нажмите "🔄 Обновить сервер" для применения изменений!`, {
        parse_mode: 'Markdown',
        ...getMainMenu()
      });
      break;

    case 'waiting_delete_client':
      if (!clientsConfig[text]) {
        bot.sendMessage(chatId, '❌ Клиент не найден. Выберите из списка:');
        return;
      }

      const clientToDelete = clientsConfig[text];
      delete clientsConfig[text];
      saveClientsConfig();
      delete userStates[userId];

      bot.sendMessage(chatId, `✅ *Клиент удален!*\n\n👤 Имя: *${text}*\n🌐 Удалено прокси: ${clientToDelete.proxies.length} шт.\n\n💡 Нажмите "🔄 Обновить сервер" для применения изменений!`, {
        parse_mode: 'Markdown',
        ...getMainMenu()
      });
      break;
  }
}

// Обновить конфигурацию сервера
async function updateServerConfig(chatId) {
  try {
    // Сохраняем конфигурацию в JSON файл
    saveClientsConfig();
    
    let reloadResult = null;
    
    // Пытаемся автоматически уведомить прокси сервер (если URL указан)
    if (PROXY_SERVER_URL) {
      try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(`${PROXY_SERVER_URL}/reload-config`, {
          method: 'POST',
          timeout: 5000
        });
        reloadResult = await response.json();
        console.log('✅ Proxy server auto-reload successful:', reloadResult);
      } catch (err) {
        console.log('⚠️ Auto-reload failed (but config saved):', err.message);
      }
    }
    
    const message = reloadResult 
      ? `✅ *Конфигурация обновлена!*\n\n📊 Клиентов: ${Object.keys(clientsConfig).length}\n🔄 *Автоматическая перезагрузка выполнена*\n\n💡 Изменения применены мгновенно!`
      : `✅ *Конфигурация сохранена!*\n\n📊 Клиентов: ${Object.keys(clientsConfig).length}\n📁 Файл: clients-config.json\n\n${PROXY_SERVER_URL ? '⚠️ Автоматическая перезагрузка не удалась' : '💡 Прокси сервер автоматически подхватит изменения'}`;
    
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      ...getMainMenu()
    });
  } catch (error) {
    console.error('❌ Ошибка обновления конфигурации:', error);
    bot.sendMessage(chatId, '❌ Ошибка при обновлении конфигурации сервера.', getMainMenu());
  }
}

// Показать статистику
async function showStatistics(chatId) {
  const totalClients = Object.keys(clientsConfig).length;
  let totalProxies = 0;
  let clientStats = '';

  Object.keys(clientsConfig).forEach((clientName, index) => {
    const client = clientsConfig[clientName];
    totalProxies += client.proxies.length;
    clientStats += `${index + 1}. *${clientName}*: ${client.proxies.length} прокси\n`;
  });

  const message = `📊 *Статистика системы*\n\n👥 Всего клиентов: *${totalClients}*\n🌐 Всего прокси: *${totalProxies}*\n\n*Детализация по клиентам:*\n${clientStats || 'Нет клиентов'}`;

  bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    ...getMainMenu()
  });
}

// Показать помощь
async function showHelp(chatId) {
  const helpMessage = `
❓ *Справка по использованию бота*

*Основные функции:*

📋 *Список клиентов* - показывает всех добавленных клиентов с их паролями и количеством прокси

➕ *Добавить клиента* - пошаговое добавление нового клиента:
   1. Введите имя клиента
   2. Введите пароль для подключения
   3. Отправьте список прокси в формате \`ip:port:user:pass\`

🗑 *Удалить клиента* - удаление клиента и всех его прокси

🔄 *Обновить сервер* - сохраняет конфигурацию и уведомляет прокси сервер

📊 *Статистика* - показывает общую информацию о клиентах и прокси

*Формат прокси:*
\`31.44.190.27:9625:512sdn:M0HBKk\`
где: IP:PORT:USERNAME:PASSWORD

*Важно:* После добавления/удаления клиентов нажмите "🔄 Обновить сервер"!
  `;

  bot.sendMessage(chatId, helpMessage, {
    parse_mode: 'Markdown',
    ...getMainMenu()
  });
}

// Инициализация
loadClientsConfig();

console.log('🤖 Telegram Bot запущен!');
console.log(`👥 Администраторы: ${ADMIN_IDS.join(', ')}`);
console.log(`📁 Файл конфигурации: ${CLIENTS_CONFIG_PATH}`);
console.log(`🌐 Прокси сервер URL: ${PROXY_SERVER_URL || 'не указан'}`);

// Обработка ошибок
bot.on('error', (error) => {
  console.error('❌ Ошибка бота:', error);
});

process.on('SIGINT', () => {
  console.log('🛑 Остановка бота...');
  bot.stopPolling();
  process.exit(0);
});
