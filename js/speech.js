// Озвучка (speechSynthesis) и распознавание речи для lv-LV.
// Если браузер не умеет — на <body> не появятся классы has-tts / has-stt,
// и CSS просто скрывает соответствующие кнопки.
(function () {
  'use strict';

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let voice = null;
  let activeRec = null;

  function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    voice = voices.find((v) => /^lv([-_]|$)/i.test(v.lang)) || null;
    document.body.classList.toggle('has-tts', !!voice);
  }

  function init() {
    if ('speechSynthesis' in window) {
      pickVoice();
      window.speechSynthesis.onvoiceschanged = pickVoice;
    }
    // Распознавание работает только в безопасном контексте (https / localhost).
    if (Recognition && window.isSecureContext) {
      document.body.classList.add('has-stt');
    }
  }

  function speak(text) {
    if (!voice) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.85;
    window.speechSynthesis.speak(u);
  }

  // onDone({ heard: [строки], error: строка|null })
  function listen(onDone) {
    if (!Recognition) return onDone({ heard: [], error: 'Распознавание не поддерживается' });
    if (activeRec) activeRec.abort();

    const rec = new Recognition();
    activeRec = rec;
    rec.lang = 'lv-LV';
    rec.interimResults = false;
    rec.maxAlternatives = 5;

    let finished = false;
    const finish = (res) => {
      if (finished) return;
      finished = true;
      activeRec = null;
      onDone(res);
    };

    rec.onresult = (e) => {
      const heard = [];
      for (let i = 0; i < e.results[0].length; i++) heard.push(e.results[0][i].transcript);
      finish({ heard, error: null });
    };
    rec.onerror = (e) => {
      if (e.error === 'language-not-supported') {
        document.body.classList.remove('has-stt');
        finish({ heard: [], error: 'Браузер не распознаёт латышский' });
      } else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        finish({ heard: [], error: 'Нет доступа к микрофону' });
      } else if (e.error === 'no-speech') {
        finish({ heard: [], error: 'Ничего не услышал, попробуй ещё раз' });
      } else {
        finish({ heard: [], error: 'Ошибка распознавания: ' + e.error });
      }
    };
    rec.onend = () => finish({ heard: [], error: 'Ничего не услышал, попробуй ещё раз' });

    try {
      rec.start();
    } catch (err) {
      finish({ heard: [], error: err.message });
    }
  }

  window.Speech = {
    init,
    speak,
    listen,
    get hasTts() { return !!voice; }
  };
})();
