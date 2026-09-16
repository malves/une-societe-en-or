// Couche client partagée : appels d'actions, flux temps réel (SSE) et sons.
(function () {
  const FenOr = {};

  /* ----------  Actions vers le serveur  ---------- */
  FenOr.action = async function (name, body) {
    const res = await fetch('/api/action/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      console.error('Action échouée :', name, await res.text());
    }
    return res.json();
  };

  FenOr.api = async function (method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || 'Erreur');
      err.status = res.status;
      throw err;
    }
    return data;
  };

  /* ----------  Flux temps réel  ---------- */
  FenOr.connect = function (onState) {
    let es;
    function open() {
      es = new EventSource('/api/events');
      es.onmessage = (e) => {
        try {
          onState(JSON.parse(e.data));
        } catch (_) {}
      };
      es.onerror = () => {
        // EventSource se reconnecte tout seul ; on ferme proprement si besoin.
      };
    }
    open();
    return () => es && es.close();
  };

  /* ----------  Sons (WebAudio, sans fichier)  ---------- */
  let audioCtx = null;
  FenOr.enableAudio = function () {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return !!audioCtx;
  };

  function tone(freq, start, dur, type, gainPeak) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + start;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak || 0.3, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  FenOr.sounds = {
    reveal() {
      // Petit « ding » agréable (deux notes montantes).
      tone(660, 0, 0.18, 'sine', 0.35);
      tone(990, 0.08, 0.25, 'sine', 0.3);
    },
    strike() {
      // Buzzer d'échec : grave, descendant, filtré (chaud et « lourd »).
      if (!audioCtx) return;
      const t0 = audioCtx.currentTime;
      const dur = 0.7;

      // Filtre passe-bas : enlève l'aspect criard, garde le côté « gros ».
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, t0);
      filter.frequency.exponentialRampToValueAtTime(220, t0 + dur);
      filter.Q.value = 6;

      // Enveloppe : attaque nette puis extinction.
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
      gain.gain.setValueAtTime(0.5, t0 + dur - 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      filter.connect(gain).connect(audioCtx.destination);

      // Oscillateur principal : descend nettement (sensation de chute / échec).
      const osc1 = audioCtx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(140, t0);
      osc1.frequency.exponentialRampToValueAtTime(48, t0 + dur);

      // Sous-oscillateur une octave plus bas pour l'épaisseur.
      const osc2 = audioCtx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.setValueAtTime(70, t0);
      osc2.frequency.exponentialRampToValueAtTime(30, t0 + dur);

      osc1.connect(filter);
      osc2.connect(filter);
      osc1.start(t0);
      osc2.start(t0);
      osc1.stop(t0 + dur + 0.05);
      osc2.stop(t0 + dur + 0.05);
    },
    award() {
      // Petite fanfare.
      [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.3));
    },
  };

  window.FenOr = FenOr;
})();
