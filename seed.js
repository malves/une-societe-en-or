'use strict';

/**
 * Peuplement de la base avec des questions/réponses d'exemple.
 *   node seed.js           -> ne fait rien si des questions existent déjà
 *   node seed.js --force   -> vide et régénère le contenu (garde les scores ? non : reset complet)
 */

const { db, actions } = require('./db');

const FORCE = process.argv.includes('--force');

// Chaque réponse : [libellé, points]. L'ordre = classement (1 = la plus citée).
const QUESTIONS = [
  {
    text: 'Que peut-on faire en cachette de son/sa conjoint(e) ?',
    answers: [
      ['Acheter un cadeau', 17],
      ['Le / la tromper', 11],
      ['Sortir avec des amis', 7],
      ['Boire', 7],
      ["Dépenser de l'argent", 5],
      ['Manger', 4],
      ['Regarder une série sans lui/elle', 3],
      ['Fumer', 2],
    ],
  },
  {
    text: 'Citez quelque chose que l’on trouve toujours dans un bureau.',
    answers: [
      ['Un ordinateur', 30],
      ['Un stylo', 20],
      ['Une chaise', 15],
      ['Une machine à café', 12],
      ['Des dossiers / papiers', 10],
      ['Un téléphone', 8],
      ['Une plante', 5],
    ],
  },
  {
    text: 'Quelle excuse donne-t-on pour arriver en retard au travail ?',
    answers: [
      ['Les transports / embouteillages', 35],
      ["Le réveil n'a pas sonné", 25],
      ['Un problème de voiture', 12],
      ['Les enfants', 10],
      ["J'étais malade", 8],
      ['La grève', 6],
      ['Un rendez-vous médical', 4],
    ],
  },
  {
    text: 'Que fait-on pendant une réunion ennuyeuse ?',
    answers: [
      ['Regarder son téléphone', 28],
      ['Gribouiller / dessiner', 20],
      ['Rêvasser', 15],
      ['Faire semblant de prendre des notes', 12],
      ['Répondre à ses mails', 10],
      ['Somnoler', 8],
      ["Regarder l'heure", 7],
    ],
  },
  {
    text: 'Citez un aliment que l’on mange avec les doigts.',
    answers: [
      ['Les frites', 30],
      ['La pizza', 22],
      ['Les chips', 14],
      ['Le poulet', 12],
      ['Le hamburger', 10],
      ['Les cacahuètes', 7],
      ['Les sushis', 5],
    ],
  },
  {
    text: 'Quel objet oublie-t-on le plus souvent en partant de chez soi ?',
    answers: [
      ['Les clés', 32],
      ['Le téléphone', 26],
      ['Le portefeuille', 16],
      ['Les lunettes', 8],
      ['Le chargeur', 7],
      ['Le parapluie', 6],
      ['Les papiers', 5],
    ],
  },
  {
    text: 'Citez une chose que l’on fait le vendredi soir.',
    answers: [
      ['Sortir / faire la fête', 30],
      ['Regarder un film ou une série', 22],
      ['Aller au restaurant', 15],
      ['Boire un verre', 12],
      ['Se reposer', 10],
      ['Voir des amis', 6],
      ['Faire les courses', 5],
    ],
  },
  {
    text: 'Qu’est-ce qui rend une soirée d’entreprise réussie ?',
    answers: [
      ['La bonne ambiance', 28],
      ['Le buffet / la nourriture', 22],
      ['La musique', 16],
      ['Les boissons', 12],
      ['Les jeux et animations', 10],
      ['Des collègues sympas', 7],
      ['Les cadeaux', 5],
    ],
  },
];

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM questions').get().n;

  if (count > 0 && !FORCE) {
    console.log(`La base contient déjà ${count} question(s). Utilisez "npm run reset" pour régénérer.`);
    return;
  }

  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM campaigns').run();
    db.prepare('DELETE FROM answers').run();
    db.prepare('DELETE FROM questions').run();
    db.prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('questions','answers','campaigns','campaign_invites','survey_answers','answer_clusters')"
    ).run();
  });

  const insertQ = db.prepare('INSERT INTO questions (text, sort_order) VALUES (?, ?)');
  const insertA = db.prepare(
    'INSERT INTO answers (question_id, position, label, points) VALUES (?, ?, ?, ?)'
  );

  const fill = db.transaction(() => {
    QUESTIONS.forEach((question, qi) => {
      const info = insertQ.run(question.text, qi + 1);
      const qid = info.lastInsertRowid;
      question.answers.forEach((a, ai) => {
        insertA.run(qid, ai + 1, a[0], a[1]);
      });
    });
  });

  if (FORCE) wipe();
  fill();

  // Sélectionne la première question et remet la manche à zéro.
  const first = db.prepare('SELECT id FROM questions ORDER BY sort_order, id LIMIT 1').get();
  if (FORCE) actions.resetGame();
  if (first) actions.setQuestion(first.id);

  const n = db.prepare('SELECT COUNT(*) AS n FROM questions').get().n;
  console.log(`✔ Base peuplée : ${n} questions.`);
}

seed();
