// Чистая логика без DOM и localStorage: адаптивный подбор слов,
// периоды, сводка по журналу ответов и текст отчёта. Покрыто tests/run.js.
//
// Запись журнала: { id, mode, given, result, ts, sec }
//   mode   — 'input' | 'reading' | 'cards'
//   given  — что ввёл (null для карточек)
//   result — 'ok' | 'almost' | 'bad'
//   ts     — время ответа, мс;  sec — сколько думал, секунд
(function () {
  'use strict';

  const U = window.U;

  const MAX_BOX = 5;
  const RECENT_WINDOW = 80;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const MODE_NAMES = { input: 'Ввод', reading: 'Чтение', cards: 'Карточки', forms: 'Формы' };
  const PERIODS = {
    today: { label: 'сегодня', days: 1, prev: 'вчера' },
    week: { label: 'последние 7 дней', days: 7, prev: 'предыдущие 7 дней' },
    month: { label: 'последние 30 дней', days: 30, prev: 'предыдущие 30 дней' },
    all: { label: 'всё время', days: null, prev: null }
  };

  // ---------- адаптивный подбор ----------

  // Штрафы за последние RECENT_WINDOW ответов: ошибка — 1, «почти» — 0.5.
  function recentPenalties(log, windowSize) {
    const n = windowSize == null ? RECENT_WINDOW : windowSize;
    const map = new Map();
    log.slice(-n).forEach((e) => {
      const add = e.result === 'bad' ? 1 : e.result === 'almost' ? 0.5 : 0;
      if (add) map.set(e.id, (map.get(e.id) || 0) + add);
    });
    return map;
  }

  // Ящик 1 — 16, ящик 5 — 1. Недавние ошибки умножают вес на (1 + 2·штраф):
  // одна ошибка — ×3, две — ×5.
  function wordWeight(box, penalty) {
    return Math.pow(2, MAX_BOX - box) * (1 + 2 * (penalty || 0));
  }

  // Взвешенная выборка без повторов (Efraimidis–Spirakis).
  function pickSession(pool, size, opts) {
    const o = opts || {};
    const getBox = o.getBox || (() => 1);
    const penalties = o.penalties || new Map();
    const rand = o.rand || Math.random;
    return pool
      .map((w) => {
        const weight = wordWeight(getBox(w.id), penalties.get(w.id));
        return { w, key: Math.pow(rand(), 1 / weight) };
      })
      .sort((a, b) => b.key - a.key)
      .slice(0, size)
      .map((x) => x.w);
  }

  // ---------- периоды ----------

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  // Границы периода [start, end) и предыдущего такого же. `from` — отметка
  // «начать с нуля»: всё, что раньше неё, в статистику не попадает.
  function periodRange(period, now, from) {
    const p = PERIODS[period] || PERIODS.all;
    const floor = from || 0;
    const end = now + 1;
    if (!p.days) return { start: floor, end, prev: null };

    const start = addDays(startOfDay(now), -(p.days - 1));
    const prevStart = addDays(start, -p.days).getTime();
    const prevEnd = start.getTime();
    return {
      start: Math.max(start.getTime(), floor),
      end,
      prev: prevEnd > floor ? { start: Math.max(prevStart, floor), end: prevEnd } : null
    };
  }

  function inRange(log, range) {
    return log.filter((e) => e.ts >= range.start && e.ts < range.end);
  }

  // ---------- сводка ----------

  function counter() {
    return { total: 0, ok: 0, almost: 0, bad: 0 };
  }

  function count(c, result) {
    c.total++;
    c[result] = (c[result] || 0) + 1;
  }

  function accuracy(c) {
    return c.total ? c.ok / c.total : 0;
  }

  function lessonKey(w) {
    const block = w && w.block != null ? w.block : null;
    const lesson = block != null && w.lesson != null ? w.lesson : null;
    if (block == null) return { key: '?', label: 'Без блока', block, lesson };
    if (lesson == null) return { key: `b${block}`, label: `Блок ${block}`, block, lesson };
    return { key: `b${block}l${lesson}`, label: `Блок ${block} · урок ${lesson}`, block, lesson };
  }

  function byNumber(a, b) {
    const x = a == null ? Infinity : a;
    const y = b == null ? Infinity : b;
    return x - y;
  }

  function mostFrequent(values) {
    const m = new Map();
    values.forEach((v) => m.set(v, (m.get(v) || 0) + 1));
    let best = null;
    m.forEach((n, v) => { if (!best || n > best.n) best = { value: v, n }; });
    return best;
  }

  function summarize(entries, wordsById) {
    const all = counter();
    const byMode = {};
    const byLesson = new Map();
    const byBlock = new Map();
    const byWord = new Map();
    const byDrill = new Map();
    const forms = Object.assign(counter(), { diacritic: 0 });
    const days = new Set();
    const inputErrors = { diacritic: 0, other: 0, skipped: 0 };
    let secSum = 0;
    let secN = 0;

    entries.forEach((e) => {
      count(all, e.result);
      days.add(U.dayKey(new Date(e.ts)));
      if (typeof e.sec === 'number') { secSum += e.sec; secN++; }

      if (!byMode[e.mode]) byMode[e.mode] = counter();
      count(byMode[e.mode], e.result);

      const w = wordsById.get(e.id);
      const lk = lessonKey(w);
      if (!byLesson.has(lk.key)) {
        byLesson.set(lk.key, Object.assign(counter(), { label: lk.label, block: lk.block, lesson: lk.lesson }));
      }
      count(byLesson.get(lk.key), e.result);
      if (!byBlock.has(lk.block)) {
        byBlock.set(lk.block, Object.assign(counter(), {
          label: lk.block == null ? 'Без блока' : `Блок ${lk.block}`, block: lk.block
        }));
      }
      count(byBlock.get(lk.block), e.result);

      // Задания «Форм» считаются отдельно, чтобы не смешивать их с трудными словами.
      const isForm = e.mode === 'forms';
      const target = isForm ? byDrill : byWord;
      if (isForm) {
        count(forms, e.result);
        if (e.result === 'almost') forms.diacritic++;
      }
      if (!target.has(e.id)) target.set(e.id, Object.assign(counter(), { id: e.id, word: w, wrong: [] }));
      const bw = target.get(e.id);
      count(bw, e.result);
      if (e.result !== 'ok' && e.given && e.given.trim()) bw.wrong.push(e.given.trim());

      // «почти» в режиме «Ввод» — это ровно ошибка только в диакритике.
      if (e.mode === 'input' && e.result !== 'ok') {
        if (e.result === 'almost') inputErrors.diacritic++;
        else if (!e.given || !e.given.trim()) inputErrors.skipped++;
        else inputErrors.other++;
      }
    });

    const lessons = Array.from(byLesson.values())
      .sort((a, b) => accuracy(a) - accuracy(b) || b.total - a.total);

    const hardest = (map, n) => Array.from(map.values())
      .map((x) => Object.assign(x, { errors: x.almost + x.bad, typical: mostFrequent(x.wrong) }))
      .filter((x) => x.errors > 0)
      .sort((a, b) => b.errors - a.errors || (b.errors / b.total) - (a.errors / a.total))
      .slice(0, n);
    const hard = hardest(byWord, 10);
    forms.accuracy = accuracy(forms);
    forms.hard = hardest(byDrill, 5);

    return {
      ...all,
      accuracy: accuracy(all),
      days: days.size,
      avgSec: secN ? secSum / secN : null,
      byMode,
      lessons,
      blocks: Array.from(byBlock.values()).sort((a, b) => byNumber(a.block, b.block)),
      hard,
      forms,
      inputErrors
    };
  }

  // ---------- текстовый отчёт ----------

  function pct(x) {
    return `${Math.round(x * 100)}%`;
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }

  function wordLabel(h) {
    return h.word ? `${h.word.lv} (${h.word.ru})` : `${h.id} (удалено)`;
  }

  function buildReport(log, wordsById, period, now, from) {
    const p = PERIODS[period] || PERIODS.all;
    const range = periodRange(period, now, from);
    const cur = summarize(inRange(log, range), wordsById);
    const lines = [];

    const firstTs = log.length ? Math.max(range.start, log[0].ts) : range.start;
    const fromLabel = fmtDate(range.start);
    const span = p.days
      ? (fromLabel === fmtDate(now) ? fromLabel : `${fromLabel}–${fmtDate(now)}`)
      : (log.length ? `с ${fmtDate(firstTs)}` : '');
    lines.push('Латышский тренажёр — отчёт');
    lines.push(`Период: ${p.label}${span ? ` (${span})` : ''}`);
    if (from) lines.push(`Статистика считается с ${fmtDate(from)}`);
    lines.push(`Ответов: ${cur.total}, дней с занятиями: ${cur.days}`);

    if (!cur.total) {
      lines.push('', 'За этот период ответов нет.');
      return lines.join('\n');
    }

    lines.push(`Точность: ${pct(cur.accuracy)} (верно ${cur.ok}, почти ${cur.almost}, неверно ${cur.bad})`);
    if (cur.avgSec != null) lines.push(`В среднем на ответ: ${cur.avgSec.toFixed(1)} с`);
    const modes = Object.keys(MODE_NAMES).filter((m) => cur.byMode[m])
      .map((m) => `${MODE_NAMES[m]} ${pct(accuracy(cur.byMode[m]))} (${cur.byMode[m].total})`);
    if (modes.length) lines.push(`По режимам: ${modes.join(' · ')}`);

    lines.push('', 'Точность по урокам (от слабых к сильным):');
    cur.lessons.forEach((l) => {
      lines.push(`- ${l.label}: ${pct(accuracy(l))} (${l.total} отв.)`);
    });

    lines.push('', 'Трудные слова (топ-10):');
    cur.hard.forEach((h, i) => {
      let line = `${i + 1}. ${wordLabel(h)} — ошибок ${h.errors} из ${h.total}`;
      if (h.typical) line += `; обычно ввожу: «${h.typical.value}»${h.typical.n > 1 ? ` (${h.typical.n}×)` : ''}`;
      lines.push(line);
    });
    if (!cur.hard.length) lines.push('нет ошибок');

    const ie = cur.inputErrors;
    const inputErrTotal = ie.diacritic + ie.other + ie.skipped;
    lines.push('', 'Ошибки в режиме «Ввод»:');
    if (inputErrTotal) {
      lines.push(`- только диакритика (ā→a, š→s…): ${ie.diacritic} из ${inputErrTotal}`);
      lines.push(`- другие ошибки: ${ie.other}`);
      lines.push(`- «не знаю»: ${ie.skipped}`);
    } else {
      lines.push('- нет');
    }

    const f = cur.forms;
    if (f.total) {
      lines.push('', `Формы: ${pct(f.accuracy)} (${f.total} отв.; верно ${f.ok}, почти ${f.almost}, неверно ${f.bad}), только диакритика: ${f.diacritic}`);
      if (f.hard.length) {
        lines.push('Трудные задания:');
        f.hard.forEach((h, i) => {
          let line = `${i + 1}. ${h.word ? `${h.word.ru} → ${h.word.lv}` : `${h.id} (удалено)`} — ошибок ${h.errors} из ${h.total}`;
          if (h.typical) line += `; обычно ввожу: «${h.typical.value}»${h.typical.n > 1 ? ` (${h.typical.n}×)` : ''}`;
          lines.push(line);
        });
      }
    }

    if (p.prev) {
      const prevEntries = range.prev ? inRange(log, range.prev) : [];
      lines.push('', `Сравнение с периодом «${p.prev}»:`);
      if (!prevEntries.length) {
        lines.push('- данных за прошлый период нет');
      } else {
        const prev = summarize(prevEntries, wordsById);
        const diff = Math.round((cur.accuracy - prev.accuracy) * 100);
        lines.push(`- ответов: ${cur.total} (было ${prev.total})`);
        lines.push(`- точность: ${pct(cur.accuracy)} (было ${pct(prev.accuracy)}, ${diff >= 0 ? '+' : ''}${diff} п.п.)`);
        lines.push(`- дней с занятиями: ${cur.days} (было ${prev.days})`);
        lines.push(`- ошибок из-за диакритики: ${ie.diacritic} (было ${prev.inputErrors.diacritic})`);
        if (f.total || prev.forms.total) {
          lines.push(`- Формы: ${f.total ? pct(f.accuracy) : '—'} (было ${prev.forms.total ? pct(prev.forms.accuracy) : '—'})`);
        }
      }
    }

    return lines.join('\n');
  }

  window.Stats = {
    MAX_BOX, RECENT_WINDOW, DAY_MS, PERIODS, MODE_NAMES,
    recentPenalties, wordWeight, pickSession,
    periodRange, inRange, summarize, accuracy, buildReport
  };
})();
