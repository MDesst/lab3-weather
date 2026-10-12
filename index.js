import { readFileSync } from 'node:fs';
import { Command, InvalidArgumentError } from 'commander';

// ---------- допоміжні функції ----------

// Єдине місце, де програма завершується з помилкою:
// повідомлення українською, без стеку викликів, код завершення 1.
function fail(message) {
  console.error(`Помилка: ${message}`);
  process.exit(1);
}

// commander формує повідомлення англійською, тому перекладаємо найтиповіші.
function translateCommanderError(str) {
  const msg = str.split('\n')[0].replace(/^error: /, '').trim();
  let m;
  if ((m = msg.match(/^missing required argument '(.+)'/))) {
    return `не вказано обов'язковий аргумент '${m[1]}'`;
  }
  if ((m = msg.match(/^unknown option '(.+?)'/))) {
    return `невідома опція '${m[1]}'`;
  }
  if ((m = msg.match(/^unknown command '(.+?)'/))) {
    return `невідома команда '${m[1]}'`;
  }
  if ((m = msg.match(/^option '(.+?)' argument missing/))) {
    return `для опції '${m[1]}' не вказано значення`;
  }
  if ((m = msg.match(/^option '(.+?)' argument '(.*?)' is invalid\.\s*(.*)/))) {
    return `некоректне значення '${m[2]}' для опції '${m[1]}': ${m[3]}`;
  }
  if (/^too many arguments/.test(msg)) {
    return 'забагато аргументів';
  }
  return msg;
}

// Перевірка, що значення опції — додатне ціле число.
function parsePositiveInt(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new InvalidArgumentError('очікується додатне ціле число.');
  }
  return Number(value);
}

// Читає й розбирає JSON-файл; шлях бере з глобальної опції --file.
function loadData() {
  const path = program.opts().file;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') fail(`файл '${path}' не знайдено.`);
    fail(`не вдалося прочитати файл '${path}' (${e.code ?? e.message}).`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    fail(`файл '${path}' містить некоректний JSON (${e.message}).`);
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.sensors)) {
    fail(`у файлі '${path}' немає масиву 'sensors'.`);
  }
  return data;
}

// Шукає датчик за sensorId (точний збіг, з урахуванням регістру).
function findSensor(data, id) {
  const sensor = data.sensors.find((s) => s.sensorId === id);
  if (!sensor) {
    const ids = data.sensors.map((s) => s.sensorId).join(', ');
    fail(`датчик '${id}' не знайдено. Доступні: ${ids}.`);
  }
  return sensor;
}

// Показ має значення, якщо value — число (null або відсутнє поле = збій).
function hasValue(reading) {
  return typeof reading.value === 'number';
}

// Іде за шляхом на кшталт "sensors.0.unit". Розрізняє «поля немає» і «значення null».
function resolvePath(obj, path) {
  let current = obj;
  for (const key of path.split('.')) {
    if (current !== null && typeof current === 'object' && Object.hasOwn(current, key)) {
      current = current[key];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

// ---------- опис програми ----------

const program = new Command();

// Налаштування виводу помилок commander: до решти команд передається у спадок,
// тому викликається до їх оголошення.
program.configureOutput({
  outputError: (str, write) => write(`Помилка: ${translateCommanderError(str)}\n`),
});
program.showHelpAfterError('(довідка: node index.js --help)');

program
  .name('weather')
  .description('Консольна програма для перегляду даних метеостанції з JSON-файлу')
  .version('1.0.0', '-V, --version', 'показати версію програми')
  .helpOption('-h, --help', 'показати довідку')
  .helpCommand('help [command]', 'показати довідку по команді')
  .option('-f, --file <path>', 'шлях до JSON-файлу з даними', 'data.json')
  .addHelpText(
    'after',
    `
Приклади:
  node index.js list --limit 1
  node index.js sensor DHT-22-T01
  node index.js get location.latitude
  node index.js --file other.json info BMP280-P02`
  );

// ---------- загальні можливості ----------

program
  .command('list')
  .description('показати стислий список датчиків')
  .option('-l, --limit <n>', 'максимальна кількість датчиків у списку', parsePositiveInt)
  .action((options) => {
    const data = loadData();
    const sensors = options.limit ? data.sensors.slice(0, options.limit) : data.sensors;
    sensors.forEach((s, i) => {
      console.log(`${i + 1}. ${s.sensorId} | ${s.type} | ${s.unit}`);
    });
    console.log(`Показано ${sensors.length} з ${data.sensors.length}.`);
  });

program
  .command('sensor')
  .description('показати один датчик цілком (разом з усіма показами)')
  .argument('<sensorId>', 'ідентифікатор датчика, наприклад DHT-22-T01')
  .action((sensorId) => {
    const sensor = findSensor(loadData(), sensorId);
    console.log(JSON.stringify(sensor, null, 2));
  });

program
  .command('get')
  .description('показати значення поля за шляхом (вкладені поля через крапку)')
  .argument('<path>', 'шлях до поля, наприклад location.latitude або sensors.0.unit')
  .action((path) => {
    const result = resolvePath(loadData(), path);
    if (!result.found) {
      fail(`поле '${path}' не знайдено.`);
    }
    const { value } = result;
    if (value !== null && typeof value === 'object') {
      console.log(JSON.stringify(value, null, 2));
    } else {
      // null виводиться як "null" з кодом 0: поле є, але значення порожнє
      console.log(typeof value === 'string' ? value : JSON.stringify(value));
    }
  });

// ---------- можливості варіанта 6 ----------

program
  .command('info')
  .description('показати характеристики датчика (без серії показів)')
  .argument('<sensorId>', 'ідентифікатор датчика, наприклад DHT-22-T01')
  .action((sensorId) => {
    const s = findSensor(loadData(), sensorId);
    console.log(`Ідентифікатор: ${s.sensorId}`);
    console.log(`Тип: ${s.type}`);
    console.log(`Одиниця виміру: ${s.unit}`);
    console.log(`Калібрований: ${s.isCalibrated ? 'так' : 'ні'}`);
    console.log(`Кількість показів: ${s.readings.length}`);
  });

program
  .command('readings')
  .description('показати серію показів датчика')
  .argument('<sensorId>', 'ідентифікатор датчика, наприклад DHT-22-T01')
  .option('-s, --skip-missing', 'пропускати покази без значення (збої)')
  .action((sensorId, options) => {
    const s = findSensor(loadData(), sensorId);
    const list = options.skipMissing ? s.readings.filter(hasValue) : s.readings;
    for (const r of list) {
      if (hasValue(r)) {
        console.log(`${r.timestamp}  ${r.value} ${s.unit}`);
      } else {
        console.log(`${r.timestamp}  немає значення (збій: ${r.errorCode ?? 'невідомо'})`);
      }
    }
    console.log(`Показано ${list.length} з ${s.readings.length}.`);
  });

program
  .command('stats')
  .description('мінімум, максимум і середнє значення датчика без урахування відсутніх показів')
  .argument('<sensorId>', 'ідентифікатор датчика, наприклад DHT-22-T01')
  .action((sensorId) => {
    const s = findSensor(loadData(), sensorId);
    const values = s.readings.filter(hasValue).map((r) => r.value);
    if (values.length === 0) {
      fail(`у датчика '${sensorId}' немає жодного показу зі значенням.`);
    }
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = Number((sum / values.length).toFixed(2));
    console.log(`Датчик: ${s.sensorId} (${s.type})`);
    console.log(`Використано показів: ${values.length} з ${s.readings.length}`);
    console.log(`Мінімум: ${Math.min(...values)} ${s.unit}`);
    console.log(`Максимум: ${Math.max(...values)} ${s.unit}`);
    console.log(`Середнє: ${avg} ${s.unit}`);
  });

program.parse();