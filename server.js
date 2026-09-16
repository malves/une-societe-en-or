'use strict';

/**
 * Serveur du jeu « Famille en OR ».
 * - Sert le front (dossier public/).
 * - Expose une API d'état + d'actions.
 * - Diffuse les changements en temps réel via SSE (Server-Sent Events).
 */

const path = require('path');
const express = require('express');
const { getState, actions } = require('./db');
const { admin, survey, HttpError } = require('./content');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   Temps réel : Server-Sent Events
   ============================================================ */
const clients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify(getState())}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // État initial immédiat.
  res.write(`data: ${JSON.stringify(getState())}\n\n`);
  clients.add(res);

  // Ping périodique pour garder la connexion ouverte.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

/* ============================================================
   Lecture de l'état
   ============================================================ */
app.get('/api/state', (req, res) => {
  res.json(getState());
});

/* ============================================================
   Actions de jeu
   Chaque action modifie l'état puis diffuse à tous les écrans.
   ============================================================ */
const handlers = {
  start: () => actions.start(),
  goHome: () => actions.goHome(),
  setQuestion: (b) => actions.setQuestion(b.questionId),
  reveal: (b) => actions.reveal(b.answerId),
  hide: (b) => actions.hide(b.answerId),
  revealAll: () => actions.revealAll(),
  addStrike: () => actions.addStrike(),
  setStrikes: (b) => actions.setStrikes(b.value),
  clearStrikes: () => actions.clearStrikes(),
  setActiveTeam: (b) => actions.setActiveTeam(b.team),
  setMultiplier: (b) => actions.setMultiplier(b.value),
  awardPot: (b) => actions.awardPot(b.team),
  adjustScore: (b) => actions.adjustScore(b.team, b.delta),
  setScore: (b) => actions.setScore(b.team, b.value),
  setName: (b) => actions.setName(b.team, b.name),
  setTeamConfig: (b) => actions.setTeamConfig(b.team, b.name, b.members, b.chief),
  addTeam: (b) => actions.addTeam(b.name),
  removeTeam: (b) => actions.removeTeam(b.team),
  resetScores: () => actions.resetScores(),
  resetRound: () => actions.resetRound(),
  resetGame: () => actions.resetGame(),
};

app.post('/api/action/:name', (req, res) => {
  const handler = handlers[req.params.name];
  if (!handler) {
    return res.status(404).json({ error: `Action inconnue : ${req.params.name}` });
  }
  try {
    handler(req.body || {});
    broadcast();
    res.json(getState());
  } catch (err) {
    console.error(`Erreur action ${req.params.name} :`, err);
    res.status(500).json({ error: err.message });
  }
});

function handleApi(res, fn, { notify = false } = {}) {
  try {
    const data = fn();
    if (notify) broadcast();
    res.json(data);
  } catch (err) {
    if (err instanceof HttpError || err.status) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}

/* ============================================================
   Atelier : questions
   ============================================================ */
app.get('/api/admin/questions', (req, res) => handleApi(res, () => admin.listQuestions()));

app.post('/api/admin/questions', (req, res) => {
  handleApi(res, () => admin.createQuestion(req.body || {}), { notify: true });
});

app.get('/api/admin/questions/:id', (req, res) => {
  handleApi(res, () => admin.getQuestion(Number(req.params.id)));
});

app.put('/api/admin/questions/:id', (req, res) => {
  handleApi(res, () => admin.updateQuestion(Number(req.params.id), req.body || {}), {
    notify: true,
  });
});

app.delete('/api/admin/questions/:id', (req, res) => {
  handleApi(res, () => admin.deleteQuestion(Number(req.params.id)), { notify: true });
});

app.post('/api/admin/questions/reorder', (req, res) => {
  handleApi(res, () => admin.reorderQuestions((req.body || {}).ids), { notify: true });
});

app.post('/api/admin/questions/:id/enabled', (req, res) => {
  handleApi(res, () => admin.setEnabled(Number(req.params.id), !!(req.body || {}).enabled), {
    notify: true,
  });
});

/* ============================================================
   Atelier : campagnes
   ============================================================ */
app.get('/api/admin/campaigns', (req, res) => handleApi(res, () => admin.listCampaigns()));

app.post('/api/admin/campaigns', (req, res) => {
  handleApi(res, () => admin.createCampaign(req.body || {}));
});

app.get('/api/admin/campaigns/:id', (req, res) => {
  handleApi(res, () => admin.getCampaign(Number(req.params.id)));
});

app.patch('/api/admin/campaigns/:id', (req, res) => {
  handleApi(res, () => admin.renameCampaign(Number(req.params.id), (req.body || {}).name));
});

app.post('/api/admin/campaigns/:id/invites', (req, res) => {
  handleApi(res, () => admin.addInvites(Number(req.params.id), (req.body || {}).emails));
});

app.post('/api/admin/campaigns/:id/close', (req, res) => {
  handleApi(res, () => admin.closeCampaign(Number(req.params.id)));
});

app.get('/api/admin/campaigns/:id/questions/:qid/clusters', (req, res) => {
  handleApi(res, () => admin.getClusterBoard(Number(req.params.id), Number(req.params.qid)));
});

app.post('/api/admin/campaigns/:id/questions/:qid/clusters', (req, res) => {
  const b = req.body || {};
  handleApi(res, () =>
    admin.createCluster(Number(req.params.id), Number(req.params.qid), b.label, b.answerIds)
  );
});

app.patch('/api/admin/clusters/:id', (req, res) => {
  handleApi(res, () => admin.updateCluster(Number(req.params.id), req.body || {}));
});

app.delete('/api/admin/clusters/:id', (req, res) => {
  handleApi(res, () => admin.deleteCluster(Number(req.params.id)));
});

app.post('/api/admin/clusters/:id/assign', (req, res) => {
  handleApi(res, () => admin.assignToCluster(Number(req.params.id), (req.body || {}).answerIds));
});

app.post('/api/admin/campaigns/:id/questions/:qid/unassign', (req, res) => {
  handleApi(res, () =>
    admin.unassignAnswers(Number(req.params.id), Number(req.params.qid), (req.body || {}).answerIds)
  );
});

app.post('/api/admin/campaigns/:id/questions/:qid/publish', (req, res) => {
  handleApi(res, () => admin.publishQuestion(Number(req.params.id), Number(req.params.qid)), {
    notify: true,
  });
});

/* ============================================================
   Sondage participant (lien unique)
   ============================================================ */
app.get('/api/survey/:token', (req, res) => {
  handleApi(res, () => survey.getByToken(req.params.token));
});

app.post('/api/survey/:token/answer', (req, res) => {
  const b = req.body || {};
  handleApi(res, () => survey.saveAnswer(req.params.token, b.questionId, b.text));
});

app.post('/api/survey/:token/submit', (req, res) => {
  handleApi(res, () => survey.submit(req.params.token));
});

/* ============================================================
   Démarrage
   ============================================================ */
app.listen(PORT, () => {
  console.log('');
  console.log('  🎬  Famille en OR — serveur démarré');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Plateau (à projeter) : http://localhost:${PORT}/plateau.html`);
  console.log(`  Pupitre animateur    : http://localhost:${PORT}/controle.html`);
  console.log(`  Questions / sondages : http://localhost:${PORT}/questions.html`);
  console.log(`  Accueil / scores     : http://localhost:${PORT}/`);
  console.log('');
});
