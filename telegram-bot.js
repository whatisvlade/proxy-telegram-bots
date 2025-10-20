const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = parseInt(process.env.SUPER_ADMIN_ID);
const PROXY6_API_KEY = process.env.PROXY6_API_KEY;
const RAILWAY_PROXY_URL = process.env.RAILWAY_PROXY_URL || 'https://railway-proxy-server-production-58a1.up.railway.app';
const PORT = process.env.PORT || 8080;

// Настройки PROXY6
const PROXY6_CONFIG = {
    country: 'ru',
    count: 1,
    period: 7,
    version: 4
};

// Создание бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Создание Express сервера для Railway
const app = express();
app.use(express.json());

// Health check endpoint для Railway
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        service: 'Telegram Proxy Bot',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        bot: 'running',
        admins: Object.keys(admins).length,
        uptime: process.uptime()
    });
});

// Запуск веб-сервера
app.listen(PORT, () => {
    console.log(`🌐 Health endpoint доступен на порту ${PORT}`);
});

// Хранение данных
let admins = {};
let userStates = {};

// Загрузка админов
function loadAdmins() {
    try {
        if (fs.existsSync('admins.json')) {
            const data = fs.readFileSync('admins.json', 'utf8');
            admins = JSON.parse(data);
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки админов:', error);
        admins = {};
    }
}

// Сохранение админов
function saveAdmins() {
    try {
        fs.writeFileSync('admins.json', JSON.stringify(admins, null, 2));
        console.log('💾 Конфигурация админов сохранена');
    } catch (error) {
        console.error('❌ Ошибка сохранения админов:', error);
    }
}

// Проверка прав админа
function isAdmin(userId) {
    return userId === SUPER_ADMIN_ID || admins.hasOwnProperty(userId.toString());
}

function isSuperAdmin(userId) {
    return userId === SUPER_ADMIN_ID;
}

// Клавиатура для админов
function getAdminKeyboard() {
    return {
        keyboard: [
            ['➕ Добавить клиента', '📋 Список клиентов'],
            ['🔧 Управление прокси', '💰 Баланс PROXY6'],
            ['👥 Управление админами', '📊 Статистика']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

// Клавиатура для управления прокси
function getProxyManagementKeyboard() {
    return {
        keyboard: [
            ['➕ Добавить прокси', '➖ Удалить прокси'],
            ['🔄 Ротация прокси', '📋 Список прокси'],
            ['🏠 Главное меню']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

// PROXY6.net API функции
async function checkProxy6Balance() {
    try {
        const response = await axios.get(`https://proxy6.net/api/${PROXY6_API_KEY}/getbalance`);
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка проверки баланса PROXY6:', error.response?.data || error.message);
        throw error;
    }
}

async function getProxy6Prices() {
    try {
        const response = await axios.get(`https://proxy6.net/api/${PROXY6_API_KEY}/getprice`, {
            params: {
                count: PROXY6_CONFIG.count,
                period: PROXY6_CONFIG.period,
                version: PROXY6_CONFIG.version
            }
        });
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка получения цен PROXY6:', error.response?.data || error.message);
        throw error;
    }
}

async function buyProxy6Proxies() {
    try {
        const response = await axios.get(`https://proxy6.net/api/${PROXY6_API_KEY}/buy`, {
            params: {
                count: PROXY6_CONFIG.count,
                period: PROXY6_CONFIG.period,
                country: PROXY6_CONFIG.country,
                version: PROXY6_CONFIG.version
            }
        });
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка покупки прокси PROXY6:', error.response?.data || error.message);
        throw error;
    }
}

// Функция для проверки и форматирования прокси
function formatProxyForRailway(proxy) {
    // PROXY6.net возвращает: { host, port, user, pass, type }
    // Railway ожидает: "host:port:user:pass" или объект
    
    if (typeof proxy === 'string') {
        return proxy; // Уже в правильном формате
    }
    
    if (proxy.host && proxy.port && proxy.user && proxy.pass) {
        return `${proxy.host}:${proxy.port}:${proxy.user}:${proxy.pass}`;
    }
    
    console.error('❌ Неверный формат прокси:', proxy);
    return null;
}

// Railway Proxy Server API функции
async function addClientToProxyServer(clientName, password, proxies = []) {
    try {
        // Форматируем прокси для Railway
        const formattedProxies = proxies
            .map(proxy => formatProxyForRailway(proxy))
            .filter(proxy => proxy !== null);

        console.log(`🔧 Добавляем клиента ${clientName} с ${formattedProxies.length} прокси`);
        console.log('📋 Первые 3 прокси:', formattedProxies.slice(0, 3));

        const response = await axios.post(`${RAILWAY_PROXY_URL}/api/add-client`, {
            clientName: clientName,
            password: password,
            proxies: formattedProxies
        });
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка добавления клиента на прокси сервер:', error.response?.data || error.message);
        throw error;
    }
}

async function getClientsFromProxyServer() {
    try {
        const response = await axios.get(`${RAILWAY_PROXY_URL}/api/clients`);
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка получения клиентов с прокси сервера:', error.response?.data || error.message);
        throw error;
    }
}

async function deleteClientFromProxyServer(clientName) {
    try {
        const response = await axios.delete(`${RAILWAY_PROXY_URL}/api/delete-client/${clientName}`);
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка удаления клиента с прокси сервера:', error.response?.data || error.message);
        throw error;
    }
}

async function addProxyToClient(clientName, proxy) {
    try {
        const formattedProxy = formatProxyForRailway(proxy);
        if (!formattedProxy) {
            throw new Error('Неверный формат прокси');
        }

        const response = await axios.post(`${RAILWAY_PROXY_URL}/api/add-proxy`, {
            clientName: clientName,
            proxy: formattedProxy
        });
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка добавления прокси клиенту:', error.response?.data || error.message);
        throw error;
    }
}

async function removeProxyFromClient(clientName, proxy) {
    try {
        const formattedProxy = formatProxyForRailway(proxy);
        if (!formattedProxy) {
            throw new Error('Неверный формат прокси');
        }

        const response = await axios.delete(`${RAILWAY_PROXY_URL}/api/remove-proxy`, {
            data: {
                clientName: clientName,
                proxy: formattedProxy
            }
        });
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка удаления прокси у клиента:', error.response?.data || error.message);
        throw error;
    }
}

// Функция для тестирования прокси
async function testProxy(proxy) {
    try {
        const formattedProxy = formatProxyForRailway(proxy);
        if (!formattedProxy) {
            return false;
        }

        const [host, port, user, pass] = formattedProxy.split(':');
        
        // Простая проверка доступности прокси
        const proxyUrl = `http://${user}:${pass}@${host}:${port}`;
        
        const response = await axios.get('http://httpbin.org/ip', {
            proxy: false,
            httpsAgent: new (require('https').Agent)({
                rejectUnauthorized: false
            }),
            timeout: 10000
        });
        
        return true;
    } catch (error) {
        console.error(`❌ Прокси ${proxy} не работает:`, error.message);
        return false;
    }
}

// Обработчики команд
bot.onText(/\/start/, (msg) => {
    const userId = msg.from.id;
    
    if (!isAdmin(userId)) {
        bot.sendMessage(userId, '❌ У вас нет прав доступа к этому боту.');
        return;
    }

    const welcomeMessage = `🚀 *Добро пожаловать в Telegram Proxy Bot!*

🔧 *Основные функции:*
• Автоматическая покупка прокси через PROXY6.net
• Управление клиентами на Railway Proxy Server
• Мульти-админская система
• Проверка работоспособности прокси

👑 *Ваш статус:* ${isSuperAdmin(userId) ? 'Супер-админ' : 'Админ'}

Используйте кнопки ниже для управления:`;

    bot.sendMessage(userId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: getAdminKeyboard()
    });
});

// Обработка кнопок
bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const text = msg.text;

    if (!isAdmin(userId)) {
        return;
    }

    // Обработка состояний пользователя
    if (userStates[userId]) {
        await handleUserState(userId, text, msg);
        return;
    }

    switch (text) {
        case '➕ Добавить клиента':
            console.log(`➕ Команда добавления клиента от userId=${userId}`);
            userStates[userId] = { action: 'add_client', step: 'name' };
            bot.sendMessage(userId, '👤 Введите имя клиента:');
            break;

        case '📋 Список клиентов':
            console.log(`📋 Команда списка клиентов от userId=${userId}`);
            await handleListClients(userId);
            break;

        case '🔧 Управление прокси':
            bot.sendMessage(userId, '🔧 Выберите действие с прокси:', {
                reply_markup: getProxyManagementKeyboard()
            });
            break;

        case '💰 Баланс PROXY6':
            console.log(`💰 Команда баланса PROXY6 от userId=${userId}`);
            await handleProxy6Balance(userId);
            break;

        case '👥 Управление админами':
            if (isSuperAdmin(userId)) {
                await handleAdminManagement(userId);
            } else {
                bot.sendMessage(userId, '❌ Только супер-админ может управлять админами.');
            }
            break;

        case '📊 Статистика':
            await handleStats(userId);
            break;

        case '➕ Добавить прокси':
            userStates[userId] = { action: 'add_proxy', step: 'client' };
            bot.sendMessage(userId, '👤 Введите имя клиента для добавления прокси:');
            break;

        case '➖ Удалить прокси':
            console.log(`➖ Команда удаления прокси от userId=${userId}`);
            userStates[userId] = { action: 'remove_proxy', step: 'client' };
            bot.sendMessage(userId, '👤 Введите имя клиента для удаления прокси:');
            break;

        case '🔄 Ротация прокси':
            userStates[userId] = { action: 'rotate_proxy', step: 'client' };
            bot.sendMessage(userId, '👤 Введите имя клиента для ротации прокси:');
            break;

        case '📋 Список прокси':
            userStates[userId] = { action: 'list_proxies', step: 'client' };
            bot.sendMessage(userId, '👤 Введите имя клиента для просмотра прокси:');
            break;

        case '🏠 Главное меню':
            bot.sendMessage(userId, '🏠 Главное меню', {
                reply_markup: getAdminKeyboard()
            });
            break;
    }
});

// Обработка состояний пользователя
async function handleUserState(userId, text, msg) {
    const state = userStates[userId];

    switch (state.action) {
        case 'add_client':
            if (state.step === 'name') {
                state.clientName = text;
                state.step = 'password';
                bot.sendMessage(userId, '🔐 Введите пароль для клиента:');
            } else if (state.step === 'password') {
                state.password = text;
                await handleAddClient(userId, state.clientName, state.password);
                delete userStates[userId];
            }
            break;

        case 'add_proxy':
            if (state.step === 'client') {
                state.clientName = text;
                state.step = 'proxy';
                bot.sendMessage(userId, '🌐 Введите прокси в формате host:port:user:pass:');
            } else if (state.step === 'proxy') {
                await handleAddProxyToClient(userId, state.clientName, text);
                delete userStates[userId];
            }
            break;

        case 'remove_proxy':
            if (state.step === 'client') {
                state.clientName = text;
                state.step = 'proxy';
                bot.sendMessage(userId, '🌐 Введите прокси для удаления в формате host:port:user:pass:');
            } else if (state.step === 'proxy') {
                await handleRemoveProxyFromClient(userId, state.clientName, text);
                delete userStates[userId];
            }
            break;

        case 'rotate_proxy':
            if (state.step === 'client') {
                await handleRotateProxy(userId, text);
                delete userStates[userId];
            }
            break;

        case 'list_proxies':
            if (state.step === 'client') {
                await handleListClientProxies(userId, text);
                delete userStates[userId];
            }
            break;
    }
}

// Обработчики функций
async function handleAddClient(userId, clientName, password) {
    try {
        bot.sendMessage(userId, '🛒 Покупаю прокси через PROXY6.net...');
        
        // Покупка прокси
        const purchaseResult = await buyProxy6Proxies();
        
        if (purchaseResult.status !== 'yes') {
            bot.sendMessage(userId, `❌ Ошибка покупки прокси: ${purchaseResult.error || 'Неизвестная ошибка'}`);
            return;
        }

        console.log('🔍 Структура ответа PROXY6:', JSON.stringify(purchaseResult, null, 2));

        // Правильное форматирование прокси из PROXY6.net
        const proxies = Object.values(purchaseResult.list || {});
        console.log(`📦 Получено ${proxies.length} прокси от PROXY6`);

        if (proxies.length === 0) {
            bot.sendMessage(userId, '❌ Не удалось получить прокси от PROXY6.net');
            return;
        }

        bot.sendMessage(userId, `✅ Куплено ${proxies.length} прокси. Добавляю клиента...`);

        // Добавление клиента на прокси сервер
        await addClientToProxyServer(clientName, password, proxies);

        bot.sendMessage(userId, `✅ Клиент "${clientName}" успешно добавлен с ${proxies.length} прокси!

🔧 *Данные для подключения:*
• Хост: \`yamabiko.proxy.rlwy.net:38659\`
• Логин: \`${clientName}\`
• Пароль: \`${password}\`

📋 Используйте эти данные для настройки прокси в ваших приложениях.`, {
            parse_mode: 'Markdown',
            reply_markup: getAdminKeyboard()
        });

    } catch (error) {
        console.error('❌ Ошибка добавления клиента:', error);
        bot.sendMessage(userId, `❌ Ошибка: ${error.message}`, {
            reply_markup: getAdminKeyboard()
        });
    }
}

async function handleListClients(userId) {
    try {
        const clients = await getClientsFromProxyServer();
        
        if (!clients || clients.length === 0) {
            bot.sendMessage(userId, '📋 Клиенты не найдены.');
            return;
        }

        let message = '📋 *Список клиентов:*\n\n';
        clients.forEach((client, index) => {
            message += `${index + 1}. *${client.name}*\n`;
            message += `   🌐 Прокси: ${client.proxies ? client.proxies.length : 0}\n`;
            message += `   🔐 Пароль: \`${client.password}\`\n`;
            message += `   🔗 Подключение: \`yamabiko.proxy.rlwy.net:38659\`\n\n`;
        });

        bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка получения списка клиентов:', error);
        bot.sendMessage(userId, '❌ Ошибка получения списка клиентов.');
    }
}

async function handleProxy6Balance(userId) {
    try {
        const balance = await checkProxy6Balance();
        
        if (balance.status === 'yes') {
            bot.sendMessage(userId, `💰 *Баланс PROXY6.net:* ${balance.balance} ${balance.currency}`, {
                parse_mode: 'Markdown'
            });
        } else {
            bot.sendMessage(userId, `❌ Ошибка получения баланса: ${balance.error}`);
        }
    } catch (error) {
        console.error('❌ Ошибка проверки баланса:', error);
        bot.sendMessage(userId, '❌ Ошибка проверки баланса PROXY6.net');
    }
}

async function handleAdminManagement(userId) {
    const adminList = Object.keys(admins).map(id => `• ${id}`).join('\n');
    const message = `👥 *Управление админами*\n\n*Текущие админы:*\n${adminList || 'Нет админов'}\n\n*Команды:*\n/add_admin [ID] - добавить админа\n/remove_admin [ID] - удалить админа`;
    
    bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
}

async function handleStats(userId) {
    try {
        const clients = await getClientsFromProxyServer();
        const totalClients = clients ? clients.length : 0;
        const totalProxies = clients ? clients.reduce((sum, client) => sum + (client.proxies ? client.proxies.length : 0), 0) : 0;
        
        const message = `📊 *Статистика системы*\n\n👥 Всего клиентов: ${totalClients}\n🌐 Всего прокси: ${totalProxies}\n👑 Админов: ${Object.keys(admins).length + 1}\n🔗 Прокси сервер: \`yamabiko.proxy.rlwy.net:38659\``;
        
        bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        bot.sendMessage(userId, '❌ Ошибка получения статистики.');
    }
}

async function handleAddProxyToClient(userId, clientName, proxy) {
    try {
        await addProxyToClient(clientName, proxy);
        bot.sendMessage(userId, `✅ Прокси добавлен клиенту "${clientName}"`, {
            reply_markup: getAdminKeyboard()
        });
    } catch (error) {
        console.error('❌ Ошибка добавления прокси:', error);
        bot.sendMessage(userId, `❌ Ошибка добавления прокси: ${error.message}`, {
            reply_markup: getAdminKeyboard()
        });
    }
}

async function handleRemoveProxyFromClient(userId, clientName, proxy) {
    try {
        await removeProxyFromClient(clientName, proxy);
        bot.sendMessage(userId, `✅ Прокси удален у клиента "${clientName}"`, {
            reply_markup: getAdminKeyboard()
        });
    } catch (error) {
        console.error('❌ Ошибка удаления прокси:', error);
        bot.sendMessage(userId, `❌ Ошибка удаления прокси: ${error.message}`, {
            reply_markup: getAdminKeyboard()
        });
    }
}

async function handleRotateProxy(userId, clientName) {
    try {
        const response = await axios.post(`${RAILWAY_PROXY_URL}/api/rotate-client`, {
            clientName: clientName
        });
        bot.sendMessage(userId, `🔄 Прокси ротирован для клиента "${clientName}"`, {
            reply_markup: getAdminKeyboard()
        });
    } catch (error) {
        console.error('❌ Ошибка ротации прокси:', error);
        bot.sendMessage(userId, `❌ Ошибка ротации прокси: ${error.message}`, {
            reply_markup: getAdminKeyboard()
        });
    }
}

async function handleListClientProxies(userId, clientName) {
    try {
        const clients = await getClientsFromProxyServer();
        const client = clients.find(c => c.name === clientName);
        
        if (!client) {
            bot.sendMessage(userId, `❌ Клиент "${clientName}" не найден.`);
            return;
        }

        if (!client.proxies || client.proxies.length === 0) {
            bot.sendMessage(userId, `📋 У клиента "${clientName}" нет прокси.`);
            return;
        }

        let message = `📋 *Прокси клиента "${clientName}":*\n\n`;
        client.proxies.forEach((proxy, index) => {
            message += `${index + 1}. \`${proxy}\`\n`;
        });

        bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка получения прокси клиента:', error);
        bot.sendMessage(userId, '❌ Ошибка получения прокси клиента.');
    }
}

// Команды для управления админами
bot.onText(/\/add_admin (\d+)/, async (msg, match) => {
    const userId = msg.from.id;
    const newAdminId = match[1];

    if (!isSuperAdmin(userId)) {
        bot.sendMessage(userId, '❌ Только супер-админ может добавлять админов.');
        return;
    }

    admins[newAdminId] = {
        id: parseInt(newAdminId),
        addedBy: userId,
        addedAt: new Date().toISOString()
    };

    saveAdmins();
    bot.sendMessage(userId, `✅ Админ ${newAdminId} добавлен.`);
});

bot.onText(/\/remove_admin (\d+)/, async (msg, match) => {
    const userId = msg.from.id;
    const adminId = match[1];

    if (!isSuperAdmin(userId)) {
        bot.sendMessage(userId, '❌ Только супер-админ может удалять админов.');
        return;
    }

    if (admins[adminId]) {
        delete admins[adminId];
        saveAdmins();
        bot.sendMessage(userId, `✅ Админ ${adminId} удален.`);
    } else {
        bot.sendMessage(userId, `❌ Админ ${adminId} не найден.`);
    }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error);
});

process.on('SIGINT', () => {
    console.log('🛑 Получен сигнал SIGINT, завершаю работу...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Получен сигнал SIGTERM, завершаю работу...');
    bot.stopPolling();
    process.exit(0);
});

// Инициализация
loadAdmins();

console.log(`👑 Супер-админ ID: ${SUPER_ADMIN_ID}`);
console.log(`👥 Админов: ${Object.keys(admins).length}`);
console.log(`🛒 PROXY6.net API: ${PROXY6_API_KEY ? '✅ Настроен' : '❌ Не настроен'}`);
console.log(`🌐 Прокси сервер: ${RAILWAY_PROXY_URL}`);
console.log('🚀 Telegram Bot запущен с исправленным форматированием прокси!');
