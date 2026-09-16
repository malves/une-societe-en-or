'use strict';

/**
 * Catalogue de questions + campagnes de sondage.
 * Séparé du moteur live (db.js) pour ne pas mélanger pupitre et atelier.
 */

const crypto = require('crypto');
const { db, ensureCurrentQuestionValid, refreshQuestionIfCurrent } = require('./db');

const MAX_ANSWERS = 8;
const MONTHS = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

function defaultCampaignName(d = new Date()) {
  return `Sondage ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function cleanText(s, max) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeAnswer(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEmails(input) {
  const parts = String(input || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const p of parts) {
    if (!re.test(p)) {
      invalid.push(p);
      continue;
    }
    if (seen.has(p)) continue;
    seen.add(p);
    valid.push(p);
  }
  return { valid, invalid };
}

function normalizeAnswersInput(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    const label = cleanText(a && a.label, 80);
    if (!label) continue;
    const points = Math.max(0, Math.round(Number(a.points) || 0));
    out.push({ label, points });
    if (out.length >= MAX_ANSWERS) break;
  }
  return out;
}

function replaceAnswers(questionId, answers) {
  db.prepare('DELETE FROM answers WHERE question_id = ?').run(questionId);
  const ins = db.prepare(
    'INSERT INTO answers (question_id, position, label, points) VALUES (?, ?, ?, ?)'
  );
  answers.forEach((a, i) => ins.run(questionId, i + 1, a.label, a.points));
  refreshQuestionIfCurrent(questionId);
}

function getQuestionOrFail(id) {
  const row = db.prepare('SELECT id, text, sort_order, enabled FROM questions WHERE id = ?').get(id);
  if (!row) fail(404, 'Question introuvable');
  return row;
}

function getCampaignOrFail(id) {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!row) fail(404, 'Campagne introuvable');
  return row;
}

function countAnswers(questionId) {
  return db.prepare('SELECT COUNT(*) AS n FROM answers WHERE question_id = ?').get(questionId).n;
}

function listAnswers(questionId) {
  return db
    .prepare(
      'SELECT id, position, label, points FROM answers WHERE question_id = ? ORDER BY position'
    )
    .all(questionId);
}

function questionPayload(row) {
  const answers = listAnswers(row.id);
  return {
    id: row.id,
    text: row.text,
    sortOrder: row.sort_order,
    enabled: !!row.enabled,
    answerCount: answers.length,
    answers,
  };
}

function campaignProgress(campaignId) {
  const total = db
    .prepare('SELECT COUNT(*) AS n FROM campaign_invites WHERE campaign_id = ?')
    .get(campaignId).n;
  const submitted = db
    .prepare(
      `SELECT COUNT(*) AS n FROM campaign_invites WHERE campaign_id = ? AND status = 'submitted'`
    )
    .get(campaignId).n;
  return { total, submitted };
}

function invitePublicUrl(token) {
  return `/sondage.html?t=${encodeURIComponent(token)}`;
}

function serializeInvite(row) {
  return {
    id: row.id,
    email: row.email,
    token: row.token,
    status: row.status,
    submittedAt: row.submitted_at,
    url: invitePublicUrl(row.token),
  };
}

function campaignDetail(id) {
  const c = getCampaignOrFail(id);
  const questions = db
    .prepare(
      `SELECT q.id, q.text, cq.sort_order, cq.published,
              (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) AS answer_count
       FROM campaign_questions cq
       JOIN questions q ON q.id = cq.question_id
       WHERE cq.campaign_id = ?
       ORDER BY cq.sort_order, q.id`
    )
    .all(id)
    .map((r) => ({
      id: r.id,
      text: r.text,
      sortOrder: r.sort_order,
      published: !!r.published,
      answerCount: r.answer_count,
    }));

  const invites = db
    .prepare(
      `SELECT id, email, token, status, submitted_at
       FROM campaign_invites WHERE campaign_id = ? ORDER BY email`
    )
    .all(id)
    .map(serializeInvite);

  const { total, submitted } = campaignProgress(id);
  const pending = invites.filter((i) => i.status !== 'submitted').map((i) => i.email);

  return {
    id: c.id,
    name: c.name,
    status: c.status,
    createdAt: c.created_at,
    questions,
    invites,
    total,
    submitted,
    pending,
  };
}

function submittedCount(campaignId) {
  return campaignProgress(campaignId).submitted;
}

function recalcClusterPoints(campaignId, questionId) {
  const total = submittedCount(campaignId);
  const clusters = db
    .prepare('SELECT id FROM answer_clusters WHERE campaign_id = ? AND question_id = ?')
    .all(campaignId, questionId);
  const countStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM cluster_members WHERE cluster_id = ?'
  );
  const upd = db.prepare('UPDATE answer_clusters SET points = ? WHERE id = ?');
  for (const c of clusters) {
    const n = countStmt.get(c.id).n;
    const pts = total > 0 ? Math.round((n / total) * 100) : 0;
    upd.run(pts, c.id);
  }
}

function clusterBoard(campaignId, questionId) {
  getCampaignOrFail(campaignId);
  const question = getQuestionOrFail(questionId);
  const link = db
    .prepare(
      'SELECT 1 FROM campaign_questions WHERE campaign_id = ? AND question_id = ?'
    )
    .get(campaignId, questionId);
  if (!link) fail(400, 'Cette question ne fait pas partie de la campagne');

  const submitted = submittedCount(campaignId);
  const assignedIds = new Set(
    db
      .prepare(
        `SELECT cm.survey_answer_id AS id
         FROM cluster_members cm
         JOIN answer_clusters ac ON ac.id = cm.cluster_id
         WHERE ac.campaign_id = ? AND ac.question_id = ?`
      )
      .all(campaignId, questionId)
      .map((r) => r.id)
  );

  const raw = db
    .prepare(
      `SELECT sa.id, sa.raw_text, i.email
       FROM survey_answers sa
       JOIN campaign_invites i ON i.id = sa.invite_id
       WHERE i.campaign_id = ? AND i.status = 'submitted' AND sa.question_id = ?
       ORDER BY sa.id`
    )
    .all(campaignId, questionId);

  const groups = new Map();
  for (const row of raw) {
    if (assignedIds.has(row.id)) continue;
    const key = normalizeAnswer(row.raw_text) || `__empty_${row.id}`;
    if (!groups.has(key)) {
      groups.set(key, { key, label: row.raw_text.trim(), count: 0, answers: [] });
    }
    const g = groups.get(key);
    g.count += 1;
    g.answers.push({ id: row.id, text: row.raw_text, email: row.email });
  }

  const ungrouped = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));

  const clusters = db
    .prepare(
      `SELECT id, label, points, sort_order FROM answer_clusters
       WHERE campaign_id = ? AND question_id = ? ORDER BY sort_order, id`
    )
    .all(campaignId, questionId)
    .map((c) => {
      const members = db
        .prepare(
          `SELECT sa.id, sa.raw_text AS text, i.email
           FROM cluster_members cm
           JOIN survey_answers sa ON sa.id = cm.survey_answer_id
           JOIN campaign_invites i ON i.id = sa.invite_id
           WHERE cm.cluster_id = ?
           ORDER BY sa.id`
        )
        .all(c.id);
      return {
        id: c.id,
        label: c.label,
        points: c.points,
        sortOrder: c.sort_order,
        count: members.length,
        members,
      };
    });

  return {
    question: { id: question.id, text: question.text },
    submitted,
    ungrouped,
    clusters,
  };
}

const admin = {
  listQuestions() {
    const rows = db
      .prepare('SELECT id, text, sort_order, enabled FROM questions ORDER BY sort_order, id')
      .all();
    return rows.map(questionPayload);
  },

  getQuestion(id) {
    return questionPayload(getQuestionOrFail(id));
  },

  createQuestion({ text, answers, enabled }) {
    const label = cleanText(text, 200);
    if (!label) fail(400, 'Le texte de la question est obligatoire');
    const ans = normalizeAnswersInput(answers);
    const on = enabled == null ? 0 : enabled ? 1 : 0;
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM questions').get().m;
    const info = db
      .prepare('INSERT INTO questions (text, sort_order, enabled) VALUES (?, ?, ?)')
      .run(label, maxSort + 1, on);
    const id = Number(info.lastInsertRowid);
    if (ans.length) replaceAnswers(id, ans);
    return questionPayload(getQuestionOrFail(id));
  },

  updateQuestion(id, { text, answers, enabled }) {
    getQuestionOrFail(id);
    if (text != null) {
      const label = cleanText(text, 200);
      if (!label) fail(400, 'Le texte de la question est obligatoire');
      db.prepare('UPDATE questions SET text = ? WHERE id = ?').run(label, id);
    }
    if (enabled != null) {
      db.prepare('UPDATE questions SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
      ensureCurrentQuestionValid();
    }
    if (answers != null) {
      replaceAnswers(id, normalizeAnswersInput(answers));
    }
    return questionPayload(getQuestionOrFail(id));
  },

  setEnabled(id, enabled) {
    getQuestionOrFail(id);
    db.prepare('UPDATE questions SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    ensureCurrentQuestionValid();
    return questionPayload(getQuestionOrFail(id));
  },

  reorderQuestions(ids) {
    if (!Array.isArray(ids) || !ids.length) fail(400, 'Liste d’identifiants requise');
    const existing = db.prepare('SELECT id FROM questions').all().map((r) => r.id);
    if (ids.length !== existing.length || new Set(ids.map(Number)).size !== existing.length) {
      fail(400, 'La liste de tri est incomplète');
    }
    const upd = db.prepare('UPDATE questions SET sort_order = ? WHERE id = ?');
    const tx = db.transaction(() => {
      ids.forEach((id, i) => upd.run(i + 1, Number(id)));
    });
    tx();
    return admin.listQuestions();
  },

  deleteQuestion(id) {
    getQuestionOrFail(id);
    db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    ensureCurrentQuestionValid();
    return { ok: true };
  },

  listCampaigns() {
    return db
      .prepare(
        `SELECT c.id, c.name, c.status, c.created_at,
                (SELECT COUNT(*) FROM campaign_invites i WHERE i.campaign_id = c.id) AS total,
                (SELECT COUNT(*) FROM campaign_invites i
                  WHERE i.campaign_id = c.id AND i.status = 'submitted') AS submitted,
                (SELECT COUNT(*) FROM campaign_questions q WHERE q.campaign_id = c.id) AS question_count
         FROM campaigns c
         ORDER BY c.id DESC`
      )
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        createdAt: r.created_at,
        total: r.total,
        submitted: r.submitted,
        questionCount: r.question_count,
      }));
  },

  createCampaign({ name, questionIds }) {
    const ids = [...new Set((questionIds || []).map(Number).filter(Boolean))];
    if (!ids.length) fail(400, 'Sélectionnez au moins une question');
    for (const qid of ids) getQuestionOrFail(qid);
    const label = cleanText(name, 80) || defaultCampaignName();
    const tx = db.transaction(() => {
      const info = db.prepare('INSERT INTO campaigns (name, status) VALUES (?, ?)').run(label, 'collecting');
      const cid = Number(info.lastInsertRowid);
      const ins = db.prepare(
        'INSERT INTO campaign_questions (campaign_id, question_id, sort_order) VALUES (?, ?, ?)'
      );
      ids.forEach((qid, i) => ins.run(cid, qid, i + 1));
      return cid;
    });
    return campaignDetail(tx());
  },

  getCampaign(id) {
    return campaignDetail(id);
  },

  renameCampaign(id, name) {
    getCampaignOrFail(id);
    const label = cleanText(name, 80);
    if (!label) fail(400, 'Le nom est obligatoire');
    db.prepare('UPDATE campaigns SET name = ? WHERE id = ?').run(label, id);
    return campaignDetail(id);
  },

  addInvites(id, emailsInput) {
    const c = getCampaignOrFail(id);
    if (c.status !== 'collecting') {
      fail(400, 'Impossible d’ajouter des personnes : la collecte est clôturée');
    }
    const { valid, invalid } = parseEmails(emailsInput);
    if (!valid.length && !invalid.length) fail(400, 'Saisissez au moins une adresse email');
    const existing = new Set(
      db
        .prepare('SELECT email FROM campaign_invites WHERE campaign_id = ?')
        .all(id)
        .map((r) => r.email)
    );
    const ins = db.prepare(
      'INSERT INTO campaign_invites (campaign_id, email, token, status) VALUES (?, ?, ?, ?)'
    );
    const added = [];
    const skipped = [];
    const tx = db.transaction(() => {
      for (const email of valid) {
        if (existing.has(email)) {
          skipped.push(email);
          continue;
        }
        ins.run(id, email, newToken(), 'pending');
        existing.add(email);
        added.push(email);
      }
    });
    tx();
    return { ...campaignDetail(id), added, skipped, invalid };
  },

  closeCampaign(id) {
    const c = getCampaignOrFail(id);
    if (c.status === 'collecting') {
      db.prepare("UPDATE campaigns SET status = 'clustering' WHERE id = ?").run(id);
    }
    return campaignDetail(id);
  },

  getClusterBoard(campaignId, questionId) {
    return clusterBoard(campaignId, questionId);
  },

  createCluster(campaignId, questionId, label, answerIds) {
    const c = getCampaignOrFail(campaignId);
    if (c.status === 'collecting') fail(400, 'Clôturez d’abord la collecte pour regrouper');
    getQuestionOrFail(questionId);
    const name = cleanText(label, 80);
    if (!name) fail(400, 'Le libellé de la réponse type est obligatoire');
    const n = db
      .prepare(
        'SELECT COUNT(*) AS n FROM answer_clusters WHERE campaign_id = ? AND question_id = ?'
      )
      .get(campaignId, questionId).n;
    if (n >= MAX_ANSWERS) {
      fail(400, `Maximum ${MAX_ANSWERS} réponses type par question (limite du plateau)`);
    }
    const maxSort = db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), 0) AS m FROM answer_clusters
         WHERE campaign_id = ? AND question_id = ?`
      )
      .get(campaignId, questionId).m;
    const info = db
      .prepare(
        'INSERT INTO answer_clusters (campaign_id, question_id, label, points, sort_order) VALUES (?, ?, ?, 0, ?)'
      )
      .run(campaignId, questionId, name, maxSort + 1);
    const clusterId = Number(info.lastInsertRowid);
    if (Array.isArray(answerIds) && answerIds.length) {
      admin.assignToCluster(clusterId, answerIds);
    } else {
      recalcClusterPoints(campaignId, questionId);
    }
    return clusterBoard(campaignId, questionId);
  },

  updateCluster(clusterId, { label, points }) {
    const cluster = db.prepare('SELECT * FROM answer_clusters WHERE id = ?').get(clusterId);
    if (!cluster) fail(404, 'Réponse type introuvable');
    if (label != null) {
      const name = cleanText(label, 80);
      if (!name) fail(400, 'Le libellé est obligatoire');
      db.prepare('UPDATE answer_clusters SET label = ? WHERE id = ?').run(name, clusterId);
    }
    if (points != null) {
      db.prepare('UPDATE answer_clusters SET points = ? WHERE id = ?').run(
        Math.max(0, Math.round(Number(points) || 0)),
        clusterId
      );
    }
    return clusterBoard(cluster.campaign_id, cluster.question_id);
  },

  deleteCluster(clusterId) {
    const cluster = db.prepare('SELECT * FROM answer_clusters WHERE id = ?').get(clusterId);
    if (!cluster) fail(404, 'Réponse type introuvable');
    db.prepare('DELETE FROM answer_clusters WHERE id = ?').run(clusterId);
    recalcClusterPoints(cluster.campaign_id, cluster.question_id);
    return clusterBoard(cluster.campaign_id, cluster.question_id);
  },

  assignToCluster(clusterId, answerIds) {
    const cluster = db.prepare('SELECT * FROM answer_clusters WHERE id = ?').get(clusterId);
    if (!cluster) fail(404, 'Réponse type introuvable');
    const ids = [...new Set((answerIds || []).map(Number).filter(Boolean))];
    if (!ids.length) fail(400, 'Aucune réponse à associer');
    const check = db.prepare(
      `SELECT sa.id FROM survey_answers sa
       JOIN campaign_invites i ON i.id = sa.invite_id
       WHERE sa.id = ? AND i.campaign_id = ? AND sa.question_id = ? AND i.status = 'submitted'`
    );
    const del = db.prepare('DELETE FROM cluster_members WHERE survey_answer_id = ?');
    const ins = db.prepare(
      'INSERT INTO cluster_members (cluster_id, survey_answer_id) VALUES (?, ?)'
    );
    const tx = db.transaction(() => {
      for (const aid of ids) {
        if (!check.get(aid, cluster.campaign_id, cluster.question_id)) {
          fail(400, 'Réponse invalide pour cette question');
        }
        del.run(aid);
        ins.run(clusterId, aid);
      }
    });
    tx();
    recalcClusterPoints(cluster.campaign_id, cluster.question_id);
    return clusterBoard(cluster.campaign_id, cluster.question_id);
  },

  unassignAnswers(campaignId, questionId, answerIds) {
    getCampaignOrFail(campaignId);
    const ids = [...new Set((answerIds || []).map(Number).filter(Boolean))];
    if (!ids.length) fail(400, 'Aucune réponse à retirer');
    const del = db.prepare(
      `DELETE FROM cluster_members
       WHERE survey_answer_id = ?
         AND cluster_id IN (
           SELECT id FROM answer_clusters WHERE campaign_id = ? AND question_id = ?
         )`
    );
    const tx = db.transaction(() => {
      for (const aid of ids) del.run(aid, campaignId, questionId);
    });
    tx();
    recalcClusterPoints(campaignId, questionId);
    return clusterBoard(campaignId, questionId);
  },

  publishQuestion(campaignId, questionId) {
    const c = getCampaignOrFail(campaignId);
    if (c.status === 'collecting') fail(400, 'Clôturez d’abord la collecte');
    getQuestionOrFail(questionId);
    const link = db
      .prepare(
        'SELECT 1 FROM campaign_questions WHERE campaign_id = ? AND question_id = ?'
      )
      .get(campaignId, questionId);
    if (!link) fail(400, 'Cette question ne fait pas partie de la campagne');

    const clusters = db
      .prepare(
        `SELECT ac.id, ac.label, ac.points,
                (SELECT COUNT(*) FROM cluster_members cm WHERE cm.cluster_id = ac.id) AS n
         FROM answer_clusters ac
         WHERE ac.campaign_id = ? AND ac.question_id = ?
         ORDER BY ac.points DESC, n DESC, ac.id`
      )
      .all(campaignId, questionId)
      .filter((r) => r.n > 0)
      .slice(0, MAX_ANSWERS);

    if (!clusters.length) fail(400, 'Créez au moins une réponse type avec des réponses associées');

    replaceAnswers(
      questionId,
      clusters.map((r) => ({ label: r.label, points: r.points }))
    );
    db.prepare('UPDATE questions SET enabled = 1 WHERE id = ?').run(questionId);
    db.prepare(
      'UPDATE campaign_questions SET published = 1 WHERE campaign_id = ? AND question_id = ?'
    ).run(campaignId, questionId);

    const remaining = db
      .prepare(
        'SELECT COUNT(*) AS n FROM campaign_questions WHERE campaign_id = ? AND published = 0'
      )
      .get(campaignId).n;
    if (remaining === 0) {
      db.prepare("UPDATE campaigns SET status = 'published' WHERE id = ?").run(campaignId);
    } else if (c.status !== 'published') {
      db.prepare("UPDATE campaigns SET status = 'clustering' WHERE id = ?").run(campaignId);
    }

    return { campaign: campaignDetail(campaignId), question: questionPayload(getQuestionOrFail(questionId)) };
  },
};

const survey = {
  getByToken(token) {
    const invite = db
      .prepare(
        `SELECT i.*, c.name AS campaign_name, c.status AS campaign_status
         FROM campaign_invites i
         JOIN campaigns c ON c.id = i.campaign_id
         WHERE i.token = ?`
      )
      .get(String(token || ''));
    if (!invite) fail(404, 'Lien invalide');

    if (invite.status === 'submitted') {
      return {
        status: 'submitted',
        campaignName: invite.campaign_name,
        email: invite.email,
      };
    }

    const questions = db
      .prepare(
        `SELECT q.id, q.text, cq.sort_order,
                COALESCE(sa.raw_text, '') AS draft
         FROM campaign_questions cq
         JOIN questions q ON q.id = cq.question_id
         LEFT JOIN survey_answers sa
           ON sa.question_id = q.id AND sa.invite_id = ?
         WHERE cq.campaign_id = ?
         ORDER BY cq.sort_order, q.id`
      )
      .all(invite.id, invite.campaign_id)
      .map((r) => ({ id: r.id, text: r.text, draft: r.draft }));

    return {
      status: invite.status,
      campaignName: invite.campaign_name,
      email: invite.email,
      questions,
    };
  },

  saveAnswer(token, questionId, rawText) {
    const data = survey.getByToken(token);
    if (data.status === 'submitted') fail(400, 'Ce sondage a déjà été validé');
    const invite = db.prepare('SELECT * FROM campaign_invites WHERE token = ?').get(token);
    const qid = Number(questionId);
    if (!data.questions.some((q) => q.id === qid)) fail(400, 'Question hors campagne');
    const text = String(rawText || '').slice(0, 400);
    db.prepare(
      `INSERT INTO survey_answers (invite_id, question_id, raw_text, submitted_in_final)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(invite_id, question_id) DO UPDATE SET raw_text = excluded.raw_text`
    ).run(invite.id, qid, text);
    if (invite.status === 'pending') {
      db.prepare("UPDATE campaign_invites SET status = 'in_progress' WHERE id = ?").run(invite.id);
    }
    return survey.getByToken(token);
  },

  submit(token) {
    const data = survey.getByToken(token);
    if (data.status === 'submitted') fail(400, 'Ce sondage a déjà été validé');
    const missing = (data.questions || []).filter((q) => !cleanText(q.draft, 400));
    if (missing.length) {
      fail(400, 'Répondez à toutes les questions avant de valider');
    }
    const invite = db.prepare('SELECT * FROM campaign_invites WHERE token = ?').get(token);
    const tx = db.transaction(() => {
      db.prepare(
        'UPDATE survey_answers SET submitted_in_final = 1 WHERE invite_id = ?'
      ).run(invite.id);
      db.prepare(
        "UPDATE campaign_invites SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?"
      ).run(invite.id);
    });
    tx();
    return survey.getByToken(token);
  },
};

module.exports = { admin, survey, HttpError, MAX_ANSWERS };
