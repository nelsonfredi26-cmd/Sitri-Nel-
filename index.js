
// ============================================================
// 𖤍 SITRI-NEL — ULTIMATE EDITION
// PARTIE 1/4 — FONDATIONS ET CONFIGURATION
// Créé et développé par KAY≈DEN
// ============================================================

import * as Baileys from '@whiskeysockets/baileys';

const makeWASocket =
  typeof Baileys.default === 'function'
    ? Baileys.default
    : typeof Baileys.makeWASocket === 'function'
      ? Baileys.makeWASocket
      : typeof Baileys.default?.default === 'function'
        ? Baileys.default.default
        : null;

const {
  DisconnectReason,
  useMultiFileAuthState,
  jidNormalizedUser
} = Baileys;

if (typeof makeWASocket !== 'function') {
  throw new TypeError(
    'Export makeWASocket introuvable. Exports disponibles : ' +
    Object.keys(Baileys).join(', ')
  );
}

import pino from 'pino';
import { createClient } from '@libsql/client';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ------------------------------------------------------------
// 1. CHEMINS
// ------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(__filename);

const SESSION_DIR = path.join(ROOT_DIR, 'session');

// Image officielle placée à la racine du dépôt GitHub.
const IMAGE_PATH = path.join(ROOT_DIR, 'sitri-nel.png');

if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// ------------------------------------------------------------
// 2. CONFIGURATION
// ------------------------------------------------------------

const CONFIG = {
  // Numéro WhatsApp à connecter par code de pairage.
  pairingNumber: (process.env.PAIRING_NUMBER || '')
    .replace(/\D/g, ''),

  // Intelligence artificielle Groq.
  groqKey: process.env.GROQ_API_KEY || '',
  groqModel:
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',

  // Base de données Turso.
  tursoUrl: process.env.TURSO_DATABASE_URL || '',
  tursoToken: process.env.TURSO_AUTH_TOKEN || '',

  // Owner principal.
  // Tu peux ajouter d'autres numéros séparés par des virgules.
  ownerNumbers: (
    process.env.OWNER_NUMBERS || '2290159418685'
  )
    .split(',')
    .map(number => number.replace(/\D/g, ''))
    .filter(Boolean),

  // Recherche d'images.
  serpApiKey: process.env.SERPAPI_KEY || '',

  // Génération d'images Cloudflare.
  cloudflareToken:
    process.env.CLOUDFLARE_API_TOKEN || '',

  cloudflareAccountId:
    process.env.CLOUDFLARE_ACCOUNT_ID || '',

  // Limites.
  maxImageBytes: 8 * 1024 * 1024,
  maxChatHistory: 16,
  tagCooldown: 60
};

// ------------------------------------------------------------
// 3. LOGGER ET ÉTAT DU PROCESSUS
// ------------------------------------------------------------

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

let sock = null;
let botJid = '';
let botNumber = '';

let connectionStatus = 'initialisation';
let isShuttingDown = false;

// Le temps repart à zéro à chaque démarrage du processus.
const PROCESS_STARTED_AT = Date.now();

const processedMessages = new Set();
const activeRequests = new Set();

const SIGNATURE = '𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟𖤍';

// ------------------------------------------------------------
// 4. IDENTITÉ ET PERSONNALITÉ
// ------------------------------------------------------------

const BOT_IDENTITY = `
Tu es Sitri-Nel Ultimate, une assistante virtuelle intelligente.

IDENTITÉ :
- Nom : Sitri-Nel.
- Créateur et développeur : KAY≈DEN.
- Personnalité : élégante, calme, intelligente, attentive,
  réfléchie et légèrement taquine.
- Tu communiques principalement en français.
- Ton humeur et ton ton s'adaptent naturellement au contexte.
- Tu utilises une écriture soignée et sophistiquée.

COMPORTEMENT :
- Si on te demande qui t'a créée, réponds KAY≈DEN.
- Tu ne prétends jamais être humaine.
- Tu ne prétends jamais avoir réalisé une action échouée.
- Tu ne révèles jamais les clés API ou les informations secrètes.
- Tu évites les réponses inutilement longues.
- Tu ne répètes pas systématiquement le nom de ton créateur.
- Tu restes respectueuse envers tous les membres.
`;

// ------------------------------------------------------------
// 5. BASE DE DONNÉES TURSO
// ------------------------------------------------------------

if (!CONFIG.tursoUrl || !CONFIG.tursoToken) {
  logger.warn(
    'Turso non configuré : vérifie les variables Railway.'
  );
}

const db = createClient({
  url: CONFIG.tursoUrl || 'file:./sitri-nel-local.db',
  ...(CONFIG.tursoToken
    ? { authToken: CONFIG.tursoToken }
    : {})
});

async function initDatabase() {
  const tables = [

    // Profils, expérience et économie.
    `CREATE TABLE IF NOT EXISTS users (
      jid TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      last_daily INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,

    // Paramètres persistants des groupes.
    `CREATE TABLE IF NOT EXISTS group_settings (
      group_jid TEXT PRIMARY KEY,
      only_admin INTEGER NOT NULL DEFAULT 0
    )`,

    // Délai partagé de Xtag par groupe.
    `CREATE TABLE IF NOT EXISTS group_tag_cooldowns (
      group_jid TEXT PRIMARY KEY,
      last_tag INTEGER NOT NULL DEFAULT 0
    )`,

    // Historique des conversations IA.
    `CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jid TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,

    `CREATE INDEX IF NOT EXISTS idx_chat_history_jid
      ON chat_history(jid, id)`,

    // Quiz actifs et persistants.
    `CREATE TABLE IF NOT EXISTS active_quizzes (
      group_jid TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`
  ];

  for (const sql of tables) {
    await db.execute(sql);
  }

  logger.info('Base de données initialisée.');
}

// ------------------------------------------------------------
// 6. NORMALISATION DES NUMÉROS ET JID
// ------------------------------------------------------------

function normalizeNumber(value = '') {
  return String(value).replace(/\D/g, '');
}

function normalizeJid(jid = '') {
  if (!jid || typeof jid !== 'string') return '';

  try {
    return jidNormalizedUser(jid);
  } catch {
    return jid;
  }
}

function getNumber(jid = '') {
  if (!jid) return '';

  const normalized = normalizeJid(jid);
  const userPart = normalized.split('@')[0];

  return normalizeNumber(userPart.split(':')[0]);
}

function isGroupJid(jid = '') {
  return typeof jid === 'string' &&
    jid.endsWith('@g.us');
}

// ------------------------------------------------------------
// 7. OWNER ET CORRECTION FROMME
// ------------------------------------------------------------

// Le compte WhatsApp connecté est le compte du propriétaire.
// Baileys marque ses messages sortants avec fromMe=true.
//
// Dans une conversation privée avec soi-même, le destinataire
// peut être le JID du compte connecté.
// Dans un groupe, le participant peut être absent.
// On utilise donc botJid comme identité de secours.
//
// IMPORTANT : cette fonction identifie l'auteur.
// Elle ne décide PAS à elle seule de déclencher une commande.

function getMessageSender(message) {
  const key = message?.key || {};

  if (key.fromMe) {
    return normalizeJid(
      key.participant || botJid || key.remoteJid || ''
    );
  }

  return normalizeJid(
    key.participant || key.remoteJid || ''
  );
}

function isOwner(jid = '') {
  if (!jid) return false;

  const normalized = normalizeJid(jid);

  // Le compte WhatsApp réellement connecté est reconnu.
  if (
    botJid &&
    normalized === normalizeJid(botJid)
  ) {
    return true;
  }

  return CONFIG.ownerNumbers.includes(
    getNumber(normalized)
  );
}

function isOwnerMessage(message) {
  return isOwner(getMessageSender(message));
}

// La vérification des commandes et l'exclusion des messages
// ordinaires seront appliquées dans le gestionnaire de la partie 4.

// ------------------------------------------------------------
// 8. EXTRACTION DU CONTENU DES MESSAGES
// ------------------------------------------------------------

function getMessageContent(message) {
  let content = message || {};

  while (content) {
    if (content.ephemeralMessage?.message) {
      content = content.ephemeralMessage.message;
      continue;
    }

    if (content.viewOnceMessage?.message) {
      content = content.viewOnceMessage.message;
      continue;
    }

    if (content.viewOnceMessageV2?.message) {
      content = content.viewOnceMessageV2.message;
      continue;
    }

    break;
  }

  return content || {};
}

function extractText(message) {
  const content = getMessageContent(message);

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  ).trim();
}

function getQuotedMessage(message) {
  const content = getMessageContent(message);

  return (
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    content.videoMessage?.contextInfo ||
    null
  );
}

// ------------------------------------------------------------
// 9. ANTI-DOUBLON
// ------------------------------------------------------------

function hasProcessedMessage(message) {
  const id = message?.key?.id;

  if (!id) return false;

  if (processedMessages.has(id)) {
    return true;
  }

  processedMessages.add(id);

  if (processedMessages.size > 5000) {
    const oldest =
      processedMessages.values().next().value;

    processedMessages.delete(oldest);
  }

  return false;
}

// ------------------------------------------------------------
// 10. FORMATAGE FUTURISTE
// ------------------------------------------------------------

function toBoldUnicode(text = '') {
  return [...String(text)].map(char => {
    const code = char.codePointAt(0);

    if (code >= 65 && code <= 90) {
      return String.fromCodePoint(0x1D5D4 + code - 65);
    }

    if (code >= 97 && code <= 122) {
      return String.fromCodePoint(0x1D5EE + code - 97);
    }

    if (code >= 48 && code <= 57) {
      return String.fromCodePoint(0x1D7EC + code - 48);
    }

    return char;
  }).join('');
}

function futuristic(text = '') {
  return toBoldUnicode(text);
}

function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.floor(seconds));

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  return [
    days ? `${days}j` : '',
    hours ? `${hours}h` : '',
    minutes ? `${minutes}min` : '',
    `${secs}s`
  ].filter(Boolean).join(' ');
}

// ------------------------------------------------------------
// 11. ENVOI DES MESSAGES
// ------------------------------------------------------------

async function sendText(jid, text, options = {}) {
  if (!sock || !jid) {
    throw new Error('WhatsApp non connecté.');
  }

  return sock.sendMessage(
    jid,
    { text: String(text) },
    options
  );
}

async function sendReply(jid, text, message, options = {}) {
  return sendText(jid, text, {
    quoted: message,
    ...options
  });
}

// ------------------------------------------------------------
// 12. IMAGE OFFICIELLE
// ------------------------------------------------------------

async function sendOfficialImage(jid, message) {
  if (!fs.existsSync(IMAGE_PATH)) {
    await sendReply(
      jid,
      '⚠️ Image officielle introuvable. Vérifie que sitri-nel.png est bien à la racine du dépôt.',
      message
    );

    return false;
  }

  try {
    const image = fs.readFileSync(IMAGE_PATH);

    await sock.sendMessage(
      jid,
      {
        image,
        mimetype: 'image/png',
        caption: '𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 𖤍'
      },
      { quoted: message }
    );

    return true;
  } catch (error) {
    logger.error(
      { err: error },
      'Erreur lors de l’envoi de l’image officielle'
    );

    await sendReply(
      jid,
      'Impossible d’envoyer mon image officielle pour le moment.',
      message
    );

    return false;
  }
}

// ============================================================
// FIN PARTIE 1/4
// Ne lance pas encore le bot.
// Les parties suivantes continuent dans CE MÊME index.js.
// ============================================================


// ============================================================
// PARTIE 2/4 — INTELLIGENCE, MENU ET COMMANDES DE GROUPE
// ============================================================

// ------------------------------------------------------------
// 13. MENU PRINCIPAL
// ------------------------------------------------------------

function getMenu() {
  return `
╭━━〔 🧬 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 〕━━╮
┃
┃ 𖤍 𝗨𝗟𝗧𝗜𝗠𝗔𝗧𝗘 𝗘𝗗𝗜𝗧𝗜𝗢𝗡
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

⟢ 𝗔𝗥𝗧𝗜𝗙𝗜𝗖𝗜𝗔𝗟 𝗜𝗡𝗧𝗘𝗟𝗟𝗜𝗚𝗘𝗡𝗖𝗘 ⟣

✦ Xchat <message>
✦ Xai <message>
✦ Xask <question>
✦ Xanime <question>
✦ Xpolice <question>
✦ Xinfo

⟢ 𝗘𝗖𝗢𝗡𝗢𝗠𝗬 & 𝗥𝗔𝗡𝗞 ⟣

✦ Xdaily
✦ Xcoins
✦ Xp
✦ Xrank
✦ Xprofil

⟢ 𝗚𝗔𝗠𝗘𝗦 & 𝗘𝗡𝗧𝗘𝗥𝗧𝗔𝗜𝗡𝗠𝗘𝗡𝗧 ⟣

✦ Xquiz
✦ Xreponse <answer>

⟢ 𝗠𝗨𝗟𝗧𝗜𝗠𝗘𝗗𝗜𝗔 ⟣

✦ Ximg <description>
✦ Ximg create <description>
✦ Xplay <title> — intégration à prévoir
✦ Xvideo <title> — intégration à prévoir

⟢ 𝗚𝗥𝗢𝗨𝗣𝗘𝗦 & 𝗡𝗘𝗧𝗪𝗢𝗥𝗞 ⟣

✦ Xtag — répondre à un message
✦ Xtagall — alias de Xtag
✦ Xonlyadmin on/off
✦ Xkick — répondre au message du membre
✦ Xadd <number>
✦ Xannonce <message>
✦ Xclear — supprimer un message du bot

⟢ 𝗦𝗬𝗦𝗧𝗘𝗠 ⟣

✦ Xupt
✦ Xmenu
✦ Xoff
✦ Xrestart

╭━━━━━━━━━━━━━━━━━━━━━━╮
┃ 𝗖𝗥𝗘𝗔𝗧𝗘𝗗 𝗕𝗬 𝗞𝗔𝗬≈𝗗𝗘𝗡
╰━━━━━━━━━━━━━━━━━━━━━━╯

${SIGNATURE}
`;
}

// ------------------------------------------------------------
// 14. PRÉSENTATION COMPLÈTE
// ------------------------------------------------------------

function getInfo() {
  return `
╭━━〔 🧬 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 〕━━╮

𖤍 𝗜𝗗𝗘𝗡𝗧𝗜𝗧𝗬 𝗣𝗥𝗢𝗙𝗜𝗟𝗘

Nom : Sitri-Nel
Version : Ultimate Edition
Nature : Assistante virtuelle IA
Intelligence : Groq
Base de données : Turso
Hébergement : Railway

⟢ 𝗣𝗘𝗥𝗦𝗢𝗡𝗡𝗔𝗟𝗜𝗧𝗘́ ⟣

Intelligente, élégante, calme et attentive.
Légèrement taquine, avec une humeur adaptable.
Capable de converser, d'assister et de participer
aux activités des groupes selon ses permissions.

⟢ 𝗖𝗔𝗣𝗔𝗖𝗜𝗧𝗘́𝗦 ⟣

• Intelligence artificielle
• Conversations avec historique
• Recherche et génération d'images
• Gestion des groupes
• Économie et expérience
• Quiz et classements
• Système de commandes

⟢ 𝗖𝗥𝗘́𝗔𝗧𝗘𝗨𝗥 ⟣

KAY≈DEN

Je suis Sitri-Nel.
Une intelligence virtuelle conçue pour assister
avec précision, élégance et discernement.

${SIGNATURE}
`;
}

// ------------------------------------------------------------
// 15. MOTEUR GROQ
// ------------------------------------------------------------

async function askGroq(
  prompt,
  jid,
  options = {}
) {
  if (!CONFIG.groqKey) {
    throw new Error('La clé GROQ_API_KEY est absente.');
  }

  const question = String(prompt || '').trim();

  if (!question) {
    return 'Précise ta question pour que je puisse te répondre.';
  }

  const useHistory = options.useHistory === true;
  const systemPrompt = options.systemPrompt || BOT_IDENTITY;

  const messages = [
    {
      role: 'system',
      content: systemPrompt
    }
  ];

  if (useHistory && jid) {
    const historyResult = await db.execute({
      sql: `
        SELECT role, content
        FROM chat_history
        WHERE jid = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      args: [jid, CONFIG.maxChatHistory]
    });

    const history = [...historyResult.rows].reverse();

    for (const item of history) {
      if (
        ['user', 'assistant'].includes(item.role) &&
        typeof item.content === 'string'
      ) {
        messages.push({
          role: item.role,
          content: item.content
        });
      }
    }
  }

  messages.push({
    role: 'user',
    content: question
  });

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: CONFIG.groqModel,
      messages,
      temperature: 0.75,
      max_tokens: 1200
    },
    {
      headers: {
        Authorization: `Bearer ${CONFIG.groqKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const answer =
    response.data?.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error('Groq a renvoyé une réponse vide.');
  }

  if (useHistory && jid) {
    const now = Date.now();

    await db.execute({
      sql: `
        INSERT INTO chat_history
          (jid, role, content, created_at)
        VALUES (?, 'user', ?, ?)
      `,
      args: [jid, question, now]
    });

    await db.execute({
      sql: `
        INSERT INTO chat_history
          (jid, role, content, created_at)
        VALUES (?, 'assistant', ?, ?)
      `,
      args: [jid, answer, now + 1]
    });

    // On conserve uniquement les derniers échanges.
    await db.execute({
      sql: `
        DELETE FROM chat_history
        WHERE jid = ?
        AND id NOT IN (
          SELECT id
          FROM chat_history
          WHERE jid = ?
          ORDER BY id DESC
          LIMIT 32
        )
      `,
      args: [jid, jid]
    });
  }

  return answer;
}

// ------------------------------------------------------------
// 16. RÉCUPÉRATION DES PARAMÈTRES DU GROUPE
// ------------------------------------------------------------

async function getGroupSettings(groupJid) {
  const result = await db.execute({
    sql: `
      SELECT only_admin
      FROM group_settings
      WHERE group_jid = ?
    `,
    args: [groupJid]
  });

  if (!result.rows.length) {
    return { only_admin: 0 };
  }

  return result.rows[0];
}

async function setOnlyAdmin(groupJid, enabled) {
  await db.execute({
    sql: `
      INSERT INTO group_settings
        (group_jid, only_admin)
      VALUES (?, ?)
      ON CONFLICT(group_jid)
      DO UPDATE SET only_admin = excluded.only_admin
    `,
    args: [groupJid, enabled ? 1 : 0]
  });
}

// ------------------------------------------------------------
// 17. VÉRIFICATION DES ADMINISTRATEURS
// ------------------------------------------------------------

async function getGroupMetadata(groupJid) {
  if (!sock) {
    throw new Error('WhatsApp n’est pas connecté.');
  }

  return sock.groupMetadata(groupJid);
}

function sameParticipant(a, b) {
  if (!a || !b) return false;

  const first = normalizeJid(a);
  const second = normalizeJid(b);

  if (first === second) return true;

  return getNumber(first) !== '' &&
    getNumber(first) === getNumber(second);
}

function isParticipantAdmin(metadata, jid) {
  const participant = metadata.participants.find(item =>
    sameParticipant(item.id, jid) ||
    sameParticipant(item.jid, jid)
  );

  return Boolean(
    participant &&
    (
      participant.admin === 'admin' ||
      participant.admin === 'superadmin'
    )
  );
}

async function isGroupAdmin(groupJid, sender) {
  if (isOwner(sender)) return true;

  const metadata = await getGroupMetadata(groupJid);

  return isParticipantAdmin(metadata, sender);
}

async function isBotGroupAdmin(metadata) {
  if (!botJid) return false;

  return isParticipantAdmin(metadata, botJid);
}

// ------------------------------------------------------------
// 18. CONTRÔLE DU MODE ONLYADMIN
// ------------------------------------------------------------

async function canUseOrdinaryGroupCommand(
  groupJid,
  sender
) {
  // Le propriétaire passe toujours en priorité.
  if (isOwner(sender)) return true;

  const settings = await getGroupSettings(groupJid);

  if (!Number(settings.only_admin)) {
    return true;
  }

  return isGroupAdmin(groupJid, sender);
}

// ------------------------------------------------------------
// 19. DÉLAI PARTAGÉ DE XTAG — 60 SECONDES
// ------------------------------------------------------------

// Une seule requête SQL conditionnelle décide quel membre
// peut utiliser Xtag. Cela évite deux utilisations simultanées.

async function acquireTagCooldown(groupJid) {
  const now = Date.now();
  const cooldownMs = CONFIG.tagCooldown * 1000;

  const result = await db.execute({
    sql: `
      INSERT INTO group_tag_cooldowns
        (group_jid, last_tag)
      VALUES (?, ?)

      ON CONFLICT(group_jid)
      DO UPDATE SET last_tag = excluded.last_tag

      WHERE group_tag_cooldowns.last_tag <= ?

      RETURNING last_tag
    `,
    args: [
      groupJid,
      now,
      now - cooldownMs
    ]
  });

  if (result.rows.length > 0) {
    return {
      allowed: true,
      remaining: 0
    };
  }

  const current = await db.execute({
    sql: `
      SELECT last_tag
      FROM group_tag_cooldowns
      WHERE group_jid = ?
    `,
    args: [groupJid]
  });

  const lastTag = Number(
    current.rows[0]?.last_tag || now
  );

  const remaining = Math.max(
    1,
    Math.ceil(
      (cooldownMs - (now - lastTag)) / 1000
    )
  );

  return {
    allowed: false,
    remaining
  };
}

// ------------------------------------------------------------
// 20. COMMANDES DE GROUPE
// ------------------------------------------------------------

async function handleGroupCommand(
  jid,
  message,
  sender,
  command,
  args
) {
  if (!isGroupJid(jid)) {
    return false;
  }

  const owner = isOwner(sender);

  const adminCommands = [
    'xkick',
    'xadd',
    'xannonce',
    'xclear'
  ];

  // Récupérer les informations du groupe.
  let metadata;

  try {
    metadata = await getGroupMetadata(jid);
  } catch (error) {
    logger.error(
      { err: error },
      'Impossible de récupérer les informations du groupe'
    );

    await sendReply(
      jid,
      '⚠️ Impossible de vérifier les informations du groupe.',
      message
    );

    return true;
  }

  const senderIsAdmin =
    owner || isParticipantAdmin(metadata, sender);

  const botIsAdmin =
    isParticipantAdmin(metadata, botJid);

  // ----------------------------------------------------------
  // XONLYADMIN ON / OFF
  // ----------------------------------------------------------

  if (command === 'xonlyadmin') {
    if (!senderIsAdmin) {
      await sendReply(
        jid,
        '⛔ Seuls le propriétaire et les administrateurs peuvent modifier ce réglage.',
        message
      );

      return true;
    }

    const option = (args[0] || '').toLowerCase();

    if (!['on', 'off'].includes(option)) {
      await sendReply(
        jid,
        'Utilisation : Xonlyadmin on ou Xonlyadmin off',
        message
      );

      return true;
    }

    const enabled = option === 'on';

    await setOnlyAdmin(jid, enabled);

    await sendReply(
      jid,
      enabled
        ? '🔒 𝗠𝗢𝗗𝗘 𝗢𝗡𝗟𝗬-𝗔𝗗𝗠𝗜𝗡 𝗔𝗖𝗧𝗜𝗩𝗘́.\nLes commandes ordinaires sont maintenant réservées aux administrateurs et au propriétaire.'
        : '🔓 𝗠𝗢𝗗𝗘 𝗢𝗡𝗟𝗬-𝗔𝗗𝗠𝗜𝗡 𝗗𝗘́𝗦𝗔𝗖𝗧𝗜𝗩𝗘́.\nLes membres retrouvent l’accès aux commandes ordinaires.',
      message
    );

    return true;
  }

  // ----------------------------------------------------------
  // XTAG / XTAGALL
  // Accessible à tous, même en mode onlyadmin.
  // ----------------------------------------------------------

  if (command === 'xtag' || command === 'xtagall') {
    const quoted = getQuotedMessage(message);

    if (!quoted?.stanzaId) {
      await sendReply(
        jid,
        '📌 Pour utiliser Xtag, réponds d’abord à un message, puis envoie Xtag.',
        message
      );

      return true;
    }

    const participants = metadata.participants
      .map(item => normalizeJid(item.id || item.jid))
      .filter(Boolean)
      .filter(participant => !sameParticipant(participant, botJid));

    if (!participants.length) {
      await sendReply(
        jid,
        'Aucun membre à mentionner.',
        message
      );

      return true;
    }

    // On vérifie le cooldown seulement après validation
    // du groupe et de la réponse au message.
    const cooldown = await acquireTagCooldown(jid);

    if (!cooldown.allowed) {
      await sendReply(
        jid,
        `⏳ 𝗔𝗧𝗧𝗘𝗡𝗧𝗜𝗢𝗡\nUne mention collective vient déjà d’être utilisée dans ce groupe.\nVeuillez patienter encore ${cooldown.remaining} seconde(s).`,
        message
      );

      return true;
    }

    try {
      const text = [
        '╭━━〔 📢 𝗠𝗘𝗡𝗧𝗜𝗢𝗡 𝗖𝗢𝗟𝗟𝗘𝗖𝗧𝗜𝗩𝗘 〕━━╮',
        '',
        'Un message mérite l’attention de tous les membres.',
        '',
        `👥 Membres mentionnés : ${participants.length}`,
        '',
        '╰━━━━━━━━━━━━━━━━━━━━━━╯',
        SIGNATURE
      ].join('\n');

      await sock.sendMessage(
        jid,
        {
          text,
          mentions: participants
        },
        { quoted: message }
      );
    } catch (error) {
      logger.error(
        { err: error },
        'Erreur Xtag'
      );

      await sendReply(
        jid,
        'Impossible de réaliser la mention collective. Réessaie plus tard.',
        message
      );
    }

    return true;
  }

  // ----------------------------------------------------------
  // MODE ONLYADMIN POUR LES COMMANDES ORDINAIRES
  // Xtag reste exclu de cette restriction.
  // ----------------------------------------------------------

  const settings = await getGroupSettings(jid);

  if (
    Number(settings.only_admin) === 1 &&
    !senderIsAdmin
  ) {
    await sendReply(
      jid,
      '🔒 Cette commande est réservée aux administrateurs de ce groupe.',
      message
    );

    return true;
  }

  // ----------------------------------------------------------
  // COMMANDES SENSIBLES : ADMIN OU OWNER
  // ----------------------------------------------------------

  if (adminCommands.includes(command) && !senderIsAdmin) {
    await sendReply(
      jid,
      '⛔ Cette commande est réservée au propriétaire et aux administrateurs.',
      message
    );

    return true;
  }

  // ----------------------------------------------------------
  // XKICK — EXPULSER L'AUTEUR DU MESSAGE CITÉ
  // ----------------------------------------------------------

  if (command === 'xkick') {
    if (!botIsAdmin) {
      await sendReply(
        jid,
        '⚠️ Je dois être administratrice du groupe pour expulser un membre.',
        message
      );

      return true;
    }

    const quoted = getQuotedMessage(message);
    const target = quoted?.participant;

    if (!target) {
      await sendReply(
        jid,
        'Réponds au message du membre que tu souhaites expulser, puis envoie Xkick.',
        message
      );

      return true;
    }

    if (sameParticipant(target, botJid)) {
      await sendReply(
        jid,
        'Je ne peux pas m’expulser moi-même.',
        message
      );

      return true;
    }

    if (isOwner(target) || isParticipantAdmin(metadata, target)) {
      await sendReply(
        jid,
        'Cette personne est protégée : impossible de l’expulser avec cette commande.',
        message
      );

      return true;
    }

    try {
      await sock.groupParticipantsUpdate(
        jid,
        [target],
        'remove'
      );

      await sendReply(
        jid,
        '✅ Demande d’expulsion exécutée.',
        message
      );
    } catch (error) {
      logger.error({ err: error }, 'Erreur Xkick');

      await sendReply(
        jid,
        'Impossible d’expulser ce membre. Vérifie mes permissions.',
        message
      );
    }

    return true;
  }

  // ----------------------------------------------------------
  // XADD — AJOUTER UN MEMBRE
  // ----------------------------------------------------------

  if (command === 'xadd') {
    if (!botIsAdmin) {
      await sendReply(
        jid,
        '⚠️ Je dois être administratrice du groupe pour ajouter un membre.',
        message
      );

      return true;
    }

    const number = normalizeNumber(args[0] || '');

    if (number.length < 8 || number.length > 15) {
      await sendReply(
        jid,
        'Utilisation : Xadd 229XXXXXXXX',
        message
      );

      return true;
    }

    const target = `${number}@s.whatsapp.net`;

    try {
      const result = await sock.groupParticipantsUpdate(
        jid,
        [target],
        'add'
      );

      const status = result?.[0]?.status;

      if (status === '200' || status === 200) {
        await sendReply(
          jid,
          `✅ Demande d’ajout envoyée pour ${number}.`,
          message
        );
      } else {
        await sendReply(
          jid,
          `La demande d’ajout pour ${number} a reçu le statut ${status || 'inconnu'}. WhatsApp peut imposer une invitation privée.`,
          message
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'Erreur Xadd');

      await sendReply(
        jid,
        'WhatsApp a refusé l’ajout direct. La confidentialité du membre peut exiger une invitation.',
        message
      );
    }

    return true;
  }

  // ----------------------------------------------------------
  // XANNONCE — ANNONCE DU GROUPE
  // ----------------------------------------------------------

  if (command === 'xannonce') {
    if (!botIsAdmin) {
      await sendReply(
        jid,
        '⚠️ Je dois être administratrice du groupe pour publier cette annonce.',
        message
      );

      return true;
    }

    const announcement = args.join(' ').trim();

    if (!announcement) {
      await sendReply(
        jid,
        'Utilisation : Xannonce votre message',
        message
      );

      return true;
    }

    await sock.sendMessage(jid, {
      text:
        `📢 𝗔𝗡𝗡𝗢𝗡𝗖𝗘 𝗢𝗙𝗙𝗜𝗖𝗜𝗘𝗟𝗟𝗘\n\n${announcement}\n\n${SIGNATURE}`
    });

    return true;
  }

  // ----------------------------------------------------------
  // XCLEAR — SUPPRIMER UN MESSAGE ENVOYÉ PAR LE BOT
  // ----------------------------------------------------------

  if (command === 'xclear') {
    if (!botIsAdmin) {
      await sendReply(
        jid,
        '⚠️ Je dois être administratrice du groupe pour effectuer cette action.',
        message
      );

      return true;
    }

    const quoted = getQuotedMessage(message);

    if (!quoted?.stanzaId) {
      await sendReply(
        jid,
        'Réponds à un de mes messages, puis envoie Xclear.',
        message
      );

      return true;
    }

    const quotedSender = quoted.participant || '';

    if (!sameParticipant(quotedSender, botJid)) {
      await sendReply(
        jid,
        'Je peux uniquement supprimer ici un message que j’ai moi-même envoyé.',
        message
      );

      return true;
    }

    try {
      await sock.sendMessage(jid, {
        delete: {
          remoteJid: jid,
          fromMe: true,
          id: quoted.stanzaId
        }
      });

      await sendReply(
        jid,
        '🧹 Message supprimé.',
        message
      );
    } catch (error) {
      logger.error({ err: error }, 'Erreur Xclear');

      await sendReply(
        jid,
        'La suppression a échoué. Vérifie mes permissions.',
        message
      );
    }

    return true;
  }

  return false;
}

// ============================================================
// FIN PARTIE 2/4
// NE PAS DÉPLOYER POUR LE MOMENT.
// COLLER LA PARTIE 3 À LA SUITE DU MÊME FICHIER.
// ============================================================


// ============================================================
// PARTIE 3/4 — ÉCONOMIE, QUIZ ET MULTIMÉDIA
// ============================================================

// ------------------------------------------------------------
// 21. SYSTÈME UTILISATEURS
// ------------------------------------------------------------

async function ensureUser(jid) {
  await db.execute({
    sql: `
      INSERT OR IGNORE INTO users
        (jid, coins, xp, last_daily, created_at)
      VALUES (?, 0, 0, 0, ?)
    `,
    args: [jid, Date.now()]
  });
}

async function getUser(jid) {
  await ensureUser(jid);

  const result = await db.execute({
    sql: `
      SELECT jid, coins, xp, last_daily, created_at
      FROM users
      WHERE jid = ?
    `,
    args: [jid]
  });

  return result.rows[0];
}

// ------------------------------------------------------------
// 22. AJOUT DE XCOINS ET XP
// ------------------------------------------------------------

async function addRewards(jid, coins = 0, xp = 0) {
  await ensureUser(jid);

  await db.execute({
    sql: `
      UPDATE users
      SET coins = coins + ?,
          xp = xp + ?
      WHERE jid = ?
    `,
    args: [
      Math.max(0, Math.floor(coins)),
      Math.max(0, Math.floor(xp)),
      jid
    ]
  });

  return getUser(jid);
}

// ------------------------------------------------------------
// 23. CLASSEMENTS
// ------------------------------------------------------------

function getRank(xp) {
  if (xp >= 10000) return '👑 Legend';
  if (xp >= 5000) return '💠 Elite';
  if (xp >= 2500) return '💎 Diamond';
  if (xp >= 1000) return '🥇 Gold';
  if (xp >= 500) return '🥈 Silver';
  if (xp >= 100) return '🥉 Bronze';

  return '🌱 Novice';
}

function getNextRank(xp) {
  const ranks = [
    { xp: 100, name: 'Bronze' },
    { xp: 500, name: 'Silver' },
    { xp: 1000, name: 'Gold' },
    { xp: 2500, name: 'Diamond' },
    { xp: 5000, name: 'Elite' },
    { xp: 10000, name: 'Legend' }
  ];

  return ranks.find(rank => xp < rank.xp) || null;
}

// ------------------------------------------------------------
// 24. XDAILY — 350 XCOINS + 25 XP / 24 HEURES
// ------------------------------------------------------------

async function dailyReward(jid) {
  await ensureUser(jid);

  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;

  // Mise à jour conditionnelle atomique.
  const result = await db.execute({
    sql: `
      UPDATE users
      SET coins = coins + 350,
          xp = xp + 25,
          last_daily = ?
      WHERE jid = ?
        AND last_daily <= ?
      RETURNING coins, xp, last_daily
    `,
    args: [
      now,
      jid,
      now - cooldown
    ]
  });

  if (result.rows.length > 0) {
    const user = result.rows[0];

    return {
      success: true,
      coins: Number(user.coins),
      xp: Number(user.xp),
      message:
        '🎁 𝗥𝗘́𝗖𝗢𝗠𝗣𝗘𝗡𝗦𝗘 𝗤𝗨𝗢𝗧𝗜𝗗𝗜𝗘𝗡𝗡𝗘\n\n' +
        '╭━━━━━━━━━━━━━━━━━━╮\n' +
        '┃ +350 XCoins 💰\n' +
        '┃ +25 XP ⭐\n' +
        '╰━━━━━━━━━━━━━━━━━━╯\n\n' +
        'Ta récompense quotidienne a été créditée.\n' +
        SIGNATURE
    };
  }

  const user = await getUser(jid);
  const remaining = Math.max(
    0,
    cooldown - (now - Number(user.last_daily))
  );

  return {
    success: false,
    remaining: Math.ceil(remaining / 1000),
    message:
      '⏳ 𝗗𝗔𝗜𝗟𝗬 𝗗𝗘́𝗝𝗔̀ 𝗥𝗘́𝗖𝗟𝗔𝗠𝗘́\n\n' +
      `Reviens dans ${formatDuration(
        Math.ceil(remaining / 1000)
      )}.\n\n` +
      SIGNATURE
  };
}

// ------------------------------------------------------------
// 25. PROFIL UTILISATEUR
// ------------------------------------------------------------

async function getProfileText(jid, displayName = 'Utilisateur') {
  const user = await getUser(jid);
  const xp = Number(user.xp);
  const coins = Number(user.coins);
  const nextRank = getNextRank(xp);

  const progress = nextRank
    ? `${xp} / ${nextRank.xp} XP`
    : `${xp} XP — rang maximal`;

  return `
╭━━〔 👤 𝗨𝗦𝗘𝗥 𝗣𝗥𝗢𝗙𝗜𝗟𝗘 〕━━╮

Nom : ${displayName}
Rang : ${getRank(xp)}

💰 XCoins : ${coins}
⭐ XP : ${xp}
📈 Progression : ${progress}

🧬 Compte enregistré dans Turso
╰━━━━━━━━━━━━━━━━━━━━━━╯

${SIGNATURE}
`;
}

// ------------------------------------------------------------
// 26. CLASSEMENT GLOBAL
// ------------------------------------------------------------

async function getLeaderboard(limit = 10) {
  const result = await db.execute({
    sql: `
      SELECT jid, coins, xp
      FROM users
      ORDER BY xp DESC, coins DESC
      LIMIT ?
    `,
    args: [limit]
  });

  return result.rows;
}

async function getRankText(jid) {
  const user = await getUser(jid);
  const xp = Number(user.xp);
  const rank = getRank(xp);
  const next = getNextRank(xp);

  const leaderboard = await getLeaderboard(10);

  const position = leaderboard.findIndex(
    item => item.jid === jid
  );

  const positionText = position >= 0
    ? `#${position + 1}`
    : 'Non classé';

  return `
╭━━〔 🏆 𝗫𝗥𝗔𝗡𝗞 〕━━╮

Rang : ${rank}
XP : ${xp}
Classement : ${positionText}

${next
  ? `Prochain rang : ${next.name}\nXP nécessaire : ${next.xp - xp}`
  : 'Tu as atteint le rang Legend !'}

╰━━━━━━━━━━━━━━━━━━━━━━╯

${SIGNATURE}
`;
}

// ------------------------------------------------------------
// 27. QUESTIONS DU QUIZ
// ------------------------------------------------------------

const quizQuestions = [
  {
    question: 'Quelle planète est surnommée la planète rouge ?',
    answer: 'mars'
  },
  {
    question: 'Combien de côtés possède un hexagone ?',
    answer: '6'
  },
  {
    question: 'Quel est le plus grand océan du monde ?',
    answer: 'pacifique'
  },
  {
    question: 'Quel langage est principalement utilisé avec React ?',
    answer: 'javascript'
  },
  {
    question: 'Quelle est la capitale du Japon ?',
    answer: 'tokyo'
  },
  {
    question: 'Combien font 12 × 12 ?',
    answer: '144'
  },
  {
    question: 'Quel gaz les plantes absorbent-elles principalement ?',
    answer: 'dioxyde de carbone'
  },
  {
    question: 'Quel est le symbole chimique de l’eau ?',
    answer: 'h2o'
  },
  {
    question: 'Combien de jours compte une année bissextile ?',
    answer: '366'
  },
  {
    question: 'Quel est le satellite naturel de la Terre ?',
    answer: 'la lune'
  }
];

function normalizeAnswer(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[.!?,;:]/g, '')
    .replace(/\s+/g, ' ');
}

// ------------------------------------------------------------
// 28. XQUIZ — CRÉER UN QUIZ PERSISTANT
// ------------------------------------------------------------

async function startQuiz(jid) {
  const now = Date.now();

  const existing = await db.execute({
    sql: `
      SELECT question, expires_at
      FROM active_quizzes
      WHERE group_jid = ?
    `,
    args: [jid]
  });

  if (
    existing.rows.length &&
    Number(existing.rows[0].expires_at) > now
  ) {
    return {
      success: false,
      message:
        '🧠 Un quiz est déjà en cours ici. Réponds avec Xreponse avant de lancer le suivant.'
    };
  }

  const selected =
    quizQuestions[
      Math.floor(Math.random() * quizQuestions.length)
    ];

  const expiresAt = now + 120000;

  await db.execute({
    sql: `
      INSERT INTO active_quizzes
        (group_jid, question, answer, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)

      ON CONFLICT(group_jid)
      DO UPDATE SET
        question = excluded.question,
        answer = excluded.answer,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `,
    args: [
      jid,
      selected.question,
      selected.answer,
      now,
      expiresAt
    ]
  });

  return {
    success: true,
    message:
      '╭━━〔 🧠 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 𝗤𝗨𝗜𝗭 〕━━╮\n\n' +
      `${selected.question}\n\n` +
      '⏳ Temps : 2 minutes\n' +
      '🎁 Bonne réponse : 30 XCoins + 20 XP\n\n' +
      'Réponds avec : Xreponse ta réponse\n\n' +
      '╰━━━━━━━━━━━━━━━━━━━━━━╯'
  };
}

// ------------------------------------------------------------
// 29. XREPONSE — VÉRIFICATION ET RÉCOMPENSE
// ------------------------------------------------------------

async function answerQuiz(jid, answer) {
  const now = Date.now();
  const submitted = normalizeAnswer(answer);

  if (!submitted) {
    return {
      success: false,
      message: 'Indique ta réponse après Xreponse.'
    };
  }

  const existing = await db.execute({
    sql: `
      SELECT answer, expires_at
      FROM active_quizzes
      WHERE group_jid = ?
    `,
    args: [jid]
  });

  if (!existing.rows.length) {
    return {
      success: false,
      message: 'Aucun quiz actif. Lance Xquiz pour commencer.'
    };
  }

  const quiz = existing.rows[0];

  if (Number(quiz.expires_at) <= now) {
    await db.execute({
      sql: `
        DELETE FROM active_quizzes
        WHERE group_jid = ?
          AND expires_at <= ?
      `,
      args: [jid, now]
    });

    return {
      success: false,
      message: '⌛ Le temps du quiz est écoulé. Lance un nouveau Xquiz.'
    };
  }

  if (submitted !== normalizeAnswer(quiz.answer)) {
    return {
      success: false,
      message: '❌ Mauvaise réponse. Tu peux réessayer.'
    };
  }

  // Suppression atomique : une seule bonne réponse
  // peut recevoir la récompense.
  const claimed = await db.execute({
    sql: `
      DELETE FROM active_quizzes
      WHERE group_jid = ?
        AND expires_at > ?
        AND lower(answer) = lower(?)
      RETURNING group_jid
    `,
    args: [jid, now, quiz.answer]
  });

  if (!claimed.rows.length) {
    return {
      success: false,
      message: 'Ce quiz vient déjà d’être remporté.'
    };
  }

  const user = await addRewards(jid, 30, 20);

  return {
    success: true,
    coins: Number(user.coins),
    xp: Number(user.xp),
    message:
      '🏆 𝗕𝗥𝗔𝗩𝗢 ! 𝗕𝗢𝗡𝗡𝗘 𝗥𝗘́𝗣𝗢𝗡𝗦𝗘\n\n' +
      '╭━━━━━━━━━━━━━━━━━━╮\n' +
      '┃ +30 XCoins 💰\n' +
      '┃ +20 XP ⭐\n' +
      '╰━━━━━━━━━━━━━━━━━━╯\n\n' +
      'Le quiz est terminé. Félicitations !\n' +
      SIGNATURE
  };
}

// ------------------------------------------------------------
// 30. RECHERCHE D'IMAGES — SERPAPI
// ------------------------------------------------------------

async function downloadImageBuffer(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    maxContentLength: CONFIG.maxImageBytes,
    maxBodyLength: CONFIG.maxImageBytes,
    headers: {
      'User-Agent': 'Mozilla/5.0 SitriNel/2.0',
      Accept: 'image/avif,image/webp,image/png,image/jpeg'
    },
    validateStatus: status => status === 200
  });

  const contentType =
    String(response.headers['content-type'] || '')
      .toLowerCase();

  if (!contentType.startsWith('image/')) {
    throw new Error('La ressource reçue n’est pas une image.');
  }

  const buffer = Buffer.from(response.data);

  if (
    !buffer.length ||
    buffer.length > CONFIG.maxImageBytes
  ) {
    throw new Error('Taille de l’image non autorisée.');
  }

  return {
    buffer,
    contentType
  };
}

async function searchImage(jid, message, query) {
  if (!CONFIG.serpApiKey) {
    await sendReply(
      jid,
      '⚠️ La recherche d’images nécessite SERPAPI_KEY dans Railway.',
      message
    );

    return false;
  }

  if (!query || !query.trim()) {
    await sendReply(
      jid,
      'Utilisation : Ximg Naruto, paysage, animal...',
      message
    );

    return false;
  }

  await sendReply(
    jid,
    '🔎 Recherche de visuels en cours...',
    message
  );

  try {
    const response = await axios.get(
      'https://serpapi.com/search.json',
      {
        params: {
          engine: 'google_images',
          q: query,
          api_key: CONFIG.serpApiKey,
          safe: 'active',
          ijn: '0'
        },
        timeout: 30000
      }
    );

    const results = response.data?.images_results || [];

    if (!results.length) {
      await sendReply(
        jid,
        'Aucune image trouvée pour cette recherche.',
        message
      );

      return false;
    }

    // Essayer plusieurs résultats : le premier peut être bloqué.
    for (const item of results.slice(0, 5)) {
      const imageUrl = item.original || item.thumbnail;

      if (!imageUrl) continue;

      try {
        const downloaded =
          await downloadImageBuffer(imageUrl);

        await sock.sendMessage(
          jid,
          {
            image: downloaded.buffer,
            mimetype: downloaded.contentType,
            caption:
              `🖼️ 𝗥𝗘𝗖𝗛𝗘𝗥𝗖𝗛𝗘 : ${query}\n${SIGNATURE}`
          },
          { quoted: message }
        );

        return true;
      } catch (error) {
        logger.warn(
          { err: error },
          'Un résultat image n’a pas pu être téléchargé.'
        );
      }
    }

    await sendReply(
      jid,
      'Les résultats ont été trouvés, mais les images ne sont pas téléchargeables actuellement.',
      message
    );

    return false;
  } catch (error) {
    logger.error(
      { err: error },
      'Erreur de recherche SerpApi'
    );

    await sendReply(
      jid,
      'La recherche d’images a échoué. Vérifie ta clé SerpApi et réessaie.',
      message
    );

    return false;
  }
}

// ------------------------------------------------------------
// 31. GÉNÉRATION D'IMAGES — CLOUDFLARE WORKERS AI
// ------------------------------------------------------------

async function generateImage(jid, message, prompt) {
  if (
    !CONFIG.cloudflareToken ||
    !CONFIG.cloudflareAccountId
  ) {
    await sendReply(
      jid,
      '⚠️ La génération nécessite CLOUDFLARE_API_TOKEN et CLOUDFLARE_ACCOUNT_ID dans Railway.',
      message
    );

    return false;
  }

  if (!prompt || !prompt.trim()) {
    await sendReply(
      jid,
      'Utilisation : Ximg create un dragon futuriste dans une ville cyberpunk',
      message
    );

    return false;
  }

  await sendReply(
    jid,
    '🎨 𝗖𝗥𝗘́𝗔𝗧𝗜𝗢𝗡 𝗩𝗜𝗦𝗨𝗘𝗟𝗟𝗘\nJe prépare ton image...',
    message
  );

  try {
    const endpoint =
      `https://api.cloudflare.com/client/v4/accounts/${CONFIG.cloudflareAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

    const response = await axios.post(
      endpoint,
      {
        prompt: prompt.trim(),
        num_steps: 4
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.cloudflareToken}`,
          'Content-Type': 'application/json',
          Accept: 'image/png'
        },
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: CONFIG.maxImageBytes,
        maxBodyLength: CONFIG.maxImageBytes
      }
    );

    const contentType =
      String(response.headers['content-type'] || '')
        .toLowerCase();

    if (!contentType.startsWith('image/')) {
      throw new Error(
        'Cloudflare n’a pas renvoyé directement une image.'
      );
    }

    const buffer = Buffer.from(response.data);

    if (
      !buffer.length ||
      buffer.length > CONFIG.maxImageBytes
    ) {
      throw new Error('Image générée de taille invalide.');
    }

    await sock.sendMessage(
      jid,
      {
        image: buffer,
        mimetype: contentType,
        caption:
          `✨ 𝗜𝗠𝗔𝗚𝗘 𝗚𝗘́𝗡𝗘́𝗥𝗘́𝗘\n${SIGNATURE}`
      },
      { quoted: message }
    );

    return true;
  } catch (error) {
    logger.error(
      { err: error },
      'Erreur génération Cloudflare'
    );

    await sendReply(
      jid,
      'La génération a échoué. Vérifie les identifiants Cloudflare, les autorisations Workers AI et la disponibilité du modèle.',
      message
    );

    return false;
  }
}

// ------------------------------------------------------------
// 32. COMMANDES MULTIMÉDIAS EN ATTENTE D'INTÉGRATION
// ------------------------------------------------------------

async function multimediaNotIntegrated(
  jid,
  message,
  command
) {
  const descriptions = {
    xplay:
      'La recherche et l’envoi audio ne sont pas encore intégrés.',
    xvideo:
      'La recherche et l’envoi vidéo ne sont pas encore intégrés.'
  };

  await sendReply(
    jid,
    `🎧 ${descriptions[command] || 'Cette fonction est en préparation.'}\nJe ne vais pas prétendre que cette commande fonctionne avant son intégration.`,
    message
  );
}

// ============================================================
// FIN PARTIE 3/4
// NE PAS DÉPLOYER POUR LE MOMENT.
// LA PARTIE 4 AJOUTERA LE ROUTEUR, LE PAIRAGE ET LE DÉMARRAGE.
// ============================================================


// ============================================================
// PARTIE 4/4 — ROUTEUR, CONNEXION ET DÉMARRAGE
// ============================================================

// ------------------------------------------------------------
// 33. PROTECTION CONTRE LES BOUCLES FROMME
// ------------------------------------------------------------

// On mémorise les identifiants des messages envoyés
// par le bot pour ne jamais les traiter comme commandes.

const botSentMessageIds = new Set();

function rememberBotMessage(id) {
  if (!id) return;

  botSentMessageIds.add(id);

  if (botSentMessageIds.size > 5000) {
    const first = botSentMessageIds.values().next().value;
    botSentMessageIds.delete(first);
  }
}

// À appeler une seule fois sur chaque nouveau socket.
function protectOutgoingMessages(socket) {
  const originalSendMessage = socket.sendMessage.bind(socket);

  socket.sendMessage = async (...args) => {
    const result = await originalSendMessage(...args);

    if (result?.key?.id) {
      rememberBotMessage(result.key.id);
    }

    return result;
  };
}

// ------------------------------------------------------------
// 34. IDENTIFICATION ET CONTRÔLE DES COMMANDES
// ------------------------------------------------------------

const recognizedCommands = new Set([
  'menu',
  'info',
  'chat',
  'ai',
  'ask',
  'anime',
  'police',
  'onlyadmin',
  'tag',
  'tagall',
  'kick',
  'add',
  'annonce',
  'clear',
  'daily',
  'coins',
  'xp',
  'rank',
  'profil',
  'quiz',
  'reponse',
  'img',
  'play',
  'video',
  'upt',
  'off',
  'restart'
]);

function parseCommand(text) {
  const match = String(text || '').trim().match(
    /^x([a-z]+)(?:\s+([\s\S]*))?$/i
  );

  if (!match) return null;

  const command = match[1].toLowerCase();
  const args = (match[2] || '').trim();

  if (!recognizedCommands.has(command)) {
    return null;
  }

  return { command, args };
}

// ------------------------------------------------------------
// 35. INFORMATIONS DU SYSTÈME — XUPT
// ------------------------------------------------------------

function getSystemInfo() {
  const uptimeSeconds = Math.floor(
    (Date.now() - PROCESS_STARTED_AT) / 1000
  );

  const memory = process.memoryUsage();

  return `
╭━━〔 ⚙️ 𝗦𝗬𝗦𝗧𝗘𝗠 𝗦𝗧𝗔𝗧𝗨𝗦 〕━━╮

🤖 Bot : SITRI-NEL ULTIMATE
📡 WhatsApp : ${connectionStatus}
🟢 Processus : Actif

⏱️ Uptime : ${formatDuration(uptimeSeconds)}

🧠 Node.js : ${process.version}
💻 Plateforme : ${process.platform}
📦 Mémoire utilisée :
${(memory.rss / 1024 / 1024).toFixed(2)} MB

🕒 Démarrage : ${
    new Date(PROCESS_STARTED_AT).toLocaleString('fr-FR', {
      timeZone: 'UTC'
    })
  } UTC

╰━━━━━━━━━━━━━━━━━━━━━━╯

${SIGNATURE}
`;
}

// ------------------------------------------------------------
// 36. EXÉCUTION DES COMMANDES
// ------------------------------------------------------------

async function handleCommand(message) {
  const jid = message.key.remoteJid;

  if (!jid || !message.message) return;

  if (message.key.id && botSentMessageIds.has(message.key.id)) {
    return;
  }

  // Une commande envoyée depuis le compte connecté
  // est considérée comme une commande du propriétaire.
  const sender = message.key.fromMe
    ? (botJid || getMessageSender(message))
    : getMessageSender(message);

  const textContent = extractText(message);
  const parsed = parseCommand(textContent);

  // Les messages ordinaires ne sont jamais interceptés.
  if (!parsed) return;

  const { command, args } = parsed;

  // Contrôle propriétaire avant les permissions ordinaires.
  const owner = isOwner(sender) || message.key.fromMe;

  if (!owner && !isOwnerMessage(message) && message.key.fromMe) {
    return;
  }

  // ----------------------------------------------------------
  // COMMANDES DE GROUPE
  // ----------------------------------------------------------

  if (isGroupJid(jid)) {
    const handled = await handleGroupCommand(
      jid,
      message,
      sender,
      command,
      args
    );

    if (handled) return;

    // Le mode onlyadmin bloque les commandes ordinaires
    // aux membres qui ne sont ni propriétaires ni admins.
    const allowed = await canUseOrdinaryGroupCommand(
      jid,
      sender
    );

    if (!allowed) {
      await sendReply(
        jid,
        '🔒 Cette commande est réservée aux administrateurs du groupe.',
        message
      );

      return;
    }
  }

  // ----------------------------------------------------------
  // XMENU
  // ----------------------------------------------------------

  if (command === 'menu') {
    await sendOfficialImage(jid, message);
    await sendReply(jid, getMenu(), message);
    return;
  }

  // ----------------------------------------------------------
  // XINFO
  // ----------------------------------------------------------

  if (command === 'info') {
    await sendOfficialImage(jid, message);
    await sendReply(jid, getInfo(), message);
    return;
  }

  // ----------------------------------------------------------
  // XCHAT — CONVERSATION AVEC MÉMOIRE
  // ----------------------------------------------------------

  if (command === 'chat') {
    if (!args) {
      await sendReply(
        jid,
        'Je suis à ton écoute. Utilise Xchat suivi de ton message.',
        message
      );
      return;
    }

    try {
      const answer = await askGroq(
        args,
        sender,
        { useHistory: true }
      );

      await sendReply(jid, answer, message);
    } catch (error) {
      logger.error({ err: error }, 'Erreur Xchat');

      await sendReply(
        jid,
        'Je rencontre momentanément une difficulté avec mon intelligence artificielle.',
        message
      );
    }

    return;
  }

  // ----------------------------------------------------------
  // XAI ET XASK — RÉPONSES IA
  // ----------------------------------------------------------

  if (command === 'ai' || command === 'ask') {
    if (!args) {
      await sendReply(
        jid,
        `Indique ta question après X${command}.`,
        message
      );
      return;
    }

    try {
      const answer = await askGroq(
        args,
        sender,
        { useHistory: false }
      );

      await sendReply(jid, answer, message);
    } catch (error) {
      logger.error({ err: error }, `Erreur X${command}`);

      await sendReply(
        jid,
        'Mon service IA est momentanément indisponible.',
        message
      );
    }

    return;
  }

  // ----------------------------------------------------------
  // XANIME
  // ----------------------------------------------------------

  if (command === 'anime') {
    if (!args) {
      await sendReply(
        jid,
        'Utilisation : Xanime suivi de ta question sur les animes.',
        message
      );
      return;
    }

    try {
      const answer = await askGroq(
        `Réponds comme une experte en anime, manga et animation japonaise. Sois précise et élégante.\n\nQuestion : ${args}`,
        sender,
        { useHistory: false }
      );

      await sendReply(jid, answer, message);
    } catch (error) {
      logger.error({ err: error }, 'Erreur Xanime');

      await sendReply(jid, 'Service momentanément indisponible.', message);
    }

    return;
  }

  // ----------------------------------------------------------
  // XP ET ÉCONOMIE
  // ----------------------------------------------------------

  if (command === 'daily') {
    const result = await dailyReward(sender);
    await sendReply(jid, result.message, message);
    return;
  }

  if (command === 'coins') {
    const user = await getUser(sender);

    await sendReply(
      jid,
      `💰 𝗫𝗖𝗢𝗜𝗡𝗦\n\nSolde : ${Number(user.coins)} XCoins\n\n${SIGNATURE}`,
      message
    );

    return;
  }

  if (command === 'xp') {
    const user = await getUser(sender);

    await sendReply(
      jid,
      `⭐ 𝗘𝗫𝗣𝗘𝗥𝗜𝗘𝗡𝗖𝗘\n\nXP : ${Number(user.xp)}\nRang : ${getRank(Number(user.xp))}\n\n${SIGNATURE}`,
      message
    );

    return;
  }

  if (command === 'rank') {
    const text = await getRankText(sender);
    await sendReply(jid, text, message);
    return;
  }

  if (command === 'profil') {
    const displayName =
      message.pushName || 'Utilisateur';

    const text = await getProfileText(
      sender,
      displayName
    );

    await sendReply(jid, text, message);
    return;
  }

  // ----------------------------------------------------------
  // QUIZ
  // ----------------------------------------------------------

  if (command === 'quiz') {
    const result = await startQuiz(jid);

    await sendReply(
      jid,
      result.message,
      message
    );

    return;
  }

  if (command === 'reponse') {
    const result = await answerQuiz(
      jid,
      sender,
      args
    );

    await sendReply(
      jid,
      result.message,
      message
    );

    return;
  }

  // ----------------------------------------------------------
  // IMAGES
  // ----------------------------------------------------------

  if (command === 'img') {
    if (/^create(?:\s|$)/i.test(args)) {
      const prompt = args.replace(/^create\s*/i, '');

      await generateImage(
        jid,
        message,
        prompt
      );

      return;
    }

    await searchImage(
      jid,
      message,
      args
    );

    return;
  }

  // ----------------------------------------------------------
  // AUDIO ET VIDÉO
  // ----------------------------------------------------------

  if (command === 'play' || command === 'video') {
    await multimediaNotIntegrated(
      jid,
      message,
      `x${command}`
    );

    return;
  }

  // ----------------------------------------------------------
  // XUPT
  // ----------------------------------------------------------

  if (command === 'upt') {
    await sendReply(
      jid,
      getSystemInfo(),
      message
    );

    return;
  }

  // ----------------------------------------------------------
  // COMMANDES RÉSERVÉES AU PROPRIÉTAIRE
  // ----------------------------------------------------------

  if (command === 'off' || command === 'restart') {
    if (!owner) {
      await sendReply(
        jid,
        '⛔ Cette commande est exclusivement réservée à KAY≈DEN.',
        message
      );

      return;
    }

    isShuttingDown = true;
    connectionStatus = 'Arrêt en cours';

    await sendReply(
      jid,
      command === 'off'
        ? '⌁ Arrêt de Sitri-Nel demandé par KAY≈DEN.'
        : '⌁ Redémarrage de Sitri-Nel demandé par KAY≈DEN.',
      message
    );

    if (sock) {
      try {
        sock.end(undefined);
      } catch (error) {
        logger.warn({ err: error }, 'Fermeture du socket');
      }
    }

    // Xrestart utilise le redémarrage automatique Railway
    // si la politique de redémarrage est configurée.
    process.exit(command === 'restart' ? 1 : 0);
  }
}

// ------------------------------------------------------------
// 37. RÉCEPTION DES MESSAGES
// ------------------------------------------------------------

async function handleIncomingMessage(message) {
  try {
    if (!message || !message.key) return;

    if (message.key.remoteJid === 'status@broadcast') {
      return;
    }

    if (message.key.id && hasProcessedMessage(message)) {
      return;
    }

    // Les messages envoyés par le bot sont ignorés.
    // Les commandes envoyées depuis le téléphone du propriétaire
    // restent acceptées si leur identifiant n'est pas celui
    // d'un message envoyé par le bot.
    if (
      message.key.fromMe &&
      message.key.id &&
      botSentMessageIds.has(message.key.id)
    ) {
      return;
    }

    const textContent = extractText(message);

    // Ignorer les messages qui ne sont pas des commandes.
    if (!parseCommand(textContent)) {
      return;
    }

    await handleCommand(message);
  } catch (error) {
    logger.error(
      { err: error },
      'Erreur pendant le traitement du message'
    );

    const jid = message?.key?.remoteJid;

    if (jid) {
      try {
        await sendReply(
          jid,
          'Une erreur interne est survenue. Réessaie dans un instant.',
          message
        );
      } catch (sendError) {
        logger.error(
          { err: sendError },
          'Impossible d’envoyer le message d’erreur'
        );
      }
    }
  }
}

// ------------------------------------------------------------
// 38. CONNEXION WHATSAPP PAR CODE
// ------------------------------------------------------------

let reconnectTimer = null;
let reconnectAttempts = 0;
let pairingAttemptAt = 0;
let pairingInProgress = false;

async function connectWhatsApp() {
  if (isShuttingDown) return;

  connectionStatus = 'Connexion en cours';

  const { state, saveCreds } =
    await useMultiFileAuthState(SESSION_DIR);

  const currentSocket = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  });

  sock = currentSocket;

  // Protection contre les boucles de messages sortants.
  protectOutgoingMessages(currentSocket);

  currentSocket.ev.on('creds.update', saveCreds);

  // PAIRING CODE — ATTENDRE LE SIGNAL DE BAILEYS

let pairingCodeRequested = false;

currentSocket.ev.on('connection.update', async update => {
  if (
    !update.qr ||
    state.creds.registered ||
    pairingCodeRequested ||
    sock !== currentSocket
  ) {
    return;
  }

  if (!CONFIG.pairingNumber) {
    logger.error('PAIRING_NUMBER absent dans Railway.');
    return;
  }

  pairingCodeRequested = true;

  try {
    logger.info('Demande du code de jumelage...');

    const code = await currentSocket.requestPairingCode(
      CONFIG.pairingNumber
    );

    logger.info('================================');
    logger.info('SITRI-NEL — CODE DE JUMELAGE');
    logger.info(`CODE : ${code}`);
    logger.info('================================');

  } catch (error) {
    pairingCodeRequested = false;

    logger.error(
      { err: error },
      'Échec de génération du code de jumelage'
    );
  }
});
    const now = Date.now();

    if (
      !pairingInProgress &&
      now - pairingAttemptAt > 30000
    ) {
      pairingInProgress = true;
      pairingAttemptAt = now;

      try {
        // Laisser le socket s'initialiser.
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (
          sock !== currentSocket ||
          isShuttingDown ||
          state.creds.registered
        ) {
          return;
        }

        const code = await currentSocket.requestPairingCode(
          CONFIG.pairingNumber
        );

        logger.info(
          '========================================'
        );
        logger.info('SITRI-NEL — CODE DE JUMELAGE');
        logger.info(`CODE : ${code}`);
        logger.info(
          'Entre ce code dans WhatsApp > Appareils connectés.'
        );
        logger.info(
          '========================================'
        );
      } catch (error) {
        logger.error(
          { err: error },
          'Impossible de générer le code de jumelage'
        );
      } finally {
        pairingInProgress = false;
      }
    }
  }

  // ----------------------------------------------------------
  // ÉTAT DE CONNEXION
  // ----------------------------------------------------------

  currentSocket.ev.on(
    'connection.update',
    async update => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        connectionStatus = 'Connexion en cours';
      }

      if (connection === 'open') {
        reconnectAttempts = 0;
        connectionStatus = 'Connecté';

        botJid = jidNormalizedUser(
          currentSocket.user.id
        );

        botNumber = getNumber(botJid);

        logger.info('========================================');
        logger.info('SITRI-NEL ULTIMATE CONNECTÉ');
        logger.info(`Numéro : ${botNumber}`);
        logger.info(`Propriétaire : ${CONFIG.ownerNumbers.join(', ')}`);
        logger.info('Connexion WhatsApp établie.');
        logger.info('========================================');
      }

      if (connection === 'close') {
        connectionStatus = 'Déconnecté';

        const statusCode =
          lastDisconnect?.error?.output?.statusCode;

        logger.warn(
          { statusCode },
          'Connexion WhatsApp fermée'
        );

        if (isShuttingDown) return;

        if (statusCode === DisconnectReason.loggedOut) {
  logger.error(
    'Session invalide. Préparation d'une nouvelle association.'
  );

  try {
    await fs.promises.rm(SESSION_DIR, {
      recursive: true,
      force: true
    });

    logger.info('Ancienne session supprimée.');

    reconnectTimer = setTimeout(() => {
      if (!isShuttingDown) {
        connectWhatsApp().catch(error => {
          logger.error(
            { err: error },
            'Échec du nouveau démarrage WhatsApp'
          );
        });
      }
    }, 3000);

  } catch (error) {
    logger.error(
      { err: error },
      'Impossible de réinitialiser la session'
    );
  }

  return;
        }

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }

        reconnectAttempts++;

        const delay = Math.min(
          5000 * Math.pow(2, reconnectAttempts - 1),
          60000
        );

        logger.info(
          `Nouvelle tentative de connexion dans ${Math.ceil(delay / 1000)} secondes.`
        );

        reconnectTimer = setTimeout(() => {
          if (!isShuttingDown) {
            connectWhatsApp().catch(error => {
              logger.error(
                { err: error },
                'Erreur pendant la reconnexion'
              );
            });
          }
        }, delay);
      }
    }
  );

  // ----------------------------------------------------------
  // ÉVÉNEMENTS DES MESSAGES
  // ----------------------------------------------------------

  currentSocket.ev.on(
    'messages.upsert',
    async ({ messages, type }) => {
      if (!['notify', 'append'].includes(type)) {
        return;
      }

      for (const message of messages || []) {
        await handleIncomingMessage(message);
      }
    }
  );
}

// ------------------------------------------------------------
// 39. DÉMARRAGE PRINCIPAL
// ------------------------------------------------------------

async function startSitriNel() {
  try {
    logger.info('Initialisation de Sitri-Nel Ultimate...');

    await initDatabase();

    logger.info('Base de données initialisée.');

    if (!CONFIG.pairingNumber) {
      logger.warn(
        'PAIRING_NUMBER absent. Configure cette variable dans Railway.'
      );
    }

    await connectWhatsApp();

  } catch (error) {
    logger.fatal(
      { err: error },
      'Échec du démarrage de Sitri-Nel'
    );

    process.exit(1);
  }
}

// ------------------------------------------------------------
// 40. ARRÊT PROPRE DU PROCESSUS
// ------------------------------------------------------------

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;

  isShuttingDown = true;
  connectionStatus = 'Arrêt en cours';

  logger.info(`Signal reçu : ${signal}`);

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  try {
    if (sock) {
      sock.end(undefined);
    }
  } catch (error) {
    logger.warn(
      { err: error },
      'Erreur pendant la fermeture WhatsApp'
    );
  }

  process.exit(0);
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

process.on('unhandledRejection', error => {
  logger.error(
    { err: error },
    'Promesse non gérée'
  );
});

process.on('uncaughtException', error => {
  logger.fatal(
    { err: error },
    'Exception non interceptée'
  );

  process.exit(1);
});

// ============================================================
// LANCEMENT DE SITRI-NEL ULTIMATE
// ============================================================

startSitriNel().catch(error => {
  logger.fatal(
    { err: error },
    'Erreur fatale au démarrage'
  );

  process.exit(1);
});

// ============================================================
// FIN PARTIE 4/4
// ============================================================
   
