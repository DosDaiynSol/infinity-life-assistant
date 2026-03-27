require('dotenv').config({ path: '../.env' });
const crosspostService = require('./services/crosspost-service');

async function testVK() {
    console.log('Testing VK cross-posting...');
    const result = await crosspostService.postToVK('Тестовое сообщение от бота (Infinity Life). Проверка работоспособности.');
    console.log('VK Result:', result);
    process.exit(0);
}

testVK();
