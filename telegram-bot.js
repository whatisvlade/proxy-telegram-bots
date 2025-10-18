// Enhanced Proxy Server with Telegram Bot API (FIXED)
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs').promises;
const path = require('path');
const net = require('net');

const app = express();
app.use(express.json({ limit: '10mb' })); // Увеличиваем лимит для больших списков прокси

// ====== КОНФИГУРАЦИЯ ======
const PORT = process.env.PORT || 8080;
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'localhost:8080';
const CONFIG_FILE = path.join(__dirname, 'clients-config.json');

// API авторизация для Telegram бота
const API_USERNAME = process.env.API_USERNAME || 'telegram_bot';
const API_PASSWORD = process.env.API_PASSWORD || 'bot_secret_2024';
const API_AUTH = Buffer.from(`${API_USERNAME}:${API_PASSWORD}`).toString('base64');

// ====== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ======
let clientsConfig = {};
let proxyAgents = {};
let currentProxyIndex = {};
let blockedProxies = new Set();

// ====== ФУНКЦИИ УПРАВЛЕНИЯ КОНФИГУРАЦИЕЙ ======
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    clientsConfig = JSON.parse(data);
    console.log('📁 Configuration loaded from file');
    
    // Инициализируем индексы для существующих клиентов
    for (const clientName of Object.keys(clientsConfig)) {
      if (!currentProxyIndex[clientName]) {
        currentProxyIndex[clientName] = 0;
      }
    }
    
    return true;
  } catch (error) {
    console.log('📝 Using empty configuration, creating config file...');
    clientsConfig = {};
    await saveConfig();
    return false;
  }
}

async function saveConfig() {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(clientsConfig, null, 2));
    console.log('💾 Configuration saved to file');
    return true;
  } catch (error) {
    console.error('❌ Error saving configuration:', error.message);
    return false;
  }
}

// ====== ФУНКЦИИ РАБОТЫ С ПРОКСИ ======
function parseProxyUrl(proxyString) {
  try {
    // Если уже URL формат
    if (proxyString.startsWith('http://')) {
      return proxyString;
    }
    
    // Парсим формат host:port:user:pass
    const parts = proxyString.split(':');
    if (parts.length === 4) {
      const [host, port, user, pass] = parts;
      return `http://${user}:${pass}@${host}:${port}`;
    }
    
    console.error('❌ Invalid proxy format:', proxyString);
    return null;
  } catch (error) {
    console.error('❌ Error parsing proxy:', proxyString, error.message);
    return null;
  }
}

function initializeClient(clientName, password, proxies = []) {
  console.log(`🔍 Initializing client: ${clientName}`);
  console.log(`   Password: ${password}`);
  console.log(`   Raw proxies count: ${proxies.length}`);
  
  if (proxies.length > 0) {
    console.log(`   First proxy: ${proxies[0]}`);
    console.log(`   Last proxy: ${proxies[proxies.length - 1]}`);
  }
  
  // Парсим и валидируем прокси
  const validProxies = [];
  const invalidProxies = [];
  
  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    const parsedProxy = parseProxyUrl(proxy);
    
    if (parsedProxy) {
      validProxies.push(parsedProxy);
      console.log(`✅ Proxy ${i + 1}: ${proxy} -> ${parsedProxy}`);
    } else {
      invalidProxies.push(proxy);
      console.log(`❌ Invalid proxy ${i + 1}: ${proxy}`);
    }
  }
  
  console.log(`📊 Parsing result: ${validProxies.length} valid, ${invalidProxies.length} invalid`);
  
  // Сохраняем конфигурацию клиента
  clientsConfig[clientName] = {
    password: password,
    proxies: validProxies
  };
  
  // Инициализируем индекс прокси
  currentProxyIndex[clientName] = 0;
  
  console.log(`✅ Initialized client: ${clientName} with ${validProxies.length} proxies`);
  
  return {
    success: true,
    validProxies: validProxies.length,
    invalidProxies: invalidProxies.length,
    invalidList: invalidProxies
  };
}

// ====== MIDDLEWARE АВТОРИЗАЦИИ ======
function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Proxy Server"');
    return res.status(401).json({ error: 'Authorization required' });
  }
  
  const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
  const [username, password] = credentials.split(':');
  
  // Проверяем клиентов
  if (clientsConfig[username] && clientsConfig[username].password === password) {
    req.clientName = username;
    return next();
  }
  
  res.setHeader('WWW-Authenticate', 'Basic realm="Proxy Server"');
  return res.status(401).json({ error: 'Invalid credentials' });
}

// API авторизация для Telegram бота
function apiAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'API Authorization required' });
  }
  
  const credentials = authHeader.slice(6);
  if (credentials !== API_AUTH) {
    return res.status(401).json({ error: 'Invalid API credentials' });
  }
  
  next();
}

// ====== API ENDPOINTS ======

// Получить список всех клиентов
app.get('/api/clients', apiAuth, (req, res) => {
  console.log('[API] GET /api/clients');
  
  const clientsInfo = {};
  for (const [clientName, config] of Object.entries(clientsConfig)) {
    clientsInfo[clientName] = {
      password: config.password,
      proxies: config.proxies.length,
      currentIndex: currentProxyIndex[clientName] || 0
    };
  }
  
  res.json({
    success: true,
    clients: clientsInfo,
    totalClients: Object.keys(clientsConfig).length,
    totalProxies: Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0)
  });
});

// ✅ ИСПРАВЛЕНО: Добавить клиента с правильным парсингом данных
app.post('/api/add-client', apiAuth, async (req, res) => {
  console.log('[API] POST /api/add-client');
  console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
  console.log('📥 Request headers:', req.headers);
  
  try {
    const { clientName, password, proxies = [] } = req.body;
    
    console.log(`🔍 Parsed data:`);
    console.log(`   clientName: "${clientName}"`);
    console.log(`   password: "${password}"`);
    console.log(`   proxies: ${Array.isArray(proxies) ? proxies.length : 'not array'} items`);
    
    if (!clientName || !password) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ 
        success: false, 
        error: 'clientName and password are required' 
      });
    }
    
    if (clientsConfig[clientName]) {
      console.log(`❌ Client ${clientName} already exists`);
      return res.status(409).json({ 
        success: false, 
        error: `Client ${clientName} already exists` 
      });
    }
    
    // Инициализируем клиента
    const result = initializeClient(clientName, password, proxies);
    
    // Сохраняем конфигурацию
    await saveConfig();
    
    console.log(`✅ Added new client: ${clientName} with ${result.validProxies} proxies`);
    
    const response = {
      success: true,
      message: `Client ${clientName} added successfully`,
      clientName,
      validProxies: result.validProxies,
      invalidProxies: result.invalidProxies,
      totalClients: Object.keys(clientsConfig).length
    };
    
    if (result.invalidProxies > 0) {
      response.invalidList = result.invalidList;
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Error adding client:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Удалить клиента
app.delete('/api/delete-client/:name', apiAuth, async (req, res) => {
  const clientName = req.params.name;
  console.log(`[API] DELETE /api/delete-client/${clientName}`);
  
  if (!clientsConfig[clientName]) {
    return res.status(404).json({ 
      success: false, 
      error: `Client ${clientName} not found` 
    });
  }
  
  const proxiesCount = clientsConfig[clientName].proxies.length;
  
  // Удаляем клиента
  delete clientsConfig[clientName];
  delete currentProxyIndex[clientName];
  delete proxyAgents[clientName];
  
  await saveConfig();
  
  console.log(`🗑 Deleted client: ${clientName}, closed ${proxiesCount} tunnels`);
  
  res.json({
    success: true,
    message: `Client ${clientName} deleted successfully`,
    deletedProxies: proxiesCount,
    totalClients: Object.keys(clientsConfig).length
  });
});

// Alias для удаления клиента
app.delete('/api/remove-client/:name', apiAuth, async (req, res) => {
  req.url = req.url.replace('/remove-client/', '/delete-client/');
  app._router.handle(req, res);
});

// Добавить прокси к клиенту
app.post('/api/add-proxy', apiAuth, async (req, res) => {
  console.log('[API] POST /api/add-proxy');
  console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { clientName, proxy } = req.body;
    
    if (!clientName || !proxy) {
      return res.status(400).json({ 
        success: false, 
        error: 'clientName and proxy are required' 
      });
    }
    
    if (!clientsConfig[clientName]) {
      return res.status(404).json({ 
        success: false, 
        error: `Client ${clientName} not found` 
      });
    }
    
    const parsedProxy = parseProxyUrl(proxy);
    if (!parsedProxy) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid proxy format' 
      });
    }
    
    // Проверяем дубликаты
    if (clientsConfig[clientName].proxies.includes(parsedProxy)) {
      return res.status(409).json({ 
        success: false, 
        error: 'Proxy already exists for this client' 
      });
    }
    
    clientsConfig[clientName].proxies.push(parsedProxy);
    await saveConfig();
    
    console.log(`➕ Added proxy to ${clientName}: ${proxy} -> ${parsedProxy}`);
    
    res.json({
      success: true,
      message: `Proxy added to client ${clientName}`,
      clientName,
      totalProxies: clientsConfig[clientName].proxies.length
    });
    
  } catch (error) {
    console.error('❌ Error adding proxy:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Удалить прокси у клиента
app.delete('/api/remove-proxy', apiAuth, async (req, res) => {
  console.log('[API] DELETE /api/remove-proxy');
  console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { clientName, proxy } = req.body;
    
    if (!clientName || !proxy) {
      return res.status(400).json({ 
        success: false, 
        error: 'clientName and proxy are required' 
      });
    }
    
    if (!clientsConfig[clientName]) {
      return res.status(404).json({ 
        success: false, 
        error: `Client ${clientName} not found` 
      });
    }
    
    const parsedProxy = parseProxyUrl(proxy);
    const proxyIndex = clientsConfig[clientName].proxies.findIndex(p => 
      p === parsedProxy || p === proxy
    );
    
    if (proxyIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        error: 'Proxy not found for this client' 
      });
    }
    
    const removedProxy = clientsConfig[clientName].proxies.splice(proxyIndex, 1)[0];
    
    // Корректируем индекс если нужно
    if (currentProxyIndex[clientName] >= clientsConfig[clientName].proxies.length) {
      currentProxyIndex[clientName] = 0;
    }
    
    await saveConfig();
    
    console.log(`➖ Removed proxy from ${clientName}: ${removedProxy}`);
    
    res.json({
      success: true,
      message: `Proxy removed from client ${clientName}`,
      clientName,
      removedProxy,
      totalProxies: clientsConfig[clientName].proxies.length
    });
    
  } catch (error) {
    console.error('❌ Error removing proxy:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Ротация прокси для клиента
app.post('/api/rotate-client', apiAuth, (req, res) => {
  console.log('[API] POST /api/rotate-client');
  console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { clientName } = req.body;
    
    if (!clientName) {
      return res.status(400).json({ 
        success: false, 
        error: 'clientName is required' 
      });
    }
    
    if (!clientsConfig[clientName]) {
      return res.status(404).json({ 
        success: false, 
        error: `Client ${clientName} not found` 
      });
    }
    
    const proxies = clientsConfig[clientName].proxies;
    if (proxies.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Client ${clientName} has no proxies` 
      });
    }
    
    // Ротация
    currentProxyIndex[clientName] = (currentProxyIndex[clientName] + 1) % proxies.length;
    const newProxy = proxies[currentProxyIndex[clientName]];
    
    console.log(`🔄 Rotated proxy for ${clientName}: index ${currentProxyIndex[clientName]}`);
    
    res.json({
      success: true,
      message: `Proxy rotated for client ${clientName}`,
      clientName,
      currentIndex: currentProxyIndex[clientName],
      currentProxy: newProxy,
      totalProxies: proxies.length
    });
    
  } catch (error) {
    console.error('❌ Error rotating proxy:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ====== ОСНОВНЫЕ ENDPOINTS ======

// Главная страница с информацией
app.get('/', (req, res) => {
  const totalClients = Object.keys(clientsConfig).length;
  const totalProxies = Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0);
  
  // Подсчет пересекающихся прокси
  const allProxies = [];
  Object.values(clientsConfig).forEach(config => {
    allProxies.push(...config.proxies);
  });
  const uniqueProxies = new Set(allProxies);
  const overlappingProxies = allProxies.length - uniqueProxies.size;
  
  let authInfo = '';
  if (totalClients > 0) {
    const firstClient = Object.keys(clientsConfig)[0];
    const firstConfig = clientsConfig[firstClient];
    authInfo = `Auth: Basic (${firstClient}/${firstConfig.password}\n`;
    
    // Показываем первые несколько прокси
    const proxiesToShow = firstConfig.proxies.slice(0, 20);
    proxiesToShow.forEach(proxy => {
      // Конвертируем обратно в host:port:user:pass формат для отображения
      try {
        const url = new URL(proxy);
        const [user, pass] = url.username && url.password ? [url.username, url.password] : ['', ''];
        authInfo += `${url.hostname}:${url.port}:${user}:${pass}\n`;
      } catch (e) {
        authInfo += `${proxy}\n`;
      }
    });
    
    if (firstConfig.proxies.length > 20) {
      authInfo += `... и еще ${firstConfig.proxies.length - 20} прокси\n`;
    }
    authInfo += ')';
  }
  
  const knownHostnames = PUBLIC_HOST.includes(',') ? PUBLIC_HOST : `${PUBLIC_HOST}, railway-proxy-server-production-58a1.up.railway.app`;
  
  res.send(`🚀 Railway Proxy Rotator - Enhanced with Telegram Bot
Public host: ${PUBLIC_HOST}
Known hostnames: ${knownHostnames}

${authInfo}

⚡ Enhanced Features:
- Telegram Bot Management API
- Dynamic client/proxy management
- File-based configuration persistence
- Hot reload without restart
- Concurrent rotation mode
    
Original API:
GET /status - server status
GET /current (requires Basic) - current proxy
GET /myip (requires Basic) - get IP via proxy
POST /rotate (requires Basic) - rotate proxy

Telegram Bot API:
GET /api/clients - list all clients
POST /api/add-client - add new client
DELETE /api/delete-client/:name - delete client
DELETE /api/remove-client/:name - remove client (alias)
POST /api/add-proxy - add proxy to client
DELETE /api/remove-proxy - remove proxy from client
POST /api/rotate-client - rotate proxy for client

Total clients: ${totalClients}

Overlapping proxies: ${overlappingProxies}

Blocked proxies: ${blockedProxies.size}
`);
  
  console.log(`[SELF-API] GET ${req.url} Host:${req.get('host')}`);
});

// Статус сервера
app.get('/status', (req, res) => {
  const totalClients = Object.keys(clientsConfig).length;
  const totalProxies = Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0);
  
  res.json({
    status: 'running',
    clients: totalClients,
    proxies: totalProxies,
    blocked: blockedProxies.size,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '2.0.0-enhanced'
  });
  
  console.log(`[SELF-API] GET ${req.url} Host:${req.get('host')}`);
});

// Текущий прокси клиента
app.get('/current', basicAuth, (req, res) => {
  const clientName = req.clientName;
  const config = clientsConfig[clientName];
  
  if (!config || config.proxies.length === 0) {
    return res.status(404).json({ error: 'No proxies available' });
  }
  
  const currentIndex = currentProxyIndex[clientName] || 0;
  const currentProxy = config.proxies[currentIndex];
  
  res.json({
    client: clientName,
    currentProxy,
    index: currentIndex,
    totalProxies: config.proxies.length
  });
});

// Получить IP через прокси
app.get('/myip', basicAuth, async (req, res) => {
  const clientName = req.clientName;
  const config = clientsConfig[clientName];
  
  if (!config || config.proxies.length === 0) {
    return res.status(404).json({ error: 'No proxies available' });
  }
  
  const currentIndex = currentProxyIndex[clientName] || 0;
  const currentProxy = config.proxies[currentIndex];
  
  try {
    const fetch = (await import('node-fetch')).default;
    const { HttpsProxyAgent } = require('https-proxy-agent');
    
    const agent = new HttpsProxyAgent(currentProxy);
    
    const response = await fetch('https://api.ipify.org?format=json', {
      agent,
      timeout: 10000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    res.json({
      ip: data.ip,
      client: clientName,
      proxy: currentProxy,
      index: currentIndex
    });
    
  } catch (error) {
    console.error(`❌ Error getting IP for ${clientName}:`, error.message);
    
    // Помечаем прокси как проблемный
    blockedProxies.add(currentProxy);
    
    res.status(500).json({
      error: 'Failed to get IP',
      client: clientName,
      proxy: currentProxy,
      details: error.message
    });
  }
});

// Ротация прокси
app.post('/rotate', basicAuth, (req, res) => {
  const clientName = req.clientName;
  const config = clientsConfig[clientName];
  
  if (!config || config.proxies.length === 0) {
    return res.status(404).json({ error: 'No proxies available' });
  }
  
  // Ротация
  currentProxyIndex[clientName] = (currentProxyIndex[clientName] + 1) % config.proxies.length;
  const newProxy = config.proxies[currentProxyIndex[clientName]];
  
  console.log(`🔄 [${clientName}] Rotated to proxy ${currentProxyIndex[clientName]}: ${newProxy}`);
  
  res.json({
    success: true,
    client: clientName,
    newProxy,
    index: currentProxyIndex[clientName],
    totalProxies: config.proxies.length
  });
});

// ====== ЗАПУСК СЕРВЕРА ======
async function startServer() {
  // Загружаем конфигурацию
  await loadConfig();
  
  const totalClients = Object.keys(clientsConfig).length;
  const totalProxies = Object.values(clientsConfig).reduce((sum, config) => sum + config.proxies.length, 0);
  
  // Подсчет пересекающихся прокси
  const allProxies = [];
  Object.values(clientsConfig).forEach(config => {
    allProxies.push(...config.proxies);
  });
  const uniqueProxies = new Set(allProxies);
  const overlappingProxies = allProxies.length - uniqueProxies.size;
  
  app.listen(PORT, () => {
    console.log('⚡ Concurrent mode: NO rotation locks');
    console.log(`🔍 Overlapping proxies: ${overlappingProxies}`);
    console.log(`💾 Configuration file: ${CONFIG_FILE}`);
    console.log(overlappingProxies === 0 ? '✅ Fully isolated proxy pools - safe for concurrent rotation' : '⚠️ Some proxies are shared between clients');
    console.log(`🚀 Enhanced Proxy server running on port ${PORT}`);
    console.log(`🌐 Public (TCP Proxy): ${PUBLIC_HOST}`);
    
    // Определяем доступные хостнейм
    const hostnames = PUBLIC_HOST.includes(',') ? PUBLIC_HOST : `${PUBLIC_HOST}, railway-proxy-server-production-58a1.up.railway.app`;
    console.log(`✅ API self hostnames: ${hostnames}`);
    
    console.log('🤖 Telegram Bot API enabled');
    
    if (totalClients === 0) {
      console.log('📝 No clients configured - use Telegram bot to add clients');
    } else {
      console.log(`👥 Loaded ${totalClients} clients with ${totalProxies} total proxies`);
      
      // Показываем информацию о клиентах
      for (const [clientName, config] of Object.entries(clientsConfig)) {
        console.log(`   • ${clientName}: ${config.proxies.length} proxies`);
      }
    }
  });
}

// Обработка ошибок
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

startServer().catch(console.error);
