// Тесты без зависимостей: node tests/run.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// Загружает js-файлы приложения в изолированный «браузер» с заглушкой localStorage.
function loadApp(files) {
  const store = new Map();
  const ctx = {
    console,
    alert: (m) => { throw new Error('alert: ' + m); },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v))
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

const { U, Stats } = loadApp(['js/util.js', 'js/stats.js']);

// Детерминированный генератор для тестов подбора.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- проверка ответа ----------

test('Ввод: точное совпадение — верно', () => {
  assert.strictEqual(U.checkLv('šokolāde', ['šokolāde']), 'ok');
});

test('Ввод: регистр, пробелы и знаки препинания не важны', () => {
  assert.strictEqual(U.checkLv('  rīga ', ['Rīga']), 'ok');
  assert.strictEqual(U.checkLv('Paldies!', ['paldies']), 'ok');
  assert.strictEqual(U.checkLv('uz   redzēšanos', ['uz redzēšanos']), 'ok');
});

test('Ввод: без диакритики — почти', () => {
  assert.strictEqual(U.checkLv('sokolade', ['šokolāde']), 'almost');
  assert.strictEqual(U.checkLv('kirsis', ['ķirsis']), 'almost');
  assert.strictEqual(U.checkLv('ja', ['jā']), 'almost');
});

test('Ввод: лишняя диакритика тоже «почти»', () => {
  assert.strictEqual(U.checkLv('sarkāns', ['sarkans']), 'almost');
});

test('Ввод: другое слово или опечатка — неверно', () => {
  assert.strictEqual(U.checkLv('kirss', ['ķirsis']), 'bad');
  assert.strictEqual(U.checkLv('paldis', ['paldies']), 'bad');
});

test('Ввод: пустой ответ — неверно', () => {
  assert.strictEqual(U.checkLv('', ['jā']), 'bad');
  assert.strictEqual(U.checkLv('   ', ['jā']), 'bad');
});

test('Ввод: lv_alt засчитываются', () => {
  assert.strictEqual(U.checkLv('nesaprotu', ['es nesaprotu', 'nesaprotu']), 'ok');
  assert.strictEqual(U.checkLv('nesaprotu', ['es nesaprotu']), 'bad');
});

test('Ввод: комбинируемый макрон (NFD) равен готовой букве', () => {
  assert.strictEqual(U.checkLv('jā', ['jā']), 'ok');
});

test('Чтение: мягкое сравнение', () => {
  assert.strictEqual(U.checkReading('палдиес', 'ПАЛдиэс'), 'ok');
  assert.strictEqual(U.checkReading('кирсис', 'КЬИрсис'), 'ok');
  assert.strictEqual(U.checkReading('шоколаде', 'ШОколааде'), 'ok');
  assert.strictEqual(U.checkReading('ес несапроту', 'эс НЕсапроту'), 'ok');
  assert.strictEqual(U.checkReading('шокаладе', 'ШОколааде'), 'almost');
  assert.strictEqual(U.checkReading('привет', 'СВЕЙки'), 'bad');
  assert.strictEqual(U.checkReading('', 'ЙАА'), 'bad');
});

// ---------- подбор слов ----------

const pool = Array.from({ length: 20 }, (_, i) => ({ id: 'w' + i }));

test('Подбор: нужный размер и без повторов', () => {
  const s = Stats.pickSession(pool, 10, { rand: mulberry32(1) });
  assert.strictEqual(s.length, 10);
  assert.strictEqual(new Set(s.map((w) => w.id)).size, 10);
});

test('Подбор: если слов меньше, чем размер сессии — берём все', () => {
  const s = Stats.pickSession(pool.slice(0, 4), 15, { rand: mulberry32(2) });
  assert.strictEqual(s.length, 4);
});

test('Вес: нижние ящики тяжелее, ошибки увеличивают вес', () => {
  assert.strictEqual(Stats.wordWeight(1, 0), 16);
  assert.strictEqual(Stats.wordWeight(5, 0), 1);
  assert.ok(Stats.wordWeight(3, 1) > Stats.wordWeight(3, 0));
  assert.ok(Stats.wordWeight(3, 2) > Stats.wordWeight(3, 1));
});

test('Штрафы: только последние 80 ответов, почти = 0.5', () => {
  const log = [];
  for (let i = 0; i < 10; i++) log.push({ id: 'old', result: 'bad', ts: i });
  for (let i = 0; i < 78; i++) log.push({ id: 'x', result: 'ok', ts: 100 + i });
  log.push({ id: 'a', result: 'bad', ts: 500 });
  log.push({ id: 'a', result: 'almost', ts: 501 });
  const p = Stats.recentPenalties(log);
  assert.strictEqual(p.get('old'), undefined, 'ошибки старше 80 ответов не учитываются');
  assert.strictEqual(p.get('a'), 1.5);
  assert.strictEqual(p.get('x'), undefined);
});

function frequency(opts, runs) {
  const rand = mulberry32(42);
  const hits = new Map();
  for (let r = 0; r < runs; r++) {
    Stats.pickSession(pool, 5, Object.assign({ rand }, opts)).forEach((w) => {
      hits.set(w.id, (hits.get(w.id) || 0) + 1);
    });
  }
  return (id) => hits.get(id) || 0;
}

test('Подбор: слова из ящика 1 попадаются чаще, чем из ящика 5', () => {
  const box = (id) => (Number(id.slice(1)) < 10 ? 1 : 5);
  const f = frequency({ getBox: box }, 2000);
  const low = pool.filter((w) => box(w.id) === 1).reduce((s, w) => s + f(w.id), 0);
  const high = pool.filter((w) => box(w.id) === 5).reduce((s, w) => s + f(w.id), 0);
  assert.ok(low > high * 5, `ящик 1: ${low}, ящик 5: ${high}`);
});

test('Подбор: недавние ошибки поднимают слово при одинаковом ящике', () => {
  const penalties = new Map([['w3', 2]]);
  const f = frequency({ getBox: () => 2, penalties }, 3000);
  const others = pool.filter((w) => w.id !== 'w3').map((w) => f(w.id));
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  assert.ok(f('w3') > avg * 2, `w3: ${f('w3')}, в среднем: ${avg.toFixed(0)}`);
});

// ---------- периоды и отчёт ----------

const NOW = new Date(2026, 9, 7, 20, 0).getTime(); // 07.10.2026 20:00 локального времени
const at = (daysAgo, hour) => new Date(2026, 9, 7 - daysAgo, hour == null ? 12 : hour, 0).getTime();

test('Период «сегодня» начинается с полуночи, предыдущий — вчера', () => {
  const r = Stats.periodRange('today', NOW, null);
  assert.strictEqual(r.start, new Date(2026, 9, 7).getTime());
  assert.strictEqual(r.prev.start, new Date(2026, 9, 6).getTime());
  assert.strictEqual(r.prev.end, r.start);
});

test('Период 7 дней: 7 календарных дней, включая сегодня', () => {
  const r = Stats.periodRange('week', NOW, null);
  assert.strictEqual(r.start, new Date(2026, 9, 1).getTime());
  assert.strictEqual(r.prev.start, new Date(2026, 8, 24).getTime());
});

test('Отметка «начать с нуля» обрезает период и прошлый период', () => {
  const from = at(2, 9);
  const r = Stats.periodRange('week', NOW, from);
  assert.strictEqual(r.start, from);
  assert.strictEqual(r.prev, null);
  const all = Stats.periodRange('all', NOW, from);
  assert.strictEqual(all.start, from);
});

const words = new Map([
  ['b1-sok', { id: 'b1-sok', lv: 'šokolāde', ru: 'шоколад', block: 1, lesson: 1 }],
  ['b1-iela', { id: 'b1-iela', lv: 'iela', ru: 'улица', block: 1, lesson: 1 }],
  ['b2l1-ja', { id: 'b2l1-ja', lv: 'jā', ru: 'да', block: 2, lesson: 1 }],
  ['b2l2-maja', { id: 'b2l2-maja', lv: 'māja', ru: 'дом', block: 2, lesson: 2 }]
]);

function e(id, mode, given, result, ts, sec) {
  return { id, mode, given, result, ts, sec: sec == null ? 3 : sec };
}

const LOG = [
  // прошлая неделя: 4 ответа, 1 верный
  e('b1-sok', 'input', 'sokolade', 'almost', at(9)),
  e('b1-iela', 'input', 'iela', 'ok', at(9)),
  e('b2l1-ja', 'input', 'ne', 'bad', at(8)),
  e('b2l2-maja', 'cards', null, 'bad', at(8)),
  // эта неделя
  e('b1-sok', 'input', 'sokolade', 'almost', at(3)),
  e('b1-sok', 'input', 'sokolade', 'almost', at(2)),
  e('b1-sok', 'input', 'šokolade', 'almost', at(1)),
  e('b1-sok', 'input', 'šokolāde', 'ok', at(0, 9)),
  e('b1-iela', 'input', 'iela', 'ok', at(1)),
  e('b1-iela', 'reading', 'иэла', 'ok', at(0, 10)),
  e('b2l1-ja', 'input', '', 'bad', at(0, 11)),
  e('b2l1-ja', 'input', 'jaa', 'bad', at(0, 12)),
  e('b2l2-maja', 'cards', null, 'ok', at(0, 13)),
  e('b2l2-maja', 'cards', null, 'ok', at(0, 14)),
  e('b2l2-maja', 'input', 'maja', 'almost', at(0, 15)),
  e('ghost', 'input', 'x', 'bad', at(0, 16)) // слово удалено из данных
];

test('Сводка: счётчики, дни, точность', () => {
  const s = Stats.summarize(Stats.inRange(LOG, Stats.periodRange('week', NOW)), words);
  assert.strictEqual(s.total, 12);
  assert.strictEqual(s.ok, 5);
  assert.strictEqual(s.almost, 4);
  assert.strictEqual(s.bad, 3);
  assert.strictEqual(s.days, 4);
  assert.strictEqual(s.avgSec, 3);
});

test('Сводка: типы ошибок «Ввода» — диакритика отдельно', () => {
  const s = Stats.summarize(Stats.inRange(LOG, Stats.periodRange('week', NOW)), words);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.inputErrors)), { diacritic: 4, other: 2, skipped: 1 });
});

test('Сводка: уроки от слабых к сильным, блоки по порядку', () => {
  const s = Stats.summarize(Stats.inRange(LOG, Stats.periodRange('week', NOW)), words);
  const accs = [...s.lessons].map((l) => Stats.accuracy(l));
  assert.deepStrictEqual(accs, accs.slice().sort((a, b) => a - b));
  // при равной точности первым — урок, где ответов больше
  assert.strictEqual(s.lessons[0].label, 'Блок 2 · урок 1');
  assert.strictEqual(s.lessons[1].label, 'Без блока');
  assert.deepStrictEqual([...s.blocks].map((b) => b.label), ['Блок 1', 'Блок 2', 'Без блока']);
});

test('Сводка: трудные слова и типичный неверный ввод', () => {
  const s = Stats.summarize(Stats.inRange(LOG, Stats.periodRange('week', NOW)), words);
  assert.strictEqual(s.hard[0].id, 'b1-sok');
  assert.strictEqual(s.hard[0].errors, 3);
  assert.strictEqual(s.hard[0].typical.value, 'sokolade');
  assert.strictEqual(s.hard[0].typical.n, 2);
  assert.ok(!s.hard.some((h) => h.id === 'b1-iela'), 'слова без ошибок не попадают в трудные');
});

test('Отчёт: содержит всё нужное за неделю', () => {
  const r = Stats.buildReport(LOG, words, 'week', NOW, null);
  const has = (s) => assert.ok(r.includes(s), `нет строки «${s}» в отчёте:\n${r}`);
  has('Период: последние 7 дней (01.10.2026–07.10.2026)');
  has('Ответов: 12, дней с занятиями: 4');
  has('Точность: 42% (верно 5, почти 4, неверно 3)');
  has('Точность по урокам (от слабых к сильным):');
  has('- Без блока: 0% (1 отв.)');
  has('1. šokolāde (шоколад) — ошибок 3 из 4; обычно ввожу: «sokolade» (2×)');
  has('ghost (удалено)');
  has('- только диакритика (ā→a, š→s…): 4 из 7');
  has('Сравнение с периодом «предыдущие 7 дней»:');
  has('- ответов: 12 (было 4)');
  has('- точность: 42% (было 25%, +17 п.п.)');
  // уроки идут от слабых к сильным
  const lessonLines = r.split('\n').filter((l) => /^- (Блок|Без блока).*%/.test(l));
  const nums = lessonLines.map((l) => Number(/(\d+)%/.exec(l)[1]));
  assert.deepStrictEqual(nums, nums.slice().sort((a, b) => a - b));
  // не больше 10 трудных слов
  assert.ok(r.split('\n').filter((l) => /^\d+\. /.test(l)).length <= 10);
});

test('Отчёт: без прошлых данных пишет, что сравнивать не с чем', () => {
  const r = Stats.buildReport(LOG.slice(4), words, 'week', NOW, null);
  assert.ok(r.includes('данных за прошлый период нет'), r);
});

test('Отчёт «всё время» без сравнения; «начать с нуля» отрезает старое', () => {
  const all = Stats.buildReport(LOG, words, 'all', NOW, null);
  assert.ok(all.includes('Ответов: 16'));
  assert.ok(!all.includes('Сравнение'));
  const fresh = Stats.buildReport(LOG, words, 'all', NOW, at(0, 0));
  assert.ok(fresh.includes('Ответов: 8, дней с занятиями: 1'), fresh);
  assert.ok(fresh.includes('Статистика считается с 07.10.2026'));
});

test('Отчёт: пустой период', () => {
  const r = Stats.buildReport([], words, 'today', NOW, null);
  assert.ok(r.includes('Ответов: 0'));
  assert.ok(r.includes('За этот период ответов нет.'));
});

// ---------- журнал в Store ----------

test('Журнал: каждый ответ — отдельная запись, попадает в экспорт', () => {
  const app = loadApp(['js/util.js', 'js/stats.js', 'js/store.js']);
  const S = app.Store;
  S.record('b1-sok', 'almost', { mode: 'input', given: 'sokolade', sec: 4.26 });
  S.record('b1-sok', 'ok', { mode: 'cards', given: null, sec: 2 });
  assert.strictEqual(S.state.log.length, 2);
  const first = S.state.log[0];
  assert.strictEqual(first.id, 'b1-sok');
  assert.strictEqual(first.mode, 'input');
  assert.strictEqual(first.given, 'sokolade');
  assert.strictEqual(first.result, 'almost');
  assert.strictEqual(first.sec, 4.3);
  assert.strictEqual(typeof first.ts, 'number');
  assert.strictEqual(S.exportAll().log.length, 2);
  assert.strictEqual(JSON.parse(app.localStorage.getItem('lv.log')).length, 2);
});

test('Журнал: «начать с нуля» и сброс ящиков не удаляют записи', () => {
  const app = loadApp(['js/util.js', 'js/stats.js', 'js/store.js']);
  const S = app.Store;
  S.record('a', 'bad', { mode: 'input', given: 'x' });
  S.startStatsFromNow();
  S.resetProgress();
  assert.strictEqual(S.state.log.length, 1);
  assert.ok(S.state.statsFrom > 0);
});

test('Журнал: восстановление копии сливает записи без дублей', () => {
  const app = loadApp(['js/util.js', 'js/stats.js', 'js/store.js']);
  const S = app.Store;
  S.record('a', 'ok', { mode: 'input', given: 'a' });
  const backup = JSON.parse(JSON.stringify(S.exportAll()));
  backup.log.push({ id: 'b', mode: 'input', given: 'b', result: 'bad', ts: 1 });
  S.restoreProgress(backup);
  assert.strictEqual(S.state.log.length, 2);
  assert.strictEqual(S.state.log[0].id, 'b', 'журнал отсортирован по времени');
});

// ---------- запуск ----------

let failed = 0;
tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${String(err.message).split('\n').join('\n    ')}`);
  }
});
console.log(`\n${tests.length - failed} из ${tests.length} тестов прошли`);
process.exit(failed ? 1 : 0);
