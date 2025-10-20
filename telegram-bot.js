// telegram-bot-fixed-admin.js - Telegram Bot с исправленным управлением админами через + и -
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = parseInt(process.env.SUPER_ADMIN_ID);
const RAILWAY_PROXY_URL = process.env.RAILWAY_PROXY_URL || 'https://railway-proxy-server-production-58a1.up.railway.app';

// PROXY6.net API конфигурация
const PROXY6_API_KEY = process.env.PROXY6_API_KEY;
const PROXY6_BASE_URL = 'https://proxy6.net/api';

// Файлы для хранения данных
const ADMINS_FILE = path.join(__dirname, 'admins.json');
const USER_STATES_FILE = path.join(__dirname, 'user_states.json');

// Инициализация бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Состояния пользователей и админы
let admins = {};
let userStates = {};

// Функции для работы с файлами
async function loadAdmins() {
    try {
        const data = await fs.readFile(ADMINS_FILE, 'utf8');
        admins = JSON.parse(data);
        console.log('✅ Админы загружены из файла');
    } catch (error) {
        console.log('📝 Создаем новый файл админов');
        admins = {};
        await saveAdmins();
    }
}

async function saveAdmins() {
    try {
        await fs.writeFile(ADMINS_FILE, JSON.stringify(admins, null, 2));
        console.log('💾 Админы сохранены в файл');
    } catch (error) {
        console.error('❌ Ошибка сохранения админов:', error.message);
    }
}

async function loadUserStates() {
    try {
        const data = await fs.readFile(USER_STATES_FILE, 'utf8');
        userStates = JSON.parse(data);
        console.log('✅ Состояния пользователей загружены');
    } catch (error) {
        console.log('📝 Создаем новый файл состояний');
        userStates = {};
        await saveUserStates();
    }
}

async function saveUserStates() {
    try {
        await fs.writeFile(USER_STATES_FILE, JSON.stringify(userStates, null, 2));
    } catch (error) {
        console.error('❌ Ошибка сохранения состояний:', error.message);
    }
}

// Проверка прав доступа
function isSuperAdmin(userId) {
    return userId === SUPER_ADMIN_ID;
}

function isAdmin(userId) {
    return isSuperAdmin(userId) || admins.hasOwnProperty(userId.toString());
}

// Функция для проверки и форматирования прокси
function formatProxyForRailway(proxy) {
    // PROXY6.net возвращает: { host, port, user, pass, type }
    // Railway ожидает: "http://user:pass@host:port"

    if (typeof proxy === 'string') {
        // Если уже в формате http://user:pass@host:port
        if (proxy.startsWith('http://') && proxy.includes('@')) {
            return proxy;
        }
        
        // Если в формате host:port:user:pass - конвертируем
        const parts = proxy.split(':');
        if (parts.length === 4) {
            const [host, port, user, pass] = parts;
            return `http://${user}:${pass}@${host}:${port}`;
        }
        
        return proxy; // Возвращаем как есть
    }

    // Если объект от PROXY6.net
    if (proxy.host && proxy.port && proxy.user && proxy.pass) {
        return `http://${proxy.user}:${proxy.pass}@${proxy.host}:${proxy.port}`;
    }

    console.error('❌ Неверный формат прокси:', proxy);
    return null;
}

// PROXY6.net API функции
async function checkProxy6Balance() {
    try {
        const response = await axios.get(`${PROXY6_BASE_URL}/${PROXY6_API_KEY}/getbalance`);
        if (response.data.status === 'yes') {
            return {
                success: true,
                balance: response.data.balance,
                currency: response.data.currency
            };
        }
        return { success: false, error: response.data.error || 'Unknown error' };
    } catch (error) {
        console.error('❌ Ошибка проверки баланса PROXY6:', error.message);
        return { success: false, error: error.message };
    }
}

async function getProxy6Price(count = 1, period = 7, version = 3) {
    try {
        const response = await axios.get(`${PROXY6_BASE_URL}/${PROXY6_API_KEY}/getprice`, {
            params: {
                count,
                period,
                version
            }
        });
        
        if (response.data.status === 'yes') {
            return {
                success: true,
                price: response.data.price,
                pricePerProxy: response.data.price_single,
                currency: response.data.currency
            };
        }
        return { success: false, error: response.data.error || 'Unknown error' };
    } catch (error) {
        console.error('❌ Ошибка получения цены PROXY6:', error.message);
        return { success: false, error: error.message };
    }
}

async function buyProxy6Proxies(count = 1, period = 7, country = 'ru', version = 3, type = 'http') {
    try {
        const response = await axios.get(`${PROXY6_BASE_URL}/${PROXY6_API_KEY}/buy`, {
            params: {
                count,
                period,
                country,
                version,
                type
            }
        });
        
        if (response.data.status === 'yes') {
            const proxies = [];
            const proxyList = response.data.list || {};
            
            Object.values(proxyList).forEach(proxy => {
                const formattedProxy = `${proxy.host}:${proxy.port}:${proxy.user}:${proxy.pass}`;
                proxies.push(formattedProxy);
            });
            
            console.log(`📦 Получено ${proxies.length} прокси от PROXY6`);
            console.log(`📋 Первые 3 прокси:`, proxies.slice(0, 3));
            
            return {
                success: true,
                proxies,
                orderId: response.data.order_id,
                count: response.data.count,
                price: response.data.price
            };
        }
        return { success: false, error: response.data.error || 'Unknown error' };
    } catch (error) {
        console.error('❌ Ошибка покупки прокси PROXY6:', error.message);
        return { success: false, error: error.message };
    }
}

// Функции для работы с Railway Proxy Server
async function addClientToProxyServer(clientName, password, proxies = []) {
    try {
        // Форматируем прокси для Railway
        const formattedProxies = proxies.map(proxy => formatProxyForRailway(proxy)).filter(p => p !== null);
        
        console.log(`🔧 Добавляем клиента ${clientName} с ${formattedProxies.length} прокси`);
        
        const response = await axios.post(`${RAILWAY_PROXY_URL}/api/add-client`, {
            clientName,
            password,
            proxies: formattedProxies
        });
        
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Ошибка добавления клиента на прокси сервер:', error.response?.data?.error || error.message);
        return { success: false, error: error.response?.data?.error || error.message };
    }
}

async function removeClientFromProxyServer(clientName) {
    try {
        const response = await axios.delete(`${RAILWAY_PROXY_URL}/api/delete-client/${clientName}`);
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Ошибка удаления клиента:', error.response?.data?.error || error.message);
        return { success: false, error: error.response?.data?.error || error.message };
    }
}

async function addProxyToClient(clientName, proxy) {
    try {
        const formattedProxy = formatProxyForRailway(proxy);
        if (!formattedProxy) {
            return { success: false, error: 'Неверный формат прокси' };
        }
        
        const response = await axios.post(`${RAILWAY_PROXY_URL}/api/add-proxy`, {
            clientName,
            proxy: formattedProxy
        });
        
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Ошибка добавления прокси:', error.response?.data?.error || error.message);
        return { success: false, error: error.response?.data?.error || error.message };
    }
}

async function removeProxyFromClient(clientName, proxy) {
    try {
        const response = await axios.delete(`${RAILWAY_PROXY_URL}/api/remove-proxy`, {
            data: {
                clientName,
                proxy
            }
        });
        
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Ошибка удаления прокси:', error.response?.data?.error || error.message);
        return { success: false, error: error.response?.data?.error || error.message };
    }
}

async function rotateClientProxy(clientName) {
    try {
        const response = await axios.post(`${RAILWAY_PROXY_URL}/api/rotate-client`, {
            clientName
        });
        
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Ошибка ротации прокси:', error.response?.data?.error || error.message);
        return { success: false, error: error.response?.data?.error || error.message };
    }
}

async function getClientsFromProxyServer() {
    try {
        const response = await axios.get(`${RAILWAY_PROXY_URL}/api/clients`);
        return { success: true, data: response.data };
    } catch (error) {
        console.error('❌ Ошибка получения клиентов:', error.response?.data?.error || error.message);
        return { success: false, error: error.response?.data?.error || error.message };
    }
}

// Клавиатуры
function getMainKeyboard() {
    return {
        keyboard: [
            ['➕ Добавить клиента', '➖ Удалить клиента'],
            ['📋 Список клиентов', '🔄 Ротация прокси'],
            ['💰 Баланс PROXY6', '🛒 Купить прокси'],
            ['👥 Управление админами']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

function getAdminKeyboard() {
    return {
        keyboard: [
            ['➕ Добавить админа', '➖ Удалить админа'],
            ['📋 Список админов', '🔙 Назад']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    };
}

// Функция для очистки состояния пользователя
function clearUserState(userId) {
    delete userStates[userId];
    saveUserStates();
}

// Обработчики команд
bot.onText(/^\/start$/, async (msg) => {
    const userId = msg.from.id;
    
    if (!isAdmin(userId)) {
        return bot.sendMessage(userId, '❌ У вас нет доступа к этому боту.');
    }
    
    // Очищаем состояние при старте
    clearUserState(userId);
    
    const welcomeMessage = `🤖 Добро пожаловать в Proxy Manager Bot!

🔧 Доступные функции:
• Управление клиентами прокси-сервера
• Автоматическая покупка прокси через PROXY6.net
• Ротация прокси для клиентов
• Мониторинг баланса PROXY6

${isSuperAdmin(userId) ? '👑 Вы супер-админ - доступны все функции' : '👤 Вы админ - доступны основные функции'}

Используйте кнопки ниже для управления:`;

    await bot.sendMessage(userId, welcomeMessage, {
        reply_markup: getMainKeyboard()
    });
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const text = msg.text;
    
    if (!isAdmin(userId)) {
        return;
    }
    
    // Обработка команд управления админами через + и -
    if (text && text.startsWith('+') && isSuperAdmin(userId)) {
        const adminIdStr = text.substring(1).trim();
        const adminId = parseInt(adminIdStr);
        
        if (isNaN(adminId)) {
            return bot.sendMessage(userId, '❌ Неверный формат ID админа. Используйте: +123456789');
        }
        
        if (admins.hasOwnProperty(adminId.toString())) {
            return bot.sendMessage(userId, '❌ Этот пользователь уже является админом.');
        }
        
        admins[adminId.toString()] = {
            id: adminId,
            addedBy: userId,
            addedAt: new Date().toISOString()
        };
        
        await saveAdmins();
        
        return bot.sendMessage(userId, `✅ Админ ${adminId} успешно добавлен!`);
    }
    
    if (text && text.startsWith('-') && isSuperAdmin(userId)) {
        const adminIdStr = text.substring(1).trim();
        const adminId = parseInt(adminIdStr);
        
        if (isNaN(adminId)) {
            return bot.sendMessage(userId, '❌ Неверный формат ID админа. Используйте: -123456789');
        }
        
        if (adminId === SUPER_ADMIN_ID) {
            return bot.sendMessage(userId, '❌ Нельзя удалить супер-админа.');
        }
        
        if (!admins.hasOwnProperty(adminId.toString())) {
            return bot.sendMessage(userId, '❌ Этот пользователь не является админом.');
        }
        
        delete admins[adminId.toString()];
        await saveAdmins();
        
        return bot.sendMessage(userId, `✅ Админ ${adminId} успешно удален!`);
    }
    
    // Проверяем, есть ли состояние у пользователя
    if (userStates[userId]) {
        // Проверяем, не является ли это кнопкой меню
        const menuButtons = [
            '➕ Добавить клиента', '➖ Удалить клиента', '📋 Список клиентов', 
            '🔄 Ротация прокси', '💰 Баланс PROXY6', '🛒 Купить прокси',
            '👥 Управление админами', '➕ Добавить админа', '➖ Удалить админа',
            '📋 Список админов', '🔙 Назад'
        ];
        
        if (menuButtons.includes(text)) {
            // Очищаем состояние и обрабатываем как обычную кнопку
            clearUserState(userId);
        } else {
            // Обрабатываем как ввод в состоянии
            await handleUserState(userId, text);
            return;
        }
    }
    
    // Обработка кнопок главного меню
    switch (text) {
        case '➕ Добавить клиента':
            await handleAddClientStart(userId);
            break;
            
        case '➖ Удалить клиента':
            await handleDeleteClientStart(userId);
            break;
            
        case '📋 Список клиентов':
            await handleListClients(userId);
            break;
            
        case '🔄 Ротация прокси':
            await handleRotateProxyStart(userId);
            break;
            
        case '💰 Баланс PROXY6':
            await handleCheckBalance(userId);
            break;
            
        case '🛒 Купить прокси':
            await handleBuyProxyStart(userId);
            break;
            
        case '👥 Управление админами':
            if (isSuperAdmin(userId)) {
                await handleAdminManagement(userId);
            } else {
                await bot.sendMessage(userId, '❌ Только супер-админ может управлять админами.');
            }
            break;
            
        case '➕ Добавить админа':
            if (isSuperAdmin(userId)) {
                await handleAddAdminStart(userId);
            }
            break;
            
        case '➖ Удалить админа':
            if (isSuperAdmin(userId)) {
                await handleDeleteAdminStart(userId);
            }
            break;
            
        case '📋 Список админов':
            if (isSuperAdmin(userId)) {
                await handleListAdmins(userId);
            }
            break;
            
        case '🔙 Назад':
            clearUserState(userId);
            await bot.sendMessage(userId, '🏠 Главное меню:', {
                reply_markup: getMainKeyboard()
            });
            break;
    }
});

// Обработчики состояний
async function handleUserState(userId, text) {
    const state = userStates[userId];
    
    switch (state.action) {
        case 'add_client_name':
            await handleAddClientName(userId, text);
            break;
            
        case 'add_client_password':
            await handleAddClientPassword(userId, text);
            break;
            
        case 'delete_client':
            await handleDeleteClient(userId, text);
            break;
            
        case 'rotate_proxy':
            await handleRotateProxy(userId, text);
            break;
            
        case 'buy_proxy_client':
            await handleBuyProxyClient(userId, text);
            break;
            
        case 'add_admin':
            await handleAddAdmin(userId, text);
            break;
            
        case 'delete_admin':
            await handleDeleteAdmin(userId, text);
            break;
    }
}

// Функции обработки добавления клиента
async function handleAddClientStart(userId) {
    userStates[userId] = { action: 'add_client_name' };
    await saveUserStates();
    
    await bot.sendMessage(userId, '📝 Введите имя нового клиента:');
}

async function handleAddClientName(userId, clientName) {
    if (!clientName || clientName.length < 2) {
        return bot.sendMessage(userId, '❌ Имя клиента должно содержать минимум 2 символа. Попробуйте еще раз:');
    }
    
    userStates[userId] = { 
        action: 'add_client_password',
        clientName: clientName.trim()
    };
    await saveUserStates();
    
    await bot.sendMessage(userId, `📝 Введите пароль для клиента "${clientName}":`);
}

async function handleAddClientPassword(userId, password) {
    if (!password || password.length < 4) {
        return bot.sendMessage(userId, '❌ Пароль должен содержать минимум 4 символа. Попробуйте еще раз:');
    }
    
    const { clientName } = userStates[userId];
    
    // Автоматически покупаем прокси если настроен PROXY6
    let proxies = [];
    if (PROXY6_API_KEY) {
        await bot.sendMessage(userId, '🛒 Покупаем прокси для нового клиента...');
        
        const buyResult = await buyProxy6Proxies(30, 7, 'ru', 4, 'http');
        if (buyResult.success) {
            proxies = buyResult.proxies;
            await bot.sendMessage(userId, `✅ Куплено ${proxies.length} прокси за ${buyResult.price} RUB`);
        } else {
            await bot.sendMessage(userId, `⚠️ Не удалось купить прокси: ${buyResult.error}`);
        }
    }
    
    // Добавляем клиента на прокси сервер
    const result = await addClientToProxyServer(clientName, password, proxies);
    
    if (result.success) {
        await bot.sendMessage(userId, `✅ Клиент "${clientName}" успешно добавлен с ${proxies.length} прокси!`, {
            reply_markup: getMainKeyboard()
        });
    } else {
        await bot.sendMessage(userId, `❌ Ошибка добавления клиента: ${result.error}`, {
            reply_markup: getMainKeyboard()
        });
    }
    
    clearUserState(userId);
}

// Функции обработки удаления клиента
async function handleDeleteClientStart(userId) {
    const clientsResult = await getClientsFromProxyServer();
    
    if (!clientsResult.success) {
        return bot.sendMessage(userId, `❌ Ошибка получения списка клиентов: ${clientsResult.error}`);
    }
    
    const clients = Object.keys(clientsResult.data.clients);
    
    if (clients.length === 0) {
        return bot.sendMessage(userId, '📭 Нет клиентов для удаления.');
    }
    
    userStates[userId] = { action: 'delete_client' };
    await saveUserStates();
    
    const clientsList = clients.map((name, index) => `${index + 1}. ${name}`).join('\n');
    await bot.sendMessage(userId, `📋 Выберите клиента для удаления (введите имя):\n\n${clientsList}`);
}

async function handleDeleteClient(userId, clientName) {
    const result = await removeClientFromProxyServer(clientName.trim());
    
    if (result.success) {
        await bot.sendMessage(userId, `✅ Клиент "${clientName}" успешно удален!`, {
            reply_markup: getMainKeyboard()
        });
    } else {
        await bot.sendMessage(userId, `❌ Ошибка удаления клиента: ${result.error}`, {
            reply_markup: getMainKeyboard()
        });
    }
    
    clearUserState(userId);
}

// Функции обработки списка клиентов
async function handleListClients(userId) {
    const result = await getClientsFromProxyServer();
    
    if (!result.success) {
        return bot.sendMessage(userId, `❌ Ошибка получения списка клиентов: ${result.error}`);
    }
    
    const clients = result.data.clients;
    const clientNames = Object.keys(clients);
    
    if (clientNames.length === 0) {
        return bot.sendMessage(userId, '📭 Нет активных клиентов.');
    }
    
    let message = `📋 Список клиентов (${clientNames.length}):\n\n`;
    
    clientNames.forEach((name, index) => {
        const client = clients[name];
        message += `${index + 1}. 👤 ${name}\n`;
        message += `   📊 Прокси: ${client.totalProxies}\n`;
        message += `   🔄 Ротаций: ${client.rotationCount}\n`;
        message += `   🌐 Текущий: ${client.currentProxy || 'нет'}\n`;
        message += `   🔗 Туннели: ${client.activeTunnels}\n\n`;
    });
    
    await bot.sendMessage(userId, message);
}

// Функции обработки ротации прокси
async function handleRotateProxyStart(userId) {
    const clientsResult = await getClientsFromProxyServer();
    
    if (!clientsResult.success) {
        return bot.sendMessage(userId, `❌ Ошибка получения списка клиентов: ${clientsResult.error}`);
    }
    
    const clients = Object.keys(clientsResult.data.clients);
    
    if (clients.length === 0) {
        return bot.sendMessage(userId, '📭 Нет клиентов для ротации прокси.');
    }
    
    userStates[userId] = { action: 'rotate_proxy' };
    await saveUserStates();
    
    const clientsList = clients.map((name, index) => `${index + 1}. ${name}`).join('\n');
    await bot.sendMessage(userId, `🔄 Выберите клиента для ротации прокси (введите имя):\n\n${clientsList}`);
}

async function handleRotateProxy(userId, clientName) {
    const result = await rotateClientProxy(clientName.trim());
    
    if (result.success) {
        const data = result.data;
        await bot.sendMessage(userId, 
            `✅ Прокси для "${clientName}" успешно ротирован!\n\n` +
            `🔄 Ротация #${data.rotationCount}\n` +
            `📊 Старый: ${data.oldProxy || 'нет'}\n` +
            `🆕 Новый: ${data.newProxy || 'нет'}\n` +
            `🔗 Закрыто туннелей: ${data.closedTunnels}`,
            { reply_markup: getMainKeyboard() }
        );
    } else {
        await bot.sendMessage(userId, `❌ Ошибка ротации прокси: ${result.error}`, {
            reply_markup: getMainKeyboard()
        });
    }
    
    clearUserState(userId);
}

// Функции обработки баланса PROXY6
async function handleCheckBalance(userId) {
    if (!PROXY6_API_KEY) {
        return bot.sendMessage(userId, '❌ PROXY6 API ключ не настроен.');
    }
    
    await bot.sendMessage(userId, '💰 Проверяем баланс PROXY6...');
    
    const result = await checkProxy6Balance();
    
    if (result.success) {
        await bot.sendMessage(userId, 
            `💰 Баланс PROXY6:\n\n` +
            `💵 ${result.balance} ${result.currency}`
        );
    } else {
        await bot.sendMessage(userId, `❌ Ошибка проверки баланса: ${result.error}`);
    }
}

// Функции обработки покупки прокси
async function handleBuyProxyStart(userId) {
    const clientsResult = await getClientsFromProxyServer();
    
    if (!clientsResult.success) {
        return bot.sendMessage(userId, `❌ Ошибка получения списка клиентов: ${clientsResult.error}`);
    }
    
    const clients = Object.keys(clientsResult.data.clients);
    
    if (clients.length === 0) {
        return bot.sendMessage(userId, '📭 Нет клиентов. Сначала добавьте клиента.');
    }
    
    userStates[userId] = { action: 'buy_proxy_client' };
    await saveUserStates();
    
    const clientsList = clients.map((name, index) => `${index + 1}. ${name}`).join('\n');
    await bot.sendMessage(userId, `🛒 Выберите клиента для покупки прокси (введите имя):\n\n${clientsList}`);
}

async function handleBuyProxyClient(userId, clientName) {
    if (!PROXY6_API_KEY) {
        clearUserState(userId);
        return bot.sendMessage(userId, '❌ PROXY6 API ключ не настроен.', {
            reply_markup: getMainKeyboard()
        });
    }
    
    await bot.sendMessage(userId, '🛒 Покупаем прокси...');
    
    const buyResult = await buyProxy6Proxies(30, 7, 'ru', 4, 'http');
    
    if (!buyResult.success) {
        clearUserState(userId);
        return bot.sendMessage(userId, `❌ Ошибка покупки прокси: ${buyResult.error}`, {
            reply_markup: getMainKeyboard()
        });
    }
    
    // Добавляем прокси к клиенту
    let addedCount = 0;
    for (const proxy of buyResult.proxies) {
        const addResult = await addProxyToClient(clientName.trim(), proxy);
        if (addResult.success) {
            addedCount++;
        }
    }
    
    await bot.sendMessage(userId, 
        `✅ Покупка завершена!\n\n` +
        `🛒 Заказ: ${buyResult.orderId}\n` +
        `💰 Цена: ${buyResult.price} RUB\n` +
        `📦 Куплено: ${buyResult.proxies.length} прокси\n` +
        `➕ Добавлено к "${clientName}": ${addedCount} прокси`,
        { reply_markup: getMainKeyboard() }
    );
    
    clearUserState(userId);
}

// Функции управления админами
async function handleAdminManagement(userId) {
    await bot.sendMessage(userId, '👥 Управление админами:', {
        reply_markup: getAdminKeyboard()
    });
}

async function handleAddAdminStart(userId) {
    userStates[userId] = { action: 'add_admin' };
    await saveUserStates();
    
    await bot.sendMessage(userId, '➕ Введите ID пользователя для добавления в админы:\n\n💡 Или используйте команду: +123456789');
}

async function handleAddAdmin(userId, adminIdText) {
    const adminId = parseInt(adminIdText.trim());
    
    if (isNaN(adminId)) {
        return bot.sendMessage(userId, '❌ Неверный формат ID. Введите числовой ID пользователя:');
    }
    
    if (admins.hasOwnProperty(adminId.toString())) {
        clearUserState(userId);
        return bot.sendMessage(userId, '❌ Этот пользователь уже является админом.', {
            reply_markup: getAdminKeyboard()
        });
    }
    
    admins[adminId.toString()] = {
        id: adminId,
        addedBy: userId,
        addedAt: new Date().toISOString()
    };
    
    await saveAdmins();
    
    clearUserState(userId);
    
    await bot.sendMessage(userId, `✅ Админ ${adminId} успешно добавлен!`, {
        reply_markup: getAdminKeyboard()
    });
}

async function handleDeleteAdminStart(userId) {
    const adminIds = Object.keys(admins);
    
    if (adminIds.length === 0) {
        return bot.sendMessage(userId, '📭 Нет админов для удаления.');
    }
    
    userStates[userId] = { action: 'delete_admin' };
    await saveUserStates();
    
    let message = '➖ Выберите админа для удаления (введите ID):\n\n';
    adminIds.forEach(id => {
        const admin = admins[id];
        message += `👤 ${id} (добавлен ${new Date(admin.addedAt).toLocaleDateString()})\n`;
    });
    
    message += '\n💡 Или используйте команду: -123456789';
    
    await bot.sendMessage(userId, message);
}

async function handleDeleteAdmin(userId, adminIdText) {
    const adminId = parseInt(adminIdText.trim());
    
    if (isNaN(adminId)) {
        return bot.sendMessage(userId, '❌ Неверный формат ID. Введите числовой ID админа:');
    }
    
    if (adminId === SUPER_ADMIN_ID) {
        clearUserState(userId);
        return bot.sendMessage(userId, '❌ Нельзя удалить супер-админа.', {
            reply_markup: getAdminKeyboard()
        });
    }
    
    if (!admins.hasOwnProperty(adminId.toString())) {
        clearUserState(userId);
        return bot.sendMessage(userId, '❌ Этот пользователь не является админом.', {
            reply_markup: getAdminKeyboard()
        });
    }
    
    delete admins[adminId.toString()];
    await saveAdmins();
    
    clearUserState(userId);
    
    await bot.sendMessage(userId, `✅ Админ ${adminId} успешно удален!`, {
        reply_markup: getAdminKeyboard()
    });
}

async function handleListAdmins(userId) {
    const adminIds = Object.keys(admins);
    
    let message = `👥 Список админов:\n\n`;
    message += `👑 ${SUPER_ADMIN_ID} (Супер-админ)\n\n`;
    
    if (adminIds.length === 0) {
        message += '📭 Нет обычных админов.';
    } else {
        adminIds.forEach(id => {
            const admin = admins[id];
            message += `👤 ${id}\n`;
            message += `   📅 Добавлен: ${new Date(admin.addedAt).toLocaleDateString()}\n`;
            message += `   👤 Кем: ${admin.addedBy}\n\n`;
        });
    }
    
    message += `\n💡 Для быстрого управления используйте:\n`;
    message += `➕ +123456789 - добавить админа\n`;
    message += `➖ -123456789 - удалить админа`;
    
    await bot.sendMessage(userId, message);
}

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Запуск бота
async function startBot() {
    try {
        await loadAdmins();
        await loadUserStates();
        
        console.log('🤖 Telegram Bot запущен!');
        console.log(`👑 Супер-админ: ${SUPER_ADMIN_ID}`);
        console.log(`🔧 Railway Proxy URL: ${RAILWAY_PROXY_URL}`);
        console.log(`🔑 PROXY6 API: ${PROXY6_API_KEY ? 'настроен' : 'не настроен'}`);
        console.log(`👥 Админов загружено: ${Object.keys(admins).length}`);
        
        // Отправляем уведомление супер-админу о запуске
        if (SUPER_ADMIN_ID) {
            try {
                await bot.sendMessage(SUPER_ADMIN_ID, 
                    `🤖 Бот успешно запущен!\n\n` +
                    `⚡ Все системы работают\n` +
                    `👥 Админов: ${Object.keys(admins).length}\n` +
                    `🔑 PROXY6: ${PROXY6_API_KEY ? '✅' : '❌'}\n\n` +
                    `💡 Управление админами:\n` +
                    `➕ +123456789 - добавить\n` +
                    `➖ -123456789 - удалить`
                );
            } catch (error) {
                console.log('⚠️ Не удалось отправить уведомление супер-админу');
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка запуска бота:', error);
        process.exit(1);
    }
}

startBot();
