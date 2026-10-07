// Общие функции: нормализация, сравнение ответов, разбор JSON, даты.
(function () {
  'use strict';

  const DIACRITICS = {
    'ā': 'a', 'č': 'c', 'ē': 'e', 'ģ': 'g', 'ī': 'i', 'ķ': 'k',
    'ļ': 'l', 'ņ': 'n', 'š': 's', 'ū': 'u', 'ž': 'z', 'ō': 'o', 'ŗ': 'r'
  };

  // Латышский ответ: регистр, лишние пробелы и знаки препинания не важны.
  function cleanLv(s) {
    return String(s || '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[.,!?;:"'«»„“”()…–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripDiacritics(s) {
    return s.replace(/[āčēģīķļņšūžōŗ]/g, (c) => DIACRITICS[c]);
  }

  // 'ok' — точно, 'almost' — верно без учёта диакритики, 'bad' — неверно.
  function checkLv(answer, variants) {
    const a = cleanLv(answer);
    if (!a) return 'bad';
    const cleaned = variants.map(cleanLv).filter(Boolean);
    if (cleaned.includes(a)) return 'ok';
    const plain = stripDiacritics(a);
    if (cleaned.some((v) => stripDiacritics(v) === plain)) return 'almost';
    return 'bad';
  }

  // Чтение русскими буквами сравниваем мягко: э=е, й=и, без ь/ъ,
  // удвоенные буквы схлопываются, всё кроме кириллицы выкидывается.
  function normReading(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/э/g, 'е')
      .replace(/й/g, 'и')
      .replace(/[ъь]/g, '')
      .replace(/[^а-я]/g, '')
      .replace(/(.)\1+/g, '$1');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function checkReading(answer, reference) {
    const a = normReading(answer);
    const r = normReading(reference);
    if (!a) return 'bad';
    if (a === r) return 'ok';
    const allowed = Math.max(1, Math.floor(r.length / 6));
    return levenshtein(a, r) <= allowed ? 'almost' : 'bad';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // JSON, но прощает // и /* */ комментарии и висячие запятые —
  // удобно вставлять примеры прямо из заметок.
  function parseLooseJson(src) {
    try {
      return JSON.parse(src);
    } catch (e) { /* пробуем мягкий разбор */ }
    let out = '';
    let inStr = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      const next = src[i + 1];
      if (inStr) {
        out += c;
        if (c === '\\') { out += next || ''; i++; } else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === '/' && next === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        out += '\n';
        continue;
      }
      if (c === '/' && next === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i++;
        continue;
      }
      out += c;
    }
    out = out.replace(/,(\s*[\]}])/g, '$1');
    return JSON.parse(out);
  }

  function dayKey(date) {
    const d = date || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  window.U = {
    cleanLv, stripDiacritics, checkLv, normReading, checkReading,
    escapeHtml, parseLooseJson, dayKey, shuffle
  };
})();
