// Campagne : invitations, suivi, regroupement drag-and-drop, publication.
(function () {
  const api = window.FenOr.api;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const campaignId = Number(params.get('id'));

  let campaign = null;
  let board = null;
  let activeQid = null;
  let pollTimer = null;
  let dragPayload = null;
  let loadGen = 0;

  const STATUS = {
    pending: 'en attente',
    in_progress: 'en cours',
    submitted: 'validé',
  };
  const CAMP = {
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

  function absoluteUrl(path) {
    return location.origin + path;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  async function loadCampaign() {
    const gen = ++loadGen;
    const data = await api('GET', `/api/admin/campaigns/${campaignId}`);
    if (gen !== loadGen) return;
    campaign = data;
    renderCampaign();
    if (campaign.status !== 'collecting') {
      if (!activeQid && campaign.questions[0]) activeQid = campaign.questions[0].id;
      await loadBoard();
    }
  }

  function renderCampaign() {
    const c = campaign;
    $('titleName').textContent = c.name;
    if (document.activeElement !== $('campName')) $('campName').value = c.name;
    const [label, cls] = CAMP[c.status] || [c.status, ''];
    $('statusBadge').textContent = label;
    $('statusBadge').className = 'badge ' + cls;
    $('progress').textContent = `${c.submitted} / ${c.total} ont validé`;
    $('progressHint').textContent = c.total
      ? c.submitted === c.total
        ? 'Tout le monde a répondu.'
        : 'En attente des personnes ci-dessous.'
      : 'Ajoutez des emails pour générer les liens uniques.';

    const pending = $('pendingList');
    pending.innerHTML = '';
    c.pending.forEach((email) => {
      const s = document.createElement('span');
      s.textContent = email;
      pending.appendChild(s);
    });

    const collecting = c.status === 'collecting';
    $('addBox').hidden = !collecting;
    $('btnClose').hidden = !collecting;
    $('btnClose').disabled = c.total === 0;
    $('clusterCard').hidden = collecting;

    const body = $('inviteBody');
    body.innerHTML = '';
    c.invites.forEach((inv) => {
      const url = absoluteUrl(inv.url);
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${escapeHtml(inv.email)}</td>` +
        `<td>${STATUS[inv.status] || inv.status}</td>` +
        `<td class="mono">${escapeHtml(url)}</td>` +
        `<td>` +
        `<div class="btnrow" style="margin:0">` +
        `<button class="b b--ghost copy">Copier</button>` +
        `<a class="b b--ghost" href="mailto:${encodeURIComponent(inv.email)}?subject=${encodeURIComponent('Sondage Famille en OR')}&body=${encodeURIComponent('Voici ton lien unique :\n' + url)}">Mail</a>` +
        `</div></td>`;
      tr.querySelector('.copy').addEventListener('click', async () => {
        const ok = await copyText(url);
        flash(ok ? 'Lien copié' : 'Impossible de copier', ok ? 'ok' : 'err');
      });
      body.appendChild(tr);
    });
  }

  async function loadBoard() {
    if (!activeQid || campaign.status === 'collecting') return;
    board = await api('GET', `/api/admin/campaigns/${campaignId}/questions/${activeQid}/clusters`);
    renderBoard();
  }

  function renderBoard() {
    const tabs = $('qTabs');
    tabs.innerHTML = '';
    campaign.questions.forEach((q) => {
      const b = document.createElement('button');
      b.className = 'tab' + (q.id === activeQid ? ' is-on' : '');
      b.textContent = (q.published ? '✓ ' : '') + q.text;
      b.title = q.text;
      b.addEventListener('click', async () => {
        activeQid = q.id;
        await loadBoard();
      });
      tabs.appendChild(b);
    });

    const ungrouped = $('ungrouped');
    ungrouped.innerHTML = '';
    if (!board.ungrouped.length) {
      ungrouped.innerHTML = '<p class="empty">Toutes les réponses sont regroupées (ou personne n’a encore validé).</p>';
    } else {
      board.ungrouped.forEach((g) => ungrouped.appendChild(pileEl(g)));
    }

    const box = $('clusters');
    box.innerHTML = '';
    if (!board.clusters.length) {
      box.innerHTML = '<p class="empty">Créez une réponse type, puis glissez les variantes dedans.</p>';
    } else {
      board.clusters.forEach((c) => box.appendChild(clusterEl(c)));
    }

    const qMeta = campaign.questions.find((q) => q.id === activeQid);
    $('btnPublish').textContent = qMeta && qMeta.published
      ? 'Republier cette question (remplace le plateau)'
      : 'Publier cette question sur le plateau';
  }

  function pileEl(g, nested) {
    const div = document.createElement('div');
    div.className = nested ? 'chip' : 'pile';
    div.draggable = true;
    div.dataset.ids = JSON.stringify(g.answers.map((a) => a.id));
    const who = g.answers.map((a) => a.email).filter(Boolean).slice(0, 4).join(', ');
    div.innerHTML = nested
      ? `${escapeHtml(g.label || g.text || '')}`
      : `<div class="pile__label">${escapeHtml(g.label)}<span class="pile__count">×${g.count}</span></div>` +
        (who ? `<div class="pile__who">${escapeHtml(who)}</div>` : '');
    bindDrag(div);
    return div;
  }

  function clusterEl(c) {
    const wrap = document.createElement('div');
    wrap.className = 'cluster dropzone';
    wrap.dataset.clusterId = String(c.id);
    wrap.innerHTML =
      `<div class="cluster__head">` +
      `<input type="text" class="lab" maxlength="80" value="${escapeHtml(c.label)}" />` +
      `<input type="number" class="cluster__pts" min="0" max="100" value="${c.points}" title="Points" />` +
      `<button class="b b--ghost save">OK</button>` +
      `<button class="b b--red del">✕</button>` +
      `</div>` +
      `<div class="cluster__members"></div>`;
    const members = wrap.querySelector('.cluster__members');
    c.members.forEach((m) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.draggable = true;
      chip.dataset.ids = JSON.stringify([m.id]);
      chip.title = m.email || '';
      chip.textContent = m.text;
      bindDrag(chip);
      members.appendChild(chip);
    });
    wrap.querySelector('.save').addEventListener('click', async () => {
      try {
        board = await api('PATCH', `/api/admin/clusters/${c.id}`, {
          label: wrap.querySelector('.lab').value,
          points: Number(wrap.querySelector('.cluster__pts').value) || 0,
        });
        renderBoard();
        flash('Réponse type mise à jour', 'ok');
      } catch (err) {
        flash(err.message, 'err');
      }
    });
    wrap.querySelector('.del').addEventListener('click', async () => {
      if (!confirm('Supprimer cette réponse type ? Les réponses redeviennent libres.')) return;
      try {
        board = await api('DELETE', `/api/admin/clusters/${c.id}`);
        renderBoard();
      } catch (err) {
        flash(err.message, 'err');
      }
    });
    bindDrop(wrap, async (ids) => {
      board = await api('POST', `/api/admin/clusters/${c.id}/assign`, { answerIds: ids });
      renderBoard();
    });
    return wrap;
  }

  function bindDrag(el) {
    el.addEventListener('dragstart', (e) => {
      dragPayload = el.dataset.ids;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', el.dataset.ids);
    });
    el.addEventListener('dragend', () => {
      dragPayload = null;
    });
  }

  function bindDrop(el, onDrop) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('is-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-over'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('is-over');
      let ids;
      try {
        ids = JSON.parse(e.dataTransfer.getData('text/plain') || dragPayload || '[]');
      } catch (_) {
        return;
      }
      if (!Array.isArray(ids) || !ids.length) return;
      try {
        await onDrop(ids);
      } catch (err) {
        flash(err.message, 'err');
      }
    });
  }

  bindDrop($('ungrouped'), async (ids) => {
    board = await api('POST', `/api/admin/campaigns/${campaignId}/questions/${activeQid}/unassign`, {
      answerIds: ids,
    });
    renderBoard();
  });

  $('btnRename').addEventListener('click', async () => {
    try {
      campaign = await api('PATCH', `/api/admin/campaigns/${campaignId}`, { name: $('campName').value });
      renderCampaign();
      flash('Nom enregistré', 'ok');
    } catch (err) {
      flash(err.message, 'err');
    }
  });

  $('btnAdd').addEventListener('click', async () => {
    try {
      const res = await api('POST', `/api/admin/campaigns/${campaignId}/invites`, {
        emails: $('emails').value,
      });
      campaign = res;
      $('emails').value = '';
      renderCampaign();
      const bits = [];
      if (res.added && res.added.length) bits.push(`${res.added.length} lien(s) créé(s)`);
      if (res.skipped && res.skipped.length) bits.push(`${res.skipped.length} déjà présent(s)`);
      if (res.invalid && res.invalid.length) bits.push(`ignoré : ${res.invalid.join(', ')}`);
      flash(bits.join(' · ') || 'Aucun email valide', res.added && res.added.length ? 'ok' : 'err');
    } catch (err) {
      flash(err.message, 'err');
    }
  });

  $('btnCopyAll').addEventListener('click', async () => {
    if (!campaign || !campaign.invites.length) return;
    const block = campaign.invites
      .map((inv) => `${inv.email}\n${absoluteUrl(inv.url)}`)
      .join('\n\n');
    const ok = await copyText(block);
    flash(ok ? 'Tous les liens sont copiés' : 'Impossible de copier', ok ? 'ok' : 'err');
  });

  $('btnClose').addEventListener('click', async () => {
    if (!campaign.total) return;
    const remaining = campaign.total - campaign.submitted;
    const msg = remaining
      ? `${remaining} personne(s) n’ont pas encore validé. Clôturer quand même ?\nVous ne pourrez plus ajouter de participants.`
      : 'Clôturer la collecte et passer au regroupement ?';
    if (!confirm(msg)) return;
    stopPoll();
    loadGen += 1;
    try {
      campaign = await api('POST', `/api/admin/campaigns/${campaignId}/close`);
      activeQid = campaign.questions[0] && campaign.questions[0].id;
      renderCampaign();
      await loadBoard();
    } catch (err) {
      flash(err.message, 'err');
    }
  });

  $('btnNewCluster').addEventListener('click', async () => {
    const label = $('newCluster').value.trim();
    if (!label || !activeQid) return;
    try {
      board = await api('POST', `/api/admin/campaigns/${campaignId}/questions/${activeQid}/clusters`, {
        label,
      });
      $('newCluster').value = '';
      renderBoard();
    } catch (err) {
      flash(err.message, 'err');
    }
  });
  $('newCluster').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('btnNewCluster').click();
    }
  });

  $('btnPublish').addEventListener('click', async () => {
    if (!activeQid) return;
    const q = campaign.questions.find((x) => x.id === activeQid);
    const warn = q && q.answerCount
      ? `Publier remplacera les ${q.answerCount} réponses actuelles du plateau pour :\n« ${q.text} »`
      : `Publier cette question sur le plateau ?\n« ${q ? q.text : ''} »`;
    if (!confirm(warn)) return;
    try {
      const res = await api('POST', `/api/admin/campaigns/${campaignId}/questions/${activeQid}/publish`);
      campaign = res.campaign;
      renderCampaign();
      await loadBoard();
      flash('Question publiée sur le plateau', 'ok');
    } catch (err) {
      flash(err.message, 'err');
    }
  });

  async function tick() {
    try {
      await loadCampaign();
      if (!campaign || campaign.status !== 'collecting') stopPoll();
      else if (!pollTimer) startPoll();
    } catch (err) {
      flash(err.message, 'err');
      stopPoll();
    }
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(tick, 4000);
  }
  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  if (!campaignId) {
    flash('Campagne introuvable', 'err');
    return;
  }

  tick().then(() => {
    if (campaign && campaign.status === 'collecting') startPoll();
  });
})();
