// Интерфейс: экраны, режимы тренировки, тексты, статистика, импорт.
(function () {
  'use strict';

  const esc = U.escapeHtml;
  const $app = document.getElementById('app');
  const $back = document.getElementById('back');
  const $title = document.getElementById('title');
  const $streak = document.getElementById('streak');
  const $popup = document.getElementById('popup');

  const SPECIAL = ['ā', 'č', 'ē', 'ģ', 'ī', 'ķ', 'ļ', 'ņ', 'š', 'ū', 'ž'];

  const MODES = {
    input: { title: 'Ввод', sub: 'русский → пишу по-латышски' },
    reading: { title: 'Чтение', sub: 'латышский → как читается' },
    cards: { title: 'Карточки', sub: 'знал / не знал' },
    forms: { title: 'Формы', sub: 'грамматика: вписываю форму' }
  };

  const VERDICT = {
    ok: 'Верно!',
    almost: 'Почти!',
    bad: 'Неверно'
  };

  let session = null;

  // ---------- общие кусочки ----------

  function setHeader(title, showBack) {
    $title.textContent = title;
    $back.hidden = !showBack;
    const s = Store.streak();
    $streak.textContent = s ? `🔥 ${s}` : '';
    $streak.title = s ? `Дней подряд: ${s}` : '';
  }

  function speechBar(word) {
    return `
      <div class="speech">
        <button type="button" class="btn small tts-btn" data-say="${esc(word.lv)}">🔊 Послушать</button>
        <button type="button" class="btn small stt-btn" data-check="${esc(word.id)}">🎤 Проверить произношение</button>
      </div>
      <div class="stt-result" hidden></div>`;
  }

  function wordDetails(word, opts) {
    const o = opts || {};
    const parts = [];
    if (o.lv) parts.push(`<div class="detail-lv" lang="lv">${esc([word.lv].concat(word.lv_alt).join(' / '))}</div>`);
    if (o.ru) parts.push(`<div class="detail-ru">${esc(word.ru)}</div>`);
    if (o.ru && word.ru_alt.length) parts.push(`<div class="muted">также: ${esc(word.ru_alt.join(', '))}</div>`);
    if (o.read && word.read) parts.push(`<div class="detail-read">[${esc(word.read)}]</div>`);
    if (word.note) parts.push(`<div class="note">💡 ${esc(word.note)}</div>`);
    return parts.join('');
  }

  // Задание из грамматики в виде «слова», чтобы сессия, итог и голос работали одинаково.
  function drillItem(d) {
    return {
      id: d.id, lv: d.a, lv_alt: d.alt, ru: d.q, ru_alt: [], read: '', note: '',
      block: d.block, lesson: d.lesson, gid: d.gid, title: d.title, kind: 'drill'
    };
  }

  function findWord(id) {
    const w = Store.words().find((x) => x.id === id);
    if (w) return w;
    const d = Store.drills().find((x) => x.id === id);
    return d ? drillItem(d) : null;
  }

  function blockLessonLabel(block, lesson) {
    if (block == null) return 'Без блока';
    return lesson == null ? `Блок ${block}` : `Блок ${block} · урок ${lesson}`;
  }

  // Группирует по «блок · урок» в порядке номеров (без блока — в конце).
  function groupByLesson(items) {
    const num = (x) => (x == null ? Infinity : x);
    const sorted = items.slice().sort((a, b) =>
      num(a.block) - num(b.block) || num(a.lesson) - num(b.lesson));
    const groups = [];
    sorted.forEach((x) => {
      const label = blockLessonLabel(x.block, x.lesson);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(x);
      else groups.push({ label, items: [x] });
    });
    return groups;
  }

  function emptyState(text) {
    return `
      <div class="empty">
        <p>${text}</p>
        <a class="btn" href="#/">На главную</a>
      </div>`;
  }

  // ---------- главная ----------

  function renderHome() {
    setHeader('Латышский тренажёр', false);
    const st = Store.state;
    const opts = Store.filterOptions();
    if (!opts.some((o) => o.value === st.settings.filter)) Store.setSettings({ filter: 'all' });
    const pool = Store.filteredWords();
    const textsCount = Store.filteredTexts().length;
    const drillsCount = Store.filteredDrills().length;
    const size = st.settings.size;
    const custom = !Store.SESSION_SIZES.includes(size);

    const banner = st.baseError ? `
      <div class="banner">
        <p><b>Не удалось загрузить файлы из папки data.</b></p>
        <p>Если index.html открыт двойным кликом, браузер не даёт читать файлы с диска.
        Выбери их вручную (на эту сессию) или запусти локальный сервер / открой версию на GitHub Pages.</p>
        <label class="btn small file-btn">Выбрать файлы из папки data
          <input type="file" id="base-files" accept=".json,application/json" multiple hidden>
        </label>
        <p class="muted small-text">${esc(st.baseError)}</p>
      </div>` : '';

    $app.innerHTML = `
      ${banner}
      <div class="field">
        <label for="filter">Что повторяем</label>
        <select id="filter">
          ${opts.map((o) => `<option value="${o.value}" ${o.value === st.settings.filter ? 'selected' : ''}>${o.sub ? ' ' : ''}${esc(o.label)}</option>`).join('')}
        </select>
        <div class="muted">${pool.length} слов · ${drillsCount} заданий на формы · ${textsCount} текстов</div>
      </div>

      <div class="field">
        <span class="label">Карточек за сессию</span>
        <div class="size-row">
          <div class="seg" role="group">
            ${Store.SESSION_SIZES.map((n) => `<button type="button" data-size="${n}" class="${n === size ? 'active' : ''}">${n}</button>`).join('')}
          </div>
          <input id="size-custom" class="size-input${custom ? ' active' : ''}" type="number" inputmode="numeric"
            min="1" max="999" step="1" placeholder="своё" value="${custom ? size : ''}" aria-label="Своё число карточек">
        </div>
        <div class="muted small-text">Если карточек в блоке меньше — пройдём все, каждую по разу.</div>
      </div>

      <div class="tiles">
        ${Object.keys(MODES).map((m) => `
          <a class="tile" href="#/${m}">
            <span class="tile-title">${MODES[m].title}</span>
            <span class="tile-sub">${MODES[m].sub}</span>
          </a>`).join('')}
        <a class="tile" href="#/texts">
          <span class="tile-title">Тексты</span>
          <span class="tile-sub">читаю и отвечаю на вопросы</span>
        </a>
        <a class="tile" href="#/grammar">
          <span class="tile-title">Грамматика</span>
          <span class="tile-sub">правила, таблицы, примеры</span>
        </a>
      </div>

      <div class="tiles secondary three">
        <a class="tile" href="#/dict"><span class="tile-title">Словарь</span></a>
        <a class="tile" href="#/stats"><span class="tile-title">Статистика</span></a>
        <a class="tile" href="#/import"><span class="tile-title">Импорт</span></a>
      </div>`;

    $app.querySelector('#filter').addEventListener('change', (e) => {
      Store.setSettings({ filter: e.target.value });
      renderHome();
    });
    $app.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
      Store.setSettings({ size: Number(b.dataset.size) });
      renderHome();
    }));
    // Своё число сохраняем на лету, без перерисовки — чтобы не терять фокус и клавиатуру.
    const sizeInput = $app.querySelector('#size-custom');
    sizeInput.addEventListener('input', () => {
      const n = Number(sizeInput.value);
      const ok = Store.isSessionSize(n);
      sizeInput.classList.toggle('invalid', sizeInput.value !== '' && !ok);
      if (!ok) return;
      Store.setSettings({ size: n });
      sizeInput.classList.add('active');
      $app.querySelectorAll('[data-size]').forEach((b) => b.classList.remove('active'));
    });
    const files = $app.querySelector('#base-files');
    if (files) files.addEventListener('change', loadBaseFiles);
  }

  async function loadBaseFiles(e) {
    try {
      const parsed = await Promise.all(Array.from(e.target.files).map((f) => f.text().then(U.parseLooseJson)));
      Store.loadBaseFromFiles(parsed);
    } catch (err) {
      alert('Не получилось прочитать файл: ' + err.message);
    }
    renderHome();
  }

  // ---------- сессия ----------

  function startSession(mode, items) {
    let pool = mode === 'forms' ? Store.filteredDrills().map(drillItem) : Store.filteredWords();
    if (mode === 'reading') pool = pool.filter((w) => w.read);
    const list = items || Store.pickSession(pool, Store.state.settings.size);

    setHeader(MODES[mode].title, true);
    if (!list.length) {
      const empty = {
        reading: 'В выбранном блоке нет слов с полем «read».',
        forms: 'В выбранном блоке нет заданий на формы. Добавь карточки в data/grammar.json или через Импорт.'
      };
      $app.innerHTML = emptyState(empty[mode] ||
        'В выбранном блоке нет слов. Выбери другой фильтр или добавь слова через Импорт.');
      return;
    }
    session = { mode, items: U.shuffle(list), i: 0, results: [], answered: false };
    renderStep();
  }

  function progressBar() {
    const n = session.items.length;
    const pct = Math.round((session.i / n) * 100);
    return `
      <div class="progress">
        <div class="progress-text">${session.i + 1} / ${n}</div>
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
      </div>`;
  }

  function renderStep() {
    if (session.i >= session.items.length) return renderSummary();
    session.answered = false;
    session.shownAt = Date.now();
    const word = session.items[session.i];
    if (session.mode === 'input' || session.mode === 'forms') renderInputStep(word);
    else if (session.mode === 'reading') renderReadingStep(word);
    else renderCardStep(word);
  }

  function answerResult(word, result, answer) {
    session.answered = true;
    session.results.push({ word, result, answer });
    const p = Store.record(word.id, result, {
      mode: session.mode,
      given: answer,
      sec: (Date.now() - session.shownAt) / 1000
    });
    setHeader(MODES[session.mode].title, true);
    return p;
  }

  function nextStep() {
    session.i++;
    renderStep();
  }

  function boxNote(p) {
    return `<div class="muted box-note">ящик ${p.box} из ${Store.MAX_BOX}</div>`;
  }

  // --- режим «Ввод»

  function specialKeys() {
    return `
      <div class="keys" id="keys">
        <button type="button" class="key shift" data-shift>⇧</button>
        ${SPECIAL.map((c) => `<button type="button" class="key" data-ch="${c}">${c}</button>`).join('')}
      </div>`;
  }

  function bindSpecialKeys(input) {
    const keys = $app.querySelector('#keys');
    let upper = false;
    // pointerdown + preventDefault — чтобы поле не теряло фокус и клавиатура не пряталась.
    keys.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    keys.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || input.readOnly) return;
      if (b.hasAttribute('data-shift')) {
        upper = !upper;
        b.classList.toggle('active', upper);
        keys.querySelectorAll('[data-ch]').forEach((k) => {
          k.textContent = upper ? k.dataset.ch.toUpperCase() : k.dataset.ch;
        });
        return;
      }
      const ch = upper ? b.dataset.ch.toUpperCase() : b.dataset.ch;
      const s = input.selectionStart == null ? input.value.length : input.selectionStart;
      const en = input.selectionEnd == null ? s : input.selectionEnd;
      input.setRangeText(ch, s, en, 'end');
      input.focus();
    });
  }

  // «Ввод» и «Формы»: одинаковая проверка, разные задание и подсказки.
  function renderInputStep(word) {
    const isForm = word.kind === 'drill';
    $app.innerHTML = `
      ${progressBar()}
      <div class="card">
        <div class="prompt-label">${isForm ? esc(word.title) : 'Как по-латышски?'}</div>
        <div class="prompt${isForm ? ' drill' : ''}"${isForm ? ' lang="lv"' : ''}>${esc(word.ru)}</div>
      </div>
      <form id="answer-form" autocomplete="off">
        <input id="answer" class="answer" type="text" lang="lv" placeholder="Пиши по-латышски"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
        ${specialKeys()}
        <div id="feedback"></div>
        <div class="actions">
          <button type="button" class="btn secondary" id="skip">Не знаю</button>
          <button type="submit" class="btn primary" id="submit">Проверить</button>
        </div>
      </form>`;

    const input = $app.querySelector('#answer');
    bindSpecialKeys(input);
    input.focus();

    const check = (given) => {
      const result = U.checkLv(given, [word.lv].concat(word.lv_alt));
      const p = answerResult(word, result, given);
      input.readOnly = true;
      input.classList.add(result);
      const correctLine = result === 'ok'
        ? (word.lv_alt.length ? `<div class="muted">варианты: ${esc([word.lv].concat(word.lv_alt).join(' / '))}</div>` : '')
        : `<div>Правильно: <b lang="lv">${esc(word.lv)}</b>${word.lv_alt.length ? ` <span class="muted">(или ${esc(word.lv_alt.join(' / '))})</span>` : ''}</div>`;
      $app.querySelector('#feedback').innerHTML = `
        <div class="feedback ${result}">
          <div class="verdict">${VERDICT[result]}${result === 'almost' ? ' Проверь диакритику.' : ''}</div>
          ${correctLine}
          ${isForm
            ? `<div class="muted">Правило: <a href="#/grammar/${encodeURIComponent(word.gid)}">${esc(word.title)}</a></div>`
            : wordDetails(word, { read: true })}
          ${boxNote(p)}
        </div>
        ${speechBar(word)}`;
      $app.querySelector('#skip').hidden = true;
      $app.querySelector('#submit').textContent = 'Дальше →';
    };

    $app.querySelector('#answer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (session.answered) return nextStep();
      if (!input.value.trim()) return input.focus();
      check(input.value);
    });
    $app.querySelector('#skip').addEventListener('click', () => check(''));
  }

  // --- режим «Чтение»

  function renderReadingStep(word) {
    $app.innerHTML = `
      ${progressBar()}
      <div class="card">
        <div class="prompt-label">Как читается?</div>
        <div class="prompt" lang="lv">${esc(word.lv)}</div>
      </div>
      <form id="answer-form" autocomplete="off">
        <input id="answer" class="answer" type="text" lang="ru" placeholder="Русскими буквами"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
        <div id="feedback"></div>
        <div class="actions">
          <button type="button" class="btn secondary" id="skip">Не знаю</button>
          <button type="submit" class="btn primary" id="submit">Проверить</button>
        </div>
      </form>`;

    const input = $app.querySelector('#answer');
    input.focus();

    const check = (given) => {
      const result = U.checkReading(given, word.read);
      const p = answerResult(word, result, given);
      input.readOnly = true;
      input.classList.add(result);
      const verdict = { ok: 'Верно!', almost: 'Почти!', bad: 'Не совсем' }[result];
      $app.querySelector('#feedback').innerHTML = `
        <div class="feedback ${result}">
          <div class="verdict">${verdict}</div>
          <div>Эталон: <b class="detail-read">${esc(word.read)}</b></div>
          <div class="muted">заглавными — ударный слог</div>
          ${wordDetails(word, { ru: true })}
          ${boxNote(p)}
        </div>
        ${speechBar(word)}`;
      $app.querySelector('#skip').hidden = true;
      $app.querySelector('#submit').textContent = 'Дальше →';
    };

    $app.querySelector('#answer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (session.answered) return nextStep();
      if (!input.value.trim()) return input.focus();
      check(input.value);
    });
    $app.querySelector('#skip').addEventListener('click', () => check(''));
  }

  // --- режим «Карточки»

  function renderCardStep(word) {
    $app.innerHTML = `
      ${progressBar()}
      <div class="card flashcard" id="flip" role="button" tabindex="0">
        <div class="prompt" lang="lv">${esc(word.lv)}</div>
        <div class="back" hidden>
          ${wordDetails(word, { ru: true, read: true })}
        </div>
        <div class="muted tap-hint">нажми, чтобы перевернуть</div>
      </div>
      ${speechBar(word)}
      <div class="actions" id="grade" hidden>
        <button type="button" class="btn bad" data-grade="bad">Не знал</button>
        <button type="button" class="btn ok" data-grade="ok">Знал</button>
      </div>`;

    const flip = $app.querySelector('#flip');
    flip.addEventListener('click', () => {
      flip.querySelector('.back').hidden = false;
      flip.querySelector('.tap-hint').hidden = true;
      flip.classList.add('flipped');
      $app.querySelector('#grade').hidden = false;
    });
    flip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip.click(); }
    });
    $app.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => {
      if (session.answered) return;
      answerResult(word, b.dataset.grade, null);
      nextStep();
    }));
  }

  // --- итог

  function renderSummary() {
    const r = session.results;
    const ok = r.filter((x) => x.result === 'ok').length;
    const almost = r.filter((x) => x.result === 'almost');
    const bad = r.filter((x) => x.result === 'bad');
    const missed = almost.concat(bad);
    const mode = session.mode;

    const row = (x) => `
      <li class="${x.result}">
        ${x.word.kind === 'drill'
          ? `<span lang="lv">${esc(x.word.ru)}</span> → <span class="lv" lang="lv">${esc(x.word.lv)}</span>`
          : `<span class="lv" lang="lv">${esc(x.word.lv)}</span> — ${esc(x.word.ru)}`}
        ${mode === 'reading' ? `<div class="muted">[${esc(x.word.read)}]</div>` : ''}
        ${x.answer != null ? `<div class="muted">твой ответ: ${x.answer.trim() ? esc(x.answer) : '—'}</div>` : ''}
      </li>`;

    $app.innerHTML = `
      <div class="card summary">
        <div class="prompt-label">Итог сессии</div>
        <div class="score">${ok} из ${r.length}</div>
        <div class="muted">верно${almost.length ? ` · почти: ${almost.length}` : ''}${bad.length ? ` · ошибок: ${bad.length}` : ''}</div>
      </div>
      ${missed.length ? `
        <h3>Ошибки</h3>
        <ul class="mistakes">${missed.map(row).join('')}</ul>` : '<p class="center">Без ошибок 🎉</p>'}
      <div class="actions column">
        ${missed.length ? '<button type="button" class="btn primary" id="retry">Повторить ошибки</button>' : ''}
        <button type="button" class="btn ${missed.length ? 'secondary' : 'primary'}" id="again">Новая сессия</button>
        <a class="btn secondary" href="#/">На главную</a>
      </div>`;

    const retry = $app.querySelector('#retry');
    if (retry) retry.addEventListener('click', () => startSession(mode, missed.map((x) => x.word)));
    $app.querySelector('#again').addEventListener('click', () => startSession(mode));
  }

  // ---------- тексты ----------

  function renderTextList() {
    setHeader('Тексты', true);
    const list = Store.filteredTexts();
    if (!list.length) {
      $app.innerHTML = emptyState('Текстов пока нет. Добавь их в data/texts.json или через Импорт.');
      return;
    }
    $app.innerHTML = `
      <div class="list">
        ${list.map((t) => {
          const res = Store.state.textResults[t.id];
          return `
            <a class="list-item" href="#/text/${encodeURIComponent(t.id)}">
              <span class="tile-title">${esc(t.title)}</span>
              <span class="muted">${t.block != null ? `блок ${t.block} · ` : ''}${t.questions.length} вопр.${res ? ` · лучший: ${res.best}/${res.total}` : ''}</span>
            </a>`;
        }).join('')}
      </div>`;
  }

  function isWordToken(t) {
    return /^[\p{L}\p{M}]/u.test(t);
  }

  // Слова и фразы из glossary становятся кликабельными. Фразы из нескольких
  // слов ищем жадно: сначала самую длинную подходящую.
  function renderLvText(text, glossary) {
    const gl = new Map();
    let maxWords = 1;
    glossary.forEach((g) => {
      const key = U.cleanLv(g.lv);
      if (!key) return;
      gl.set(key, g);
      maxWords = Math.max(maxWords, key.split(' ').length);
    });

    const tokens = text.match(/[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu) || [];
    let html = '';
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (!isWordToken(t)) { html += esc(t); i++; continue; }

      let match = null;
      let end = i;
      for (let n = maxWords; n >= 1 && !match; n--) {
        const phrase = [t];
        let j = i;
        while (phrase.length < n) {
          const sep = tokens[j + 1];
          const nxt = tokens[j + 2];
          if (!sep || !nxt || !/^[  ]+$/.test(sep) || !isWordToken(nxt)) break;
          phrase.push(nxt);
          j += 2;
        }
        if (phrase.length !== n) continue;
        const g = gl.get(U.cleanLv(phrase.join(' ')));
        if (g) { match = g; end = j; }
      }

      const chunk = tokens.slice(i, end + 1).join('');
      if (match) {
        html += `<span class="w gl" data-lv="${esc(match.lv)}" data-ru="${esc(match.ru)}">${esc(chunk)}</span>`;
      } else {
        html += `<span class="w" data-lv="${esc(chunk)}">${esc(chunk)}</span>`;
      }
      i = end + 1;
    }
    return html;
  }

  function lookupInWords(lv) {
    const key = U.cleanLv(lv);
    return Store.words().find((w) => [w.lv].concat(w.lv_alt).some((x) => U.cleanLv(x) === key));
  }

  function showPopup(lv, ru, read) {
    $popup.innerHTML = `
      <div class="popup-lv" lang="lv">${esc(lv)}</div>
      <div class="popup-ru">${ru ? esc(ru) : '<span class="muted">нет в глоссарии</span>'}</div>
      ${read ? `<div class="detail-read">[${esc(read)}]</div>` : ''}
      <button type="button" class="btn small tts-btn" data-say="${esc(lv)}">🔊 Послушать</button>`;
    $popup.hidden = false;
  }

  function hidePopup() {
    $popup.hidden = true;
  }

  function renderText(id) {
    const t = Store.texts().find((x) => x.id === id);
    setHeader('Текст', true);
    if (!t) {
      $app.innerHTML = emptyState('Текст не найден.');
      return;
    }

    $app.innerHTML = `
      <h2 class="text-title">${esc(t.title)}</h2>
      <div class="speech">
        <button type="button" class="btn small tts-btn" data-say="${esc(t.lv)}">🔊 Послушать текст</button>
      </div>
      <div class="lv-text" lang="lv">${renderLvText(t.lv, t.glossary)}</div>
      <p class="muted small-text">Нажми на слово — покажу перевод.</p>
      ${t.ru ? `
        <button type="button" class="btn secondary" id="toggle-tr">Показать перевод</button>
        <div class="ru-text" id="ru-text" hidden>${esc(t.ru)}</div>` : ''}
      ${t.questions.length ? `
        <h3>Вопросы</h3>
        ${t.questions.map((q, qi) => `
          <div class="question" data-q="${qi}">
            <p>${qi + 1}. ${esc(q.q)}</p>
            <div class="options">
              ${q.options.map((o, oi) => `<button type="button" class="btn option" data-opt="${oi}">${esc(o)}</button>`).join('')}
            </div>
          </div>`).join('')}
        <div id="q-score"></div>` : ''}`;

    $app.querySelector('.lv-text').addEventListener('click', (e) => {
      const w = e.target.closest('.w');
      if (!w) return;
      $app.querySelectorAll('.w.active').forEach((x) => x.classList.remove('active'));
      w.classList.add('active');
      if (w.dataset.ru) {
        const known = lookupInWords(w.dataset.lv);
        showPopup(w.dataset.lv, w.dataset.ru, known && known.read);
      } else {
        const known = lookupInWords(w.dataset.lv);
        showPopup(known ? known.lv : w.dataset.lv, known && known.ru, known && known.read);
      }
    });

    const toggle = $app.querySelector('#toggle-tr');
    if (toggle) toggle.addEventListener('click', () => {
      const ru = $app.querySelector('#ru-text');
      ru.hidden = !ru.hidden;
      toggle.textContent = ru.hidden ? 'Показать перевод' : 'Скрыть перевод';
    });

    let answered = 0;
    let correct = 0;
    $app.querySelectorAll('.question').forEach((qEl) => {
      const q = t.questions[Number(qEl.dataset.q)];
      qEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-opt]');
        if (!b || qEl.classList.contains('done')) return;
        qEl.classList.add('done');
        const chosen = Number(b.dataset.opt);
        qEl.querySelectorAll('[data-opt]').forEach((o) => {
          o.disabled = true;
          if (Number(o.dataset.opt) === q.answer) o.classList.add('ok');
        });
        if (chosen !== q.answer) b.classList.add('bad');
        else correct++;
        answered++;
        if (answered === t.questions.length) {
          Store.saveTextResult(t.id, correct, answered);
          setHeader('Текст', true);
          $app.querySelector('#q-score').innerHTML = `
            <div class="feedback ${correct === answered ? 'ok' : correct ? 'almost' : 'bad'}">
              <div class="verdict">Правильно ${correct} из ${answered}</div>
            </div>
            <div class="actions column"><a class="btn secondary" href="#/texts">К списку текстов</a></div>`;
        }
      });
    });
  }

  // ---------- грамматика ----------

  function renderGrammarList() {
    setHeader('Грамматика', true);
    const list = Store.grammar();
    if (!list.length) {
      $app.innerHTML = emptyState('Карточек пока нет. Добавь их в data/grammar.json или через Импорт.');
      return;
    }
    $app.innerHTML = groupByLesson(list).map((g) => `
      <h3>${esc(g.label)}</h3>
      <div class="list">
        ${g.items.map((c) => `
          <a class="list-item" href="#/grammar/${encodeURIComponent(c.id)}">
            <span class="tile-title">${esc(c.title)}</span>
            ${c.drills.length ? `<span class="muted">${c.drills.length} заданий на формы</span>` : ''}
          </a>`).join('')}
      </div>`).join('');
  }

  function grammarTable(t) {
    return `
      <div class="table-wrap">
        <table class="gtable" lang="lv">
          ${t.headers.length ? `<thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}
          <tbody>
            ${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderGrammarCard(id) {
    setHeader('Грамматика', true);
    const c = Store.grammar().find((x) => x.id === id);
    if (!c) {
      $app.innerHTML = emptyState('Карточка не найдена.');
      return;
    }
    $app.innerHTML = `
      <div class="muted">${esc(blockLessonLabel(c.block, c.lesson))}</div>
      <h2 class="text-title">${esc(c.title)}</h2>
      ${c.rule ? `<div class="rule">${esc(c.rule)}</div>` : ''}
      ${c.table ? grammarTable(c.table) : ''}
      ${c.examples.length ? `
        <h3>Примеры</h3>
        <ul class="examples">
          ${c.examples.map((x) => `
            <li>
              <div class="ex-lv" lang="lv">${esc(x.lv)}</div>
              ${x.ru ? `<div class="muted">${esc(x.ru)}</div>` : ''}
              <button type="button" class="btn small tts-btn" data-say="${esc(x.lv)}">🔊 Послушать</button>
            </li>`).join('')}
        </ul>` : ''}
      ${c.drills.length ? `
        <div class="actions column">
          <button type="button" class="btn primary" id="drill-card">Тренировать формы (${c.drills.length})</button>
        </div>` : ''}`;

    const btn = $app.querySelector('#drill-card');
    if (btn) btn.addEventListener('click', () => {
      const items = Store.drills().filter((d) => d.gid === c.id).map(drillItem);
      startSession('forms', Store.pickSession(items, Store.state.settings.size));
    });
  }

  // ---------- словарь ----------

  function searchKey(s) {
    return U.stripDiacritics(U.cleanLv(s)).replace(/ё/g, 'е');
  }

  function dictRow(w) {
    return `
      <li class="dict-row">
        <div class="dict-head">
          <span class="lv" lang="lv">${esc([w.lv].concat(w.lv_alt).join(' / '))}</span>
          <button type="button" class="btn small tts-btn" data-say="${esc(w.lv)}" aria-label="Послушать">🔊</button>
        </div>
        <div>${esc([w.ru].concat(w.ru_alt).join(', '))}</div>
        ${w.read ? `<div class="detail-read">[${esc(w.read)}]</div>` : ''}
        ${w.note ? `<div class="note">💡 ${esc(w.note)}</div>` : ''}
      </li>`;
  }

  function renderDict() {
    setHeader('Словарь', true);
    const all = Store.words();
    const blocks = Array.from(new Set(all.map((w) => w.block).filter((b) => b != null))).sort((a, b) => a - b);
    let block = Store.state.settings.dictBlock;
    if (block !== 'all' && !blocks.includes(Number(block))) block = 'all';

    $app.innerHTML = `
      <div class="dict-controls">
        <select id="dict-block" aria-label="Блок">
          <option value="all">Все блоки</option>
          ${blocks.map((b) => `<option value="${b}" ${String(b) === String(block) ? 'selected' : ''}>Блок ${b}</option>`).join('')}
        </select>
        <input id="dict-search" class="answer" type="search" placeholder="Поиск: lv или ru"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
      </div>
      <div id="dict-list"></div>`;

    const $list = $app.querySelector('#dict-list');
    const $search = $app.querySelector('#dict-search');

    const draw = () => {
      const q = searchKey($search.value);
      const items = all.filter((w) => {
        if (block !== 'all' && w.block !== Number(block)) return false;
        if (!q) return true;
        return [w.lv, w.ru, w.read].concat(w.lv_alt, w.ru_alt).some((x) => searchKey(x).includes(q));
      });
      $list.innerHTML = items.length
        ? `<p class="muted">${items.length} слов</p>` + groupByLesson(items).map((g) => `
            <h3>${esc(g.label)}</h3>
            <ul class="dict">${g.items.map(dictRow).join('')}</ul>`).join('')
        : '<p class="muted center">Ничего не нашлось.</p>';
    };

    $app.querySelector('#dict-block').addEventListener('change', (e) => {
      block = e.target.value;
      Store.setSettings({ dictBlock: block });
      draw();
    });
    $search.addEventListener('input', draw);
    draw();
  }

  // ---------- статистика ----------

  const PERIOD_TABS = [
    ['today', 'Сегодня'],
    ['week', '7 дней'],
    ['month', '30 дней'],
    ['all', 'Всё время']
  ];

  function pct(x) {
    return `${Math.round(x * 100)}%`;
  }

  function accRow(label, c, sub) {
    const acc = Stats.accuracy(c);
    const cls = acc >= 0.8 ? 'ok' : acc >= 0.5 ? 'almost' : 'bad';
    return `
      <div class="acc-row${sub ? ' sub' : ''}">
        <span class="acc-label">${esc(label)}</span>
        <span class="acc-bar"><span class="${cls}" style="width:${acc * 100}%"></span></span>
        <span class="acc-num">${pct(acc)}</span>
        <span class="acc-total muted">${c.total}</span>
      </div>`;
  }

  function renderStats() {
    setHeader('Статистика', true);
    const st = Store.state;
    const period = Stats.PERIODS[st.settings.period] ? st.settings.period : 'week';
    const all = Store.words();
    const boxes = Array(Store.MAX_BOX + 1).fill(0);
    let unseen = 0;
    all.forEach((w) => {
      const p = Store.getProgress(w.id);
      boxes[p.box]++;
      if (!p.seen) unseen++;
    });
    const maxBox = Math.max(1, ...boxes);
    const s = Store.summary(period);
    const ie = s.inputErrors;
    const ieTotal = ie.diacritic + ie.other + ie.skipped;

    const lessonsOf = (block) => s.lessons
      .filter((l) => l.block === block && l.lesson != null)
      .sort((a, b) => a.lesson - b.lesson);

    $app.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="stat-num">${all.length}</div><div class="muted">всего слов</div></div>
        <div class="stat"><div class="stat-num">${Store.streak()}</div><div class="muted">дней подряд</div></div>
      </div>

      <h3>Ящики</h3>
      <div class="boxes">
        ${boxes.slice(1).map((n, i) => `
          <div class="box-row">
            <span class="box-label">Ящик ${i + 1}</span>
            <span class="box-bar"><span class="b${i + 1}" style="width:${(n / maxBox) * 100}%"></span></span>
            <span class="box-num">${n}</span>
          </div>`).join('')}
      </div>
      <p class="muted">Новые слова лежат в ящике 1. Ещё ни разу не видел: ${unseen}. Лучшая серия: ${Store.bestStreak()} дн.</p>

      <h3>За период</h3>
      <div class="seg" role="group">
        ${PERIOD_TABS.map(([k, label]) => `<button type="button" data-period="${k}" class="${k === period ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      ${st.statsFrom ? `<p class="muted small-text">Статистика считается с ${new Date(st.statsFrom).toLocaleString('ru-RU')}</p>` : ''}

      <div class="stat-grid period-grid">
        <div class="stat"><div class="stat-num">${s.total}</div><div class="muted">ответов</div></div>
        <div class="stat"><div class="stat-num">${s.total ? pct(s.accuracy) : '—'}</div><div class="muted">точность</div></div>
        <div class="stat"><div class="stat-num">${s.days}</div><div class="muted">дней занимался</div></div>
        <div class="stat"><div class="stat-num">${s.avgSec != null ? s.avgSec.toFixed(1) : '—'}</div><div class="muted">сек. на ответ</div></div>
      </div>

      ${s.total ? `
        <p class="muted">верно ${s.ok} · почти ${s.almost} · неверно ${s.bad}</p>

        <h3>По блокам и урокам</h3>
        <div class="acc-list">
          ${s.blocks.map((b) => accRow(b.label, b) + lessonsOf(b.block).map((l) => accRow(`урок ${l.lesson}`, l, true)).join('')).join('')}
        </div>

        <h3>Трудные слова</h3>
        ${s.hard.length ? `
          <ul class="mistakes">
            ${s.hard.map((h) => `
              <li class="${h.bad ? 'bad' : 'almost'}">
                <span class="lv" lang="lv">${esc(h.word ? h.word.lv : h.id)}</span>${h.word ? ` — ${esc(h.word.ru)}` : ''}
                <div class="muted">ошибок ${h.errors} из ${h.total}${h.typical ? ` · обычно: «${esc(h.typical.value)}»` : ''}</div>
              </li>`).join('')}
          </ul>` : '<p class="muted">Ошибок нет 🎉</p>'}

        <h3>Ошибки в «Вводе»</h3>
        ${ieTotal ? `
          <div class="err-types">
            <div class="feedback almost"><b>${ie.diacritic}</b> — только диакритика (ā→a, š→s…)</div>
            <div class="feedback bad"><b>${ie.other}</b> — другие ошибки</div>
            <div class="feedback bad"><b>${ie.skipped}</b> — «не знаю»</div>
          </div>` : '<p class="muted">Ошибок в режиме «Ввод» нет.</p>'}

        ${s.forms.total ? `
          <h3>Формы</h3>
          ${accRow('точность', s.forms)}
          <p class="muted">верно ${s.forms.ok} · только диакритика ${s.forms.diacritic} · неверно ${s.forms.bad}</p>
          ${s.forms.hard.length ? `
            <ul class="mistakes">
              ${s.forms.hard.map((h) => `
                <li class="${h.bad ? 'bad' : 'almost'}">
                  ${h.word ? `<span lang="lv">${esc(h.word.ru)}</span> → <span class="lv" lang="lv">${esc(h.word.lv)}</span>` : esc(h.id)}
                  <div class="muted">ошибок ${h.errors} из ${h.total}${h.typical ? ` · обычно: «${esc(h.typical.value)}»` : ''}</div>
                </li>`).join('')}
            </ul>` : ''}` : ''}
      ` : '<p class="muted">За этот период ответов нет.</p>'}

      <div class="actions column">
        <button type="button" class="btn primary" id="copy-report">Скопировать отчёт</button>
        <textarea id="report-text" rows="12" readonly hidden></textarea>
        <button type="button" class="btn secondary" id="stats-zero">Начать с нуля</button>
        <button type="button" class="btn danger" id="reset">Сбросить ящики</button>
      </div>`;

    $app.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
      Store.setSettings({ period: b.dataset.period });
      renderStats();
    }));

    $app.querySelector('#copy-report').addEventListener('click', async (e) => {
      const text = Store.report(period);
      try {
        await navigator.clipboard.writeText(text);
        e.target.textContent = 'Отчёт скопирован ✓';
      } catch (err) {
        // Без https буфер обмена недоступен — показываем текст, чтобы скопировать вручную.
        const ta = $app.querySelector('#report-text');
        ta.value = text;
        ta.hidden = false;
        ta.select();
        e.target.textContent = 'Скопируй текст ниже';
      }
    });

    $app.querySelector('#stats-zero').addEventListener('click', () => {
      if (!confirm('Начать статистику с нуля? Старые ответы останутся в журнале и экспорте, но в статистику и отчёт не попадут. Ящики не меняются.')) return;
      Store.startStatsFromNow();
      renderStats();
    });

    $app.querySelector('#reset').addEventListener('click', () => {
      if (!confirm('Сбросить ящики Лейтнера, дни подряд и результаты текстов? Слова и журнал ответов останутся.')) return;
      Store.resetProgress();
      renderStats();
    });
  }

  // ---------- импорт ----------

  const IMPORT_EXAMPLE = `[
  {"id":"b2l2-maja","lv":"māja","ru":"дом","read":"МААя","block":2,"lesson":2}
]`;

  function importCounts() {
    const st = Store.state;
    return `Из файлов: ${st.baseWords.length} слов, ${st.baseTexts.length} текстов, ${st.baseGrammar.length} карточек грамматики. ` +
      `Импортировано: ${st.importedWords.length} слов, ${st.importedTexts.length} текстов, ${st.importedGrammar.length} карточек.`;
  }

  function renderImport() {
    setHeader('Импорт', true);
    $app.innerHTML = `
      <p class="muted" id="import-counts">${importCounts()}</p>

      <div class="field">
        <label for="import-src">Вставь JSON — массив слов, текстов или карточек грамматики (можно вперемешку)</label>
        <textarea id="import-src" rows="10" spellcheck="false" placeholder='${esc(IMPORT_EXAMPLE)}'></textarea>
        <div class="muted small-text">Если id уже есть — запись обновится, иначе добавится.
        Комментарии // и висячие запятые можно. Сюда же можно вставить резервную копию.</div>
      </div>
      <div class="actions">
        <button type="button" class="btn secondary" id="import-clear">Очистить поле</button>
        <button type="button" class="btn primary" id="import-go">Добавить</button>
      </div>
      <div id="import-result"></div>

      <h3>Резервная копия</h3>
      <div class="actions column">
        <button type="button" class="btn secondary" id="export">Экспорт всех данных (файл)</button>
        <button type="button" class="btn secondary" id="export-copy">Скопировать экспорт в буфер</button>
        <button type="button" class="btn danger" id="clear-imported">Удалить импортированное</button>
      </div>`;

    const src = $app.querySelector('#import-src');
    const out = $app.querySelector('#import-result');

    $app.querySelector('#import-clear').addEventListener('click', () => {
      src.value = '';
      out.innerHTML = '';
      src.focus();
    });

    $app.querySelector('#import-go').addEventListener('click', () => {
      let data;
      try {
        data = U.parseLooseJson(src.value);
      } catch (e) {
        out.innerHTML = `<div class="feedback bad">Не похоже на JSON: ${esc(e.message)}</div>`;
        return;
      }

      let items;
      let backup = null;
      if (Array.isArray(data)) {
        items = data;
      } else if (data && typeof data === 'object' &&
        (Array.isArray(data.words) || Array.isArray(data.texts) || Array.isArray(data.grammar))) {
        backup = data;
        items = (data.words || []).concat(data.texts || [], data.grammar || []);
      } else if (data && typeof data === 'object') {
        items = [data];
      } else {
        out.innerHTML = '<div class="feedback bad">Нужен массив объектов.</div>';
        return;
      }

      const report = Store.importItems(items);
      let progressNote = '';
      if (backup && backup.progress && confirm('В копии есть прогресс (ящики, дни). Заменить текущий прогресс?')) {
        Store.restoreProgress(backup);
        progressNote = '<div>Прогресс восстановлен.</div>';
      }
      const cls = report.errors.length ? (report.added + report.updated ? 'almost' : 'bad') : 'ok';
      out.innerHTML = `
        <div class="feedback ${cls}">
          <div class="verdict">Добавлено: ${report.added}, обновлено: ${report.updated}</div>
          ${progressNote}
          ${report.errors.length ? `<div>Пропущено (${report.errors.length}):</div><ul>${report.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
        </div>`;
      if (!report.errors.length) src.value = '';
      $app.querySelector('#import-counts').textContent = importCounts();
    });

    $app.querySelector('#export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `latvian-backup-${U.dayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    $app.querySelector('#export-copy').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(Store.exportAll(), null, 2));
        e.target.textContent = 'Скопировано ✓';
      } catch (err) {
        alert('Буфер обмена недоступен: ' + err.message);
      }
    });

    $app.querySelector('#clear-imported').addEventListener('click', () => {
      if (!confirm('Удалить все импортированные слова, тексты и карточки грамматики? Файлы из data/ и прогресс не тронутся.')) return;
      Store.clearImported();
      renderImport();
    });
  }

  // ---------- голос: общие обработчики ----------

  document.addEventListener('click', (e) => {
    const say = e.target.closest('[data-say]');
    if (say) {
      Speech.speak(say.dataset.say);
      return;
    }

    const checkBtn = e.target.closest('[data-check]');
    if (checkBtn) {
      const word = findWord(checkBtn.dataset.check);
      const out = checkBtn.closest('.speech').nextElementSibling;
      if (!word || !out) return;
      const label = checkBtn.textContent;
      checkBtn.disabled = true;
      checkBtn.textContent = '🎤 Говори…';
      out.hidden = true;
      Speech.listen(({ heard, error }) => {
        checkBtn.disabled = false;
        checkBtn.textContent = label;
        out.hidden = false;
        if (error) {
          out.className = 'stt-result feedback bad';
          out.innerHTML = esc(error);
          return;
        }
        const variants = [word.lv].concat(word.lv_alt);
        const rank = { ok: 0, almost: 1, bad: 2 };
        let best = { text: heard[0], result: 'bad' };
        heard.forEach((h) => {
          const r = U.checkLv(h, variants);
          if (rank[r] < rank[best.result]) best = { text: h, result: r };
        });
        const msg = { ok: 'Совпало ✓', almost: 'Почти (отличается диакритикой)', bad: 'Не совпало' }[best.result];
        out.className = `stt-result feedback ${best.result}`;
        out.innerHTML = `<div>Распознано: «<span lang="lv">${esc(best.text)}</span>»</div><div class="verdict">${msg}</div>`;
      });
      return;
    }

    if (!$popup.hidden && !e.target.closest('#popup') && !e.target.closest('.w')) hidePopup();
  });

  // ---------- маршрутизация ----------

  function route() {
    hidePopup();
    session = null;
    window.scrollTo(0, 0);
    const hash = location.hash.replace(/^#\/?/, '');
    const [name, arg] = hash.split('/');
    if (MODES[name]) startSession(name);
    else if (name === 'texts') renderTextList();
    else if (name === 'text') renderText(decodeURIComponent(arg || ''));
    else if (name === 'grammar') {
      if (arg) renderGrammarCard(decodeURIComponent(arg));
      else renderGrammarList();
    }
    else if (name === 'dict') renderDict();
    else if (name === 'stats') renderStats();
    else if (name === 'import') renderImport();
    else renderHome();
  }

  $back.addEventListener('click', () => {
    const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
    if (name === 'text') location.hash = '#/texts';
    else if (name === 'grammar' && arg) location.hash = '#/grammar';
    else location.hash = '#/';
  });

  window.addEventListener('hashchange', route);

  Speech.init();
  Store.loadBase().then(route);
})();
