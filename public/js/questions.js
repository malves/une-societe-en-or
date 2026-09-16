// Atelier : catalogue des questions + création de campagnes.
(function () {
  const api = window.FenOr.api;
  const $ = (id) => document.getElementById(id);

  let questions = [];
  let campaigns = [];
  let selected = new Set();
  let editingId = null;
  let dragId = null;

  const STATUS = {
    collecting: ['collecte', 'badge--collect'],
    clustering: ['regroupement', 'badge--cluster'],
    published: ['publié', 'badge--done'],
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function flash(msg, kind) {
    const el = $('flash');
    el.textContent = msg || '';
    el.className = 'flash' + (kind === 'err' ? ' is-err' : kind === 'ok' ? ' is-ok' : '');
  }

  async function load() {
    try {
      const [q, c] = await Promise.all([
        api('GET', '/api/admin/questions'),
        api('GET', '/api/admin/campaigns'),
      ]);
      questions = q;
      campaigns = c;
      selected = new Set([...selected].filter((id) => questions.some((x) => x.id === id)));
      renderQuestions();
      renderCampaigns();
    } catch (err) {
      flash(err.message, 'err');
    }
  }

  function renderQuestions() {
    const box = $('qList');
    if (!questions.length) {
      box.innerHTML = '<p class="empty">Aucune question. Créez-en une pour commencer.</p>';
      $('btnCampaign').disabled = true;
      return;
    }
    box.innerHTML = '';
    questions.forEach((q) => {
      const row = document.createElement('div');
      row.className = 'q-row';
      row.draggable = true;
      row.dataset.id = String(q.id);
      row.innerHTML =
        `<span class="q-row__handle" title="Glisser pour trier">☰</span>` +
        `<input type="checkbox" class="q-check" ${selected.has(q.id) ? 'checked' : ''} aria-label="Sélectionner pour une campagne" />` +
        `<div class="q-row__text" title="${escapeHtml(q.text)}"><div class="q-row__title">${escapeHtml(q.text)}</div><span class="q-row__meta">${q.answerCount} rép.</span></div>` +
        `<label class="switch" title="Afficher dans le jeu"><input type="checkbox" class="q-on" ${q.enabled ? 'checked' : ''} /><span></span></label>` +
        `<div class="q-row__actions">` +
        `<button class="b b--ghost q-edit">Éditer</button>` +
        `<button class="b b--red q-del">Suppr.</button>` +
        `</div>`;

      row.querySelector('.q-check').addEventListener('change', (e) => {
        if (e.target.checked) selected.add(q.id);
        else selected.delete(q.id);
        $('btnCampaign').disabled = selected.size === 0;
        $('btnCampaign').textContent =
          selected.size > 0 ? `Créer une campagne (${selected.size})` : 'Créer une campagne';
      });
      row.querySelector('.q-on').addEventListener('change', async (e) => {
        try {
          await api('POST', `/api/admin/questions/${q.id}/enabled`, { enabled: e.target.checked });
          await load();
        } catch (err) {
          flash(err.message, 'err');
        }
      });
      row.querySelector('.q-edit').addEventListener('click', () => openModal(q));
      row.querySelector('.q-del').addEventListener('click', () => removeQuestion(q));

      row.addEventListener('dragstart', (e) => {
        dragId = q.id;
        row.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(q.id));
      });
      row.addEventListener('dragend', () => {
        dragId = null;
        row.classList.remove('is-dragging');
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/plain') || dragId);
        const to = q.id;
        if (!from || from === to) return;
        const ids = questions.map((x) => x.id);
        const fromIdx = ids.indexOf(from);
        const toIdx = ids.indexOf(to);
        if (fromIdx < 0 || toIdx < 0) return;
        ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, from);
        try {
          await api('POST', '/api/admin/questions/reorder', { ids });
          await load();
        } catch (err) {
          flash(err.message, 'err');
        }
      });

      box.appendChild(row);
    });
    $('btnCampaign').disabled = selected.size === 0;
    $('btnCampaign').textContent =
      selected.size > 0 ? `Créer une campagne (${selected.size})` : 'Créer une campagne';
  }

  function renderCampaigns() {
    const box = $('cList');
    if (!campaigns.length) {
      box.innerHTML = '<p class="empty">Aucune campagne pour le moment.</p>';
      return;
    }
    box.innerHTML = '';
    campaigns.forEach((c) => {
      const [label, cls] = STATUS[c.status] || [c.status, ''];
      const a = document.createElement('a');
      a.className = 'camp-row';
      a.href = `campagne.html?id=${c.id}`;
      a.innerHTML =
        `<span class="camp-row__name">${escapeHtml(c.name)}</span>` +
        `<span class="badge ${cls}">${label}</span>` +
        `<span class="camp-row__stat">${c.submitted} / ${c.total} · ${c.questionCount} q.</span>`;
      box.appendChild(a);
    });
  }

  function answerRow(label, points) {
    const div = document.createElement('div');
    div.className = 'ans-edit__row';
    div.innerHTML =
      `<input type="text" class="lab" maxlength="80" placeholder="Libellé" value="${escapeHtml(label || '')}" />` +
      `<input type="number" class="pts" min="0" max="100" value="${points || 0}" />` +
      `<button type="button" class="b b--ghost rm">✕</button>`;
    div.querySelector('.rm').addEventListener('click', () => div.remove());
    return div;
  }

  function openModal(q) {
    editingId = q ? q.id : null;
    $('modalTitle').textContent = q ? 'Éditer la question' : 'Nouvelle question';
    $('modalText').value = q ? q.text : '';
    $('modalEnabled').checked = q ? !!q.enabled : false;
    const box = $('modalAnswers');
    box.innerHTML = '';
    const answers = q && q.answers ? q.answers : [];
    answers.forEach((a) => box.appendChild(answerRow(a.label, a.points)));
    $('modalBackdrop').hidden = false;
    $('modalText').focus();
  }

  function closeModal() {
    $('modalBackdrop').hidden = true;
    editingId = null;
  }

  function collectAnswers() {
    return [...$('modalAnswers').querySelectorAll('.ans-edit__row')].map((row) => ({
      label: row.querySelector('.lab').value,
      points: Number(row.querySelector('.pts').value) || 0,
    }));
  }

  async function saveQuestion() {
    const payload = {
      text: $('modalText').value,
      answers: collectAnswers(),
      enabled: $('modalEnabled').checked,
    };
    try {
      if (editingId) await api('PUT', `/api/admin/questions/${editingId}`, payload);
      else await api('POST', '/api/admin/questions', payload);
      closeModal();
      flash('Enregistré', 'ok');
      await load();
    } catch (err) {
      flash(err.message, 'err');
    }
  }

  async function removeQuestion(q) {
    if (!confirm(`Supprimer la question ?\n\n« ${q.text} »`)) return;
    try {
      await api('DELETE', `/api/admin/questions/${q.id}`);
      selected.delete(q.id);
      flash('Question supprimée', 'ok');
      await load();
    } catch (err) {
      flash(err.message, 'err');
    }
  }

  $('btnNew').addEventListener('click', () => openModal(null));
  $('modalClose').addEventListener('click', closeModal);
  $('modalCancel').addEventListener('click', closeModal);
  $('modalSave').addEventListener('click', saveQuestion);
  $('modalAddAns').addEventListener('click', () => {
    if ($('modalAnswers').children.length >= 8) return;
    $('modalAnswers').appendChild(answerRow('', 0));
  });
  $('modalBackdrop').addEventListener('click', (e) => {
    if (e.target === $('modalBackdrop')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modalBackdrop').hidden) closeModal();
  });

  $('btnCampaign').addEventListener('click', async () => {
    const ids = questions.filter((q) => selected.has(q.id)).map((q) => q.id);
    if (!ids.length) return;
    try {
      const camp = await api('POST', '/api/admin/campaigns', { questionIds: ids });
      location.href = `campagne.html?id=${camp.id}`;
    } catch (err) {
      flash(err.message, 'err');
    }
  });

  load();
})();
