'use strict';

/**
 * Couche base de données (SQLite via better-sqlite3).
 * - Contenu : questions + réponses (avec points).
 * - État live de la partie : une seule ligne (singleton).
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'game.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ----------  Schéma  ---------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    position    INTEGER NOT NULL,          -- 1..8 (emplacement sur le plateau)
    label       TEXT NOT NULL,
    points      INTEGER NOT NULL,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS game_state (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    current_question_id INTEGER,
    revealed            TEXT    NOT NULL DEFAULT '[]',  -- JSON : ids de réponses révélées
    strikes             INTEGER NOT NULL DEFAULT 0,     -- 0..3
    active_team         INTEGER,                        -- 0, 1 ou NULL
    multiplier          INTEGER NOT NULL DEFAULT 1,     -- x1, x2, x3
    awarded             INTEGER NOT NULL DEFAULT 0,     -- cagnotte déjà attribuée ?
    started             INTEGER NOT NULL DEFAULT 0,     -- jeu lancé (0 = écran d'accueil) ?
    active_team_id      INTEGER,                        -- id de la famille active (buzz)
    team1_name          TEXT    NOT NULL DEFAULT 'Équipe A',
    team1_score         INTEGER NOT NULL DEFAULT 0,
    team2_name          TEXT    NOT NULL DEFAULT 'Équipe B',
    team2_score         INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS teams (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    score      INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    members    TEXT    NOT NULL DEFAULT '[]',   -- JSON : liste des prénoms/noms des membres
    chief      TEXT    NOT NULL DEFAULT ''       -- nom du chef de famille (parmi les membres)
  );
`);

// Migrations pour les bases créées avant l'ajout de certaines colonnes.
const stateCols = db.prepare('PRAGMA table_info(game_state)').all().map((c) => c.name);
if (!stateCols.includes('started')) {
  db.exec("ALTER TABLE game_state ADD COLUMN started INTEGER NOT NULL DEFAULT 0");
}
if (!stateCols.includes('active_team_id')) {
  db.exec("ALTER TABLE game_state ADD COLUMN active_team_id INTEGER");
}

// Migration : colonnes membres/chef sur les familles.
const teamCols = db.prepare('PRAGMA table_info(teams)').all().map((c) => c.name);
if (!teamCols.includes('members')) {
  db.exec("ALTER TABLE teams ADD COLUMN members TEXT NOT NULL DEFAULT '[]'");
}
if (!teamCols.includes('chief')) {
  db.exec("ALTER TABLE teams ADD COLUMN chief TEXT NOT NULL DEFAULT ''");
}

// Questions : visible ou non dans le jeu (pupitre / plateau).
const questionCols = db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name);
if (!questionCols.includes('enabled')) {
  db.exec('ALTER TABLE questions ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'collecting',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaign_questions (
    campaign_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    published   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (campaign_id, question_id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS campaign_invites (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id  INTEGER NOT NULL,
    email        TEXT    NOT NULL,
    token        TEXT    NOT NULL UNIQUE,
    status       TEXT    NOT NULL DEFAULT 'pending',
    submitted_at TEXT,
    UNIQUE (campaign_id, email),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS survey_answers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id           INTEGER NOT NULL,
    question_id         INTEGER NOT NULL,
    raw_text            TEXT    NOT NULL DEFAULT '',
    submitted_in_final  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (invite_id, question_id),
    FOREIGN KEY (invite_id) REFERENCES campaign_invites(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS answer_clusters (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    label       TEXT    NOT NULL,
    points      INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cluster_members (
    cluster_id       INTEGER NOT NULL,
    survey_answer_id INTEGER NOT NULL UNIQUE,
    PRIMARY KEY (cluster_id, survey_answer_id),
    FOREIGN KEY (cluster_id) REFERENCES answer_clusters(id) ON DELETE CASCADE,
    FOREIGN KEY (survey_answer_id) REFERENCES survey_answers(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_invites_token ON campaign_invites(token);
  CREATE INDEX IF NOT EXISTS idx_survey_invite ON survey_answers(invite_id);
  CREATE INDEX IF NOT EXISTS idx_clusters_q ON answer_clusters(campaign_id, question_id);
`);

// Assure l'existence de la ligne d'état unique.
db.prepare(`INSERT OR IGNORE INTO game_state (id) VALUES (1)`).run();

// Familles par défaut : 2 au minimum si la table est vide.
if (db.prepare('SELECT COUNT(*) AS n FROM teams').get().n === 0) {
  const ins = db.prepare('INSERT INTO teams (name, score, sort_order) VALUES (?, ?, ?)');
  ins.run('Famille 1', 0, 1);
  ins.run('Famille 2', 0, 2);
}

/* ----------  Requêtes préparées  ---------- */
const q = {
  getStateRow: db.prepare(`SELECT * FROM game_state WHERE id = 1`),
  listQuestions: db.prepare(
    `SELECT id, text FROM questions WHERE enabled = 1 ORDER BY sort_order, id`
  ),
  getQuestion: db.prepare(`SELECT id, text, sort_order FROM questions WHERE id = ?`),
  getAnswers: db.prepare(
    `SELECT id, position, label, points FROM answers WHERE question_id = ? ORDER BY position`
  ),
  firstQuestion: db.prepare(
    `SELECT id FROM questions WHERE enabled = 1 ORDER BY sort_order, id LIMIT 1`
  ),
  listTeams: db.prepare(`SELECT id, name, score, members, chief FROM teams ORDER BY sort_order, id`),
  countTeams: db.prepare(`SELECT COUNT(*) AS n FROM teams`),
  maxSort: db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM teams`),
  insertTeam: db.prepare(`INSERT INTO teams (name, score, sort_order) VALUES (?, ?, ?)`),
  deleteTeam: db.prepare(`DELETE FROM teams WHERE id = ?`),
  teamExists: db.prepare(`SELECT id FROM teams WHERE id = ?`),
  updTeamName: db.prepare(`UPDATE teams SET name = ? WHERE id = ?`),
  setTeamConfig: db.prepare(`UPDATE teams SET name = ?, members = ?, chief = ? WHERE id = ?`),
  addTeamScore: db.prepare(`UPDATE teams SET score = score + ? WHERE id = ?`),
  setTeamScore: db.prepare(`UPDATE teams SET score = ? WHERE id = ?`),
  resetTeamScores: db.prepare(`UPDATE teams SET score = 0`),
};

/* ----------  Lecture de l'état complet  ---------- */
function getState() {
  const s = q.getStateRow.get();
  const revealed = new Set(JSON.parse(s.revealed || '[]'));

  let question = null;
  let pot = 0;

  if (s.current_question_id) {
    const qu = q.getQuestion.get(s.current_question_id);
    if (qu) {
      const answers = q.getAnswers.get
        ? q.getAnswers.all(s.current_question_id)
        : [];
      const mapped = answers.map((a) => {
        const isRevealed = revealed.has(a.id);
        if (isRevealed) pot += a.points;
        return {
          id: a.id,
          position: a.position,
          label: a.label,
          points: a.points,
          revealed: isRevealed,
        };
      });
      question = { id: qu.id, text: qu.text, answers: mapped };
    }
  }

  pot = pot * (s.multiplier || 1);

  return {
    question,
    pot,
    started: !!s.started,
    strikes: s.strikes,
    multiplier: s.multiplier,
    activeTeamId: s.active_team_id,
    awarded: !!s.awarded,
    teams: q.listTeams.all().map((t) => ({
      id: t.id,
      name: t.name,
      score: t.score,
      members: safeArray(t.members),
      chief: t.chief || '',
    })),
    questions: q.listQuestions.all(),
  };
}

function safeArray(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

/* ----------  Mutations  ---------- */
const upd = {
  setQuestionField: db.prepare(
    `UPDATE game_state SET current_question_id = ?, revealed = '[]', strikes = 0, multiplier = 1, awarded = 0 WHERE id = 1`
  ),
  setRevealed: db.prepare(`UPDATE game_state SET revealed = ? WHERE id = 1`),
  setStrikes: db.prepare(`UPDATE game_state SET strikes = ? WHERE id = 1`),
  setActiveTeam: db.prepare(`UPDATE game_state SET active_team_id = ? WHERE id = 1`),
  setMultiplier: db.prepare(`UPDATE game_state SET multiplier = ? WHERE id = 1`),
  setAwarded: db.prepare(`UPDATE game_state SET awarded = ? WHERE id = 1`),
  setStarted: db.prepare(`UPDATE game_state SET started = ? WHERE id = 1`),
  resetRound: db.prepare(
    `UPDATE game_state SET revealed = '[]', strikes = 0, multiplier = 1, awarded = 0 WHERE id = 1`
  ),
  resetGameState: db.prepare(
    `UPDATE game_state SET current_question_id = NULL, revealed = '[]', strikes = 0, multiplier = 1, awarded = 0, started = 0, active_team_id = NULL WHERE id = 1`
  ),
};

function currentRevealedSet() {
  const s = q.getStateRow.get();
  return new Set(JSON.parse(s.revealed || '[]'));
}

const actions = {
  setQuestion(questionId) {
    upd.setQuestionField.run(questionId || null);
  },

  reveal(answerId) {
    const set = currentRevealedSet();
    set.add(Number(answerId));
    upd.setRevealed.run(JSON.stringify([...set]));
  },

  hide(answerId) {
    const set = currentRevealedSet();
    set.delete(Number(answerId));
    upd.setRevealed.run(JSON.stringify([...set]));
  },

  revealAll() {
    const s = q.getStateRow.get();
    if (!s.current_question_id) return;
    const ids = q.getAnswers.all(s.current_question_id).map((a) => a.id);
    upd.setRevealed.run(JSON.stringify(ids));
  },

  setStrikes(n) {
    upd.setStrikes.run(Math.max(0, Math.min(3, Number(n) || 0)));
  },

  addStrike() {
    const s = q.getStateRow.get();
    upd.setStrikes.run(Math.min(3, s.strikes + 1));
  },

  clearStrikes() {
    upd.setStrikes.run(0);
  },

  start() {
    upd.setStarted.run(1);
  },

  goHome() {
    upd.setStarted.run(0);
  },

  setActiveTeam(teamId) {
    if (teamId === null || teamId === undefined || teamId === '') {
      upd.setActiveTeam.run(null);
      return;
    }
    const id = Number(teamId);
    upd.setActiveTeam.run(q.teamExists.get(id) ? id : null);
  },

  setMultiplier(m) {
    upd.setMultiplier.run(Math.max(1, Math.min(3, Number(m) || 1)));
  },

  awardPot(teamId) {
    const state = getState();
    if (state.awarded) return; // évite la double attribution
    const id = Number(teamId);
    if (!q.teamExists.get(id)) return;
    q.addTeamScore.run(state.pot, id);
    upd.setAwarded.run(1);
  },

  adjustScore(teamId, delta) {
    q.addTeamScore.run(Number(delta) || 0, Number(teamId));
  },

  setScore(teamId, val) {
    q.setTeamScore.run(Math.max(0, Number(val) || 0), Number(teamId));
  },

  setName(teamId, name) {
    const clean = String(name || '').slice(0, 40).trim();
    q.updTeamName.run(clean || 'Famille', Number(teamId));
  },

  // Paramétrage complet d'une famille : nom + membres + chef.
  setTeamConfig(teamId, name, members, chief) {
    const id = Number(teamId);
    if (!q.teamExists.get(id)) return;
    const cleanName = String(name || '').slice(0, 40).trim() || 'Famille';
    const arr = Array.isArray(members)
      ? members.map((m) => String(m || '').slice(0, 40).trim()).filter(Boolean).slice(0, 40)
      : [];
    const cleanChief = String(chief || '').slice(0, 40).trim();
    const chiefFinal = arr.includes(cleanChief) ? cleanChief : '';
    q.setTeamConfig.run(cleanName, JSON.stringify(arr), chiefFinal, id);
  },

  addTeam(name) {
    const nextSort = q.maxSort.get().m + 1;
    const label = String(name || '').slice(0, 40).trim() || `Famille ${nextSort}`;
    const info = q.insertTeam.run(label, 0, nextSort);
    return info.lastInsertRowid;
  },

  removeTeam(teamId) {
    // On garde au moins 1 famille.
    if (q.countTeams.get().n <= 1) return;
    const id = Number(teamId);
    const s = q.getStateRow.get();
    if (s.active_team_id === id) upd.setActiveTeam.run(null);
    q.deleteTeam.run(id);
  },

  resetRound() {
    upd.resetRound.run();
  },

  // Remet les scores à zéro (garde les familles et leurs noms).
  resetScores() {
    q.resetTeamScores.run();
  },

  resetGame() {
    upd.resetGameState.run();
    q.resetTeamScores.run();
    const first = q.firstQuestion.get();
    if (first) upd.setQuestionField.run(first.id);
  },
};

function ensureCurrentQuestionValid() {
  const s = q.getStateRow.get();
  if (!s.current_question_id) {
    const first = q.firstQuestion.get();
    if (first) upd.setQuestionField.run(first.id);
    return;
  }
  const row = db.prepare('SELECT id, enabled FROM questions WHERE id = ?').get(s.current_question_id);
  if (!row || !row.enabled) {
    const first = q.firstQuestion.get();
    upd.setQuestionField.run(first ? first.id : null);
  }
}

function refreshQuestionIfCurrent(questionId) {
  const s = q.getStateRow.get();
  if (s.current_question_id === Number(questionId)) {
    upd.setQuestionField.run(Number(questionId));
  }
}

module.exports = {
  db,
  getState,
  actions,
  ensureCurrentQuestionValid,
  refreshQuestionIfCurrent,
};

ensureCurrentQuestionValid();
