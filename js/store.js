// Данные и прогресс: файлы из data/, импорт, система Лейтнера, статистика.
(function () {
  'use strict';

  const KEYS = {
    words: 'lv.importedWords',
    texts: 'lv.importedTexts',
    progress: 'lv.progress',
    days: 'lv.days',
    textResults: 'lv.textResults',
    settings: 'lv.settings',
    log: 'lv.log',
    statsFrom: 'lv.statsFrom'
  };

  const MAX_BOX = Stats.MAX_BOX;
  const SESSION_SIZES = [10, 15];

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      alert('Не получилось сохранить в localStorage: ' + e.message);
    }
  }

  const state = {
    baseWords: [],
    baseTexts: [],
    baseError: null,
    importedWords: load(KEYS.words, []),
    importedTexts: load(KEYS.texts, []),
    progress: load(KEYS.progress, {}),
    days: load(KEYS.days, []),
    textResults: load(KEYS.textResults, {}),
    log: load(KEYS.log, []),
    statsFrom: load(KEYS.statsFrom, null),
    settings: Object.assign({ filter: 'all', size: 10, period: 'week' }, load(KEYS.settings, {}))
  };

  // ---------- нормализация записей ----------

  function asList(v) {
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    return v ? [String(v)] : [];
  }

  function asNum(v) {
    const n = Number(v);
    return v === '' || v == null || Number.isNaN(n) ? null : n;
  }

  function normalizeWord(w) {
    if (!w || typeof w !== 'object') throw new Error('не объект');
    if (!w.id) throw new Error('нет id');
    if (!w.lv) throw new Error(`${w.id}: нет lv`);
    if (!w.ru) throw new Error(`${w.id}: нет ru`);
    return {
      id: String(w.id),
      lv: String(w.lv),
      ru: String(w.ru),
      read: w.read ? String(w.read) : '',
      block: asNum(w.block),
      lesson: asNum(w.lesson),
      lv_alt: asList(w.lv_alt),
      ru_alt: asList(w.ru_alt),
      note: w.note ? String(w.note) : ''
    };
  }

  function normalizeText(t) {
    if (!t || typeof t !== 'object') throw new Error('не объект');
    if (!t.id) throw new Error('нет id');
    if (!t.lv) throw new Error(`${t.id}: нет lv`);
    const questions = (Array.isArray(t.questions) ? t.questions : []).map((q, i) => {
      if (!q || !q.q || !Array.isArray(q.options) || q.options.length < 2) {
        throw new Error(`${t.id}: вопрос ${i + 1} без текста или вариантов`);
      }
      const answer = Number(q.answer);
      if (!(answer >= 0 && answer < q.options.length)) {
        throw new Error(`${t.id}: вопрос ${i + 1} — answer вне диапазона`);
      }
      return { q: String(q.q), options: q.options.map(String), answer };
    });
    return {
      id: String(t.id),
      block: asNum(t.block),
      title: t.title ? String(t.title) : String(t.id),
      lv: String(t.lv),
      ru: t.ru ? String(t.ru) : '',
      glossary: (Array.isArray(t.glossary) ? t.glossary : [])
        .filter((g) => g && g.lv && g.ru)
        .map((g) => ({ lv: String(g.lv), ru: String(g.ru) })),
      questions
    };
  }

  function isTextLike(item) {
    return item && typeof item === 'object' &&
      ('title' in item || 'glossary' in item || 'questions' in item);
  }

  // ---------- загрузка ----------

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  function setBase(words, texts) {
    state.baseWords = [];
    state.baseTexts = [];
    (words || []).forEach((w) => {
      try { state.baseWords.push(normalizeWord(w)); } catch (e) { console.warn('words.json:', e.message); }
    });
    (texts || []).forEach((t) => {
      try { state.baseTexts.push(normalizeText(t)); } catch (e) { console.warn('texts.json:', e.message); }
    });
  }

  async function loadBase() {
    try {
      const [words, texts] = await Promise.all([
        fetchJson('data/words.json'),
        fetchJson('data/texts.json')
      ]);
      setBase(words, texts);
      state.baseError = null;
    } catch (e) {
      state.baseError = e.message || String(e);
    }
  }

  // Ручная подгрузка файлов, когда fetch не работает (страница открыта как file://).
  function loadBaseFromFiles(parsedFiles) {
    let words = [];
    let texts = [];
    parsedFiles.forEach((arr) => {
      if (!Array.isArray(arr)) return;
      if (arr.some(isTextLike)) texts = texts.concat(arr);
      else words = words.concat(arr);
    });
    setBase(words.length ? words : state.baseWords, texts.length ? texts : state.baseTexts);
    state.baseError = null;
  }

  function mergeById(base, imported) {
    const map = new Map();
    base.forEach((x) => map.set(x.id, x));
    imported.forEach((x) => map.set(x.id, x));
    return Array.from(map.values());
  }

  function words() { return mergeById(state.baseWords, state.importedWords); }
  function texts() { return mergeById(state.baseTexts, state.importedTexts); }

  // ---------- фильтр блок/урок ----------

  // Значения фильтра: 'all' | 'b2' | 'b2l1'
  function filterOptions() {
    const blocks = new Map();
    words().forEach((w) => {
      if (w.block == null) return;
      if (!blocks.has(w.block)) blocks.set(w.block, new Set());
      if (w.lesson != null) blocks.get(w.block).add(w.lesson);
    });
    texts().forEach((t) => {
      if (t.block != null && !blocks.has(t.block)) blocks.set(t.block, new Set());
    });
    const opts = [{ value: 'all', label: 'Всё пройденное' }];
    Array.from(blocks.keys()).sort((a, b) => a - b).forEach((b) => {
      opts.push({ value: `b${b}`, label: `Блок ${b}` });
      Array.from(blocks.get(b)).sort((x, y) => x - y).forEach((l) => {
        opts.push({ value: `b${b}l${l}`, label: `Блок ${b} · урок ${l}`, sub: true });
      });
    });
    return opts;
  }

  function parseFilter(f) {
    const m = /^b(-?[\d.]+)(?:l(-?[\d.]+))?$/.exec(f || '');
    if (!m) return { block: null, lesson: null };
    return { block: Number(m[1]), lesson: m[2] != null ? Number(m[2]) : null };
  }

  function filteredWords() {
    const { block, lesson } = parseFilter(state.settings.filter);
    return words().filter((w) =>
      (block == null || w.block === block) && (lesson == null || w.lesson === lesson));
  }

  function filteredTexts() {
    const { block } = parseFilter(state.settings.filter);
    return texts().filter((t) => block == null || t.block === block);
  }

  function setSettings(patch) {
    Object.assign(state.settings, patch);
    save(KEYS.settings, state.settings);
  }

  // ---------- Лейтнер ----------

  function getProgress(id) {
    return state.progress[id] || { box: 1, seen: 0, ok: 0, almost: 0, bad: 0, last: null };
  }

  // Верно — ящик выше, ошибка — в ящик 1, «почти» — остаётся где был.
  // Каждый ответ ещё и отдельной записью в журнал (он никогда не чистится).
  function record(id, result, meta) {
    const m = meta || {};
    state.log.push({
      id,
      mode: m.mode || null,
      given: m.given == null ? null : String(m.given),
      result,
      ts: Date.now(),
      sec: typeof m.sec === 'number' ? Math.round(m.sec * 10) / 10 : null
    });
    save(KEYS.log, state.log);

    const p = Object.assign({}, getProgress(id));
    p.seen++;
    if (result === 'ok') { p.ok++; p.box = Math.min(MAX_BOX, p.box + 1); }
    else if (result === 'almost') { p.almost = (p.almost || 0) + 1; }
    else { p.bad++; p.box = 1; }
    p.last = Date.now();
    state.progress[id] = p;
    save(KEYS.progress, state.progress);
    markActiveDay();
    return p;
  }

  // Ящики Лейтнера + ошибки за последние 80 ответов (см. Stats.wordWeight).
  function pickSession(pool, size) {
    return Stats.pickSession(pool, size, {
      getBox: (id) => getProgress(id).box,
      penalties: Stats.recentPenalties(state.log)
    });
  }

  function wordsById() {
    return new Map(words().map((w) => [w.id, w]));
  }

  function summary(period) {
    const range = Stats.periodRange(period, Date.now(), state.statsFrom);
    return Stats.summarize(Stats.inRange(state.log, range), wordsById());
  }

  function report(period) {
    return Stats.buildReport(state.log, wordsById(), period, Date.now(), state.statsFrom);
  }

  // «Начать с нуля»: только отметка даты, журнал остаётся.
  function startStatsFromNow() {
    state.statsFrom = Date.now();
    save(KEYS.statsFrom, state.statsFrom);
  }

  // ---------- дни подряд ----------

  function markActiveDay() {
    const today = U.dayKey();
    if (!state.days.includes(today)) {
      state.days.push(today);
      save(KEYS.days, state.days);
    }
  }

  function streak() {
    const set = new Set(state.days);
    const d = new Date();
    // Если сегодня ещё не занимался, серия со вчера ещё не сгорела.
    if (!set.has(U.dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (set.has(U.dayKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function bestStreak() {
    const sorted = Array.from(new Set(state.days)).sort();
    let best = 0;
    let cur = 0;
    let prev = null;
    sorted.forEach((k) => {
      const d = new Date(k + 'T00:00:00');
      if (prev) {
        const p = new Date(prev);
        p.setDate(p.getDate() + 1);
        cur = U.dayKey(p) === k ? cur + 1 : 1;
      } else {
        cur = 1;
      }
      best = Math.max(best, cur);
      prev = d;
    });
    return best;
  }

  function saveTextResult(id, score, total) {
    const prev = state.textResults[id];
    state.textResults[id] = {
      last: score,
      best: Math.max(score, prev ? prev.best : 0),
      total
    };
    save(KEYS.textResults, state.textResults);
    markActiveDay();
  }

  // ---------- импорт / экспорт ----------

  function sameAsBase(item, baseList) {
    const b = baseList.find((x) => x.id === item.id);
    return b && JSON.stringify(b) === JSON.stringify(item);
  }

  // Добавляет или обновляет записи по id. Записи, совпадающие с data/*.json,
  // не сохраняем, чтобы будущие правки файлов не перекрывались старыми копиями.
  function importItems(items) {
    const report = { added: 0, updated: 0, errors: [] };
    const allWordIds = new Set(words().map((w) => w.id));
    const allTextIds = new Set(texts().map((t) => t.id));

    items.forEach((raw, i) => {
      try {
        const asText = isTextLike(raw);
        const item = asText ? normalizeText(raw) : normalizeWord(raw);
        const ids = asText ? allTextIds : allWordIds;
        const listKey = asText ? 'importedTexts' : 'importedWords';
        const base = asText ? state.baseTexts : state.baseWords;

        if (ids.has(item.id)) report.updated++; else report.added++;
        ids.add(item.id);

        const rest = state[listKey].filter((x) => x.id !== item.id);
        state[listKey] = sameAsBase(item, base) ? rest : rest.concat(item);
      } catch (e) {
        report.errors.push(`#${i + 1}: ${e.message}`);
      }
    });

    save(KEYS.words, state.importedWords);
    save(KEYS.texts, state.importedTexts);
    return report;
  }

  function exportAll() {
    return {
      app: 'latvian-trainer',
      version: 1,
      exportedAt: new Date().toISOString(),
      words: words(),
      texts: texts(),
      progress: state.progress,
      days: state.days,
      textResults: state.textResults,
      log: state.log,
      statsFrom: state.statsFrom
    };
  }

  function restoreProgress(backup) {
    if (backup.progress && typeof backup.progress === 'object') {
      state.progress = backup.progress;
      save(KEYS.progress, state.progress);
    }
    if (Array.isArray(backup.days)) {
      state.days = Array.from(new Set(state.days.concat(backup.days)));
      save(KEYS.days, state.days);
    }
    if (Array.isArray(backup.log)) {
      const seen = new Set(state.log.map((e) => `${e.ts}|${e.id}|${e.mode}`));
      backup.log.forEach((e) => {
        if (!e || !e.id || typeof e.ts !== 'number') return;
        const k = `${e.ts}|${e.id}|${e.mode}`;
        if (!seen.has(k)) { seen.add(k); state.log.push(e); }
      });
      state.log.sort((a, b) => a.ts - b.ts);
      save(KEYS.log, state.log);
    }
    if (backup.statsFrom && !state.statsFrom) {
      state.statsFrom = backup.statsFrom;
      save(KEYS.statsFrom, state.statsFrom);
    }
    if (backup.textResults && typeof backup.textResults === 'object') {
      state.textResults = backup.textResults;
      save(KEYS.textResults, state.textResults);
    }
  }

  function clearImported() {
    state.importedWords = [];
    state.importedTexts = [];
    save(KEYS.words, []);
    save(KEYS.texts, []);
  }

  // Сбрасывает ящики и результаты текстов. Журнал ответов не трогает.
  function resetProgress() {
    state.progress = {};
    state.days = [];
    state.textResults = {};
    save(KEYS.progress, {});
    save(KEYS.days, []);
    save(KEYS.textResults, {});
  }

  window.Store = {
    state, MAX_BOX, SESSION_SIZES,
    loadBase, loadBaseFromFiles, words, texts,
    filterOptions, filteredWords, filteredTexts, setSettings,
    getProgress, record, pickSession, summary, report, startStatsFromNow,
    streak, bestStreak, saveTextResult, markActiveDay,
    importItems, exportAll, restoreProgress, clearImported, resetProgress
  };
})();
