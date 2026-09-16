// Plateau (écran projeté) : reçoit l'état via SSE et met à jour l'affichage.
(function () {
  const els = {
    teams: document.getElementById('teams'),
    counter: document.getElementById('counter'),
    answers: document.getElementById('answers'),
    strikes: document.getElementById('strikes'),
    strikesMini: document.getElementById('strikesMini'),
    questionBar: document.getElementById('questionBar'),
    soundToggle: document.getElementById('soundToggle'),
    connLost: document.getElementById('connLost'),
    homeOverlay: document.getElementById('homeOverlay'),
    startBtn: document.getElementById('startBtn'),
  };

  // Mémorise l'état précédent pour déclencher les sons au bon moment.
  let prev = { revealedIds: new Set(), strikes: 0, awarded: false, activeTeamId: null };
  let soundOn = false;

  /* ----------  Rendu des cases de réponses  ---------- */
  function renderAnswers(question, revealedIds, newlyRevealed) {
    const answers = question
      ? [...question.answers].sort((a, b) => a.position - b.position)
      : [];

    els.answers.innerHTML = '';
    const n = answers.length;
    const rows = Math.max(1, Math.ceil(n / 2));
    if (n <= 1) {
      els.answers.style.gridTemplateColumns = '1fr';
      els.answers.style.gridTemplateRows = '1fr';
      els.answers.style.gridAutoFlow = 'row';
    } else {
      els.answers.style.gridTemplateColumns = '1fr 1fr';
      els.answers.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      els.answers.style.gridAutoFlow = 'column';
    }
    els.answers.setAttribute('data-count', String(n));

    answers.forEach((a) => {
      const cell = document.createElement('div');
      cell.className = 'answer';
      if (a.revealed) {
        cell.classList.add('is-revealed');
        if (newlyRevealed.has(a.id)) cell.classList.add('just-revealed');
      }
      cell.innerHTML =
        `<span class="answer__num">${a.position}</span>` +
        `<span class="answer__label">${escapeHtml(a.label)}</span>` +
        `<span class="answer__score">${a.points}</span>`;
      els.answers.appendChild(cell);
    });
  }

  /* ----------  Rendu des familles (nombre variable)  ---------- */
  function renderTeams(teams, activeTeamId, buzzJustChanged) {
    els.teams.innerHTML = '';
    // Ajuste la densité selon le nombre de familles.
    els.teams.setAttribute('data-count', String(teams.length));
    els.teams.classList.toggle('has-active', activeTeamId != null);
    teams.forEach((t) => {
      const div = document.createElement('div');
      div.className = 'team';
      const isActive = activeTeamId === t.id;
      if (isActive) {
        div.classList.add('team--active');
        if (buzzJustChanged) div.classList.add('team--buzz-in');
      }
      const chiefHtml = t.chief
        ? `<span class="team__chief">👑 ${escapeHtml(t.chief)}</span>`
        : '';
      div.innerHTML =
        `<div class="team__info">` +
        `<span class="team__name">${escapeHtml(t.name)}</span>` +
        `<span class="team__buzz">Au buzz</span>` +
        `${chiefHtml}` +
        `</div>` +
        `<span class="team__score">${t.score}</span>`;
      els.teams.appendChild(div);
    });
  }

  /* ----------  Application d'un nouvel état  ---------- */
  function apply(state) {
    const revealedIds = new Set(
      state.question ? state.question.answers.filter((a) => a.revealed).map((a) => a.id) : []
    );

    // Détection des nouveautés (pour sons + animation).
    const newlyRevealed = new Set();
    revealedIds.forEach((id) => {
      if (!prev.revealedIds.has(id)) newlyRevealed.add(id);
    });
    const strikeIncreased = state.strikes > prev.strikes;
    const justAwarded = state.awarded && !prev.awarded;
    const buzzJustChanged =
      state.activeTeamId != null && state.activeTeamId !== prev.activeTeamId;

    renderTeams(state.teams, state.activeTeamId, buzzJustChanged);
    renderAnswers(state.question, revealedIds, newlyRevealed);
    els.counter.textContent = state.pot;
    // Petit compteur d'erreurs persistant + grand X en flash momentané.
    els.strikes.setAttribute('data-count', String(state.strikes));
    els.strikesMini.setAttribute('data-count', String(state.strikes));
    if (strikeIncreased) {
      // Relance l'animation même si la classe est déjà présente.
      els.strikes.classList.remove('flash');
      void els.strikes.offsetWidth; // force un reflow
      els.strikes.classList.add('flash');
    }
    els.questionBar.textContent = state.question ? state.question.text : 'En attente de la partie…';

    // Écran d'accueil : visible tant que le jeu n'est pas démarré.
    els.homeOverlay.classList.toggle('is-hidden', !!state.started);

    // Sons
    if (soundOn) {
      if (newlyRevealed.size > 0) window.FenOr.sounds.reveal();
      if (strikeIncreased) window.FenOr.sounds.strike();
      if (justAwarded) window.FenOr.sounds.award();
    }

    prev = {
      revealedIds,
      strikes: state.strikes,
      awarded: state.awarded,
      activeTeamId: state.activeTeamId,
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ----------  Démarrage du jeu depuis le plateau  ---------- */
  els.startBtn.addEventListener('click', () => {
    // Le clic est un geste utilisateur : on active le son au passage.
    soundOn = window.FenOr.enableAudio();
    if (soundOn) els.soundToggle.classList.add('is-hidden');
    window.FenOr.action('start');
  });

  /* ----------  Activation du son  ---------- */
  els.soundToggle.addEventListener('click', () => {
    soundOn = window.FenOr.enableAudio();
    if (soundOn) {
      els.soundToggle.classList.add('is-hidden');
      window.FenOr.sounds.reveal();
    }
  });

  /* ----------  Connexion temps réel  ---------- */
  window.FenOr.connect(apply);
})();
