// Pupitre animateur : pilote la partie (N familles) et se synchronise en temps réel.
(function () {
  const A = window.FenOr.action;
  let state = null;

  const $ = (id) => document.getElementById(id);

  // Cartes de familles déjà rendues : id -> { el, nameEl, subEl, valEl, award, rm, act }
  const cards = new Map();

  const MIN_TEAMS = 2;

  /* ============================================================
     Rendu de l'interface à partir de l'état serveur
     ============================================================ */
  function render(s) {
    state = s;

    // Sélecteur de questions
    const sel = $('questionSelect');
    const currentId = s.question ? s.question.id : '';
    const sig = s.questions.map((q) => q.id + ':' + q.text).join('|');
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.innerHTML = '';
      if (!s.questions.length) {
        const o = document.createElement('option');
        o.textContent = 'Aucune question dans le jeu';
        sel.appendChild(o);
      } else {
        s.questions.forEach((q, i) => {
          const o = document.createElement('option');
          o.value = q.id;
          o.textContent = `${i + 1}. ${q.text}`;
          sel.appendChild(o);
        });
      }
    }
    if (currentId) sel.value = String(currentId);
    $('currentQ').textContent = s.question ? s.question.text : '— aucune question —';

    // Liste des réponses
    const list = $('answersList');
    list.innerHTML = '';
    if (s.question) {
      s.question.answers.forEach((a) => {
        const div = document.createElement('div');
        div.className = 'ans' + (a.revealed ? ' is-revealed' : '');
        div.innerHTML =
          `<span class="ans__pos">${a.position}</span>` +
          `<span class="ans__label">${escapeHtml(a.label)}</span>` +
          `<span class="ans__pts">${a.points}</span>`;
        div.addEventListener('click', () => toggleReveal(a));
        list.appendChild(div);
      });
    }
    const nAns = s.question ? s.question.answers.length : 0;
    const hint = $('ansHint');
    if (hint) hint.textContent = nAns ? `clic ou touches 1–${nAns}` : '';

    // Manche
    $('potValue').textContent = s.pot;
    $('strikesVis').innerHTML = [0, 1, 2]
      .map((i) => (i < s.strikes ? '✗' : '<span class="off">✗</span>'))
      .join(' ');

    document.querySelectorAll('[data-mult]').forEach((b) => {
      b.classList.toggle('is-active', Number(b.dataset.mult) === s.multiplier);
    });

    // Bouton « cagnotte → famille active »
    const active = s.teams.find((t) => t.id === s.activeTeamId) || null;
    const awardBtn = $('awardActive');
    awardBtn.disabled = s.awarded || !active;
    awardBtn.textContent = active
      ? `💰 Cagnotte → ${active.name}`
      : '💰 Cagnotte → (choisir une famille active)';

    // État du plateau (accueil / en jeu)
    $('plateauState').textContent = s.started ? 'jeu en cours' : "écran d'accueil";
    $('startGame').disabled = !!s.started;

    // Familles (rendu incrémental pour ne pas casser la saisie de nom)
    $('teamsCount').textContent = `${s.teams.length} famille${s.teams.length > 1 ? 's' : ''}`;
    renderTeams(s);
  }

  /* ----------  Rendu incrémental des cartes de familles  ---------- */
  function renderTeams(s) {
    const container = $('teamsList');
    const seen = new Set();
    const canRemove = s.teams.length > MIN_TEAMS;

    s.teams.forEach((t) => {
      seen.add(t.id);
      let c = cards.get(t.id);
      if (!c) {
        c = createCard(t);
        cards.set(t.id, c);
        container.appendChild(c.el);
      }
      c.nameEl.textContent = t.name;
      c.subEl.textContent = teamSubtitle(t);
      c.valEl.textContent = t.score;
      c.el.classList.toggle('is-active', s.activeTeamId === t.id);
      c.award.disabled = s.awarded;
      c.rm.disabled = !canRemove;
      c.rm.style.visibility = canRemove ? 'visible' : 'hidden';
    });

    // Supprime les cartes des familles qui n'existent plus.
    for (const [id, c] of cards) {
      if (!seen.has(id)) {
        c.el.remove();
        cards.delete(id);
      }
    }
  }

  function teamSubtitle(t) {
    const n = (t.members || []).length;
    const membersTxt = `${n} membre${n > 1 ? 's' : ''}`;
    return t.chief ? `👑 ${t.chief} · ${membersTxt}` : membersTxt;
  }

  function createCard(team) {
    const id = team.id;
    const el = document.createElement('div');
    el.className = 'team-ctrl';
    el.dataset.teamId = id;
    el.innerHTML =
      '<div class="team-ctrl__head">' +
      '  <button class="team-open" title="Paramétrer la famille">' +
      '    <span class="team-open__name"></span>' +
      '    <span class="team-open__sub"></span>' +
      '  </button>' +
      '</div>' +
      '<div class="team-ctrl__score">' +
      '  <button class="b b--red" data-delta="-1">−</button>' +
      '  <button class="b" data-delta="-5">−5</button>' +
      '  <span class="val">0</span>' +
      '  <button class="b" data-delta="5">+5</button>' +
      '  <button class="b b--green" data-delta="1">+</button>' +
      '  <button class="b b--gold award" title="Attribuer la cagnotte">💰</button>' +
      '  <button class="b act">Au buzz</button>' +
      '  <button class="b b--red rm" title="Supprimer la famille">✕</button>' +
      '</div>';

    const nameEl = el.querySelector('.team-open__name');
    const subEl = el.querySelector('.team-open__sub');
    const open = el.querySelector('.team-open');
    const valEl = el.querySelector('.val');
    const award = el.querySelector('.award');
    const rm = el.querySelector('.rm');
    const act = el.querySelector('.act');

    open.addEventListener('click', () => openModal(id));
    act.addEventListener('click', () => A('setActiveTeam', { team: id }));
    award.addEventListener('click', () => A('awardPot', { team: id }));
    rm.addEventListener('click', () => {
      const name = nameEl.textContent || 'cette famille';
      if (confirm(`Supprimer « ${name} » ?`)) A('removeTeam', { team: id });
    });

    el.querySelectorAll('[data-delta]').forEach((b) =>
      b.addEventListener('click', () =>
        A('adjustScore', { team: id, delta: Number(b.dataset.delta) })
      )
    );

    return { el, nameEl, subEl, valEl, award, rm, act };
  }

  function toggleReveal(a) {
    A(a.revealed ? 'hide' : 'reveal', { answerId: a.id });
  }

  /* ============================================================
     Modal de paramétrage d'une famille (nom + membres + chef)
     ============================================================ */
  const modal = {
    backdrop: $('modalBackdrop'),
    title: $('modalTitle'),
    name: $('modalName'),
    membersBox: $('modalMembers'),
    teamId: null,
    members: [], // [{ name, chief }]
  };

  function openModal(teamId) {
    if (!state) return;
    const t = state.teams.find((x) => x.id === teamId);
    if (!t) return;
    modal.teamId = teamId;
    modal.title.textContent = `Paramétrer : ${t.name}`;
    modal.name.value = t.name;
    modal.members = (t.members || []).map((m) => ({ name: m, chief: m === t.chief }));
    if (!modal.members.some((m) => m.chief) && t.chief) {
      // chef renseigné mais absent de la liste : on l'ajoute.
      modal.members.push({ name: t.chief, chief: true });
    }
    renderModalMembers();
    modal.backdrop.hidden = false;
    modal.name.focus();
  }

  function closeModal() {
    modal.backdrop.hidden = true;
    modal.teamId = null;
  }

  function renderModalMembers() {
    modal.membersBox.innerHTML = '';
    if (modal.members.length === 0) {
      const p = document.createElement('div');
      p.className = 'modal__empty';
      p.textContent = 'Aucun membre pour l’instant.';
      modal.membersBox.appendChild(p);
      return;
    }
    modal.members.forEach((m, idx) => {
      const row = document.createElement('div');
      row.className = 'member-row';

      const chief = document.createElement('button');
      chief.type = 'button';
      chief.className = 'chief-btn' + (m.chief ? ' is-chief' : '');
      chief.textContent = '👑';
      chief.title = 'Désigner comme chef de famille';
      chief.addEventListener('click', () => {
        const willBeChief = !modal.members[idx].chief;
        modal.members.forEach((mm) => (mm.chief = false));
        modal.members[idx].chief = willBeChief;
        renderModalMembers();
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'member-name';
      input.maxLength = 40;
      input.placeholder = 'Prénom / nom';
      input.value = m.name;
      input.addEventListener('input', () => (modal.members[idx].name = input.value));

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'b b--red';
      rm.textContent = '✕';
      rm.title = 'Retirer ce membre';
      rm.addEventListener('click', () => {
        modal.members.splice(idx, 1);
        renderModalMembers();
      });

      row.append(chief, input, rm);
      modal.membersBox.appendChild(row);
    });
  }

  function addModalMember() {
    modal.members.push({ name: '', chief: false });
    renderModalMembers();
    const inputs = modal.membersBox.querySelectorAll('.member-name');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function saveModal() {
    if (modal.teamId == null) return;
    const names = modal.members.map((m) => m.name.trim()).filter(Boolean);
    const chiefObj = modal.members.find((m) => m.chief && m.name.trim());
    const chief = chiefObj ? chiefObj.name.trim() : '';
    A('setTeamConfig', {
      team: modal.teamId,
      name: modal.name.value,
      members: names,
      chief: chief,
    });
    // Retour visuel : la config est écrite dans SQLite et sera conservée.
    const btn = $('modalSave');
    const original = btn.textContent;
    btn.textContent = '✓ Enregistré';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
      closeModal();
    }, 650);
  }

  $('modalClose').addEventListener('click', closeModal);
  $('modalCancel').addEventListener('click', closeModal);
  $('modalSave').addEventListener('click', saveModal);
  $('modalAddMember').addEventListener('click', addModalMember);
  modal.backdrop.addEventListener('click', (e) => {
    if (e.target === modal.backdrop) closeModal();
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ============================================================
     Câblage des boutons fixes
     ============================================================ */
  $('questionSelect').addEventListener('change', (e) =>
    A('setQuestion', { questionId: Number(e.target.value) })
  );
  $('prevQ').addEventListener('click', () => stepQuestion(-1));
  $('nextQ').addEventListener('click', () => stepQuestion(1));
  $('revealAll').addEventListener('click', () => A('revealAll'));
  $('hideAll').addEventListener('click', () => A('resetRound'));

  $('addStrike').addEventListener('click', () => A('addStrike'));
  $('clearStrikes').addEventListener('click', () => A('clearStrikes'));
  $('resetRound').addEventListener('click', () => A('resetRound'));

  $('awardActive').addEventListener('click', () => {
    if (state && state.activeTeamId != null) A('awardPot', { team: state.activeTeamId });
  });

  document.querySelectorAll('[data-mult]').forEach((b) =>
    b.addEventListener('click', () => A('setMultiplier', { value: Number(b.dataset.mult) }))
  );

  $('addTeam').addEventListener('click', () => A('addTeam'));
  $('clearActive').addEventListener('click', () => A('setActiveTeam', { team: null }));

  $('startGame').addEventListener('click', () => A('start'));
  $('resetHome').addEventListener('click', () => {
    if (
      confirm(
        "Revenir à l'écran d'accueil pour une nouvelle partie ?\n\n" +
          '• Les scores repassent à zéro.\n' +
          '• Les familles, membres et chefs sont CONSERVÉS.'
      )
    ) {
      A('resetGame');
    }
  });

  function stepQuestion(dir) {
    if (!state) return;
    const ids = state.questions.map((q) => q.id);
    const cur = state.question ? state.question.id : ids[0];
    let idx = ids.indexOf(cur);
    idx = Math.max(0, Math.min(ids.length - 1, idx + dir));
    A('setQuestion', { questionId: ids[idx] });
  }

  /* ============================================================
     Raccourcis clavier
     ============================================================ */
  document.addEventListener('keydown', (e) => {
    // Quand la modal est ouverte : Échap ferme, le reste est ignoré (saisie libre).
    if (!modal.backdrop.hidden) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();

    if (k >= '1' && k <= '8' && state && state.question) {
      const pos = Number(k);
      const a = state.question.answers.find((x) => x.position === pos);
      if (a) toggleReveal(a);
      e.preventDefault();
    } else if (k === 'x') {
      A('addStrike');
    } else if (k === 'c') {
      A('clearStrikes');
    } else if (k === 'a') {
      if (state && state.activeTeamId != null && !state.awarded) {
        A('awardPot', { team: state.activeTeamId });
      }
    } else if (k === 'r') {
      A('resetRound');
    } else if (e.key === 'ArrowLeft') {
      stepQuestion(-1);
    } else if (e.key === 'ArrowRight') {
      stepQuestion(1);
    }
  });

  /* ============================================================
     Connexion temps réel
     ============================================================ */
  const statusEl = $('status');
  window.FenOr.connect((s) => {
    statusEl.textContent = 'Connecté';
    statusEl.classList.remove('is-off');
    render(s);
  });

  window.addEventListener('offline', () => {
    statusEl.textContent = 'Hors ligne';
    statusEl.classList.add('is-off');
  });
})();
