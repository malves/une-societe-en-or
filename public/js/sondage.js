// Parcours participant : une réponse libre par question, brouillon, validation unique.
(function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const screen = document.getElementById('screen');

  let data = null;
  let index = 0;
  let saving = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Erreur');
    return json;
  }

  function showError(msg) {
    screen.innerHTML = `<p class="msg error">${escapeHtml(msg)}</p>`;
  }

  function showThanks() {
    screen.innerHTML =
      `<p class="thanks">Merci !</p>` +
      `<p class="msg">Tes réponses sont envoyées. Tu ne peux plus les modifier.</p>`;
  }

  function currentDraft() {
    const q = data.questions[index];
    return q ? q.draft : '';
  }

  function render() {
    if (!data || data.status === 'submitted') {
      showThanks();
      return;
    }
    const qs = data.questions || [];
    if (!qs.length) {
      showError('Aucune question dans ce sondage.');
      return;
    }
    index = Math.max(0, Math.min(index, qs.length - 1));
    const q = qs[index];
    const last = index === qs.length - 1;
    const pct = Math.round(((index + 1) / qs.length) * 100);

    screen.innerHTML =
      `<p class="step">${escapeHtml(data.campaignName || 'Sondage')} · Question ${index + 1} / ${qs.length}</p>` +
      `<div class="bar"><span style="width:${pct}%"></span></div>` +
      `<h1>${escapeHtml(q.text)}</h1>` +
      `<textarea id="answer" maxlength="400" placeholder="Ta réponse…">${escapeHtml(q.draft || '')}</textarea>` +
      `<div class="actions">` +
      `<button class="ghost" id="prev" ${index === 0 ? 'disabled' : ''}>Précédent</button>` +
      (last
        ? `<button class="primary" id="next">Valider mes réponses</button>`
        : `<button class="primary" id="next">Suivant</button>`) +
      `</div>` +
      `<p class="msg" id="hint" style="margin-top:14px"></p>`;

    const ta = document.getElementById('answer');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    document.getElementById('prev').addEventListener('click', async () => {
      await persist();
      index -= 1;
      render();
    });
    document.getElementById('next').addEventListener('click', async () => {
      const text = ta.value.trim();
      if (!text) {
        document.getElementById('hint').textContent = 'Écris une réponse pour continuer.';
        ta.focus();
        return;
      }
      await persist();
      if (last) {
        if (!confirm('Valider définitivement ? Tu ne pourras plus modifier tes réponses.')) return;
        try {
          data = await api('POST', `/api/survey/${encodeURIComponent(token)}/submit`);
          showThanks();
        } catch (err) {
          document.getElementById('hint').textContent = err.message;
        }
        return;
      }
      index += 1;
      render();
    });
  }

  async function persist() {
    if (!data || data.status === 'submitted' || saving) return;
    const q = data.questions[index];
    const ta = document.getElementById('answer');
    if (!q || !ta) return;
    const text = ta.value;
    if (text === (q.draft || '')) return;
    saving = true;
    try {
      data = await api('POST', `/api/survey/${encodeURIComponent(token)}/answer`, {
        questionId: q.id,
        text,
      });
    } catch (err) {
      const hint = document.getElementById('hint');
      if (hint) hint.textContent = err.message;
    } finally {
      saving = false;
    }
  }

  window.addEventListener('beforeunload', () => {
    const ta = document.getElementById('answer');
    if (!ta || !data || data.status === 'submitted') return;
    const q = data.questions[index];
    if (!q) return;
    navigator.sendBeacon(
      `/api/survey/${encodeURIComponent(token)}/answer`,
      new Blob([JSON.stringify({ questionId: q.id, text: ta.value })], { type: 'application/json' })
    );
  });

  if (!token) {
    showError('Lien invalide.');
    return;
  }

  api('GET', `/api/survey/${encodeURIComponent(token)}`)
    .then((d) => {
      data = d;
      if (d.status === 'submitted') showThanks();
      else {
        const firstEmpty = (d.questions || []).findIndex((q) => !String(q.draft || '').trim());
        index = firstEmpty >= 0 ? firstEmpty : 0;
        render();
      }
    })
    .catch((err) => showError(err.message || 'Lien invalide.'));
})();
