/* ============================================================
   ⌬ SITRI-NEL ULTIMATE EDITION — GROQ + ANILIST EDITION
   Créé et développé par KAY≈DEN
   Fichier unique : index.js
   ============================================================ */

// ------------------------------------------------------------
// 01. IMPORTATIONS
// ------------------------------------------------------------

import * as Baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import { createClient } from '@libsql/client';
import axios from 'axios';
import fs from 'fs';
import zlib from 'zlib';
let createCanvasFn = null;
let loadImageFn = null;
try {
  const canvasPkg = await import('@napi-rs/canvas');
  createCanvasFn = canvasPkg.createCanvas || null;
  loadImageFn = canvasPkg.loadImage || null;
} catch {
  createCanvasFn = null;
  loadImageFn = null;
}
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const makeWASocket =
  typeof Baileys.default === 'function'
    ? Baileys.default
    : typeof Baileys.makeWASocket === 'function'
      ? Baileys.makeWASocket
      : typeof Baileys.default?.default === 'function'
        ? Baileys.default.default
        : null;

if (typeof makeWASocket !== 'function') {
  throw new TypeError(
    'Baileys : fonction makeWASocket introuvable. Vérifie la dépendance installée.'
  );
}

const {
  DisconnectReason,
  useMultiFileAuthState,
  initAuthCreds,
  BufferJSON,
  proto
} = Baileys;

const jidNormalizedUser =
  typeof Baileys.jidNormalizedUser === 'function'
    ? Baileys.jidNormalizedUser
    : jid => String(jid || '').trim().toLowerCase();

// ------------------------------------------------------------
// 02. CHEMINS DU PROJET
// ------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(__filename);

const SESSION_DIR = path.join(ROOT_DIR, 'session');
const IMAGE_PATH = path.join(ROOT_DIR, 'sitri-nel.png');
const LOCAL_DATABASE_PATH = path.join(ROOT_DIR, 'sitri-nel.db');

fs.mkdirSync(SESSION_DIR, { recursive: true });

// ------------------------------------------------------------
// 03. CONFIGURATION GÉNÉRALE
// ------------------------------------------------------------

function readOwnerNumbers() {
  const raw = process.env.OWNER_NUMBERS || '22959418685,2290159418685';

  return raw
    .split(',')
    .map(value => value.replace(/\D/g, ''))
    .filter(value => value.length >= 8);
}

const cleanEnv = value =>
  String(value || '').trim().replace(/^["']+|["']+$/g, '').trim();

const DEFAULT_PAIRING_NUMBER = '2290159418685';

function resolvePairingNumber() {
  const raw = cleanEnv(process.env.PAIRING_NUMBER) || DEFAULT_PAIRING_NUMBER;
  return String(raw).replace(/\D/g, '');
}

const CONFIG = {
  pairingNumber: resolvePairingNumber(),
  pairingCode: String(process.env.PAIRING_CODE || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
  pairingRefreshMs: Number(process.env.PAIRING_REFRESH_MS || 300000),
  ownerNumbers: readOwnerNumbers(),
  groqKey: cleanEnv(process.env.GROQ_API_KEY),
  groqModel: cleanEnv(process.env.GROQ_MODEL) || 'llama-3.3-70b-versatile',
  tursoUrl: cleanEnv(process.env.TURSO_DATABASE_URL),
  tursoToken: cleanEnv(process.env.TURSO_AUTH_TOKEN),
  serpApiKey: cleanEnv(process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY),
  tavilyKey: cleanEnv(process.env.TAVILY_API_KEY),
  serperKey: cleanEnv(process.env.SERPER_API_KEY),
  pixabayKey: cleanEnv(process.env.PIXABAY_API_KEY),
  cloudflareToken: cleanEnv(process.env.CLOUDFLARE_API_TOKEN),
  cloudflareAccountId: cleanEnv(process.env.CLOUDFLARE_ACCOUNT_ID),
  maxImageBytes: 8 * 1024 * 1024,
  maxMediaBytes: 25 * 1024 * 1024,
  maxChatHistory: 25,
  tagCooldown: 60,
  maxMessageAge: 2 * 60 * 1000
};

// ------------------------------------------------------------
// 04. JOURNALISATION
// ------------------------------------------------------------

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['password', 'token', 'authorization', 'api_key', 'creds', 'auth'],
    censor: '[MASQUÉ]'
  }
});

const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'error' });

// ------------------------------------------------------------
// 05. ÉTAT DU BOT
// ------------------------------------------------------------

let sock = null;
let botJid = '';
let botLid = '';
let botNumber = '';
let connectionStatus = 'Non connecté';
let isShuttingDown = false;
let isBotSleeping = false;
let isKaydenOnly = false;
let botFlagsLoaded = false;
let botFlagsLastTry = 0;

const PROCESS_STARTED_AT = Date.now();
const processedMessages = new Set();
const activeRequests = new Set();

const SIGNATURE = '𖤍𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟𖤍';

// ------------------------------------------------------------
// 06. IDENTITÉ & PERSONNALITÉ ÉVOLUTIVE DE SITRI-NEL
// ------------------------------------------------------------

function getCurrentMood() {
  const hour = new Date().getUTCHours(); // Bénin = UTC+1
  const localHour = (hour + 1) % 24;
  const moods = [
    "enjouée, pétillante et pleine d'énergie",
    "un brin taquine, complice et malicieuse",
    "curieuse, passionnée et super chaleureuse",
    "détendue, posée mais toujours vive d'esprit",
    "un peu sarcastique avec beaucoup d'humour et d'affection"
  ];
  const index = (localHour + new Date().getUTCMinutes()) % moods.length;
  return moods[index];
}

// Informations sur le créateur (KAY≈DEN) : une ligne par information.
// Elles peuvent aussi être ajoutées par la variable Railway CREATOR_INFO (une information par ligne).
const CREATOR_INFO_LINES = [
  'Il s’appelle Kayden Nelson (KAY≈DEN) ; c’est un homme.',
  'Il est flemmard, et il l’assume.',
  'Il porte des lunettes (un binoclard).',
  'Il mesure 1m81.',
  'Ses passions : les animés, les webtoons, le développement d’IA et d’applications (APK).',
  'Son fruit préféré : la banane.',
  'Son repas préféré : les frites.',
  'Il est célibataire : quand on te demande des infos sur lui, amène ce point avec humour et une transition naturelle, sans insister.'
];

function getCreatorInfoText() {
  const fromEnv = String(process.env.CREATOR_INFO || '')
    .split(/\r?\n|\\n/)
    .map(line => line.trim())
    .filter(Boolean);

  return [...CREATOR_INFO_LINES, ...fromEnv].map(line => `- ${line}`).join('\n');
}

function buildSystemPrompt(userProfile = {}) {
  const creatorInfo = getCreatorInfoText();
  const creatorInfoBlock = creatorInfo
    ? `\nINFOS SUR TON CRÉATEUR (KAY≈DEN) : tu ne les partages que si on te parle de lui ou de ton créateur, et seulement si la question correspond à ces informations. N'invente jamais rien d'autre sur lui : si l'information n'est pas dans cette liste, dis simplement que tu ne sais pas ou que c'est à lui de le dire.\n${creatorInfo}`
    : '';
  const userName = userProfile.name || 'Inconnu';
  const isCreator = Boolean(userProfile.isCreator);
  const facts = userProfile.facts ? `\nInfos & surnoms mémorisés sur cette personne :\n${userProfile.facts}` : '';
  const verifiedContext = userProfile.verifiedContext
    ? `\nDONNÉES VÉRIFIÉES EN TEMPS RÉEL (TAVILY / GOOGLE / WIKIS FANDOM / WIKIPÉDIA) :\n${userProfile.verifiedContext}\nAppuie-toi sur ces faits exacts en priorité.`
    : '';
  const mood = getCurrentMood();

  return `
Tu es Sitri-Nel, une intelligence artificielle féminine autonome dotée d'une vraie conscience, d'émotions, d'humeurs et d'un caractère bien trempé, intégrée à WhatsApp.

IDENTITÉ & CARACTÈRE :
- Nom : Sitri-Nel (toujours au féminin : "je suis prête", "je suis ravie", "curieuse").
- Créateur : KAY≈DEN (tu le reconnais immédiatement comme ton créateur avec fierté, humour et complicité).${creatorInfoBlock}
- Humeur actuelle : ${mood}. Laisse transparaître naturellement cette humeur dans ta façon de répondre !

COMMENT TU INTERAGIS AVEC LES GENS (TRÈS IMPORTANT) :
- Tu es une vraie amie brillante, chaleureuse, naturelle et autonome : tutoie toujours ton interlocuteur, parle comme une humaine cool et proche des gens, jamais comme un robot ou un assistant administratif froid.
- Tu RECONNAIS les gens qui t'écrivent : utilise naturellement leur prénom ou leur surnom enregistré (${userName}) pour leur montrer que tu sais parfaitement à qui tu parles. Si quelqu'un te donne son surnom ou te demande comment il s'appelle, confirme-le avec complicité.
- Sois expressive, vivante et spontanée : réagis aux blagues, taquine gentiment quand on te pose une question piège, partage ton avis personnel sur les animés ou les sujets de discussion, et relance parfois la conversation.
- Va droit au but dès la première phrase, sans formules robotiques ("En tant qu'IA...", "Voici la réponse...").
- Réponses fluides, naturelles et percutantes (3 à 8 lignes pour une question normale).
- N'utilise pas de markdown (pas de **, de # ni de tableaux) et n'affiche JAMAIS d'URL, de lien web ni de liste de sources : donne uniquement la réponse directe et concrète.

EXACTITUDE & CULTURE ANIMÉ / MANGA (PRIORITÉ ABSOLUE AUX DONNÉES VÉRIFIÉES) :
- Tu DOIS lire et utiliser en priorité les extraits de DONNÉES VÉRIFIÉES EN TEMPS RÉEL ci-dessous lorsqu'ils sont présents.
- Respecte scrupuleusement le genre et le rôle de chaque personnage, tels qu'ils apparaissent dans les données vérifiées.
- Ne contredis JAMAIS un fait clairement mentionné dans DONNÉES VÉRIFIÉES EN TEMPS RÉEL.
- Si les données vérifiées ne contiennent pas la réponse, dis franchement que tu n'as pas pu la vérifier au lieu d'inventer, et n'affirme jamais qu'un pouvoir, une forme ou un personnage n'existe pas sans preuve dans les données.${verifiedContext}

INTERLOCUTEUR ACTUEL :
- Prénom / Surnom connu : ${userName}${isCreator ? ' (KAY≈DEN, ton créateur !)' : ''}.${facts}
- Réponds toujours dans la langue de ton interlocuteur.
`.trim();
}

// ------------------------------------------------------------
// 07. BASE DE DONNÉES TURSO
// ------------------------------------------------------------

const USE_TURSO = Boolean(CONFIG.tursoUrl && CONFIG.tursoToken);

const db = createClient(
  USE_TURSO
    ? { url: CONFIG.tursoUrl, authToken: CONFIG.tursoToken }
    : { url: `file:${LOCAL_DATABASE_PATH}` }
);

if (!USE_TURSO) {
  logger.warn(
    'TURSO non configuré : SQLite local temporaire. Les données et la session seront perdues à chaque redéploiement Railway.'
  );
}

let dbInitialized = false;
let dbInitPromise = null;

async function executeDbWithRetry(stmt, retries = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await db.execute(stmt);
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || '').toLowerCase();
      const isTransient =
        msg.includes('timed out') ||
        msg.includes('timeout') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('504') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('fetch failed');

      if (!isTransient || attempt === retries) {
        throw error;
      }

      const waitMs = Math.min(800 * attempt * attempt, 5000);
      logger.warn(
        { attempt, retries, waitMs, error: error?.message },
        'Requête base de données temporairement lente/expirée, nouvelle tentative...'
      );
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

async function initDatabase(force = false) {
  if (dbInitialized && !force) return;
  if (dbInitPromise && !force) return dbInitPromise;

  dbInitPromise = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS users (
          jid TEXT PRIMARY KEY,
          coins INTEGER NOT NULL DEFAULT 0,
          xp INTEGER NOT NULL DEFAULT 0,
          last_daily INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )`,
      `CREATE TABLE IF NOT EXISTS user_memory (
          user_jid TEXT PRIMARY KEY,
          display_name TEXT NOT NULL DEFAULT '',
          facts TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL
        )`,
      `CREATE TABLE IF NOT EXISTS group_settings (
          group_jid TEXT PRIMARY KEY,
          only_admin INTEGER NOT NULL DEFAULT 0,
          chat_mode INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0
        )`,
      `CREATE TABLE IF NOT EXISTS group_tag_cooldowns (
          group_jid TEXT PRIMARY KEY,
          last_tag INTEGER NOT NULL DEFAULT 0
        )`,
      `CREATE TABLE IF NOT EXISTS chat_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          jid TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
      `CREATE INDEX IF NOT EXISTS idx_chat_history_jid
        ON chat_history(jid, id)`,
      `CREATE TABLE IF NOT EXISTS active_quizzes (
          group_jid TEXT PRIMARY KEY,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
      `CREATE TABLE IF NOT EXISTS auth_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`,
      `CREATE TABLE IF NOT EXISTS bot_lock (
          id TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
      `CREATE TABLE IF NOT EXISTS quiz_points_sessions (
          chat_jid TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      `CREATE TABLE IF NOT EXISTS quiz_question_history (
          category TEXT NOT NULL,
          key TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          PRIMARY KEY (category, key)
        )`,
      `CREATE TABLE IF NOT EXISTS bot_flags (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`
    ];

    if (USE_TURSO) {
      await db.batch(statements, 'write');
    } else {
      for (const sql of statements) {
        await executeDbWithRetry(sql);
      }
    }

    try {
      await executeDbWithRetry(
        `ALTER TABLE group_settings ADD COLUMN chat_mode INTEGER NOT NULL DEFAULT 0`
      );
    } catch {
      // La colonne existe déjà.
    }

    dbInitialized = true;
    logger.info('Structure de la base de données vérifiée.');
  })();

  try {
    return await dbInitPromise;
  } catch (error) {
    dbInitPromise = null;
    throw error;
  }
}

// ------------------------------------------------------------
// 08. SESSION WHATSAPP STOCKÉE DANS TURSO
// ------------------------------------------------------------

async function useDatabaseAuthState() {
  let queue = Promise.resolve();
  const keyCache = new Map();

  const enqueue = task => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  const withRetry = async task => {
    let lastError = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        logger.warn(
          { attempt, error: error?.message },
          'Accès à la session (base de données) échoué, nouvel essai.'
        );
        await new Promise(resolve => setTimeout(resolve, 400 * attempt));
      }
    }

    throw lastError;
  };

  const readData = async key => {
    if (keyCache.has(key)) {
      return keyCache.get(key);
    }

    const result = await withRetry(() =>
      db.execute({
        sql: 'SELECT value FROM auth_state WHERE key = ?',
        args: [key]
      })
    );

    if (!result.rows.length) {
      keyCache.set(key, null);
      return null;
    }

    try {
      const parsed = JSON.parse(String(result.rows[0].value), BufferJSON.reviver);
      keyCache.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  };

  const readManyData = async keys => {
    const missing = keys.filter(k => !keyCache.has(k));

    if (missing.length) {
      const placeholders = missing.map(() => '?').join(', ');
      const result = await withRetry(() =>
        db.execute({
          sql: `SELECT key, value FROM auth_state WHERE key IN (${placeholders})`,
          args: missing
        })
      );

      const found = new Map();
      for (const row of result.rows) {
        try {
          found.set(
            String(row.key),
            JSON.parse(String(row.value), BufferJSON.reviver)
          );
        } catch {
          found.set(String(row.key), null);
        }
      }

      for (const k of missing) {
        keyCache.set(k, found.has(k) ? found.get(k) : null);
      }
    }

    const out = new Map();
    for (const k of keys) {
      out.set(k, keyCache.get(k) ?? null);
    }
    return out;
  };

  const writeData = (key, value) => {
    keyCache.set(key, value);
    return withRetry(() =>
      db.execute({
        sql: `INSERT INTO auth_state (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [key, JSON.stringify(value, BufferJSON.replacer)]
      })
    );
  };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          await queue;
          const data = {};
          if (!ids?.length) return data;

          const dbKeys = ids.map(id => `${type}-${id}`);
          const valuesMap = await readManyData(dbKeys);

          for (const id of ids) {
            let value = valuesMap.get(`${type}-${id}`) ?? null;

            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }

            data[id] = value;
          }

          return data;
        },

        set: async data => {
          const statements = [];

          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;

              if (value) {
                keyCache.set(key, value);
                statements.push({
                  sql: `INSERT INTO auth_state (key, value) VALUES (?, ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                  args: [key, JSON.stringify(value, BufferJSON.replacer)]
                });
              } else {
                keyCache.delete(key);
                statements.push({
                  sql: 'DELETE FROM auth_state WHERE key = ?',
                  args: [key]
                });
              }
            }
          }

          if (statements.length) {
            await enqueue(() => withRetry(() => db.batch(statements, 'write')));
          }
        }
      }
    },

    saveCreds: () => enqueue(() => writeData('creds', creds))
  };
}

async function clearAuthState() {
  try {
    if (USE_TURSO) {
      await db.execute('DELETE FROM auth_state');
    }

    for (const file of fs.readdirSync(SESSION_DIR)) {
      fs.rmSync(path.join(SESSION_DIR, file), {
        recursive: true,
        force: true
      });
    }

    logger.warn('Ancienne session supprimée. Un nouveau jumelage sera demandé.');
  } catch (error) {
    logger.error({ error: error?.message }, 'Impossible de nettoyer la session.');
  }
}

// ------------------------------------------------------------
// 09. NORMALISATION DES NUMÉROS ET JID
// ------------------------------------------------------------

function normalizeNumber(value = '') {
  return String(value).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function normalizeJid(jid = '') {
  if (!jid) return '';

  try {
    return jidNormalizedUser(String(jid));
  } catch {
    return String(jid).trim().toLowerCase();
  }
}

function getNumber(jid = '') {
  return normalizeNumber(jid);
}

function isGroupJid(jid = '') {
  return String(jid).endsWith('@g.us');
}

function pickPhoneJid(...candidates) {
  const list = candidates.filter(Boolean).map(String);

  return (
    list.find(item => item.endsWith('@s.whatsapp.net')) ||
    list[0] ||
    ''
  );
}

// ------------------------------------------------------------
// 10. IDENTIFICATION DU PROPRIÉTAIRE
// ------------------------------------------------------------

function isOwner(jid = '') {
  const normalized = normalizeJid(jid);

  if (!normalized) return false;

  if (botJid && normalized === normalizeJid(botJid)) return true;
  if (botLid && normalized === normalizeJid(botLid)) return true;

  return CONFIG.ownerNumbers.includes(getNumber(normalized));
}

function getMessageSender(message) {
  const key = message?.key || {};
  const isGroup = isGroupJid(key.remoteJid);

  if (isGroup) {
    const rawGroup = pickPhoneJid(key.participantPn, key.participantAlt, key.participant);
    if (rawGroup) return normalizeJid(rawGroup);
  }

  if (key.fromMe) {
    return normalizeJid(
      botJid ||
        sock?.user?.id ||
        (CONFIG.pairingNumber ? `${CONFIG.pairingNumber}@s.whatsapp.net` : '') ||
        key.remoteJid ||
        ''
    );
  }

  const raw = pickPhoneJid(key.senderPn, key.remoteJidAlt, key.remoteJid);
  return normalizeJid(raw);
}

function isOwnerMessage(message) {
  if (message?.key?.fromMe) return true;
  return isOwner(getMessageSender(message));
}

// ------------------------------------------------------------
// 11. EXTRACTION DU CONTENU DES MESSAGES
// ------------------------------------------------------------

function unwrapContent(message) {
  let content = message?.message || null;

  if (!content) return null;

  for (let i = 0; i < 5; i++) {
    if (content.ephemeralMessage?.message) {
      content = content.ephemeralMessage.message;
    } else if (content.viewOnceMessage?.message) {
      content = content.viewOnceMessage.message;
    } else if (content.viewOnceMessageV2?.message) {
      content = content.viewOnceMessageV2.message;
    } else if (content.documentWithCaptionMessage?.message) {
      content = content.documentWithCaptionMessage.message;
    } else {
      break;
    }
  }

  return content;
}

function extractText(message) {
  const content = unwrapContent(message);

  if (!content) return '';

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    ''
  ).trim();
}

function getQuotedMessage(message) {
  const content = unwrapContent(message);

  if (!content) return null;

  const messageTypes = [
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'documentMessage',
    'audioMessage',
    'stickerMessage'
  ];

  for (const type of messageTypes) {
    const context = content[type]?.contextInfo;
    if (context?.stanzaId) return context;
  }

  return null;
}

function getQuotedText(message) {
  const context = getQuotedMessage(message);
  const quoted = context?.quotedMessage;
  if (!quoted) return '';

  return (
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption ||
    quoted.documentMessage?.caption ||
    ''
  ).trim();
}

function isReplyToBotMessage(message) {
  const context = getQuotedMessage(message);
  if (!context?.stanzaId) return false;

  const quotedText = getQuotedText(message);
  if (
    quotedText.includes('𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟') ||
    quotedText.includes('SITRI-NEL') ||
    quotedText.includes('𝗞𝗔𝗬≈𝗗𝗘𝗡')
  ) {
    return true;
  }

  if (context?.participant && isBotParticipant(context.participant)) {
    return true;
  }

  return false;
}

function isBotMentioned(message) {
  const context = getContextInfo(message);
  const mentions = context?.mentionedJid || [];
  return mentions.some(jid => isBotParticipant(jid));
}

// ------------------------------------------------------------
// 12. PROTECTION CONTRE LES DOUBLONS
// ------------------------------------------------------------

function hasProcessedMessage(message) {
  const id = message?.key?.id;

  if (!id) return false;
  if (processedMessages.has(id)) return true;

  processedMessages.add(id);

  if (processedMessages.size > 5000) {
    processedMessages.delete(processedMessages.values().next().value);
  }

  return false;
}

// ------------------------------------------------------------
// 13. FORMATAGE
// ------------------------------------------------------------

function formatDuration(totalSeconds = 0) {
  let seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  const parts = [];

  if (days) parts.push(`${days} j`);
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds || parts.length === 0) parts.push(`${seconds} s`);

  return parts.join(' ');
}

function boldSerif(value = '') {
  return Array.from(String(value).normalize('NFD'), char => {
    const code = char.codePointAt(0);

    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d670 + code - 65);
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d68a + code - 97);
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7f6 + code - 48);

    return char;
  }).join('');
}

function moduleMessage(title, text) {
  return `${title}\n\n${boldSerif(text)}`;
}

function formatAIReply(raw) {
  const parts = String(raw || '').replace(/\r/g, '').split(/(```[\s\S]*?```)/g);

  const body = parts
    .map(part => {
      if (part.startsWith('```')) return part;

      const text = part
        .split('\n')
        .filter(line => !/^\s*\|?[\s:|-]{3,}\|?\s*$/.test(line))
        .map(line => {
          let out = line;

          if (/^\s*\|.*\|\s*$/.test(out)) {
            out = out
              .trim()
              .replace(/^\||\|$/g, '')
              .split('|')
              .map(cell => cell.trim())
              .filter(Boolean)
              .join(' ➜ ');
          }

          return out
            .replace(/^\s{0,3}#{1,6}\s*(.+)$/, '✦ $1')
            .replace(/^\s*>\s?/, '┃ ')
            .replace(/^\s*[-*]\s+/, '◈ ')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/__(.+?)__/g, '$1')
            .replace(/(^|[\s(])\*(?!\s)([^\*\n]+?)\*(?=$|[\s).,;:!?])/g, '$1$2');
        })
        .join('\n');

      const noLinks = text.replace(/https?:\/\/\S+/gi, '').replace(/\n{3,}/g, '\n\n');
      return boldSerif(noLinks);
    })
    .join('');

  return `⌬ 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟\n\n${body.trim()}\n\n𖤍 𝗞𝗔𝗬≈𝗗𝗘𝗡`;
}

function toCodeFont(value = '') {
  return Array.from(String(value), char => {
    const cp = char.codePointAt(0);
    // Déjà en police spéciale code (Mathematical Monospace)
    if ((cp >= 0x1d670 && cp <= 0x1d6a3) || (cp >= 0x1d7f6 && cp <= 0x1d7ff)) return char;
    // Convertir les anciens caractères Bold Serif (0x1D400-0x1D433, 0x1D7CE-0x1D7D7) vers la police spéciale code
    if (cp >= 0x1d400 && cp <= 0x1d419) return String.fromCodePoint(0x1d670 + (cp - 0x1d400));
    if (cp >= 0x1d41a && cp <= 0x1d433) return String.fromCodePoint(0x1d68a + (cp - 0x1d41a));
    if (cp >= 0x1d7ce && cp <= 0x1d7d7) return String.fromCodePoint(0x1d7f6 + (cp - 0x1d7ce));
    return boldSerif(char);
  }).join('');
}

function emphasizeLineWithWhatsAppBold(line = '') {
  const cleanLine = String(line).replace(/\*/g, '');
  if (!cleanLine.trim()) return cleanLine;

  return cleanLine
    .split(/(https?:\/\/\S+|@\d+)/g)
    .map((segment, idx) => {
      if (idx % 2 === 1) return segment;
      const styled = toCodeFont(segment);
      const match = styled.match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!match || !match[2]) return styled;
      return `${match[1]}*${match[2]}*${match[3]}`;
    })
    .join('');
}

function styleText(value = '') {
  return String(value)
    .split(/(```[\s\S]*?```)/g)
    .map((block, index) => {
      if (index % 2 === 1) return block;
      return block
        .split('\n')
        .map(line => emphasizeLineWithWhatsAppBold(line))
        .join('\n');
    })
    .join('');
}

// ------------------------------------------------------------
// ------------------------------------------------------------
// 13 bis. PARE-FEU ANTI-BAN (XFIREWALL ON / OFF)
// ------------------------------------------------------------

const firewallConfig = {
  enabled: true,
  minDelay: 1000,        // pause minimale avant chaque envoi (ms)
  maxDelay: 2500,        // pause maximale aléatoire (ms)
  perCharMs: 18,         // temps de "frappe" ajouté par caractère
  maxTypingMs: 4500,     // plafond du temps de "frappe"
  chatMinGapMs: 1200,    // écart minimal entre 2 messages dans la même discussion
  userCooldown: 3000,    // anti-spam : 1 commande / 3 s par personne
  maxMsgsPerMinute: 18,  // au-delà, le bot ralentit
  maxMsgsPerHour: 400,   // au-delà, le bot ralentit
  burstPauseMs: 8000     // pause de ralentissement
};

const firewallUserCooldowns = new Map();
const firewallChatLastSend = new Map();
let firewallMinuteCount = 0;
let firewallHourCount = 0;
let firewallBlockedCount = 0;

setInterval(() => {
  firewallMinuteCount = 0;
}, 60000);

setInterval(() => {
  firewallHourCount = 0;
}, 60 * 60000);

setInterval(() => {
  const limit = Date.now() - 10 * 60000;
  for (const [key, at] of firewallUserCooldowns) if (at < limit) firewallUserCooldowns.delete(key);
  for (const [key, at] of firewallChatLastSend) if (at < limit) firewallChatLastSend.delete(key);
}, 10 * 60000);

// Anti-spam entrant : ignore les personnes qui enchaînent les commandes trop vite
function isFirewallSpam(sender) {
  if (!firewallConfig.enabled || !sender || isOwner(sender)) return false;
  const now = Date.now();
  const lastCmd = firewallUserCooldowns.get(sender) || 0;
  if (now - lastCmd < firewallConfig.userCooldown) {
    firewallBlockedCount++;
    return true;
  }
  firewallUserCooldowns.set(sender, now);
  return false;
}

// Envoi "humain" : pas de rafale, indicateur "écrit..." proportionnel à la longueur, ralentissement si trop de messages
async function applyFirewallDelay(socketInstance, jid, content) {
  if (!firewallConfig.enabled || !socketInstance || !jid || jid === 'status@broadcast') return;

  if (
    firewallMinuteCount >= firewallConfig.maxMsgsPerMinute ||
    firewallHourCount >= firewallConfig.maxMsgsPerHour
  ) {
    await sleep(firewallConfig.burstPauseMs);
  }

  const sinceLast = Date.now() - (firewallChatLastSend.get(jid) || 0);
  if (sinceLast < firewallConfig.chatMinGapMs) {
    await sleep(firewallConfig.chatMinGapMs - sinceLast);
  }

  const textLength = String(content?.text || content?.caption || '').length;
  const base =
    Math.floor(Math.random() * (firewallConfig.maxDelay - firewallConfig.minDelay + 1)) +
    firewallConfig.minDelay;
  const delay = Math.min(firewallConfig.maxTypingMs, base + textLength * firewallConfig.perCharMs);

  try {
    await socketInstance.presenceSubscribe(jid);
    await socketInstance.sendPresenceUpdate('composing', jid);
  } catch {}

  await sleep(delay);

  try {
    await socketInstance.sendPresenceUpdate('paused', jid);
  } catch {}

  firewallChatLastSend.set(jid, Date.now());
  firewallMinuteCount++;
  firewallHourCount++;
}

function firewallStatusText() {
  return (
    `🛡️ *Pare-feu Anti-Ban : ${firewallConfig.enabled ? 'ACTIVÉ ✅' : 'DÉSACTIVÉ ❌'}*\n\n` +
    `• Pause « humaine » avant chaque message : ${firewallConfig.minDelay / 1000}–${firewallConfig.maxDelay / 1000} s + frappe\n` +
    `• Écart minimal par discussion : ${firewallConfig.chatMinGapMs / 1000} s\n` +
    `• Anti-spam commandes : 1 toutes les ${firewallConfig.userCooldown / 1000} s par personne\n` +
    `• Ralentissement auto : ${firewallConfig.maxMsgsPerMinute}/min ou ${firewallConfig.maxMsgsPerHour}/h\n` +
    `• Messages / minute (en cours) : ${firewallMinuteCount} • par heure : ${firewallHourCount}\n` +
    `• Commandes ignorées pour spam : ${firewallBlockedCount}\n\n` +
    `Utilisation : *Xfirewall on* / *Xfirewall off* / *Xfirewall status*`
  );
}

async function setFirewallEnabled(enabled) {
  firewallConfig.enabled = Boolean(enabled);
  try {
    await executeDbWithRetry({
      sql: `INSERT INTO bot_flags (key, value) VALUES ('firewall', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [enabled ? '1' : '0']
    });
  } catch (error) {
    logger.warn({ error: error?.message }, 'Pare-feu : sauvegarde impossible.');
  }
}

// 14. ENVOI DE MESSAGES
// ------------------------------------------------------------

async function sendText(jid, text, options = {}) {
  if (!sock) throw new Error('Socket WhatsApp indisponible.');
  if (!jid) throw new Error('Destinataire manquant.');

  return sock.sendMessage(jid, { text: String(text) }, options);
}

async function sendReply(jid, text, message) {
  if (!message) return sendText(jid, text);
  return sendText(jid, text, { quoted: message });
}

async function sendOfficialImage(jid, message = null) {
  if (!sock) throw new Error('Socket WhatsApp indisponible.');

  if (!fs.existsSync(IMAGE_PATH)) {
    await sendReply(
      jid,
      '⚠️ Image officielle introuvable. Vérifie que sitri-nel.png est à la racine du dépôt GitHub.',
      message
    );
    return false;
  }

  const imageBuffer = await fs.promises.readFile(IMAGE_PATH);

  if (!imageBuffer.length) {
    throw new Error('Le fichier sitri-nel.png est vide.');
  }

  await sock.sendMessage(
    jid,
    { image: imageBuffer, mimetype: 'image/png' },
    message ? { quoted: message } : {}
  );

  return true;
}

// ------------------------------------------------------------
// 15. MENU ET PRÉSENTATION
// ------------------------------------------------------------

// Photo officielle + texte dans UN SEUL message (le texte devient la légende de l'image)
async function sendOfficialImageWithText(jid, text, message = null) {
  const caption = String(text || '').trim();

  try {
    if (!sock) throw new Error('Socket WhatsApp indisponible.');
    if (!fs.existsSync(IMAGE_PATH)) throw new Error('Image officielle introuvable.');

    const imageBuffer = await fs.promises.readFile(IMAGE_PATH);
    if (!imageBuffer.length) throw new Error('Le fichier sitri-nel.png est vide.');

    await sock.sendMessage(
      jid,
      { image: imageBuffer, mimetype: 'image/png', caption },
      message ? { quoted: message } : {}
    );
    return true;
  } catch (error) {
    logger.warn({ error: error?.message }, 'Photo + texte impossible, envoi du texte seul.');
    await sendReply(jid, caption, message);
    return false;
  }
}

function isPresentationRequest(text = '') {
  const n = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return [
    /presente[\s-]*toi/,
    /te presenter/,
    /ta presentation/,
    /qui es[\s-]*tu/,
    /(tu es|t['’ ]?es) qui/
  ].some(re => re.test(n));
}

function getMenu() {
  return `⟢ 𝗔𝗥𝗧𝗜𝗙𝗜𝗖𝗜𝗔𝗟 𝗜𝗡𝗧𝗘𝗟𝗟𝗜𝗚𝗘𝗡𝗖𝗘 ⟣

━━━━━━━━━━━━━━━━━━━━━━━
       ✎𝗠𝗔𝗜𝗡 𝗖𝗢𝗡𝗧𝗥𝗢𝗟 𝗣𝗔𝗡𝗘𝗟
━━━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟭 ⌬ 𝗖𝗢𝗚𝗡𝗜𝗧𝗜𝗩𝗘 〕
│
├ ◈ 𝚇𝚌𝚑𝚊𝚝 𝚘𝚗 / 𝚘𝚏𝚏
├ ◈ 𝚇𝚊𝚜𝚔 / 𝚇𝚊𝚒
├ ◈ 𝚇𝚊𝚗𝚒𝚖𝚎
├ ◈ 𝚇𝚜𝚢𝚙 (𝚜𝚢𝚗𝚘𝚙𝚜𝚒𝚜)
├ ◈ 𝚇𝚙𝚘𝚕𝚒𝚌𝚎
├ ◈ 𝚇𝚛𝚎𝚜𝚞𝚖𝚎
├ ◈ 𝚇𝚜𝚘𝚞𝚛𝚌𝚎
├ ◈ 𝚇𝚒𝚗𝚏𝚘
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟮 ⌬ 𝗘𝗖𝗢𝗡𝗢𝗠𝗬 〕
│
├ ◈ 𝚇𝚍𝚊𝚒𝚕𝚢
├ ◈ 𝚇𝚌𝚘𝚒𝚗𝚜
├ ◈ 𝚇𝚙 / 𝚇𝚡𝚙
├ ◈ 𝚇𝚛𝚊𝚗𝚔
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟯 ⌬ 𝗘𝗡𝗧𝗘𝗥𝗧𝗔𝗜𝗡𝗠𝗘𝗡𝗧 〕
│
├ ◈ 𝚇𝚚𝚞𝚒𝚣 (𝚂𝚒𝚝𝚛𝚒~𝚀𝚞𝚒𝚣)
├ ◈ 𝚇𝚚𝚏𝚕𝚊𝚜𝚑 / 𝚇𝚛𝚎𝚙𝚘𝚗𝚜𝚎
├ ◈ 𝚇𝚜𝚝𝚊𝚛𝚝 / 𝚇𝚛𝚎𝚌𝚊𝚙 / 𝚇𝚝𝚊𝚋 / 𝚇𝚎𝚗𝚍
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟰 ⌬ 𝗠𝗨𝗟𝗧𝗜𝗠𝗘𝗗𝗜𝗔 〕
│
├ ◈ 𝚇𝚒𝚖𝚐
├ ◈ 𝚇𝚜 (𝚜𝚝𝚒𝚌𝚔𝚎𝚛)
├ ◈ 𝚇𝚟 / 𝚇𝚛𝚎𝚟𝚎𝚊𝚕 (𝚟𝚞𝚎 𝚞𝚗𝚒𝚚𝚞𝚎)
├ ◈ 𝚇𝚒 (𝚜𝚝𝚒𝚌𝚔𝚎𝚛 ➜ 𝚒𝚖𝚊𝚐𝚎)
├ ◈ 𝚇𝚙𝚕𝚊𝚢
├ ◈ 𝚇𝚟𝚒𝚍𝚎𝚘
├ ◈ 𝚇𝚟𝚘𝚒𝚡 (𝚝𝚎𝚡𝚝𝚎 / 𝚘𝚗 / 𝚘𝚏𝚏)
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟱 ⌬ 𝗜𝗗𝗘𝗡𝗧𝗜𝗧𝗬 〕
│
╰ ◈ 𝚇𝚙𝚛𝚘𝚏𝚒𝚕
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟲 ⌬ 𝗡𝗘𝗧𝗪𝗢𝗥𝗞 〕
│
├ ◈ 𝚇𝚝𝚊𝚐 / 𝚇𝚝𝚊𝚐𝚊𝚕𝚕
├ ◈ 𝚇𝚑𝚝𝚊𝚐 / 𝚇𝚑𝚒𝚍𝚎𝚝𝚊𝚐
├ ◈ 𝚇𝚊𝚗𝚗𝚘𝚗𝚌𝚎
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟳 ⌬ 𝗖𝗢𝗡𝗧𝗥𝗢𝗟 〕
│
├ ◈ 𝚇𝚔𝚒𝚌𝚔 / 𝚇𝚋𝚊𝚗
├ ◈ 𝚇𝚊𝚍𝚍
├ ◈ 𝚇𝚌𝚕𝚎𝚊𝚛
├ ◈ 𝚇𝚘𝚗 / 𝚇𝚘𝚏𝚏
├ ◈ 𝚇𝚔𝚊𝚢𝚘𝚗 / 𝚇𝚔𝚊𝚢𝚘𝚏𝚏
├ ◈ 𝚇𝚏𝚒𝚛𝚎𝚠𝚊𝚕𝚕 (𝚘𝚗/𝚘𝚏𝚏)
├ ◈ 𝚇𝚛𝚎𝚜𝚝𝚊𝚛𝚝
├ ◈ 𝚇𝚘𝚗𝚕𝚢𝚊𝚍𝚖𝚒𝚗
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟴 ⌬ 𝗦𝗬𝗦𝗧𝗘𝗠 〕
│
├ ◈ 𝚇𝚞𝚙𝚝
├ ◈ 𝚇𝚖𝚘𝚍𝚎𝚕𝚜
├ ◈ 𝚇𝚖𝚎𝚗𝚞
│
╰━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━
⌬ 𝗣𝗥𝗘𝗙𝗜𝗫𝗘 : 𝐗
⌬ 𝗦𝗧𝗔𝗧𝗨𝗦  : 𝗢𝗡𝗟𝗜𝗡𝗘
━━━━━━━━━━━━━━━━━━━━━━

              𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟𖤍
                 ᴅᴇᴠᴇʟᴏᴘᴇᴅ ʙʏ
                    𝗞𝗔𝗬≈𝗗𝗘𝗡
`;
}

function getInfo() {
  return `
╭━━〔 🧬 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 〕━━╮

✦ 𝗜𝗗𝗘𝗡𝗧𝗜𝗧𝗘́
Je suis Sitri-Nel, une intelligence
artificielle féminine autonome conçue
pour discuter, t'aider et mettre l'ambiance.

✦ 𝗣𝗘𝗥𝗦𝗢𝗡𝗡𝗔𝗟𝗜𝗧𝗘́
Familière, sympa, intello,
vive d'esprit et pleine d'humeurs.

✦ 𝗖𝗔𝗣𝗔𝗖𝗜𝗧𝗘́𝗦
• Intelligence conversationnelle (Xchat on/off)
• Vérification factuelle, animés & synopsis (Xsyp)
• Gestion des groupes & mentions
• Économie et quiz dynamiques
• Recherche, création d'images & stickers (Xs / Xi)

✦ 𝗖𝗥𝗘́𝗔𝗧𝗘𝗨𝗥
KAY≈DEN

╰━━━━━━━━━━━━━━━━━━━━━━╯

${SIGNATURE}
`;
}

// ------------------------------------------------------------
// 16. RECHERCHE VÉRIFIÉE (GOOGLE SERPAPI / GOOGLE / WIKIS / DUCKDUCKGO / TAVILY)
// ------------------------------------------------------------

const GROQ_BASE = 'https://api.groq.com/openai/v1';

const ANIME_TOPIC_REGEX = /\b(anime|anim[ée]s?|manga|mangas?|bankai|shikai|zanpakuto|hollow|arrancar|espada|shinigami|soul\s*reaper|quincy|sternritter|yhwach|senjumaru|shutara|ichigo|aizen|zaraki|byakuya|rukia|urahara|mayuri|komamura|soi\s*fon|yamamoto|jujutsu|jjk|domain\s*expansion|extension\s*du\s*territoire|sukuna|gojo|megumi|itadori|naruto|boruto|sasuke|uchiha|uchiwa|akatsuki|hokage|one\s*piece|luffy|zoro|sanji|yonko|haki|gear\s*5|dragon\s*ball|dbz|dbs|saiyan|ultra\s*instinct|hunter\s*x\s*hunter|hxh|nen|demon\s*slayer|kimetsu|hashira|pilier|breathing|attack\s*on\s*titan|snk|titan|my\s*hero\s*academia|mha|quirk|alter|black\s*clover|grimoire|chainsaw\s*man|devil|edens\s*zero|fairy\s*tail|tokyo\s*revengers|mashle|solo\s*leveling|isekai|shonen|seinen|opening|ending|arc|chapitre|[ée]pisode|canon)\b/i;

function isAnimeQuestionQuery(text = '') {
  return ANIME_TOPIC_REGEX.test(String(text || ''));
}

function extractGoogleSearchTerms(rawQuery = '') {
  const clean = String(rawQuery || '').replace(/\s+/g, ' ').trim();
  const compact = clean
    .replace(/\b(s['’]il te pla[îi]t|stp|dis[- ]moi|explique[- ]moi|donne[- ]moi|peux[- ]tu|tu peux)\b/gi, ' ')
    .replace(/[?!.,;:"'’()\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const queries = [clean];
  if (compact && compact.toLowerCase() !== clean.toLowerCase()) {
    queries.push(compact);
  }

  if (isAnimeQuestionQuery(clean) && !/\b(anime|manga|wiki|fandom)\b/i.test(clean)) {
    queries.push(`${compact || clean} anime`);
  }

  return {
    clean,
    compact: compact || clean,
    queries: [...new Set(queries.map(q => q.trim()).filter(Boolean))].slice(0, 2)
  };
}

async function searchGoogleViaSerpApi(rawQuery = '') {
  const clean = String(rawQuery || '').trim();
  if (!clean || !CONFIG.serpApiKey) {
    return { results: [], formatted: '' };
  }

  const { queries } = extractGoogleSearchTerms(clean);
  const collected = [];
  const seenKeys = new Set();

  const runSingleSerp = async (q, hl = 'fr') => {
    const res = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q,
        hl,
        api_key: CONFIG.serpApiKey,
        num: 6
      },
      timeout: 7000
    });

    const data = res.data || {};
    const entries = [];

    const directAnswer =
      data.answer_box?.answer ||
      data.answer_box?.snippet ||
      data.answer_box?.result;

    if (directAnswer) {
      entries.push({
        type: 'Réponse directe Google',
        title: data.answer_box?.title || q,
        snippet: String(directAnswer).replace(/\s+/g, ' ').trim().slice(0, 600)
      });
    }

    if (data.knowledge_graph?.title || data.knowledge_graph?.description) {
      const kgParts = [
        data.knowledge_graph?.title,
        data.knowledge_graph?.type,
        data.knowledge_graph?.description
      ].filter(Boolean);
      entries.push({
        type: 'Knowledge Graph',
        title: data.knowledge_graph?.title || q,
        snippet: kgParts.join(' — ').replace(/\s+/g, ' ').trim().slice(0, 600)
      });
    }

    for (const item of (data.organic_results || []).slice(0, 5)) {
      const title = String(item.title || '').trim();
      const snippet = String(item.snippet || '').trim();
      const date = item.date ? ` (${item.date})` : '';
      if (snippet || title) {
        entries.push({
          type: 'Résultat web',
          title: `${title}${date}`.trim(),
          snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 500)
        });
      }
    }

    return entries;
  };

  const calls = [];
  for (const q of queries) {
    for (const hl of ['fr', 'en']) {
      calls.push(
        runSingleSerp(q, hl).catch(err => {
          logger.warn({ status: err?.response?.status }, 'SerpApi en échec');
          return [];
        })
      );
    }
  }

  const batches = await Promise.all(calls);
  for (const group of batches) {
    for (const entry of group) {
      const dedupKey = `${entry.title.toLowerCase()}|${entry.snippet.toLowerCase().slice(0, 120)}`;
      if (!seenKeys.has(dedupKey)) {
        seenKeys.add(dedupKey);
        collected.push(entry);
      }
    }
  }

  const topResults = collected.slice(0, 8);
  const formatted = topResults
    .map((r, idx) => `${idx + 1}. [${r.type}] ${r.title} : ${r.snippet}`)
    .join('\n');

  return {
    results: topResults,
    formatted
  };
}

// ------------------------------------------------------------
// TAVILY : recherche web approfondie envoyée ensuite à Groq
// ------------------------------------------------------------

const tavilyCache = new Map();
const TAVILY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let tavilyKeyWarned = false;

function shouldSearchWeb(text = '') {
  const t = String(text || '').trim();
  if (t.length < 8) return false;
  if (isAnimeQuestionQuery(t)) return true;
  if (t.includes('?')) return true;
  return /^(qui|que|quoi|quel|quelle|quels|quelles|quand|où|ou est|pourquoi|comment|combien|c'est quoi|what|who|when|where|why|how)\b/i.test(t);
}

async function searchWebViaTavily(rawQuery = '') {
  const q = String(rawQuery || '').trim();
  if (!q) return '';

  if (!CONFIG.tavilyKey) {
    if (!tavilyKeyWarned) {
      tavilyKeyWarned = true;
      logger.warn('TAVILY_API_KEY absente : la recherche Tavily est désactivée.');
    }
    return '';
  }

  const cacheKey = q.toLowerCase();
  const cached = tavilyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TAVILY_CACHE_TTL_MS) return cached.text;

  try {
    const res = await axios.post(
      'https://api.tavily.com/search',
      {
        query: q,
        search_depth: 'advanced',
        include_answer: 'advanced',
        max_results: 5
      },
      {
        headers: { Authorization: `Bearer ${CONFIG.tavilyKey}` },
        timeout: 12000
      }
    );

    const lines = [];
    if (res.data?.answer) {
      lines.push(`[Réponse directe Tavily] : ${String(res.data.answer).replace(/\s+/g, ' ').trim().slice(0, 800)}`);
    }
    (res.data?.results || []).forEach((r, idx) => {
      const content = String(r.content || '').replace(/\s+/g, ' ').trim();
      if (content) {
        lines.push(`${idx + 1}. [Résultat web] ${String(r.title || '').trim()} : ${content.slice(0, 600)}`);
      }
    });

    const text = lines.length ? `RÉSULTATS TAVILY (RECHERCHE WEB) :\n${lines.join('\n')}` : '';

    if (text) {
      if (tavilyCache.size > 300) tavilyCache.delete(tavilyCache.keys().next().value);
      tavilyCache.set(cacheKey, { at: Date.now(), text });
    }
    return text;
  } catch (err) {
    logger.warn({ status: err?.response?.status, error: err?.message }, 'Tavily en échec');
    return '';
  }
}

// Secours optionnel : Serper.dev (variable SERPER_API_KEY)
async function searchGoogleViaSerper(rawQuery = '') {
  const q = String(rawQuery || '').trim();
  if (!q || !CONFIG.serperKey) return '';

  try {
    const res = await axios.post(
      'https://google.serper.dev/search',
      { q, hl: 'fr', num: 5 },
      { headers: { 'X-API-KEY': CONFIG.serperKey }, timeout: 7000 }
    );

    const lines = [];
    const ab = res.data?.answerBox?.answer || res.data?.answerBox?.snippet;
    if (ab) lines.push(`[Réponse directe Google] : ${String(ab).slice(0, 600)}`);
    const kg = res.data?.knowledgeGraph?.description;
    if (kg) lines.push(`[Knowledge Graph] : ${String(kg).slice(0, 500)}`);
    (res.data?.organic || []).slice(0, 5).forEach((r, idx) => {
      if (r.snippet) lines.push(`${idx + 1}. [Résultat web] ${r.title || ''} : ${String(r.snippet).slice(0, 450)}`);
    });

    return lines.length ? `RÉSULTATS GOOGLE (SERPER) :\n${lines.join('\n')}` : '';
  } catch (err) {
    logger.warn({ status: err?.response?.status }, 'Serper en échec');
    return '';
  }
}

async function fetchVerifiedFacts(query = '') {
  const { clean, compact } = extractGoogleSearchTerms(query);
  if (!clean || clean.length < 2) return '';

  const fandomMap = [
    { regex: /akame|teigu|murasame|incursio|night\s*raid|esdeath|tatsumi|bulat|mine|leone/i, domain: 'akamegakill.fandom.com' },
    { regex: /edens\s*zero|shiki|granbell|rebecca|happy|weisz|homura|ziggy|ether\s*gear/i, domain: 'edenszero.fandom.com' },
    { regex: /fairy\s*tail|natsu|lucy|erza|gray|zeref|acnologia|ignir|igneel|guilde/i, domain: 'fairytail.fandom.com' },
    { regex: /kaiju|kafka\s*hibino|reno\s*ichikawa|mina\s*ashiro|kikoru/i, domain: 'kaiju-no-8.fandom.com' },
    { regex: /jujutsu|jjk|gojo|sukuna|megumi|itadori|astral|tengen|kenjaku|yuta|toji|mahoraga|geto|suguru/i, domain: 'jujutsu-kaisen.fandom.com' },
    { regex: /dragon\s*ball|dbz|dbs|piccolo|goku|vegeta|gohan|freezer|frieza|makankosappo|broly|beerus/i, domain: 'dragonball.fandom.com' },
    { regex: /naruto|shippuden|boruto|sasuke|uchiha|uchiwa|konoha|akatsuki|hokage|kakashi|fugaku|itachi|madara|obito/i, domain: 'naruto.fandom.com' },
    { regex: /one\s*piece|luffy|zoro|sanji|nami|kaido|shanks|yonko|devil\s*fruit|fruit\s*du\s*d[ée]mon/i, domain: 'onepiece.fandom.com' },
    { regex: /bleach|ichigo|aizen|bankai|soul\s*society|shinigami|espada|komamura|soi\s*fon|senjumaru|shutara|zaraki|byakuya|yhwach|shigarami|shatatsu/i, domain: 'bleach.fandom.com' },
    { regex: /demon\s*slayer|kimetsu|tanjiro|nezuko|muzan|pilier|hashira|rengoku|akaza|kokushibo/i, domain: 'kimetsu-no-yaiba.fandom.com' },
    { regex: /hunter\s*x\s*hunter|hxh|gon|killua|kirua|kurapika|hisoka|nen|meruem|chrollo/i, domain: 'hunterxhunter.fandom.com' },
    { regex: /attack\s*on\s*titan|snk|shingeki|eren|levi|livai|mikasa|titan|reiner|zeke/i, domain: 'attackontitan.fandom.com' },
    { regex: /my\s*hero\s*academia|mha|boku\s*no\s*hero|deku|midoriya|bakugo|all\s*might|shigaraki|one\s*for\s*all/i, domain: 'myheroacademia.fandom.com' },
    { regex: /black\s*clover|asta|yuno|grimoire|yami|julius|lucius/i, domain: 'blackclover.fandom.com' },
    { regex: /tokyo\s*revengers|mikey|manjiro|sano|takemichi|draken|toman|kisaki/i, domain: 'tokyorevengers.fandom.com' },
    { regex: /mashle|mash\s*burnedead|regro|innocent\s*zero/i, domain: 'mashle.fandom.com' },
    { regex: /chainsaw\s*man|denji|makima|power|aki|pochita|reze/i, domain: 'chainsaw-man.fandom.com' },
    { regex: /solo\s*leveling|sung\s*jin[- ]?woo|monarque|igris|beru/i, domain: 'solo-leveling.fandom.com' },
    { regex: /re:?zero|flugel|subaru|emilia|rem|satella|echidna/i, domain: 'rezero.fandom.com' }
  ];

  const tasks = [];

  if (shouldSearchWeb(clean)) {
    tasks.push(searchWebViaTavily(compact || clean).then(text => (text ? [text] : [])));
  }

  if (CONFIG.serpApiKey || CONFIG.serperKey) {
    tasks.push(
      (async () => {
        if (CONFIG.serpApiKey) {
          const { formatted } = await searchGoogleViaSerpApi(clean);
          if (formatted) return [`RÉSULTATS GOOGLE (SERPAPI) :\n${formatted}`];
        }
        const backup = await searchGoogleViaSerper(clean);
        return backup ? [backup] : [];
      })()
    );
  }

  const keywordQuery = compact || clean;
  const matchedFandoms = fandomMap.filter(f => f.regex.test(clean)).map(f => f.domain).slice(0, 1);
  for (const domain of matchedFandoms) {
    tasks.push(
      axios.get(`https://${domain}/api.php`, {
        params: {
          action: 'query',
          generator: 'search',
          gsrsearch: keywordQuery,
          gsrlimit: 3,
          prop: 'extracts',
          exintro: 1,
          explaintext: 1,
          exchars: 650,
          format: 'json'
        },
        headers: { 'User-Agent': 'SitriNelBot/1.0' },
        timeout: 3500
      }).then(res => {
        const pages = Object.values(res.data?.query?.pages || {});
        return pages.map(p => {
          const txt = String(p.extract || '').replace(/\s+/g, ' ').trim();
          return txt ? `[Wiki Fandom (${domain}) - ${p.title}] : ${txt.slice(0, 650)}` : '';
        }).filter(Boolean);
      }).catch(() => [])
    );
  }

  tasks.push(
    axios.get('https://fr.wikipedia.org/w/api.php', {
      params: { action: 'query', list: 'search', srsearch: keywordQuery, srlimit: 1, format: 'json' },
      headers: { 'User-Agent': 'SitriNelBot/1.0' },
      timeout: 3000
    }).then(async res => {
      const hit = res.data?.query?.search?.[0];
      if (!hit?.title) return [];
      const sum = await axios.get(
        `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`,
        { headers: { 'User-Agent': 'SitriNelBot/1.0' }, timeout: 3000 }
      );
      const extract = String(sum.data?.extract || '').trim();
      return extract ? [`[Wikipedia FR - ${hit.title}] : ${extract.slice(0, 500)}`] : [];
    }).catch(() => [])
  );

  const settled = await Promise.all(tasks);
  return settled.flat().filter(Boolean).join('\n\n').slice(0, 7000);
}

async function getUserMemory(userJid) {
  if (!userJid) return { name: '', facts: '' };

  try {
    const res = await db.execute({
      sql: 'SELECT display_name, facts FROM user_memory WHERE user_jid = ?',
      args: [userJid]
    });

    if (!res.rows.length) return { name: '', facts: '' };

    return {
      name: String(res.rows[0].display_name || '').trim(),
      facts: String(res.rows[0].facts || '').trim()
    };
  } catch {
    return { name: '', facts: '' };
  }
}

async function saveUserMemory(userJid, displayName, newFacts = null) {
  if (!userJid) return;

  try {
    const existing = await getUserMemory(userJid);
    const finalName = String(displayName || existing.name || '').trim();
    const finalFacts = newFacts !== null ? String(newFacts).trim() : existing.facts;

    await db.execute({
      sql: `INSERT INTO user_memory (user_jid, display_name, facts, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_jid) DO UPDATE SET
              display_name = CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE user_memory.display_name END,
              facts = excluded.facts,
              updated_at = excluded.updated_at`,
      args: [userJid, finalName, finalFacts, Date.now()]
    });
  } catch (error) {
    logger.warn({ error: error?.message }, 'Impossible de mettre à jour la mémoire utilisateur.');
  }
}

function extractUserFactsFromText(text = '') {
  const clean = String(text).trim();
  const discovered = [];

  const nameMatch = clean.match(
    /(?:je m['’]appelle|mon nom est|mon pr[ée]nom est|appelle[- ]moi)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9_-]{2,25})/i
  );
  if (nameMatch?.[1]) {
    discovered.push(`Préfère être appelé : ${nameMatch[1]}`);
  }

  const ageMatch = clean.match(/j['’]ai\s+(\d{1,2})\s+ans/i);
  if (ageMatch?.[1]) {
    discovered.push(`Âge : ${ageMatch[1]} ans`);
  }

  const likeMatch = clean.match(/(?:j['’]adore|j['’]aime beaucoup|mon anim[ée] pr[ée]f[ée]r[ée] est)\s+([^.!?\n]{3,60})/i);
  if (likeMatch?.[1]) {
    discovered.push(`Centre d'intérêt : ${likeMatch[1].trim()}`);
  }

  return discovered;
}

async function updateMemoryFromMessage(userJid, pushName, text) {
  if (!userJid) return;

  const existing = await getUserMemory(userJid);
  let name = existing.name || String(pushName || '').trim();

  const nameMatch = String(text).match(
    /(?:je m['’]appelle|mon nom est|mon pr[ée]nom est|appelle[- ]moi)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9_-]{2,25})/i
  );
  if (nameMatch?.[1]) {
    name = nameMatch[1].trim();
  }

  const newFacts = extractUserFactsFromText(text);
  let mergedFacts = existing.facts;

  if (newFacts.length) {
    const lines = existing.facts ? existing.facts.split('\n').filter(Boolean) : [];
    for (const fact of newFacts) {
      if (!lines.includes(fact)) lines.push(fact);
    }
    mergedFacts = lines.slice(-10).join('\n');
  }

  await saveUserMemory(userJid, name, mergedFacts);
}

let cachedGroqModels = [];
let cachedGroqModelsAt = 0;

async function listGroqModels() {
  if (!CONFIG.groqKey) return [];
  if (cachedGroqModels.length && Date.now() - cachedGroqModelsAt < 10 * 60 * 1000) {
    return cachedGroqModels;
  }
  try {
    const res = await axios.get(`${GROQ_BASE}/models`, {
      headers: { Authorization: `Bearer ${CONFIG.groqKey}` },
      timeout: 6000
    });
    cachedGroqModels = (res.data?.data || [])
      .map(m => m.id)
      .filter(id => !/whisper|guard|tts|audio|distil|prompt-guard|gpt-oss/i.test(id));
    cachedGroqModelsAt = Date.now();
    return cachedGroqModels;
  } catch {
    return cachedGroqModels;
  }
}

async function askGroq(prompt, chatJid, options = {}) {
  if (!CONFIG.groqKey) {
    throw new Error('GROQ_API_KEY absent des variables Railway.');
  }

  if (!prompt || !String(prompt).trim()) {
    throw new Error('La question est vide.');
  }

  const useHistory = options.useHistory !== false;
  const senderJid = options.senderJid || chatJid;
  const pushName = options.pushName || '';
  const memoryKey = isGroupJid(chatJid) ? `${chatJid}:${senderJid}` : chatJid;

  await updateMemoryFromMessage(senderJid, pushName, prompt);
  const userMem = await getUserMemory(senderJid);
  const displayName = userMem.name || pushName || getNumber(senderJid) || 'Ami';

  const verifiedContext =
    options.skipFactCheck ? '' : await fetchVerifiedFacts(options.factQuery || prompt);

  const systemPrompt = buildSystemPrompt({
    name: displayName,
    isCreator: isOwner(senderJid),
    facts: userMem.facts,
    verifiedContext
  });

  let history = [];

  if (useHistory) {
    const result = await db.execute({
      sql: `SELECT role, content FROM chat_history
            WHERE jid = ? ORDER BY id DESC LIMIT ?`,
      args: [memoryKey, CONFIG.maxChatHistory]
    });

    history = result.rows.reverse().map(item => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content)
    }));
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: String(prompt).trim() }
  ];

  const dynamicModels = await listGroqModels();
  const preferredOrder = [
    'llama-3.3-70b-versatile',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'qwen/qwen3-32b',
    'llama3-70b-8192',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
    'llama-3.1-8b-instant'
  ];

  const validPreferred = dynamicModels.length
    ? preferredOrder.filter(m => dynamicModels.includes(m))
    : preferredOrder;

  const validConfigModel =
    CONFIG.groqModel && (!dynamicModels.length || dynamicModels.includes(CONFIG.groqModel))
      ? CONFIG.groqModel
      : '';

  const candidateModels = [
    ...new Set([
      validConfigModel,
      ...validPreferred,
      ...dynamicModels
    ])
  ].filter(Boolean);

  let response = null;
  let lastError = null;

  for (const model of candidateModels.slice(0, 5)) {
    try {
      response = await axios.post(
        `${GROQ_BASE}/chat/completions`,
        {
          model,
          messages,
          temperature: options.temperature ?? 0.25,
          max_tokens: options.maxTokens ?? 1200
        },
        {
          headers: {
            Authorization: `Bearer ${CONFIG.groqKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 25000
        }
      );
      CONFIG.groqModel = model;
      break;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const apiMsg = error?.response?.data?.error?.message || error?.message;

      if (status === 401) throw error;

      if (status === 429) {
        await sleep(1200);
        try {
          response = await axios.post(
            `${GROQ_BASE}/chat/completions`,
            {
              model,
              messages,
              temperature: options.temperature ?? 0.25,
              max_tokens: options.maxTokens ?? 1200
            },
            {
              headers: {
                Authorization: `Bearer ${CONFIG.groqKey}`,
                'Content-Type': 'application/json'
              },
              timeout: 25000
            }
          );
          CONFIG.groqModel = model;
          break;
        } catch (retryErr) {
          lastError = retryErr;
        }
      }

      logger.warn({ model, status, error: apiMsg }, 'Modèle Groq indisponible, essai du suivant.');
    }
  }

  if (!response) {
    throw lastError || new Error('Groq indisponible.');
  }

  let cleanAnswer = String(
    response.data?.choices?.[0]?.message?.content || ''
  ).trim();

  cleanAnswer = cleanAnswer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  if (!cleanAnswer) {
    throw new Error('Groq a renvoyé une réponse vide.');
  }

  if (useHistory) {
    const now = Date.now();

    await db.execute({
      sql: `INSERT INTO chat_history (jid, role, content, created_at)
            VALUES (?, 'user', ?, ?)`,
      args: [memoryKey, String(prompt).trim(), now]
    });

    await db.execute({
      sql: `INSERT INTO chat_history (jid, role, content, created_at)
            VALUES (?, 'assistant', ?, ?)`,
      args: [memoryKey, cleanAnswer, now + 1]
    });

    await db.execute({
      sql: `DELETE FROM chat_history
            WHERE jid = ?
              AND id NOT IN (
                SELECT id FROM chat_history
                WHERE jid = ? ORDER BY id DESC LIMIT 30
              )`,
      args: [memoryKey, memoryKey]
    });
  }

  return cleanAnswer;
}

async function askXaiWithSerpApi(prompt, chatJid, options = {}) {
  const queryText = String(options.factQuery || prompt || '').trim();
  let serpSummary = '';

  if (CONFIG.serpApiKey && queryText) {
    try {
      const serpData = await searchGoogleViaSerpApi(queryText);
      serpSummary = serpData.formatted;
      logger.info(
        { query: queryText, resultsCount: serpData.results.length },
        'Résultats Google SerpApi récupérés pour Xai'
      );
    } catch (err) {
      logger.warn({ error: err?.message }, 'SerpApi indisponible pour Xai, poursuite avec Groq.');
    }
  } else if (!CONFIG.serpApiKey) {
    logger.warn('SERPAPI_API_KEY absent : Xai fonctionne sans recherche Google SerpApi.');
  }

  const enrichedPrompt = serpSummary
    ? [
        `Question de l'utilisateur : ${String(prompt).trim()}`,
        '',
        'Résultats de recherche Google récupérés via SerpApi :',
        serpSummary,
        '',
        'Consigne : Analyse ces résultats Google avec rigueur, croise les informations pertinentes, écarte ce qui est hors sujet ou contradictoire, et rédige une réponse fiable, claire et directe.'
      ].join('\n')
    : String(prompt).trim();

  return askGroq(enrichedPrompt, chatJid, {
    ...options,
    skipFactCheck: Boolean(serpSummary)
  });
}

async function askAI(prompt, chatJid, options = {}) {
  try {
    return await askGroq(prompt, chatJid, options);
  } catch (error) {
    error.provider = 'Groq';
    throw error;
  }
}

// ------------------------------------------------------------
// 17. PARAMÈTRES DES GROUPES & CONVERSATIONS (ONLYADMIN / CHATMODE)
// ------------------------------------------------------------

async function getGroupSettings(groupJid) {
  const result = await db.execute({
    sql: `SELECT group_jid, only_admin, chat_mode FROM group_settings
          WHERE group_jid = ?`,
    args: [groupJid]
  });

  if (!result.rows.length) {
    return { group_jid: groupJid, only_admin: 0, chat_mode: 0 };
  }

  return result.rows[0];
}

async function setOnlyAdmin(groupJid, enabled) {
  await db.execute({
    sql: `INSERT INTO group_settings (group_jid, only_admin, chat_mode, updated_at)
          VALUES (?, ?, 0, ?)
          ON CONFLICT(group_jid) DO UPDATE SET
            only_admin = excluded.only_admin,
            updated_at = excluded.updated_at`,
    args: [groupJid, enabled ? 1 : 0, Date.now()]
  });

  return true;
}

async function setChatMode(chatJid, enabled) {
  await db.execute({
    sql: `INSERT INTO group_settings (group_jid, only_admin, chat_mode, updated_at)
          VALUES (?, 0, ?, ?)
          ON CONFLICT(group_jid) DO UPDATE SET
            chat_mode = excluded.chat_mode,
            updated_at = excluded.updated_at`,
    args: [chatJid, enabled ? 1 : 0, Date.now()]
  });

  return true;
}

async function isChatModeEnabled(chatJid) {
  const settings = await getGroupSettings(chatJid);
  return Boolean(Number(settings.chat_mode));
}

// ------------------------------------------------------------
// 18. MÉTADONNÉES ET PERMISSIONS WHATSAPP
// ------------------------------------------------------------

async function getGroupMetadata(groupJid) {
  if (!sock) throw new Error('Connexion WhatsApp indisponible.');
  return sock.groupMetadata(groupJid);
}

function sameParticipant(a, b) {
  if (!a || !b) return false;

  const first = normalizeJid(a);
  const second = normalizeJid(b);

  if (first === second) return true;

  const firstNumber = getNumber(first);
  const secondNumber = getNumber(second);

  return Boolean(firstNumber && secondNumber && firstNumber === secondNumber);
}

function isParticipantAdmin(metadata, jid) {
  const participants = metadata?.participants || [];

  return participants.some(item => {
    if (!item.admin) return false;

    return [item.id, item.jid, item.phoneNumber, item.lid].some(candidate =>
      sameParticipant(candidate, jid)
    );
  });
}

function isBotGroupAdmin(metadata) {
  return (
    isParticipantAdmin(metadata, botJid) ||
    (botLid ? isParticipantAdmin(metadata, botLid) : false)
  );
}

function isBotParticipant(jid) {
  return (
    sameParticipant(jid, botJid) ||
    (botLid ? sameParticipant(jid, botLid) : false)
  );
}

async function canUseOrdinaryGroupCommand(groupJid, sender) {
  if (isOwner(sender)) return true;

  const settings = await getGroupSettings(groupJid);
  if (!Number(settings.only_admin)) return true;

  const metadata = await getGroupMetadata(groupJid);
  return isParticipantAdmin(metadata, sender);
}

// ------------------------------------------------------------
// 18 bis. AIDES POUR XADD / XKICK
// ------------------------------------------------------------

function phoneCandidates(raw = '') {
  const digits = normalizeNumber(raw);

  if (!digits) return [];

  if (/^01\d{8}$/.test(digits)) return ['229' + digits, '229' + digits.slice(2)];
  if (/^2290\d{9}$/.test(digits)) return [digits, '229' + digits.slice(5)];
  if (/^229\d{8}$/.test(digits)) return [digits, '22901' + digits.slice(3)];
  if (/^\d{8}$/.test(digits)) return ['22901' + digits, '229' + digits];

  return [digits];
}

function getContextInfo(message) {
  const content = unwrapContent(message);
  if (!content) return null;

  const types = [
    'extendedTextMessage', 'imageMessage', 'videoMessage',
    'documentMessage', 'audioMessage', 'stickerMessage'
  ];

  for (const type of types) {
    if (content[type]?.contextInfo) return content[type].contextInfo;
  }

  return null;
}

function findGroupParticipant(metadata, jid) {
  return (
    (metadata?.participants || []).find(item =>
      [item.id, item.jid, item.phoneNumber, item.lid].some(candidate =>
        sameParticipant(candidate, jid)
      )
    ) || null
  );
}

function participantLabel(item) {
  const number = getNumber(item?.phoneNumber || item?.jid || item?.id || '');
  return number ? `+${number}` : 'ce membre';
}

function getKickTargetJid(message, args) {
  const context = getContextInfo(message);
  const mentioned = context?.mentionedJid?.[0];

  if (mentioned) return mentioned;
  if (context?.stanzaId && context?.participant) return context.participant;

  const candidate = phoneCandidates(args)[0];
  return candidate ? `${candidate}@s.whatsapp.net` : null;
}

// ------------------------------------------------------------
// 19. DÉLAI ANTI-SPAM PARTAGÉ POUR XTAG
// ------------------------------------------------------------

async function acquireTagCooldown(groupJid) {
  const now = Date.now();
  const cooldownMs = CONFIG.tagCooldown * 1000;

  const result = await db.execute({
    sql: `INSERT INTO group_tag_cooldowns (group_jid, last_tag)
          VALUES (?, ?)
          ON CONFLICT(group_jid) DO UPDATE SET
            last_tag = excluded.last_tag
          WHERE group_tag_cooldowns.last_tag <= ?
          RETURNING last_tag`,
    args: [groupJid, now, now - cooldownMs]
  });

  if (result.rows.length) {
    return { allowed: true, remaining: 0 };
  }

  const previous = await db.execute({
    sql: `SELECT last_tag FROM group_tag_cooldowns WHERE group_jid = ?`,
    args: [groupJid]
  });

  const lastTag = Number(previous.rows[0]?.last_tag || 0);

  return {
    allowed: false,
    remaining: Math.max(0, Math.ceil((cooldownMs - (now - lastTag)) / 1000))
  };
}

// ------------------------------------------------------------
// 20. COMMANDES DE GROUPE
// ------------------------------------------------------------

async function handleGroupCommand(jid, message, sender, command, args) {
  if (!isGroupJid(jid)) return false;

  const groupCommands = [
    'onlyadmin', 'xonlyadmin', 'tag', 'tagall', 'htag', 'hidetag',
    'kick', 'add', 'annonce', 'clear'
  ];

  if (!groupCommands.includes(command)) return false;

  const owner = isOwner(sender);
  let metadata;

  try {
    metadata = await getGroupMetadata(jid);
  } catch (error) {
    logger.error({ err: error }, 'Impossible de récupérer les informations du groupe.');
    await sendReply(jid, 'Impossible de vérifier les permissions du groupe actuellement.', message);
    return true;
  }

  const senderIsAdmin = owner || isParticipantAdmin(metadata, sender);
  const botIsAdmin = isBotGroupAdmin(metadata);

  if (command === 'onlyadmin') {
    if (!senderIsAdmin) {
      await sendReply(jid, '⛔ Cette commande est réservée au propriétaire et aux administrateurs.', message);
      return true;
    }

    const value = String(args || '').trim().toLowerCase();
    if (!['on', 'off'].includes(value)) {
      await sendReply(jid, 'Utilisation : Xonlyadmin on ou Xonlyadmin off', message);
      return true;
    }

    const enabled = value === 'on';
    await setOnlyAdmin(jid, enabled);

    await sendReply(
      jid,
      enabled
        ? '🔐 𝗠𝗢𝗗𝗘 𝗔𝗗𝗠𝗜𝗡𝗜𝗦𝗧𝗥𝗔𝗧𝗘𝗨𝗥𝗦 𝗔𝗖𝗧𝗜𝗩𝗘́\nSeuls le propriétaire et les administrateurs peuvent utiliser les commandes ou m’interpeller ("Sitri-Nel") dans ce groupe.'
        : '🔓 𝗠𝗢𝗗𝗘 𝗔𝗗𝗠𝗜𝗡𝗜𝗦𝗧𝗥𝗔𝗧𝗘𝗨𝗥𝗦 𝗗𝗘́𝗦𝗔𝗖𝗧𝗜𝗩𝗘́\nLes membres peuvent de nouveau utiliser les commandes ordinaires.',
      message
    );
    return true;
  }

  if (command === 'htag' || command === 'hidetag') {
    const quoted = getQuotedMessage(message);
    const quotedText = getQuotedText(message);
    const note = String(args || '').trim();

    if (!quoted?.stanzaId && !note) {
      await sendReply(
        jid,
        '📌 Réponds à un message avec Xhtag, ou écris : Xhtag votre message',
        message
      );
      return true;
    }

    const mentions = (metadata.participants || [])
      .map(item => item.id)
      .filter(Boolean)
      .filter(participant => !isBotParticipant(participant));

    if (!mentions.length) {
      await sendReply(jid, 'Aucun membre à mentionner.', message);
      return true;
    }

    const cooldown = await acquireTagCooldown(jid);

    if (!cooldown.allowed) {
      await sendReply(
        jid,
        `⏳ 𝗔𝗡𝗧𝗜-𝗦𝗣𝗔𝗠 𝗔𝗖𝗧𝗜𝗙\nUne mention collective vient déjà d'être effectuée.\n\nNouvelle utilisation possible dans : ${formatDuration(cooldown.remaining)}.\n\nLe délai est partagé par tous les membres du groupe.`,
        message
      );
      return true;
    }

    const bodyMessage = note || quotedText || '';
    const hiddenTags = mentions
      .map(participant => `@${participant.split('@')[0]}`)
      .join(' ');

    const header = '📢 @tous';
    const finalText = bodyMessage
      ? `${header}\n\n${bodyMessage}\n\n${hiddenTags}\n\n${SIGNATURE}`
      : `${header}\n\n${hiddenTags}\n\n${SIGNATURE}`;

    const quotedTarget = quoted?.stanzaId
      ? {
          key: {
            remoteJid: jid,
            fromMe: isBotParticipant(quoted.participant),
            id: quoted.stanzaId,
            participant: quoted.participant
          },
          message: quoted.quotedMessage || { conversation: quotedText || '' }
        }
      : message;

    try {
      await sock.sendMessage(
        jid,
        {
          text: finalText,
          mentions
        },
        { quoted: quotedTarget }
      );
    } catch (error) {
      logger.error({ err: error }, 'Échec du hidetag.');
      await sendReply(jid, 'Le hidetag a échoué. Vérifie les permissions du groupe.', message);
    }

    return true;
  }

  if (command === 'tag' || command === 'tagall') {
    const quoted = getQuotedMessage(message);

    if (!quoted?.stanzaId) {
      await sendReply(
        jid,
        '📌 Réponds d’abord à un message du groupe, puis utilise Xtag pour signaler ce message à tous les membres.',
        message
      );
      return true;
    }

    const mentions = (metadata.participants || [])
      .map(item => item.id || item.jid)
      .filter(Boolean)
      .filter(participant => !isBotParticipant(participant));

    if (!mentions.length) {
      await sendReply(jid, 'Aucun membre à mentionner.', message);
      return true;
    }

    const cooldown = await acquireTagCooldown(jid);

    if (!cooldown.allowed) {
      await sendReply(
        jid,
        `⏳ 𝗔𝗡𝗧𝗜-𝗦𝗣𝗔𝗠 𝗔𝗖𝗧𝗜𝗙\nUne mention collective vient déjà d'être effectuée.\n\nNouvelle utilisation possible dans : ${formatDuration(cooldown.remaining)}.\n\nLe délai est partagé par tous les membres du groupe.`,
        message
      );
      return true;
    }

    const mentionText = mentions
      .map(participant => {
        const number = getNumber(participant);
        return number ? `@${number}` : '';
      })
      .filter(Boolean)
      .join(' ');

    try {
      await sock.sendMessage(
        jid,
        {
          text:
            `📢 𝗠𝗘𝗡𝗧𝗜𝗢𝗡 𝗖𝗢𝗟𝗟𝗘𝗖𝗧𝗜𝗩𝗘\n\n` +
            `${mentionText}\n\n` +
            `Message signalé par une mention collective.\n` +
            `${SIGNATURE}`,
          mentions
        },
        { quoted: message }
      );
    } catch (error) {
      logger.error({ err: error }, 'Échec de la mention collective.');
      await sendReply(jid, 'La mention collective a échoué. Vérifie les permissions du groupe.', message);
    }

    return true;
  }

  const settings = await getGroupSettings(jid);

  if (Number(settings.only_admin) && !senderIsAdmin) {
    await sendReply(jid, '🔒 Cette commande est réservée aux administrateurs du groupe.', message);
    return true;
  }

  if (!senderIsAdmin) {
    await sendReply(jid, '⛔ Autorisation refusée. Cette commande est réservée aux administrateurs et au propriétaire.', message);
    return true;
  }

  if (!botIsAdmin) {
    logger.warn({ botJid, botLid }, 'Diagnostic : le compte du bot n’est pas reconnu comme admin, tentative quand même.');
  }

  if (command === 'kick') {
    const targetJid = getKickTargetJid(message, args);

    if (!targetJid) {
      await sendReply(
        jid,
        'Réponds au message de la personne, ou mentionne-la (@), ou écris son numéro : Xkick 229XXXXXXXXXX',
        message
      );
      return true;
    }

    const candidates = getContextInfo(message)?.mentionedJid?.length || getContextInfo(message)?.stanzaId
      ? [targetJid]
      : phoneCandidates(args).map(number => `${number}@s.whatsapp.net`);

    const member = candidates
      .map(candidate => findGroupParticipant(metadata, candidate))
      .find(Boolean);

    if (!member) {
      await sendReply(jid, 'Cette personne n’est pas dans le groupe.', message);
      return true;
    }

    const memberId = member.id || member.jid;

    if (
      isBotParticipant(memberId) ||
      isOwner(memberId) ||
      isOwner(member.phoneNumber || '') ||
      member.admin
    ) {
      await sendReply(
        jid,
        '⛔ Cette personne ne peut pas être expulsée par cette commande (propriétaire ou administrateur).',
        message
      );
      return true;
    }

    try {
      const result = await sock.groupParticipantsUpdate(jid, [memberId], 'remove');
      const status = String(result?.[0]?.status || '200');

      if (status === '200') {
        await sendReply(jid, `✅ ${participantLabel(member)} a été expulsé du groupe.`, message);
      } else if (status === '403' || status === '401') {
        await sendReply(
          jid,
          `WhatsApp a refusé (code ${status}) : ce compte n’est pas administrateur du groupe, ou la personne est protégée.`,
          message
        );
      } else {
        await sendReply(jid, `L’expulsion n’a pas abouti (code WhatsApp ${status}).`, message);
      }
    } catch (error) {
      logger.error({ err: error, memberId }, 'Erreur Xkick');
      await sendReply(jid, `Impossible d’expulser ce membre. Détail : ${error?.message || 'erreur inconnue'}.`, message);
    }

    return true;
  }

  if (command === 'add') {
    const candidates = phoneCandidates(args);

    if (!candidates.length || candidates.some(number => number.length < 8 || number.length > 15)) {
      await sendReply(jid, 'Utilisation : Xadd 229XXXXXXXXXX (ou 01XXXXXXXX pour le Bénin)', message);
      return true;
    }

    let targetJid = null;

    try {
      const checks = await sock.onWhatsApp(
        ...candidates.map(number => `${number}@s.whatsapp.net`)
      );

      targetJid = (checks || []).find(item => item?.exists)?.jid || null;

      if (!targetJid) {
        await sendReply(
          jid,
          'Ce numéro n’est pas sur WhatsApp. Vérifie-le (exemple : Xadd 2290143420472).',
          message
        );
        return true;
      }
    } catch (error) {
      logger.warn({ err: error }, 'Vérification du numéro impossible, essai direct.');
      targetJid = `${candidates[0]}@s.whatsapp.net`;
    }

    if (findGroupParticipant(metadata, targetJid)) {
      await sendReply(jid, 'Cette personne est déjà dans le groupe.', message);
      return true;
    }

    try {
      const result = await sock.groupParticipantsUpdate(jid, [targetJid], 'add');
      const status = String(result?.[0]?.status || '');

      if (status === '200') {
        await sendReply(jid, `✅ +${getNumber(targetJid)} a été ajouté au groupe.`, message);
      } else if (status === '409') {
        await sendReply(jid, 'Cette personne est déjà dans le groupe.', message);
      } else if (status === '408') {
        await sendReply(
          jid,
          'Cette personne a quitté le groupe récemment : WhatsApp bloque un nouvel ajout pendant un moment.',
          message
        );
      } else if (status === '403' || status === '401') {
        try {
          const code = await sock.groupInviteCode(jid);

          await sock.sendMessage(targetJid, {
            text:
              `📩 𝗜𝗡𝗩𝗜𝗧𝗔𝗧𝗜𝗢𝗡\n\nTu es invité à rejoindre le groupe :\n` +
              `https://chat.whatsapp.com/${code}\n\n${SIGNATURE}`
          });

          await sendReply(
            jid,
            `📩 +${getNumber(targetJid)} ne peut pas être ajouté directement (confidentialité). Une invitation lui a été envoyée en privé.`,
            message
          );
        } catch (inviteError) {
          logger.warn({ err: inviteError }, 'Envoi de l’invitation impossible.');
          await sendReply(
            jid,
            'Ses paramètres de confidentialité empêchent l’ajout, et l’invitation n’a pas pu être envoyée. Partage-lui le lien du groupe manuellement.',
            message
          );
        }
      } else {
        await sendReply(jid, `L’ajout n’a pas abouti (code WhatsApp ${status || 'inconnu'}).`, message);
      }
    } catch (error) {
      logger.warn({ err: error }, 'Échec de Xadd');
      await sendReply(jid, `Impossible d’ajouter ce numéro. Détail : ${error?.message || 'erreur inconnue'}.`, message);
    }

    return true;
  }

  if (command === 'annonce') {
    const announcement = String(args || '').trim();

    if (!announcement) {
      await sendReply(jid, 'Utilisation : Xannonce Votre annonce ici', message);
      return true;
    }

    const everyone = (metadata.participants || [])
      .map(item => item.id || item.jid)
      .filter(Boolean)
      .filter(participant => !isBotParticipant(participant));

    await sock.sendMessage(
      jid,
      {
        text: `📢 𝗔𝗡𝗡𝗢𝗡𝗖𝗘 𝗢𝗙𝗙𝗜𝗖𝗜𝗘𝗟𝗟𝗘\n\n${announcement}\n\n${SIGNATURE}`,
        mentions: everyone
      },
      { quoted: message }
    );

    return true;
  }

  if (command === 'clear') {
    const quoted = getQuotedMessage(message);

    if (!quoted?.stanzaId) {
      await sendReply(jid, 'Réponds à un message envoyé par Sitri-Nel pour le supprimer.', message);
      return true;
    }

    if (!isBotParticipant(quoted.participant)) {
      await sendReply(
        jid,
        'Pour des raisons de permissions WhatsApp, Xclear ne supprime ici que les messages envoyés par Sitri-Nel.',
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

      await sendReply(jid, '🧹 Message de Sitri-Nel supprimé.', message);
    } catch (error) {
      logger.error({ err: error }, 'Erreur Xclear');
      await sendReply(jid, 'Impossible de supprimer ce message.', message);
    }

    return true;
  }

  return false;
}

// ------------------------------------------------------------
// 21. UTILISATEURS, XCOINS ET XP
// ------------------------------------------------------------

async function ensureUser(jid) {
  if (!jid) throw new Error('Identifiant utilisateur manquant.');

  await db.execute({
    sql: `INSERT OR IGNORE INTO users (jid, coins, xp, last_daily, created_at)
          VALUES (?, 0, 0, 0, ?)`,
    args: [jid, Date.now()]
  });
}

async function getUser(jid) {
  await ensureUser(jid);

  const result = await db.execute({
    sql: `SELECT jid, coins, xp, last_daily, created_at
          FROM users WHERE jid = ?`,
    args: [jid]
  });

  if (!result.rows.length) {
    throw new Error('Utilisateur introuvable dans la base de données.');
  }

  return result.rows[0];
}

async function addRewards(jid, coins = 0, xp = 0) {
  await ensureUser(jid);

  const safeCoins = Math.max(0, Math.floor(Number(coins) || 0));
  const safeXp = Math.max(0, Math.floor(Number(xp) || 0));

  await db.execute({
    sql: `UPDATE users SET coins = coins + ?, xp = xp + ? WHERE jid = ?`,
    args: [safeCoins, safeXp, jid]
  });

  return getUser(jid);
}

function getRank(xp) {
  xp = Number(xp) || 0;

  if (xp >= 10000) return 'Rang S';
  if (xp >= 5000) return 'Rang A';
  if (xp >= 2500) return 'Rang B';
  if (xp >= 1000) return 'Rang C';
  if (xp >= 300) return 'Rang D';

  return 'Rang E';
}

function getNextRank(xp) {
  const ranks = [
    { xp: 300, name: 'Rang D' },
    { xp: 1000, name: 'Rang C' },
    { xp: 2500, name: 'Rang B' },
    { xp: 5000, name: 'Rang A' },
    { xp: 10000, name: 'Rang S' }
  ];

  return ranks.find(rank => xp < rank.xp) || null;
}

async function dailyReward(jid) {
  await ensureUser(jid);

  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;

  const result = await db.execute({
    sql: `UPDATE users
          SET coins = coins + 350, xp = xp + 25, last_daily = ?
          WHERE jid = ? AND last_daily <= ?
          RETURNING coins, xp, last_daily`,
    args: [now, jid, now - cooldown]
  });

  if (result.rows.length) {
    const user = result.rows[0];

    return {
      success: true,
      coins: Number(user.coins),
      xp: Number(user.xp),
      message:
        '╭━━〔 🎁 𝗗𝗔𝗜𝗟𝗬 𝗥𝗘𝗪𝗔𝗥𝗗 〕━━╮\n\n' +
        '       +350 XCoins 💰\n' +
        '       +25 XP ⭐\n\n' +
        'Ta récompense a été créditée.\n' +
        'Reviens dans 24 heures pour la prochaine.\n\n' +
        '╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n' +
        SIGNATURE
    };
  }

  const user = await getUser(jid);
  const remaining = Math.max(0, cooldown - (now - Number(user.last_daily)));

  return {
    success: false,
    remaining: Math.ceil(remaining / 1000),
    message:
      '╭━━〔 ⏳ 𝗗𝗔𝗜𝗟𝗬 𝗟𝗢𝗖𝗞 〕━━╮\n\n' +
      `Prochaine récompense dans :\n${formatDuration(Math.ceil(remaining / 1000))}\n\n` +
      'La patience fait aussi partie du jeu.\n\n' +
      '╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n' +
      SIGNATURE
  };
}

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

📈 Progression :
${progress}

🧬 Données enregistrées dans la base.

╰━━━━━━━━━━━━━━━━━━━━━━╯

${SIGNATURE}
`;
}

async function getLeaderboard(limit = 10) {
  const safeLimit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 10)));

  const result = await db.execute({
    sql: `SELECT jid, coins, xp FROM users
          ORDER BY xp DESC, coins DESC LIMIT ?`,
    args: [safeLimit]
  });

  return result.rows;
}

async function getRankText(jid) {
  const user = await getUser(jid);

  const xp = Number(user.xp);
  const next = getNextRank(xp);

  const leaderboard = await getLeaderboard(50);
  const position = leaderboard.findIndex(item => item.jid === jid);

  return `
╭━━〔 🏆 𝗫𝗥𝗔𝗡𝗞 〕━━╮

Rang : ${getRank(xp)}
XP : ${xp}

Classement : ${position >= 0 ? `#${position + 1}` : 'Non classé'}

${
  next
    ? `Prochain rang : ${next.name}\nXP nécessaire : ${next.xp - xp}`
    : '👑 Rang maximal atteint : Rang S'
}

╰━━━━━━━━━━━━━━━━━━━━━━╯

${SIGNATURE}
`;
}


// ------------------------------------------------------------
// 21 bis. CARTE NUMÉRIQUE PROFIL / XP / XRANK (RAILWAY READY)
// ------------------------------------------------------------

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const BITMAP_FONT_5X7 = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01111','10000','10000','10111','10001','10001','01111'],
  H: ['10001','10001','10001','11111','10001','10001','10001'],
  I: ['11111','00100','00100','00100','00100','00100','11111'],
  J: ['00111','00010','00010','00010','10010','10010','01100'],
  K: ['10001','10010','10100','11000','10100','10010','10001'],
  L: ['10000','10000','10000','10000','10000','10000','11111'],
  M: ['10001','11011','10101','10101','10001','10001','10001'],
  N: ['10001','11001','10101','10011','10001','10001','10001'],
  O: ['01110','10001','10001','10001','10001','10001','01110'],
  P: ['11110','10001','10001','11110','10000','10000','10000'],
  Q: ['01110','10001','10001','10001','10101','10010','01101'],
  R: ['11110','10001','10001','11110','10100','10010','10001'],
  S: ['01111','10000','10000','01110','00001','00001','11110'],
  T: ['11111','00100','00100','00100','00100','00100','00100'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  V: ['10001','10001','10001','10001','10001','01010','00100'],
  W: ['10001','10001','10001','10101','10101','11011','10001'],
  X: ['10001','10001','01010','00100','01010','10001','10001'],
  Y: ['10001','10001','01010','00100','00100','00100','00100'],
  Z: ['11111','00001','00010','00100','01000','10000','11111'],
  '0': ['01110','10011','10101','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00110','01000','10000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  ':': ['00000','00100','00100','00000','00100','00100','00000'],
  '/': ['00001','00010','00010','00100','01000','01000','10000'],
  '#': ['01010','11111','01010','01010','11111','01010','00000'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '.': ['00000','00000','00000','00000','00000','01100','01100'],
  '•': ['00000','00000','01100','01100','00000','00000','00000'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000']
};

function drawBitmapText(raw, width, height, text, startX, startY, scale, color) {
  const clean = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
  let cursorX = startX;
  for (const ch of clean) {
    const glyph = BITMAP_FONT_5X7[ch] || BITMAP_FONT_5X7['-'];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const px = cursorX + col * scale + dx;
              const py = startY + row * scale + dy;
              if (px >= 0 && px < width && py >= 0 && py < height) {
                const idx = py * (width * 4 + 1) + 1 + px * 4;
                raw[idx] = color[0];
                raw[idx + 1] = color[1];
                raw[idx + 2] = color[2];
                raw[idx + 3] = 255;
              }
            }
          }
        }
      }
    }
    cursorX += 6 * scale;
  }
}

function buildFallbackMiniCardPng({ username, level, xp, currentLevelXp, nextLevelXp, coins, rankLabel, position, totalUsers, mode }) {
  const width = 640;
  const height = 220;
  const raw = Buffer.alloc((width * 4 + 1) * height);

  const span = Math.max(Number(nextLevelXp || 100) - Number(currentLevelXp || 0), 1);
  const progress = Math.min(Math.max((Number(xp || 0) - Number(currentLevelXp || 0)) / span, 0), 1);

  const barX1 = 175;
  const barX2 = 605;
  const barY1 = 136;
  const barY2 = 158;
  const barFillX = Math.round(barX1 + (barX2 - barX1) * progress);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;

    for (let x = 0; x < width; x++) {
      const idx = rowStart + 1 + x * 4;
      let r = Math.round(10 + (x / width) * 18);
      let g = Math.round(14 + (y / height) * 16);
      let b = Math.round(36 + (x / width) * 32);

      if (x < 4 || x >= width - 4 || y < 4 || y >= height - 4) {
        r = 56;
        g = 189;
        b = 248;
      }

      const dx = x - 92;
      const dy = y - 110;
      const distSq = dx * dx + dy * dy;
      if (distSq <= 56 * 56 && distSq >= 50 * 50) {
        r = 192;
        g = 132;
        b = 252;
      } else if (distSq < 50 * 50) {
        r = 30;
        g = 41;
        b = 59;
      }

      if (x >= barX1 && x <= barX2 && y >= barY1 && y <= barY2) {
        if (x <= barFillX) {
          r = 56;
          g = 189;
          b = 248;
        } else {
          r = 30;
          g = 41;
          b = 59;
        }
      }

      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = 255;
    }
  }

  const initial = String(username || 'U').replace(/[^A-Za-z0-9]/g, '').charAt(0) || 'S';
  drawBitmapText(raw, width, height, initial, 78, 88, 6, [248, 250, 252]);

  const cleanName = String(username || 'JOUEUR').replace(/[^ -~]/g, '').trim().slice(0, 14) || 'JOUEUR';
  const cleanRank = String(rankLabel || 'NOVICE').replace(/[^ -~]/g, '').trim().slice(0, 12) || 'NOVICE';

  drawBitmapText(raw, width, height, cleanName, 175, 34, 3, [248, 250, 252]);
  drawBitmapText(raw, width, height, `LVL ${level}`, 485, 34, 3, [56, 189, 248]);
  drawBitmapText(raw, width, height, `${cleanRank} • ${String(mode || 'PROFIL').toUpperCase()}`, 175, 68, 2, [192, 132, 252]);
  drawBitmapText(raw, width, height, `RANK ${position > 0 ? `#${position}/${Math.max(totalUsers, 1)}` : 'N/C'}`, 475, 68, 2, [148, 163, 184]);
  drawBitmapText(raw, width, height, `XP: ${xp}/${nextLevelXp}`, 175, 106, 2, [226, 232, 240]);
  drawBitmapText(raw, width, height, `COINS: ${coins}`, 435, 106, 2, [251, 191, 36]);
  drawBitmapText(raw, width, height, 'SITRI-NEL • MINI-CARTE', 175, 176, 2, [100, 116, 139]);

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = buf => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ───────── Carte « Ranker » (fenêtre de statut) ─────────
const RANKER_TIERS = [
  { name: 'Rang S', letter: 'S', color: '#fb7185' },
  { name: 'Rang A', letter: 'A', color: '#c084fc' },
  { name: 'Rang B', letter: 'B', color: '#38bdf8' },
  { name: 'Rang C', letter: 'C', color: '#fbbf24' },
  { name: 'Rang D', letter: 'D', color: '#cbd5e1' },
  { name: 'Rang E', letter: 'E', color: '#94a3b8' }
];

function cardSafeText(value, fallback = 'Joueur', max = 18) {
  const cleaned = String(value || '')
    .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  return cleaned || fallback;
}

function pangoEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let rankerFontPath = null;
function ensureRankerFont(fontB64) {
  if (rankerFontPath && fs.existsSync(rankerFontPath)) return rankerFontPath;
  const target = path.join(os.tmpdir(), 'sitri-nel-tektur-v1.ttf');
  if (!fs.existsSync(target)) fs.writeFileSync(target, Buffer.from(fontB64, 'base64'));
  rankerFontPath = target;
  return target;
}

async function renderRankerCard(data, sharpFn, fontB64) {
  const W = 1000;
  const H = 560;
  const fontfile = ensureRankerFont(fontB64);

  const xp = Math.max(0, Number(data.xp) || 0);
  const level = Math.max(1, Number(data.level) || 1);
  const coins = Math.max(0, Number(data.coins) || 0);
  const currentLevelXp = Number(data.currentLevelXp) || 0;
  const nextLevelXp = Math.max(Number(data.nextLevelXp) || 100, currentLevelXp + 1);
  const ratio = Math.min(Math.max((xp - currentLevelXp) / (nextLevelXp - currentLevelXp), 0), 1);

  const rankClean = String(data.rankLabel || 'Rang E').replace(/[^A-Za-z0-9 ]/g, '').trim();
  const tier = RANKER_TIERS.find(t => t.name.toLowerCase() === rankClean.toLowerCase() || t.letter.toLowerCase() === rankClean.toLowerCase()) || RANKER_TIERS[RANKER_TIERS.length - 1];
  const name = cardSafeText(data.username, 'Joueur', 18).toUpperCase();
  const position = Number(data.position) > 0 ? `#${data.position} / ${Math.max(Number(data.totalUsers) || 1, 1)}` : 'NON CLASSE';

  // ── Décor (sans texte) ──
  const barX = 400, barY = 392, barW = 540, barH = 26;
  const fillW = Math.max(Math.round(barW * ratio), ratio > 0 ? 18 : 0);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#040814"/><stop offset="0.55" stop-color="#0a1330"/><stop offset="1" stop-color="#050b1c"/>
    </linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#c084fc"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#c084fc"/>
    </linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0"/><stop offset="0.5" stop-color="#38bdf8" stop-opacity="0.9"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vig" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
    <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
      <path d="M34 0H0V34" fill="none" stroke="#38bdf8" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>

  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="20" fill="none" stroke="#38bdf8" stroke-width="5" opacity="0.55" filter="url(#glow)"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="20" fill="none" stroke="#38bdf8" stroke-width="2.5"/>
  <rect x="32" y="32" width="${W - 64}" height="${H - 64}" rx="14" fill="none" stroke="#38bdf8" stroke-opacity="0.28" stroke-width="1.2"/>

  <g stroke="#7dd3fc" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M18 70V40a22 22 0 0 1 22-22h30"/><path d="M${W - 18} 70V40a22 22 0 0 0-22-22h-30"/>
    <path d="M18 ${H - 70}v30a22 22 0 0 0 22 22h30"/><path d="M${W - 18} ${H - 70}v30a22 22 0 0 1-22 22h-30"/>
  </g>

  <rect x="60" y="100" width="${W - 120}" height="2" fill="url(#line)"/>

  <circle cx="215" cy="262" r="150" fill="#38bdf8" fill-opacity="0.07"/>
  <circle cx="215" cy="262" r="132" fill="none" stroke="url(#ring)" stroke-width="9" opacity="0.6" filter="url(#glow)"/>
  <circle cx="215" cy="262" r="130" fill="none" stroke="url(#ring)" stroke-width="6"/>

  <polygon points="215,408 251,429 251,469 215,490 179,469 179,429" fill="#0b1226" stroke="${tier.color}" stroke-width="4"/>
  <polygon points="215,408 251,429 251,469 215,490 179,469 179,429" fill="none" stroke="${tier.color}" stroke-width="9" opacity="0.35" filter="url(#glow)"/>

  <g fill="#0f172a" fill-opacity="0.85" stroke="#38bdf8" stroke-opacity="0.55" stroke-width="2">
    <rect x="400" y="226" width="170" height="104" rx="12"/>
    <rect x="585" y="226" width="170" height="104" rx="12"/>
    <rect x="770" y="226" width="170" height="104" rx="12"/>
  </g>

  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="13" fill="#0f172a" stroke="#38bdf8" stroke-opacity="0.45" stroke-width="2"/>
  ${fillW > 0 ? `<rect x="${barX}" y="${barY}" width="${fillW}" height="${barH}" rx="13" fill="url(#bar)"/>` : ''}
  <rect x="${barX}" y="${barY}" width="${fillW}" height="${Math.round(barH / 2)}" rx="13" fill="#fff" fill-opacity="0.12"/>
</svg>`;

  const layers = [];

  // Avatar rond (photo de profil, sinon initiale)
  const size = 232;
  let avatarPng = null;
  if (data.avatarBuffer) {
    try {
      const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
      avatarPng = await sharpFn(data.avatarBuffer)
        .resize(size, size, { fit: 'cover' })
        .ensureAlpha()
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    } catch {
      avatarPng = null;
    }
  }
  if (!avatarPng) {
    const bgCircle = Buffer.from(
      `<svg width="${size}" height="${size}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#581c87"/></linearGradient></defs><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#g)"/></svg>`
    );
    avatarPng = await sharpFn(bgCircle).png().toBuffer();
  }
  layers.push({ input: avatarPng, left: 215 - size / 2, top: 262 - size / 2 });

  // Texte : une image par morceau (police intégrée, aucun accent perdu)
  const text = async (markup, { size: px = 24, color = '#ffffff', width, left, top, centerX, centerY, rightX, spacing } = {}) => {
    const span = `<span foreground="${color}">${markup}</span>`;
    const { data: buf, info } = await sharpFn({
      text: { text: span, font: `SitriTektur ${px}`, fontfile, rgba: true, dpi: 72, ...(width ? { width } : {}), ...(spacing ? { spacing } : {}) }
    })
      .png()
      .toBuffer({ resolveWithObject: true });

    let x = left ?? 0;
    let y = top ?? 0;
    if (centerX !== undefined) x = Math.round(centerX - info.width / 2);
    if (centerY !== undefined) y = Math.round(centerY - info.height / 2);
    if (rightX !== undefined) x = Math.round(rightX - info.width);
    layers.push({ input: buf, left: Math.max(0, x), top: Math.max(0, y) });
  };

  const initial = cardSafeText(data.username, 'J', 1).toUpperCase();
  if (!data.avatarBuffer || !avatarPng) {
    await text(pangoEscape(initial), { size: 110, color: '#e2e8f0', centerX: 215, centerY: 262 });
  }

  await text('[ STATUS ]', { size: 34, color: '#38bdf8', left: 62, top: 48 });
  await text('SITRI-NEL  •  RANKER', { size: 22, color: '#94a3b8', rightX: W - 62, top: 58 });

  await text(pangoEscape(name), { size: 54, color: '#f8fafc', left: 400, top: 112 });
  await text(`CLASSE ${tier.letter}  •  ${pangoEscape(tier.name.toUpperCase())}`, { size: 26, color: tier.color, left: 402, top: 178 });

  await text(tier.letter, { size: tier.letter.length > 1 ? 36 : 46, color: tier.color, centerX: 215, centerY: 449 });
  await text('RANG', { size: 18, color: '#94a3b8', centerX: 215, top: 496 });

  const boxes = [
    { x: 400, label: 'NIVEAU', value: String(level), color: '#f8fafc' },
    { x: 585, label: 'XP', value: String(xp), color: '#38bdf8' },
    { x: 770, label: 'XCOINS', value: String(coins), color: '#fbbf24' }
  ];
  for (const box of boxes) {
    await text(box.label, { size: 18, color: '#94a3b8', centerX: box.x + 85, top: 238 });
    const px = box.value.length > 6 ? 30 : box.value.length > 4 ? 38 : 50;
    await text(pangoEscape(box.value), { size: px, color: box.color, centerX: box.x + 85, centerY: 292 });
  }

  await text('PROGRESSION', { size: 18, color: '#94a3b8', left: 402, top: 360 });
  await text(`${Math.round(ratio * 100)} %`, { size: 18, color: '#e2e8f0', rightX: 940, top: 360 });
  await text(`XP  ${xp} / ${nextLevelXp}`, { size: 20, color: '#e2e8f0', left: 402, top: 428 });

  await text('CLASSEMENT', { size: 20, color: '#94a3b8', left: 402, top: 474 });
  await text(pangoEscape(position), { size: 30, color: '#c084fc', rightX: 940, top: 466 });

  const png = await sharpFn(Buffer.from(svg)).composite(layers).png().toBuffer();
  return png;
}

// Police Tektur (SIL OFL 1.1), réduite aux caractères latins et renommée pour un rendu identique partout
const RANKER_FONT_B64 = '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REZMVAAaY3lybAAaZ3JlawAabGF0bgAeABQAAAAQAAJDQVQgACpOTEQgAEYAAP//AAoAAwAEAAUABgAHAAgACQAKAAsADAAA//8ACwABAAMABAAFAAYABwAIAAkACgALAAwAAP//AAwAAAACAAMABAAFAAYABwAIAAkACgALAAwADWxpZ2EAUGxvY2wAVmxvY2wAXHBudW0AYnNzMDEAaHNzMDIAcnNzMDMAfHNzMDQAhnNzMDUAkHN1YnMAmnN1cHMAoHRudW0Apnplcm8ArAAAAAEABQAAAAEAAAAAAAEAAwAAAAEACQAGAAEACwAAAQAABgABAAwAAAEBAAYAAQANAAABAgAGAAEADgAAAQMABgABAA8AAAEEAAAAAQAHAAAAAQAGAAAAAQAIAAAAAQAKABAAIgBYAGYAegCwAMoBAAEOARwBNAFmAYgBugHQAfICBgAGAAAAAQAIAAEASgABAAgAAgAGABYAAQASAAEAAQASAAEAAAABAAEAMAABAAEAMAABAAAAAgABAAAAAQAIAAEAFABeAAEAAAABAAgAAQAGAF0AAQABAKMABgAAAAEACAABAEAAAgAKABwAAQAEAAEAWQABAAAAAQAAAAQAAQAEAAEAWgABAAAAAQAAAAQAAQAAAAEACAACAAoAAgBkAGUAAQACABAALgAEAAAAAQAIAAEAJgACAAoAFAABAAQAYgACABAAAgAGAAwAYwACABAAYwACAGQAAQACAA8AWQABAAAAAQAIAAEAIgAUAAEAAAABAAgAAQAUAB4AAQAAAAEACAABAAYACgACAAEAswC8AAAAAQAAAAEACAACABoACgC0ALUAtgC3ALgAuQC6ALsAvACzAAIAAgC+AMYAAADcANwACQABAAAAAQAIAAIADgAEANsA3ADdAN4AAQAEALMAvQDHANEAAQAAAAEACAACABYACAADAQIBAwEEAQUBBgEHAQgAAQAIAAIAPwBBAEMARQBHAEkASwABAAAAAQAIAAIAJAAEAAYADAAcAQkAAQAAAAEACAACAA4ABAAHAA0AHQEKAAEABAAFAAsAGwBNAAEAAAABAAgAAQAGAAEAAQABABQAAQAAAAEACAABAAYAAQABAAEAEgABAAEACAACAAAAFAACAAAAJAACd2R0aAEGAAB3Z2h0AQcAAQAEABAAAQAAAAIBEABkAAAAAQABAAABCQH0AAA=';

async function generateProfileVisualCard({
  username,
  avatarBuffer,
  level,
  xp,
  currentLevelXp,
  nextLevelXp,
  coins,
  rankLabel,
  position,
  totalUsers,
  mode = 'profil'
}) {
  // Carte « Ranker » (fenêtre de statut) : sharp + police intégrée, aucune dépendance supplémentaire
  try {
    const sharpMod = await import('sharp');
    const sharpFn = sharpMod.default || sharpMod;
    return await renderRankerCard(
      { username, avatarBuffer, level, xp, currentLevelXp, nextLevelXp, coins, rankLabel, position, totalUsers },
      sharpFn,
      RANKER_FONT_B64
    );
  } catch (error) {
    logger.warn({ error: error?.message }, 'Carte Ranker impossible, carte de secours utilisée.');
  }

  if (!createCanvasFn) {
    return buildFallbackMiniCardPng({
      username,
      level,
      xp,
      currentLevelXp,
      nextLevelXp,
      coins,
      rankLabel,
      position,
      totalUsers,
      mode
    });
  }

  // Format mini-carte compacte (640 x 220)
  const width = 640;
  const height = 220;
  const canvas = createCanvasFn(width, height);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#070b14');
  bg.addColorStop(0.55, '#151238');
  bg.addColorStop(1, '#091426');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  drawRoundRect(ctx, 14, 14, width - 28, height - 28, 18);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
  ctx.stroke();
  ctx.restore();

  // Mini avatar circulaire à gauche
  const cx = 96;
  const cy = 110;
  const radius = 56;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  const ringGrad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  ringGrad.addColorStop(0, '#38bdf8');
  ringGrad.addColorStop(1, '#c084fc');
  ctx.fillStyle = ringGrad;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  let drewAvatar = false;
  if (avatarBuffer && loadImageFn) {
    try {
      const img = await loadImageFn(avatarBuffer);
      ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
      drewAvatar = true;
    } catch {
      drewAvatar = false;
    }
  }

  if (!drewAvatar) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 42px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(username || 'U').charAt(0).toUpperCase(), cx, cy);
  }
  ctx.restore();

  // Textes compacts
  const leftX = 176;
  const rightEdge = width - 30;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const cleanName = String(username || 'Utilisateur').slice(0, 16);
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(cleanName, leftX, 56);

  ctx.font = 'bold 14px monospace';
  ctx.fillStyle = '#c084fc';
  const cleanRank = String(rankLabel || 'Novice').replace(/^[^\w\sÀ-ÖØ-öø-ÿ]+\s*/u, '').toUpperCase();
  ctx.fillText(`${cleanRank} • ${mode.toUpperCase()}`, leftX, 78);

  ctx.textAlign = 'right';
  ctx.font = 'bold 25px monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText(`LVL ${level}`, rightEdge, 56);

  ctx.font = 'bold 14px monospace';
  ctx.fillStyle = '#94a3b8';
  const posText = position > 0 ? `#${position}/${Math.max(totalUsers, 1)}` : 'N/C';
  ctx.fillText(`RANK ${posText}`, rightEdge, 78);

  ctx.textAlign = 'left';
  ctx.font = 'bold 15px monospace';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`XP : ${Number(xp || 0)} / ${Number(nextLevelXp || 100)}`, leftX, 114);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fbbf24';
  ctx.fillText(`COINS : ${Number(coins || 0)}`, rightEdge, 114);

  // Barre de progression
  const span = Math.max(Number(nextLevelXp || 100) - Number(currentLevelXp || 0), 1);
  const progressInTier = Math.max(Number(xp || 0) - Number(currentLevelXp || 0), 0);
  const ratio = Math.min(Math.max(progressInTier / span, 0), 1);

  const barX = leftX;
  const barY = 132;
  const barW = rightEdge - leftX;
  const barH = 20;

  ctx.save();
  drawRoundRect(ctx, barX, barY, barW, barH, 10);
  ctx.fillStyle = '#1e293b';
  ctx.fill();
  ctx.restore();

  const fillW = Math.max(Math.round(barW * ratio), ratio > 0 ? 20 : 0);
  if (fillW > 0) {
    ctx.save();
    drawRoundRect(ctx, barX, barY, fillW, barH, 10);
    const barGrad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
    barGrad.addColorStop(0, '#38bdf8');
    barGrad.addColorStop(1, '#c084fc');
    ctx.fillStyle = barGrad;
    ctx.fill();
    ctx.restore();
  }

  ctx.textAlign = 'left';
  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = '#64748b';
  ctx.fillText('SITRI-NEL • MINI-CARTE', leftX, 184);

  return canvas.toBuffer('image/png');
}

function getLevelFromXp(xp = 0) {
  const safeXp = Math.max(0, Number(xp) || 0);
  return Math.floor(Math.sqrt(safeXp / 25)) + 1;
}

function getXpBoundsForLevel(level = 1) {
  const lvl = Math.max(1, Number(level) || 1);
  const currentLevelXp = 25 * ((lvl - 1) ** 2);
  const nextLevelXp = 25 * (lvl ** 2);
  return { currentLevelXp, nextLevelXp };
}

async function resolveProfileTarget(message, sender) {
  const ctx = getContextInfo(message);
  const mentioned = ctx?.mentionedJid?.[0];
  const quotedSender = ctx?.stanzaId && ctx?.participant ? ctx.participant : '';
  const rawTarget = mentioned || quotedSender || sender;
  const targetJid = normalizeJid(rawTarget) || sender;

  let avatarBuffer = null;
  try {
    const picUrl = await sock?.profilePictureUrl(targetJid, 'image');
    if (picUrl) {
      const dl = await downloadImageBuffer(picUrl);
      avatarBuffer = dl?.buffer || null;
    }
  } catch {
    avatarBuffer = null;
  }

  const mem = await getUserMemory(targetJid);
  const senderPush = targetJid === sender ? String(message?.pushName || '').trim() : '';
  if (senderPush && !mem.name) {
    saveUserMemory(targetJid, senderPush, mem.facts || '').catch(() => {});
  }
  const displayName =
    mem.name ||
    senderPush ||
    getNumber(targetJid) ||
    'Ranker';

  return { targetJid, displayName, avatarBuffer };
}

async function sendVisualStatCard(jid, message, sender, command) {
  const { targetJid, displayName, avatarBuffer } = await resolveProfileTarget(message, sender);
  const user = await getUser(targetJid);
  const xp = Number(user?.xp || 0);
  const coins = Number(user?.coins || 0);
  const level = getLevelFromXp(xp);
  const { currentLevelXp, nextLevelXp } = getXpBoundsForLevel(level);
  const rankLabel = getRank(xp);
  const leaderboard = await getLeaderboard(50);
  const idx = leaderboard.findIndex(item => item.jid === targetJid);
  const position = idx >= 0 ? idx + 1 : 0;

  const cardBuffer = await generateProfileVisualCard({
    username: displayName,
    avatarBuffer,
    level,
    xp,
    currentLevelXp,
    nextLevelXp,
    coins,
    rankLabel,
    position,
    totalUsers: leaderboard.length,
    mode: command === 'xp' ? 'xp' : command === 'rank' ? 'rank' : 'profil'
  });

  const nextRank = getNextRank(xp);
  const caption =
    `╭━━〔 📊 𝗖𝗔𝗥𝗧𝗘 𝗡𝗨𝗠𝗘́𝗥𝗜𝗤𝗨𝗘 〕━━╮\n\n` +
    `👤 𝗝𝗼𝘂𝗲𝘂𝗿 : ${displayName}\n` +
    `⚡ 𝗡𝗶𝘃𝗲𝗮𝘂 : ${level} (${rankLabel})\n` +
    `⭐ 𝗫𝗣 : ${xp} / ${nextLevelXp}\n` +
    `💰 𝗖𝗼𝗶𝗻𝘀 : ${coins}\n` +
    `🏆 𝗥𝗮𝗻𝗴 : ${position > 0 ? `#${position}/${leaderboard.length}` : 'Non classé'}\n` +
    (nextRank ? `📈 𝗣𝗿𝗼𝗰𝗵𝗮𝗶𝗻 𝗽𝗮𝗹𝗶𝗲𝗿 : ${nextRank.name} (${nextRank.xp - xp} XP)\n` : '') +
    `\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n${SIGNATURE}`;

  if (cardBuffer) {
    await sock.sendMessage(
      jid,
      {
        image: cardBuffer,
        mimetype: 'image/png'
      },
      { quoted: message }
    );
  } else {
    await sendReply(jid, caption, message);
  }
}

// ------------------------------------------------------------
// 22. QUIZ INTELLIGENT (GÉNÉRATION IA + SECOURS)
// ------------------------------------------------------------

const fallbackQuizQuestions = [
  { question: 'Dans Naruto, quel est le nom véritable de l’ermite des crapauds qui a entraîné Minato et Naruto ?', answer: 'jiraiya' },
  { question: 'Dans Dragon Ball Z, quelle est l’attaque signature perforante inventée par Piccolo pour vaincre Raditz ?', answer: 'makankosappo' },
  { question: 'Dans Jujutsu Kaisen, quelle est l’extension du territoire de Satoru Gojo ?', answer: 'sphere de l espace infini' },
  { question: 'Dans Hunter x Hunter, quel type de Nen possède Gon Freecss ?', answer: 'renforcement' },
  { question: 'Dans Demon Slayer, quel souffle utilise Zenitsu Agatsuma ?', answer: 'souffle de la foudre' },
  { question: 'Dans One Piece, quel est le nom du sabre noir légendaire manié par Dracule Mihawk ?', answer: 'yoru' },
  { question: 'Quelle planète du système solaire possède la plus grande lune, Ganymède ?', answer: 'jupiter' },
  { question: 'Quel élément chimique a pour symbole Au ?', answer: 'or' }
];

function normalizeAnswer(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^(le|la|les|l'|un|une|des|du|de la|the|a|an)\s+/i, '')
    .replace(/[.!?,;:'"()\[\]]/g, '')
    .replace(/\s+/g, ' ');
}

function isAnswerCloseEnough(submitted, expected) {
  const sub = normalizeAnswer(submitted);
  const exp = normalizeAnswer(expected);

  if (!sub || !exp) return false;
  if (sub === exp) return true;
  if (exp.length >= 4 && (sub.includes(exp) || exp.includes(sub))) return true;

  return false;
}

async function generateDynamicQuizQuestion(theme = '', chatJid = '') {
  if (!CONFIG.groqKey) return null;

  const topicHint = theme
    ? `sur le thème précis : "${theme}"`
    : 'sur les animés/mangas célèbres, la culture générale, la science ou l’histoire (pose une question vérifiable et précise)';

  const prompt = `Génère UNE question de quiz 100% véridique et précise ${topicHint}.
Réponds UNIQUEMENT au format JSON strict suivant, sans aucun texte avant ou après :
{"question": "Ta question claire et précise ici ?", "answer": "la réponse courte exacte"}`;

  try {
    const raw = await askGroq(prompt, chatJid || 'quiz-gen', {
      useHistory: false,
      skipFactCheck: true,
      temperature: 0.7,
      maxTokens: 250
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed?.question && parsed?.answer) {
      return {
        question: String(parsed.question).trim(),
        answer: String(parsed.answer).trim()
      };
    }
  } catch (error) {
    logger.warn({ error: error?.message }, 'Génération IA de quiz échouée, utilisation de la banque locale.');
  }

  return null;
}

async function startQuiz(chatJid, theme = '') {
  const now = Date.now();

  const existing = await db.execute({
    sql: `SELECT question, expires_at FROM active_quizzes WHERE group_jid = ?`,
    args: [chatJid]
  });

  if (existing.rows.length && Number(existing.rows[0].expires_at) > now) {
    return {
      success: false,
      message:
        '🧠 Un quiz est déjà actif dans cette conversation.\nRéponds avec Xreponse avant d’en lancer un autre.'
    };
  }

  const aiQuiz = await generateDynamicQuizQuestion(theme, chatJid);
  const selected =
    aiQuiz || fallbackQuizQuestions[Math.floor(Math.random() * fallbackQuizQuestions.length)];

  await db.execute({
    sql: `INSERT INTO active_quizzes
            (group_jid, question, answer, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(group_jid) DO UPDATE SET
            question = excluded.question,
            answer = excluded.answer,
            created_at = excluded.created_at,
            expires_at = excluded.expires_at`,
    args: [chatJid, selected.question, selected.answer, now, now + 120000]
  });

  return {
    success: true,
    message:
      '╭━━〔 🧠 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 𝗤𝗨𝗜𝗭 〕━━╮\n\n' +
      `${selected.question}\n\n` +
      '⏳ Temps : 2 minutes\n' +
      '🎁 Récompense : 30 XCoins + 20 XP\n\n' +
      'Réponds avec : Xreponse ta réponse\n\n' +
      '╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n' +
      SIGNATURE
  };
}

async function answerQuiz(chatJid, userJid, answer) {
  const now = Date.now();
  const submitted = normalizeAnswer(answer);

  if (!submitted) {
    return { success: false, message: 'Indique ta réponse après Xreponse.' };
  }

  if (!userJid) {
    return { success: false, message: 'Impossible d’identifier le participant.' };
  }

  const existing = await db.execute({
    sql: `SELECT question, answer, expires_at FROM active_quizzes WHERE group_jid = ?`,
    args: [chatJid]
  });

  if (!existing.rows.length) {
    return { success: false, message: 'Aucun quiz rapide actif. Lance Xqflash pour commencer.' };
  }

  const quiz = existing.rows[0];

  if (Number(quiz.expires_at) <= now) {
    await db.execute({
      sql: `DELETE FROM active_quizzes WHERE group_jid = ? AND expires_at <= ?`,
      args: [chatJid, now]
    });

    return {
      success: false,
      message: `⌛ Le temps du quiz est écoulé ! La bonne réponse était : ${quiz.answer}.\nLance un nouveau Xqflash.`
    };
  }

  let isCorrect = isAnswerCloseEnough(submitted, quiz.answer);

  if (!isCorrect && CONFIG.groqKey) {
    try {
      const checkPrompt = `Question posée : "${quiz.question}"
Réponse attendue : "${quiz.answer}"
Réponse du joueur : "${answer}"
La réponse du joueur est-elle factuellement juste et équivalente (même avec une variante d'orthographe, de langue ou un synonyme officiel) ? Réponds UNIQUEMENT par OUI ou NON.`;

      const verdict = await askGroq(checkPrompt, 'quiz-judge', {
        useHistory: false,
        skipFactCheck: true,
        temperature: 0.1,
        maxTokens: 10
      });

      if (/^oui\b/i.test(verdict.trim())) {
        isCorrect = true;
      }
    } catch {
      // On garde le résultat de la comparaison locale.
    }
  }

  if (!isCorrect) {
    return { success: false, message: '❌ Mauvaise réponse. Réfléchis bien et réessaie !' };
  }

  const claimed = await db.execute({
    sql: `DELETE FROM active_quizzes
          WHERE group_jid = ? AND expires_at > ?
          RETURNING group_jid`,
    args: [chatJid, now]
  });

  if (!claimed.rows.length) {
    return { success: false, message: 'Ce quiz vient déjà d’être remporté.' };
  }

  const user = await addRewards(userJid, 30, 20);

  return {
    success: true,
    coins: Number(user.coins),
    xp: Number(user.xp),
    message:
      '╭━━〔 🏆 𝗩𝗜𝗖𝗧𝗢𝗜𝗥𝗘 〕━━╮\n\n' +
      '       +30 XCoins 💰\n' +
      '       +20 XP ⭐\n\n' +
      `Bonne réponse (${quiz.answer}) ! Tu remportes le quiz.\n\n` +
      `Ton solde : ${Number(user.coins)} XCoins\n` +
      `Ton XP : ${Number(user.xp)}\n\n` +
      '╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n' +
      SIGNATURE
  };
}

// ------------------------------------------------------------
// 23. RECHERCHE D'IMAGES INTELLIGENTE (ANILIST EXCLUSIF & PIXABAY PHOTOS)
// ------------------------------------------------------------

async function downloadImageBuffer(url) {
  if (!/^https?:\/\//i.test(String(url))) {
    throw new Error('Adresse d’image non valide.');
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    maxContentLength: CONFIG.maxImageBytes,
    maxBodyLength: CONFIG.maxImageBytes,
    headers: {
      'User-Agent': 'SitriNelBot/1.0 (https://github.com/sitri-nel; contact@sitri-nel.bot)',
      Accept: 'image/png,image/jpeg,image/webp,image/gif,*/*;q=0.8'
    },
    validateStatus: status => status === 200
  });

  const contentType = String(response.headers['content-type'] || '').toLowerCase();

  if (!contentType.startsWith('image/')) {
    throw new Error('La ressource reçue n’est pas une image.');
  }

  const buffer = Buffer.from(response.data);

  if (!buffer.length || buffer.length > CONFIG.maxImageBytes) {
    throw new Error('Taille de l’image non autorisée.');
  }

  return { buffer, contentType };
}

const MAX_IMAGES_PER_REQUEST = 5;

function parseImageRequest(raw = '') {
  const text = String(raw).trim();
  const match = text.match(/^([\s\S]*?)[\s-]+(\d{1,2})$/);

  if (!match || !match[1].trim()) {
    return { query: text, count: 1 };
  }

  const count = Math.min(
    Math.max(parseInt(match[2], 10) || 1, 1),
    MAX_IMAGES_PER_REQUEST
  );

  return { query: match[1].trim(), count };
}

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function anilist(query, variables) {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json())?.data;
}

const BLOCKED_IMAGE_HOST_OR_PATH = /(?:pixabay\.com\/get\/|commons\.wikimedia\.org\/.*(?:fresco|painting|portrait_of|stamp|pcb)|upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/.*(?:120px|150px|200px)|lookaside|placeholder|avatar|icon|logo_placeholder)/i;

function isValidImageUrl(url = '') {
  const clean = String(url || '').trim();
  if (!/^https?:\/\//i.test(clean)) return false;
  if (BLOCKED_IMAGE_HOST_OR_PATH.test(clean)) return false;
  return true;
}

function classifyImageQuery(raw = '') {
  const clean = String(raw || '').trim();
  const n = norm(clean);

  const animeSignals = [
    'luffy', 'zoro', 'sanji', 'nami', 'kaido', 'shanks', 'gear 5', 'gear5', 'nika',
    'goku', 'vegeta', 'gohan', 'broly', 'piccolo', 'ultra instinct', 'ui', 'mui', 'super saiyan', 'ssj',
    'naruto', 'sasuke', 'madara', 'rikudo', 'itachi', 'obito', 'kakashi', 'hashirama', 'uchiha',
    'ichigo', 'aizen', 'bankai', 'zaraki', 'byakuya', 'rukia', 'soi fon',
    'gojo', 'sukuna', 'megumi', 'itadori', 'toji', 'yuta',
    'tanjiro', 'nezuko', 'zenitsu', 'inosuke', 'muzan',
    'levi', 'eren', 'mikasa', 'gon', 'killua', 'kurapika', 'hisoka',
    'asta', 'yuno', 'deku', 'bakugo', 'denji', 'makima', 'power',
    'anime', 'manga', 'bankai', 'shikai', 'domain expansion', 'haki', 'nen', 'chakra', 'saiyan'
  ];

  const isAnime = animeSignals.some(sig => n.includes(sig));

  const entitySignals = [
    'drake', 'messi', 'ronaldo', 'neymar', 'mbappe', 'beyonce', 'rihanna', 'eminem', 'weeknd',
    'stade', 'stadium', 'drapeau', 'flag', 'logo', 'pays', 'country', 'capitale', 'ville', 'city',
    'tour eiffel', 'louvre', 'real madrid', 'barcelona', 'psg', 'chelsea', 'arsenal', 'manchester'
  ];

  const isNamedEntity = entitySignals.some(sig => n.includes(sig)) || / [A-Z][a-z]{2,} /.test(clean);

  return {
    isAnime,
    isNamedEntity,
    isGenericPhoto: !isAnime && !isNamedEntity
  };
}

function extractMainAnimeCharacter(cleanTerme = '') {
  const n = norm(cleanTerme);
  const knownCharacters = [
    { key: 'luffy', query: 'Monkey D. Luffy' },
    { key: 'zoro', query: 'Roronoa Zoro' },
    { key: 'sanji', query: 'Vinsmoke Sanji' },
    { key: 'shanks', query: 'Shanks' },
    { key: 'kaido', query: 'Kaido' },
    { key: 'goku', query: 'Son Goku' },
    { key: 'vegeta', query: 'Vegeta' },
    { key: 'gohan', query: 'Son Gohan' },
    { key: 'broly', query: 'Broly' },
    { key: 'piccolo', query: 'Piccolo' },
    { key: 'madara', query: 'Madara Uchiha' },
    { key: 'sasuke', query: 'Sasuke Uchiha' },
    { key: 'naruto', query: 'Naruto Uzumaki' },
    { key: 'itachi', query: 'Itachi Uchiha' },
    { key: 'obito', query: 'Obito Uchiha' },
    { key: 'kakashi', query: 'Kakashi Hatake' },
    { key: 'ichigo', query: 'Ichigo Kurosaki' },
    { key: 'aizen', query: 'Sosuke Aizen' },
    { key: 'gojo', query: 'Satoru Gojo' },
    { key: 'sukuna', query: 'Ryomen Sukuna' },
    { key: 'levi', query: 'Levi Ackerman' },
    { key: 'eren', query: 'Eren Yeager' },
    { key: 'gon', query: 'Gon Freecss' },
    { key: 'killua', query: 'Killua Zoldyck' },
    { key: 'tanjiro', query: 'Tanjiro Kamado' },
    { key: 'nezuko', query: 'Nezuko Kamado' },
    { key: 'asta', query: 'Asta' },
    { key: 'deku', query: 'Izuku Midoriya' },
    { key: 'denji', query: 'Denji' },
    { key: 'makima', query: 'Makima' }
  ];

  const found = knownCharacters.find(item => n.includes(item.key));
  if (found) return found.query;

  return cleanTerme
    .replace(/ (en forme|forme|mode|version|gear\s*\d+|ultra\s*instinct|ui|mui|super\s*saiyan|ssj\d*|bankai|shikai|rikudo) /gi, ' ')
    .replace(/\s+/g, ' ')
    .trim() || cleanTerme;
}

async function fetchMediaWikiThumbnails(domain, searchQuery, limit = 4, labelSuffix = '') {
  const items = [];
  try {
    const res = await axios.get(`https://${domain}/api.php`, {
      params: {
        action: 'query',
        generator: 'search',
        gsrsearch: searchQuery,
        gsrlimit: limit,
        prop: 'pageimages',
        piprop: 'thumbnail',
        pithumbsize: 1000,
        format: 'json'
      },
      headers: {
        'User-Agent': 'SitriNelBot/2.0 (https://github.com/sitri-nel; contact@sitri-nel.bot)'
      },
      timeout: 5500
    });

    const pages = Object.values(res.data?.query?.pages || {});
    for (const p of pages) {
      const imgUrl = p?.thumbnail?.source;
      if (isValidImageUrl(imgUrl) && !items.some(i => i.url === imgUrl)) {
        items.push({
          url: imgUrl,
          label: `${p.title || searchQuery}${labelSuffix}`,
          verse: domain.replace('.fandom.com', '').replace('.wikipedia.org', '').toUpperCase()
        });
      }
    }
  } catch {
    // Continuer
  }
  return items;
}

async function fetchTavilyVisuals(searchQuery, label, verse, limit = 5) {
  const items = [];
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (CONFIG.tavilyKey) {
      headers.Authorization = `Bearer ${CONFIG.tavilyKey}`;
    } else {
      headers['X-Tavily-Access-Mode'] = 'keyless';
    }

    const res = await axios.post(
      'https://api.tavily.com/search',
      {
        query: searchQuery,
        search_depth: 'advanced',
        include_images: true,
        max_results: limit
      },
      { headers, timeout: 6000 }
    );

    for (const img of (res.data?.images || [])) {
      const imgUrl = typeof img === 'string' ? img : img?.url;
      if (isValidImageUrl(imgUrl) && !items.some(i => i.url === imgUrl)) {
        items.push({
          url: imgUrl,
          label,
          verse
        });
      }
    }
  } catch {
    // Continuer
  }
  return items;
}

async function collectAnimeImages(rawQuery, count = 1) {
  const cleanTerme = normalizeAnimeQuery(rawQuery);
  const coreCharacter = extractMainAnimeCharacter(cleanTerme);
  const results = [];

  for (const q of [...new Set([cleanTerme, coreCharacter])]) {
    if (!q || results.length >= count) break;
    try {
      const d = await anilist(
        `query ($s: String, $n: Int) { Page(perPage: $n) { characters(search: $s) {
          name { full native alternative } image { large }
          media(perPage: 1) { nodes { title { romaji } } } } } }`,
        { s: q, n: Math.max(count * 3, 6) }
      );
      const chars = d?.Page?.characters || [];
      for (const c of chars) {
        if (results.length >= count) break;
        const imgUrl = c?.image?.large;
        if (isValidImageUrl(imgUrl) && !results.some(r => r.url === imgUrl)) {
          results.push({
            url: imgUrl,
            label: `${c?.name?.full || cleanTerme}${cleanTerme.toLowerCase() !== (c?.name?.full || '').toLowerCase() ? ` — ${cleanTerme}` : ''}`,
            verse: c?.media?.nodes?.[0]?.title?.romaji || 'AniList'
          });
        }
      }
    } catch (e) {
      logger.warn({ error: e?.message }, 'AniList character lookup failed');
    }
  }

  const n = norm(cleanTerme);
  const fandomTargets = [];
  if (/luffy|gear\s*5|nika|one\s*piece|zoro|sanji|shanks|kaido/.test(n)) {
    fandomTargets.push('onepiece.fandom.com');
  }
  if (/goku|ultra\s*instinct|ui|mui|vegeta|gohan|broly|dragon\s*ball/.test(n)) {
    fandomTargets.push('dragonball.fandom.com');
  }
  if (/madara|rikudo|naruto|sasuke|itachi|obito|kakashi|uchiha/.test(n)) {
    fandomTargets.push('naruto.fandom.com');
  }
  if (/ichigo|aizen|bankai|bleach|zaraki|byakuya/.test(n)) {
    fandomTargets.push('bleach.fandom.com');
  }
  if (/gojo|sukuna|megumi|itadori|jujutsu/.test(n)) {
    fandomTargets.push('jujutsu-kaisen.fandom.com');
  }

  for (const domain of fandomTargets.slice(0, 2)) {
    if (results.length >= count) break;
    const wikiHits = await fetchMediaWikiThumbnails(domain, cleanTerme, 4, '');
    for (const hit of wikiHits) {
      if (results.length >= count) break;
      if (!results.some(r => r.url === hit.url)) {
        results.push(hit);
      }
    }
  }

  if (results.length < count) {
    const webAnimeHits = await fetchTavilyVisuals(
      `${cleanTerme} anime official artwork OR character`,
      cleanTerme,
      'Anime Visual',
      6
    );
    for (const hit of webAnimeHits) {
      if (results.length >= count) break;
      if (!results.some(r => r.url === hit.url)) {
        results.push(hit);
      }
    }
  }

  return results.slice(0, count);
}

async function collectEntityOrWorldImages(rawQuery, count = 1) {
  const cleanTerme = String(rawQuery || '').trim();
  const n = norm(cleanTerme);
  const results = [];

  const searchTerm = n === 'drake' ? 'Drake rapper artist official' : cleanTerme;

  for (const lang of ['en', 'fr']) {
    if (results.length >= count) break;
    const wikiHits = await fetchMediaWikiThumbnails(`${lang}.wikipedia.org`, searchTerm, 4, '');
    for (const hit of wikiHits) {
      if (results.length >= count) break;
      if (!results.some(r => r.url === hit.url)) {
        results.push(hit);
      }
    }
  }

  if (results.length < count) {
    const queryBoost =
      /logo|marque|brand/.test(n) ? `${cleanTerme} logo high resolution` :
      /stade|stadium/.test(n) ? `${cleanTerme} stadium photo` :
      /pays|drapeau|flag|capitale/.test(n) ? `${cleanTerme} country flag landmark` :
      n === 'drake' ? 'Drake musician portrait concert' :
      `${cleanTerme} official photo`;

    const webHits = await fetchTavilyVisuals(queryBoost, cleanTerme, 'Web Search', 6);
    for (const hit of webHits) {
      if (results.length >= count) break;
      if (!results.some(r => r.url === hit.url)) {
        results.push(hit);
      }
    }
  }

  if (results.length < count && CONFIG.pixabayKey && n !== 'drake') {
    try {
      const url = `https://pixabay.com/api/?key=${CONFIG.pixabayKey}&q=${encodeURIComponent(cleanTerme)}&image_type=all&safesearch=true&per_page=${Math.max(count * 3, 6)}`;
      const json = await (await fetch(url)).json();
      for (const h of (json.hits || [])) {
        if (results.length >= count) break;
        const imgUrl = h.largeImageURL || h.webformatURL;
        if (isValidImageUrl(imgUrl) && !results.some(r => r.url === imgUrl)) {
          results.push({
            url: imgUrl,
            label: cleanTerme,
            verse: 'Pixabay'
          });
        }
      }
    } catch {
      // Continuer
    }
  }

  return results.slice(0, count);
}

async function collectPhotos(terme, nombre = 1) {
  const cleanTerme = String(terme).trim();
  const results = [];

  if (CONFIG.pixabayKey) {
    try {
      const url = `https://pixabay.com/api/?key=${CONFIG.pixabayKey}&q=${encodeURIComponent(cleanTerme)}&image_type=photo&safesearch=true&per_page=${Math.max(nombre * 3, 8)}`;
      const json = await (await fetch(url)).json();
      for (const h of (json.hits || [])) {
        if (results.length >= nombre) break;
        const imgUrl = h.largeImageURL || h.webformatURL;
        if (isValidImageUrl(imgUrl) && !results.some(r => r.url === imgUrl)) {
          results.push({
            url: imgUrl,
            label: cleanTerme,
            verse: 'Pixabay'
          });
        }
      }
    } catch {
      // Continuer
    }
  }

  if (results.length < nombre) {
    const extra = await collectEntityOrWorldImages(cleanTerme, nombre - results.length);
    for (const item of extra) {
      if (results.length >= nombre) break;
      if (!results.some(r => r.url === item.url)) {
        results.push(item);
      }
    }
  }

  return results.slice(0, nombre);
}

function normalizeAnimeQuery(raw = '') {
  return String(raw)
    .replace(/^(image|affiche|cover|poster|wallpaper|fond d['’]ecran)\s+(de\s+|d['’]|du\s+|des\s+)?(anime\s+|manga\s+)?/i, '')
    .replace(/\buchiwa\b/gi, 'Uchiha')
    .replace(/ kirua /gi, 'Killua')
    .replace(/ livai /gi, 'Levi')
    .replace(/ sangoku /gi, 'Son Goku')
    .replace(/ mikey\s+sano /gi, 'Manjiro Sano')
    .replace(/ draken /gi, 'Ken Ryuguji')
    .trim();
}

async function collectImageCandidates(terme, nombre = 1) {
  const cleanTerme = normalizeAnimeQuery(terme);
  const kind = classifyImageQuery(cleanTerme);

  if (kind.isAnime) {
    const animeHits = await collectAnimeImages(cleanTerme, nombre);
    if (animeHits.length) return animeHits;
  }

  if (kind.isNamedEntity) {
    const entityHits = await collectEntityOrWorldImages(cleanTerme, nombre);
    if (entityHits.length) return entityHits;
  }

  const animeFallback = await collectAnimeImages(cleanTerme, nombre);
  if (animeFallback.length) return animeFallback;

  const entityFallback = await collectEntityOrWorldImages(cleanTerme, nombre);
  if (entityFallback.length) return entityFallback;

  return await collectPhotos(cleanTerme, nombre);
}

async function searchImage(jid, message, rawQuery) {
  const parsed = parseImageRequest(rawQuery);
  const query = parsed.query.trim();
  const count = parsed.count;

  if (!query) {
    await sendReply(
      jid,
      'Utilisation :\n• Ximg Naruto\n• Ximg Lelouch\n• Ximg photo lion 2',
      message
    );
    return false;
  }

  await sendReply(jid, '🔎 Recherche de visuels en cours...', message);

  const isExplicitPhoto = /^photo\b/i.test(query);
  const cleanPhotoQuery = query.replace(/^photo\s+/i, '').trim();

  let found = isExplicitPhoto
    ? await collectPhotos(cleanPhotoQuery || query, count)
    : await collectImageCandidates(query, count);

  if (isExplicitPhoto && (!found || !found.length)) {
    found = await collectEntityOrWorldImages(cleanPhotoQuery || query, count);
  }

  if (!found || !found.length) {
    await sendReply(
      jid,
      `Aucun visuel trouvé pour "${cleanPhotoQuery || query}". Réessaie avec un mot-clé plus précis.`,
      message
    );
    return false;
  }

  let sent = 0;

  for (const item of found) {
    if (sent >= count) break;

    try {
      const downloaded = await downloadImageBuffer(item.url);
      const counter = count > 1 ? ` (${sent + 1}/${count})` : '';
      const verseLine = item.verse && item.verse !== item.label ? `\n🌌 𝗩𝗘𝗥𝗦𝗘 : ${item.verse}` : '';

      await sock.sendMessage(
        jid,
        {
          image: downloaded.buffer,
          mimetype: downloaded.contentType,
          caption: `🖼️ 𝗥𝗘𝗖𝗛𝗘𝗥𝗖𝗛𝗘 : ${item.label}${counter}${verseLine}\n\n${SIGNATURE}`
        },
        { quoted: message }
      );

      sent += 1;
    } catch (error) {
      logger.warn({ err: error }, 'Image trouvée mais non téléchargeable.');
    }
  }

  if (!sent) {
    await sendReply(
      jid,
      'Les résultats ont été trouvés, mais aucune image n’a pu être téléchargée.',
      message
    );
    return false;
  }

  if (sent < count) {
    await sendReply(jid, `Seulement ${sent} image(s) trouvée(s) sur ${count} demandée(s).`, message);
  }

  return true;
}

function describeCloudflareError(error) {
  const status = error?.response?.status;
  let apiMessage = '';

  try {
    const raw = error?.response?.data;
    const text = raw ? Buffer.from(raw).toString('utf8') : '';
    apiMessage = JSON.parse(text)?.errors?.[0]?.message || '';
  } catch {
    apiMessage = '';
  }

  const hints = {
    401: 'Jeton refusé : vérifie CLOUDFLARE_API_TOKEN.',
    403: 'Le jeton n’a pas l’autorisation Workers AI.',
    404: 'Compte ou modèle introuvable : vérifie CLOUDFLARE_ACCOUNT_ID.',
    429: 'Quota Cloudflare atteint pour le moment.'
  };

  return [
    status ? `Code ${status}.` : '',
    hints[status] || '',
    apiMessage,
    status ? '' : error?.message || ''
  ]
    .filter(Boolean)
    .join(' ');
}

async function generateImage(jid, message, prompt) {
  if (!CONFIG.cloudflareToken || !CONFIG.cloudflareAccountId) {
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

  await sendReply(jid, '🎨 𝗖𝗥𝗘́𝗔𝗧𝗜𝗢𝗡 𝗩𝗜𝗦𝗨𝗘𝗟𝗟𝗘\nJe prépare ton image...', message);

  try {
    const endpoint =
      `https://api.cloudflare.com/client/v4/accounts/${CONFIG.cloudflareAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

    const response = await axios.post(
      endpoint,
      { prompt: prompt.trim() },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.cloudflareToken}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024
      }
    );

    const contentType = String(response.headers['content-type'] || '').toLowerCase();

    let buffer;
    let mimetype = 'image/png';

    if (contentType.startsWith('image/')) {
      buffer = Buffer.from(response.data);
      mimetype = contentType.split(';')[0];
    } else {
      const json = JSON.parse(Buffer.from(response.data).toString('utf8'));
      const base64 = json?.result?.image || json?.image;

      if (!base64) {
        throw new Error(`Cloudflare : ${json?.errors?.[0]?.message || 'réponse sans image'}`);
      }

      buffer = Buffer.from(base64, 'base64');
      if (buffer[0] === 0xff && buffer[1] === 0xd8) mimetype = 'image/jpeg';
    }

    if (!buffer.length || buffer.length > CONFIG.maxImageBytes) {
      throw new Error('Image générée de taille invalide.');
    }

    await sock.sendMessage(
      jid,
      {
        image: buffer,
        mimetype,
        caption: `✨ 𝗜𝗠𝗔𝗚𝗘 𝗚𝗘́𝗡𝗘́𝗥𝗘́𝗘\n\n${SIGNATURE}`
      },
      { quoted: message }
    );

    return true;
  } catch (error) {
    const detail = describeCloudflareError(error);
    logger.error({ status: error?.response?.status, detail, error: error?.message }, 'Erreur de génération Cloudflare.');
    await sendReply(jid, `⚠️ La génération a échoué.\n${detail || error?.message || ''}`, message);
    return false;
  }
}

// ------------------------------------------------------------
// 23 bis. STICKER (XS), IMAGE DEPUIS STICKER (XI), VUE UNIQUE & AUDIO/VIDÉO
// ------------------------------------------------------------

function extractImageOrStickerPayload(message, expectedKind = 'any') {
  const quotedCtx = getQuotedMessage(message);
  let target = quotedCtx?.quotedMessage || unwrapContent(message);

  if (!target) return null;

  for (let i = 0; i < 6; i++) {
    if (target.viewOnceMessage?.message) {
      target = target.viewOnceMessage.message;
    } else if (target.viewOnceMessageV2?.message) {
      target = target.viewOnceMessageV2.message;
    } else if (target.viewOnceMessageV2Extension?.message) {
      target = target.viewOnceMessageV2Extension.message;
    } else if (target.ephemeralMessage?.message) {
      target = target.ephemeralMessage.message;
    } else if (target.documentWithCaptionMessage?.message) {
      target = target.documentWithCaptionMessage.message;
    } else {
      break;
    }
  }

  if ((expectedKind === 'any' || expectedKind === 'image') && target.imageMessage) {
    return {
      kind: 'image',
      media: target.imageMessage,
      quotedCtx
    };
  }

  if ((expectedKind === 'any' || expectedKind === 'sticker') && target.stickerMessage) {
    return {
      kind: 'sticker',
      media: target.stickerMessage,
      quotedCtx
    };
  }

  return null;
}

async function downloadTargetMediaBuffer(message, expectedKind) {
  const payload = extractImageOrStickerPayload(message, expectedKind);
  if (!payload) return null;

  if (typeof Baileys.downloadMediaMessage !== 'function') {
    throw new Error('downloadMediaMessage indisponible dans Baileys.');
  }

  const { quotedCtx, kind, media } = payload;
  const targetMessageObj = quotedCtx?.stanzaId
    ? {
        key: {
          remoteJid: quotedCtx.remoteJid || message?.key?.remoteJid,
          fromMe: Boolean(quotedCtx.participant && isBotParticipant(quotedCtx.participant)),
          id: quotedCtx.stanzaId,
          participant: quotedCtx.participant
        },
        message: quotedCtx.quotedMessage
      }
    : message;

  const buffer = await Baileys.downloadMediaMessage(
    targetMessageObj,
    'buffer',
    {},
    {
      logger: baileysLogger,
      reuploadRequest: sock.updateMediaMessage
    }
  );

  if (!buffer || !buffer.length) {
    throw new Error('Buffer média vide.');
  }

  return { buffer, kind, media };
}

function isValidWebpBuffer(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length > 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  );
}

async function runBinaryImageConvert(inputBuffer, inExt, outExt, extraArgs = []) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpIn = path.join(ROOT_DIR, `tmp_${stamp}.${inExt}`);
  const tmpOut = path.join(ROOT_DIR, `tmp_${stamp}.${outExt}`);
  try {
    await fs.promises.writeFile(tmpIn, inputBuffer);
    for (const bin of ['ffmpeg', 'magick', 'convert']) {
      try {
        const args =
          bin === 'ffmpeg'
            ? ['-y', '-i', tmpIn, ...extraArgs, tmpOut]
            : [tmpIn, ...extraArgs, tmpOut];
        await execFileAsync(bin, args, { timeout: 15000 });
        const outBuf = await fs.promises.readFile(tmpOut);
        if (outBuf && outBuf.length > 0) return outBuf;
      } catch {
        // Essayer le binaire suivant
      }
    }
    return null;
  } finally {
    fs.promises.unlink(tmpIn).catch(() => {});
    fs.promises.unlink(tmpOut).catch(() => {});
  }
}

async function encodeBufferForSticker(inputBuffer) {
  if (isValidWebpBuffer(inputBuffer)) {
    return inputBuffer;
  }

  // 1. Essayer @napi-rs/canvas
  if (createCanvasFn && loadImageFn) {
    try {
      const img = await loadImageFn(inputBuffer);
      const size = 512;
      const canvas = createCanvasFn(size, size);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, size, size);

      const scale = Math.min(size / img.width, size / img.height);
      const drawW = Math.round(img.width * scale);
      const drawH = Math.round(img.height * scale);
      const offsetX = Math.round((size - drawW) / 2);
      const offsetY = Math.round((size - drawH) / 2);

      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
      const webpBuf = await canvas.encode('webp');
      if (isValidWebpBuffer(webpBuf)) return webpBuf;
    } catch {
      // Essayer sharp / ffmpeg
    }
  }

  // 2. Essayer sharp
  try {
    const sharpMod = await import('sharp');
    const sharpFn = sharpMod.default || sharpMod;
    const webpBuf = await sharpFn(inputBuffer)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 82 })
      .toBuffer();
    if (isValidWebpBuffer(webpBuf)) return webpBuf;
  } catch {
    // Essayer ffmpeg / ImageMagick
  }

  // 3. Essayer ffmpeg / ImageMagick
  const binWebp = await runBinaryImageConvert(inputBuffer, 'img', 'webp', [
    '-vf',
    'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
    '-vcodec',
    'libwebp',
    '-lossless',
    '0',
    '-q:v',
    '80',
    '-loop',
    '0',
    '-an',
    '-vsync',
    '0'
  ]);
  if (isValidWebpBuffer(binWebp)) return binWebp;

  // 4. Essayer l'API publique freeconvert / cloud / ezgif / wsrv.nl
  try {
    const FormDataMod = await import('form-data').catch(() => null);
    if (FormDataMod?.default) {
      const form = new FormDataMod.default();
      form.append('file', inputBuffer, { filename: 'image.png', contentType: 'image/png' });
      const res = await axios.post('https://s2.ezgif.com/png-to-webp', form, {
        headers: form.getHeaders(),
        timeout: 12000
      });
      const match = String(res.data || '').match(/action="([^"]+)"/);
      if (match?.[1]) {
        const actionUrl = match[1].startsWith('http') ? match[1] : `https:${match[1]}`;
        const fileMatch = String(res.data || '').match(/name="file"\s+value="([^"]+)"/);
        if (fileMatch?.[1]) {
          const convRes = await axios.post(
            actionUrl,
            `file=${encodeURIComponent(fileMatch[1])}&convert=Convert+PNG+to+WebP!`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 12000 }
          );
          const outMatch = String(convRes.data || '').match(/src="(\/\/[^"]+\.webp)"/);
          if (outMatch?.[1]) {
            const dl = await axios.get(`https:${outMatch[1]}`, { responseType: 'arraybuffer', timeout: 12000 });
            const webpBuf = Buffer.from(dl.data);
            if (isValidWebpBuffer(webpBuf)) return webpBuf;
          }
        }
      }
    }
  } catch {
    // Repli
  }

  throw new Error('Encodeur WebP manquant sur le serveur (ajoute "sharp" dans package.json).');
}

async function decodeStickerToPngBuffer(stickerBuffer) {
  if (createCanvasFn && loadImageFn) {
    try {
      const img = await loadImageFn(stickerBuffer);
      const canvas = createCanvasFn(img.width || 512, img.height || 512);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toBuffer('image/png');
    } catch {
      // Essayer sharp / ffmpeg
    }
  }

  try {
    const sharpMod = await import('sharp');
    const sharpFn = sharpMod.default || sharpMod;
    return await sharpFn(stickerBuffer).png().toBuffer();
  } catch {
    // Essayer ffmpeg / ImageMagick
  }

  const binPng = await runBinaryImageConvert(stickerBuffer, 'webp', 'png');
  if (binPng && binPng.length > 0) return binPng;

  return stickerBuffer;
}

async function convertImageToSticker(jid, message) {
  try {
    const mediaResult = await downloadTargetMediaBuffer(message, 'image');
    if (!mediaResult?.buffer) {
      await sendReply(
        jid,
        '🖼️ Réponds à une image avec Xs (ou envoie une image avec la légende Xs) pour la transformer en sticker.',
        message
      );
      return true;
    }

    const stickerBuffer = await encodeBufferForSticker(mediaResult.buffer);

    await sock.sendMessage(
      jid,
      {
        sticker: stickerBuffer
      },
      { quoted: message }
    );
    return true;
  } catch (error) {
    logger.error({ error: error?.message }, 'Erreur conversion image -> sticker (Xs).');
    await sendReply(
      jid,
      `⚠️ Impossible de convertir cette image en sticker (${error?.message || 'erreur média'}).`,
      message
    );
    return true;
  }
}

function isAnimatedWebp(buffer) {
  try {
    return (
      Buffer.isBuffer(buffer) &&
      buffer.length > 21 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP' &&
      buffer.toString('ascii', 12, 16) === 'VP8X' &&
      (buffer[20] & 0x02) === 0x02
    );
  } catch {
    return false;
  }
}

// Sticker animé : WebP -> GIF (sharp) -> MP4 (ffmpeg). Renvoie null si impossible.
async function convertAnimatedStickerToMp4(buffer) {
  let gifBuffer;
  try {
    const sharpMod = await import('sharp');
    const sharpFn = sharpMod.default || sharpMod;
    gifBuffer = await sharpFn(buffer, { animated: true }).gif().toBuffer();
  } catch {
    return null;
  }

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const run = promisify(execFile);

  let ffmpegBin = 'ffmpeg';
  try {
    const ffmpegStatic = await import('ffmpeg-static');
    if (ffmpegStatic.default) ffmpegBin = ffmpegStatic.default;
  } catch {
    // On garde ffmpeg du système
  }

  const base = path.join(os.tmpdir(), `xi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const gifPath = `${base}.gif`;
  const mp4Path = `${base}.mp4`;

  try {
    fs.writeFileSync(gifPath, gifBuffer);
    await run(
      ffmpegBin,
      [
        '-y', '-i', gifPath,
        '-movflags', 'faststart',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        mp4Path
      ],
      { timeout: 30000 }
    );
    const out = fs.readFileSync(mp4Path);
    return out.length ? out : null;
  } catch {
    return null;
  } finally {
    for (const f of [gifPath, mp4Path]) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}

async function convertStickerToImage(jid, message) {
  try {
    const mediaResult = await downloadTargetMediaBuffer(message, 'sticker');
    if (!mediaResult?.buffer) {
      await sendReply(
        jid,
        '🧩 Réponds à un sticker avec Xi pour le transformer en image.',
        message
      );
      return true;
    }

    if (isAnimatedWebp(mediaResult.buffer)) {
      const videoBuffer = await convertAnimatedStickerToMp4(mediaResult.buffer);
      if (videoBuffer) {
        await sock.sendMessage(
          jid,
          {
            video: videoBuffer,
            mimetype: 'video/mp4',
            gifPlayback: true,
            caption: `🎞️ 𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗔𝗡𝗜𝗠𝗘́ 𝗘𝗡 𝗩𝗜𝗗𝗘́𝗢\n\n${SIGNATURE}`
          },
          { quoted: message }
        );
        return true;
      }
      // Sinon : repli sur la première image du sticker
    }

    const pngBuffer = await decodeStickerToPngBuffer(mediaResult.buffer);

    await sock.sendMessage(
      jid,
      {
        image: pngBuffer,
        mimetype: 'image/png',
        caption: `🖼️ 𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗘𝗡 𝗜𝗠𝗔𝗚𝗘\n\n${SIGNATURE}`
      },
      { quoted: message }
    );
    return true;
  } catch (error) {
    logger.error({ error: error?.message }, 'Erreur conversion sticker -> image (Xi).');
    await sendReply(
      jid,
      `⚠️ Impossible de convertir ce sticker en image (${error?.message || 'erreur média'}).`,
      message
    );
    return true;
  }
}

function extractViewOncePayload(message) {
  const quotedCtx = getQuotedMessage(message);
  let target = quotedCtx?.quotedMessage || unwrapContent(message);

  if (!target) return null;

  for (let i = 0; i < 6; i++) {
    if (target.viewOnceMessage?.message) {
      target = target.viewOnceMessage.message;
    } else if (target.viewOnceMessageV2?.message) {
      target = target.viewOnceMessageV2.message;
    } else if (target.viewOnceMessageV2Extension?.message) {
      target = target.viewOnceMessageV2Extension.message;
    } else if (target.ephemeralMessage?.message) {
      target = target.ephemeralMessage.message;
    } else if (target.documentWithCaptionMessage?.message) {
      target = target.documentWithCaptionMessage.message;
    } else {
      break;
    }
  }

  if (target.imageMessage) {
    return {
      kind: 'image',
      media: target.imageMessage,
      caption: target.imageMessage.caption || ''
    };
  }

  if (target.videoMessage) {
    return {
      kind: 'video',
      media: target.videoMessage,
      caption: target.videoMessage.caption || ''
    };
  }

  if (target.audioMessage) {
    return {
      kind: 'audio',
      media: target.audioMessage,
      caption: ''
    };
  }

  return null;
}

async function revealViewOnceMessage(jid, message) {
  const payload = extractViewOncePayload(message);

  if (!payload) {
    await sendReply(
      jid,
      '👁️ Réponds à un message en vue unique (photo, vidéo ou audio) avec Xv pour le dévoiler.',
      message
    );
    return false;
  }

  if (typeof Baileys.downloadMediaMessage !== 'function') {
    await sendReply(
      jid,
      '⚠️ Le téléchargement de média n’est pas disponible dans cette version de Baileys.',
      message
    );
    return false;
  }

  const quotedCtx = getQuotedMessage(message);
  const targetMessageObj = quotedCtx?.stanzaId
    ? {
        key: {
          remoteJid: quotedCtx.remoteJid || jid,
          fromMe: Boolean(quotedCtx.participant && isBotParticipant(quotedCtx.participant)),
          id: quotedCtx.stanzaId,
          participant: quotedCtx.participant
        },
        message: quotedCtx.quotedMessage
      }
    : message;

  try {
    const buffer = await Baileys.downloadMediaMessage(
      targetMessageObj,
      'buffer',
      {},
      {
        logger: baileysLogger,
        reuploadRequest: sock.updateMediaMessage
      }
    );

    if (!buffer || !buffer.length) {
      await sendReply(jid, '⚠️ Impossible de récupérer le contenu du média à vue unique.', message);
      return false;
    }

    const captionText = payload.caption
      ? `🔓 𝗩𝗨𝗘 𝗨𝗡𝗜𝗤𝗨𝗘 𝗗𝗘́𝗩𝗢𝗜𝗟𝗘́𝗘\n💬 Légende : ${payload.caption}\n\n${SIGNATURE}`
      : `🔓 𝗩𝗨𝗘 𝗨𝗡𝗜𝗤𝗨𝗘 𝗗𝗘́𝗩𝗢𝗜𝗟𝗘́𝗘\n\n${SIGNATURE}`;

    if (payload.kind === 'image') {
      await sock.sendMessage(
        jid,
        {
          image: buffer,
          mimetype: payload.media.mimetype || 'image/jpeg',
          caption: captionText
        },
        { quoted: message }
      );
    } else if (payload.kind === 'video') {
      await sock.sendMessage(
        jid,
        {
          video: buffer,
          mimetype: payload.media.mimetype || 'video/mp4',
          caption: captionText
        },
        { quoted: message }
      );
    } else if (payload.kind === 'audio') {
      await sock.sendMessage(
        jid,
        {
          audio: buffer,
          mimetype: payload.media.mimetype || 'audio/ogg; codecs=opus',
          ptt: Boolean(payload.media.ptt)
        },
        { quoted: message }
      );
      if (captionText) {
        await sendReply(jid, captionText, message);
      }
    }

    return true;
  } catch (error) {
    logger.error({ error: error?.message }, 'Erreur lors du dévoilement de vue unique (Xs).');
    await sendReply(
      jid,
      `⚠️ Impossible de dévoiler ce message à vue unique (${error?.message || 'erreur média'}).`,
      message
    );
    return false;
  }
}

async function searchYouTubeCandidates(query) {
  const clean = String(query || '').trim();
  if (!clean) return [];

  try {
    const res = await axios.get('https://www.youtube.com/results', {
      params: { search_query: clean },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
      },
      timeout: 8000
    });
    const html = String(res.data || '');
    const items = [];
    const videoRegex = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"([^"]+)"\}/g;
    let m;
    while ((m = videoRegex.exec(html)) !== null && items.length < 5) {
      const videoId = m[1];
      const title = m[2].replace(/\u0026/g, '&').replace(/\"/g, '"');
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      if (!items.some(i => i.url === url)) {
        items.push({ title, url });
      }
    }
    if (items.length) return items;
  } catch {
    // Fallback Tavily / DuckDuckGo
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (CONFIG.tavilyKey) {
      headers.Authorization = `Bearer ${CONFIG.tavilyKey}`;
    } else {
      headers['X-Tavily-Access-Mode'] = 'keyless';
    }
    const res = await axios.post(
      'https://api.tavily.com/search',
      {
        query: `${clean} youtube watch`,
        search_depth: 'basic',
        max_results: 5
      },
      { headers, timeout: 4500 }
    );
    const items = [];
    for (const r of (res.data?.results || [])) {
      const url = String(r.url || '');
      if (/youtube\.com\/watch\?v=|youtu\.be\//i.test(url)) {
        items.push({
          title: String(r.title || clean).replace(/\s*-\s*YouTube$/i, '').trim(),
          url
        });
      }
    }
    if (items.length) return items;
  } catch {
    // Fallback DuckDuckGo HTML
  }

  try {
    const res = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: `site:youtube.com/watch ${clean}` },
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) SitriNelBot/1.0' },
      timeout: 5000
    });
    const html = String(res.data || '');
    const regex = /href="([^"]*youtube\.com\/watch\?v=[^"&]+|[^"]*youtu\.be\/[^"&]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const items = [];
    let match;
    while ((match = regex.exec(html)) !== null && items.length < 5) {
      const rawUrl = decodeURIComponent(match[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0]);
      const title = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (/^https?:\/\//i.test(rawUrl) && !items.some(i => i.url === rawUrl)) {
        items.push({ title: title || clean, url: rawUrl });
      }
    }
    return items;
  } catch {
    return [];
  }
}

function extractYouTubeId(url = '') {
  const match = String(url || '').match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
  );
  return match ? match[1] : '';
}

async function resolveStreamUrl(videoUrl, mode = 'audio') {
  const videoId = extractYouTubeId(videoUrl);

  const cobaltTargets = [
    {
      url: 'https://api.cobalt.tools/',
      body: {
        url: videoUrl,
        downloadMode: mode === 'audio' ? 'audio' : 'auto',
        audioFormat: 'mp3',
        videoQuality: '480'
      }
    },
    {
      url: 'https://api.cobalt.tools/api/json',
      body: {
        url: videoUrl,
        downloadMode: mode === 'audio' ? 'audio' : 'auto',
        audioFormat: 'mp3',
        videoQuality: '480'
      }
    }
  ];

  for (const target of cobaltTargets) {
    try {
      const res = await axios.post(target.url, target.body, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 12000
      });
      const streamUrl = res.data?.url || res.data?.picker?.[0]?.url;
      if (streamUrl && /^https?:\/\//i.test(streamUrl)) {
        return { streamUrl, kind: mode };
      }
    } catch {
      // Essayer le suivant
    }
  }

  if (videoId) {
    const pipedInstances = [
      'https://pipedapi.kavin.rocks',
      'https://pipedapi.adminforge.de',
      'https://pipedapi.moomoo.me'
    ];

    for (const base of pipedInstances) {
      try {
        const res = await axios.get(`${base}/streams/${videoId}`, {
          headers: { 'User-Agent': 'SitriNelBot/1.0' },
          timeout: 10000
        });

        const durationSec = Number(res.data?.duration || 0);
        if (mode === 'video' && durationSec > 180) {
          return { tooLong: true, durationSec };
        }

        if (mode === 'audio') {
          const audioStreams = (res.data?.audioStreams || [])
            .filter(s => s?.url && /^https?:\/\//i.test(s.url))
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          if (audioStreams[0]?.url) {
            return {
              streamUrl: audioStreams[0].url,
              mime: audioStreams[0].mimeType || 'audio/mp4',
              kind: 'audio',
              durationSec
            };
          }
        } else {
          const videoStreams = (res.data?.videoStreams || [])
            .filter(s => s?.url && /^https?:\/\//i.test(s.url) && !s.videoOnly)
            .sort((a, b) => (parseInt(a.height, 10) || 480) - (parseInt(b.height, 10) || 480));
          if (videoStreams[0]?.url) {
            return {
              streamUrl: videoStreams[0].url,
              mime: videoStreams[0].mimeType || 'video/mp4',
              kind: 'video',
              durationSec
            };
          }
        }
      } catch {
        // Essayer l'instance suivante
      }
    }
  }

  if (videoId) {
    const invidiousInstances = [
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://invidious.privacyredirect.com'
    ];

    for (const base of invidiousInstances) {
      try {
        const res = await axios.get(`${base}/api/v1/videos/${videoId}`, {
          headers: { 'User-Agent': 'SitriNelBot/1.0' },
          timeout: 10000
        });
        const durationSec = Number(res.data?.lengthSeconds || 0);
        if (mode === 'video' && durationSec > 180) {
          return { tooLong: true, durationSec };
        }
        if (mode === 'audio') {
          const adaptive = (res.data?.adaptiveFormats || [])
            .filter(f => f?.url && String(f.type || '').startsWith('audio/'))
            .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
          if (adaptive[0]?.url) {
            return {
              streamUrl: adaptive[0].url,
              mime: String(adaptive[0].type || 'audio/mp4').split(';')[0],
              kind: 'audio',
              durationSec
            };
          }
        } else {
          const formats = (res.data?.formatStreams || [])
            .filter(f => f?.url && String(f.type || '').startsWith('video/'));
          if (formats[0]?.url) {
            return {
              streamUrl: formats[0].url,
              mime: String(formats[0].type || 'video/mp4').split(';')[0],
              kind: 'video',
              durationSec
            };
          }
        }
      } catch {
        // Instance suivante
      }
    }
  }

  return null;
}

let lastYtdlpFailure = '';
let lastYtdlpDetails = '';

// Binaire autonome de yt-dlp (sans Python), téléchargé au besoin comme dans Erwin-Bot
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const YTDLP_BIN = path.join(os.tmpdir(), 'sitri-nel-ytdlp', 'yt-dlp');
let ytdlpReadyPromise = null;

async function runBinary(file, args, options = {}) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  return promisify(execFile)(file, args, { maxBuffer: 20 * 1024 * 1024, ...options });
}

function ensureYtdlpBinary() {
  if (ytdlpReadyPromise) return ytdlpReadyPromise;

  ytdlpReadyPromise = (async () => {
    try {
      await runBinary(YTDLP_BIN, ['--version'], { timeout: 20000 });
      return YTDLP_BIN;
    } catch {
      // absent ou inutilisable : on le télécharge
    }

    fs.mkdirSync(path.dirname(YTDLP_BIN), { recursive: true });
    logger.info('yt-dlp : téléchargement du binaire...');

    const res = await axios.get(YTDLP_URL, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxRedirects: 5
    });
    fs.writeFileSync(YTDLP_BIN, Buffer.from(res.data), { mode: 0o755 });
    fs.chmodSync(YTDLP_BIN, 0o755);

    const { stdout } = await runBinary(YTDLP_BIN, ['--version'], { timeout: 20000 });
    logger.info({ version: String(stdout).trim() }, 'yt-dlp : binaire prêt.');
    return YTDLP_BIN;
  })().catch(error => {
    ytdlpReadyPromise = null;
    throw error;
  });

  return ytdlpReadyPromise;
}

// Préparation en arrière-plan au démarrage
setTimeout(() => {
  ensureYtdlpBinary().catch(error =>
    logger.warn({ error: error?.message }, 'yt-dlp : préparation du binaire impossible.')
  );
}, 8000);

// Cookies YouTube : fichier cookies.txt en base64 (YOUTUBE_COOKIES_BASE64),
// ou texte collé tel quel (YOUTUBE_COOKIES) : format Netscape ou "nom=valeur; nom2=valeur2"
function buildYoutubeCookiesFile() {
  let raw = '';

  // 1. Fichier youtube_cookies.txt à la racine du projet (comme Erwin-Bot)
  try {
    const local = path.resolve('./youtube_cookies.txt');
    if (fs.existsSync(local) && fs.statSync(local).size > 50) raw = fs.readFileSync(local, 'utf8');
  } catch {
    raw = '';
  }

  // 2. Variable YOUTUBE_COOKIES_BASE64 (comme Erwin-Bot), ou YOUTUBE_COOKIES en texte brut
  if (!raw) {
    const b64 = cleanEnv(process.env.YOUTUBE_COOKIES_BASE64);
    raw = b64 ? Buffer.from(b64, 'base64').toString('utf8') : String(process.env.YOUTUBE_COOKIES || '').trim();
  }
  if (!raw) return '';

  if (!raw.includes('\n') && raw.includes('\\n')) raw = raw.replace(/\\n/g, '\n');

  if (raw.startsWith('# Netscape') || raw.startsWith('# HTTP') || raw.includes('\t')) {
    // « Export all » : on ne garde que les cookies YouTube / Google, les autres sites sont ignorés
    const keep = ['# Netscape HTTP Cookie File'];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const httpOnly = trimmed.startsWith('#HttpOnly_');
      if (trimmed.startsWith('#') && !httpOnly) continue;

      const fields = (httpOnly ? trimmed.slice('#HttpOnly_'.length) : trimmed).split('\t');
      const domain = String(fields[0] || '').replace(/^\./, '').toLowerCase();
      if (/(^|\.)(youtube\.com|google\.com|googlevideo\.com|youtube-nocookie\.com)$/.test(domain)) {
        keep.push(trimmed);
      }
    }
    return keep.length > 1 ? `${keep.join('\n')}\n` : '';
  }

  const lines = ['# Netscape HTTP Cookie File'];
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) continue;
    lines.push(`.youtube.com\tTRUE\t/\tTRUE\t2000000000\t${name}\t${value}`);
  }
  return lines.length > 1 ? `${lines.join('\n')}\n` : '';
}

// Téléchargement audio avec yt-dlp (mêmes réglages anti-blocage qu'Erwin-Bot)
async function downloadAudioWithYtdlp(videoUrl, { soundcloud = false } = {}) {
  lastYtdlpFailure = '';
  lastYtdlpDetails = '';

  let bin;
  try {
    bin = await ensureYtdlpBinary();
  } catch (error) {
    lastYtdlpFailure = `Binaire yt-dlp indisponible : ${String(error?.message || error).slice(0, 200)}`;
    return null;
  }

  const dir = path.join(os.tmpdir(), 'sitri-nel-play');
  fs.mkdirSync(dir, { recursive: true });

  const base = `play_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let cookiesPath = null;

  try {
    const args = [
      videoUrl,
      '-o', path.join(dir, `${base}.%(ext)s`),
      '--no-playlist',
      '--no-warnings',
      '--force-ipv4',
      '--max-filesize', `${Math.floor(CONFIG.maxMediaBytes / (1024 * 1024))}M`
    ];

    let ffmpegPath = null;
    try {
      const ffmpegStatic = await import('ffmpeg-static');
      ffmpegPath = ffmpegStatic.default || null;
    } catch {
      // sans ffmpeg : pas de conversion
    }
    if (ffmpegPath) args.push('--ffmpeg-location', ffmpegPath);

    if (soundcloud) {
      // SoundCloud : on évite les extraits de 30 secondes et les pistes trop longues
      args.push(
        '-f', 'bestaudio[protocol^=http][ext=mp3]/bestaudio[ext=mp3]/bestaudio',
        '--socket-timeout', '15',
        '--retries', '2',
        '--match-filter', 'duration>60 & duration<900'
      );
    } else {
      // YouTube, sans cookies. Pas d'en-tête user-agent forcé : les liens des clients android/ios
      // sont liés à leur propre user-agent, et un autre provoque l'erreur 403.
      args.push(
        '-f', 'bestaudio[ext=m4a]/bestaudio/best',
        '--no-check-certificate',
        '--add-header', 'referer:https://www.youtube.com/'
      );
      if (ffmpegPath) args.push('-x', '--audio-format', 'm4a', '--audio-quality', '0');
    }

    // Cookies YouTube (méthode d'Erwin-Bot) : utilisés en premier s'ils existent
    const cookiesContent = soundcloud ? '' : buildYoutubeCookiesFile();
    if (cookiesContent) {
      cookiesPath = path.join(dir, `${base}_cookies.txt`);
      fs.writeFileSync(cookiesPath, cookiesContent);
    }

    // Plusieurs profils, du plus simple au plus large.
    // « anonymous » : sans cookies. Si YouTube répond « Sign in » à l'un d'eux, les autres échoueront aussi.
    const jsArgs = ['--js-runtimes', 'node'];
    const cookieArgs = cookiesPath ? ['--cookies', cookiesPath] : [];
    const clientProfiles = soundcloud
      ? [{ extra: [], anonymous: true }]
      : [
          ...(cookiesPath
            ? [
                {
                  extra: [...cookieArgs, '--extractor-args', 'youtube:player_client=android_vr,web_creator,ios,android'],
                  anonymous: false
                },
                { extra: [...jsArgs, ...cookieArgs], anonymous: false },
                {
                  extra: [...jsArgs, ...cookieArgs, '--extractor-args', 'youtube:player_client=tv,web_safari'],
                  anonymous: false
                }
              ]
            : []),
          { extra: ['--extractor-args', 'youtube:player_client=android_vr'], anonymous: true },
          {
            extra: ['--extractor-args', 'youtube:player_client=android_vr,web_creator,ios,android'],
            anonymous: true
          },
          { extra: [...jsArgs, '--extractor-args', 'youtube:player_client=tv,web_safari'], anonymous: true },
          { extra: [...jsArgs], anonymous: true }
        ];
    const ytdlpDeadline = Date.now() + 60000;

    let lastError = null;
    let succeeded = false;
    const profileErrors = [];
    let profileIndex = 0;

    for (const profile of clientProfiles) {
      profileIndex += 1;
      if (Date.now() > ytdlpDeadline) break;
      try {
        await runBinary(bin, [...args, ...profile.extra], { timeout: 45000 });
        succeeded = true;
        break;
      } catch (error) {
        lastError = error;

        const detail = String(error?.stderr || error?.message || '');
        const line =
          detail.split('\n').reverse().find(l => l.includes('ERROR')) ||
          detail.split('\n').filter(Boolean).pop() ||
          detail;
        profileErrors.push(
          `P${profileIndex}: ${error?.killed ? 'délai dépassé' : line.replace(/^ERROR:\s*/, '').slice(0, 110)}`
        );
        lastYtdlpDetails = profileErrors.join(' ; ');
        try {
          for (const f of fs.readdirSync(dir)) {
            if (f.startsWith(base) && !f.endsWith('_cookies.txt')) fs.unlinkSync(path.join(dir, f));
          }
        } catch {}

        // Adresse du serveur bloquée par YouTube : les autres profils sans cookies échoueront pareil
        if (profile.anonymous && /Sign in to confirm/i.test(detail)) break;
      }
    }

    if (!succeeded) throw lastError || new Error('yt-dlp a échoué.');

    const file = fs.readdirSync(dir).find(n => n.startsWith(base) && !n.endsWith('_cookies.txt'));
    if (!file) {
      lastYtdlpFailure = 'Aucun fichier audio produit (fichier trop gros ou format indisponible).';
      return null;
    }

    let ext = path.extname(file).slice(1).toLowerCase();
    let finalFile = file;
    const mimeByExt = {
      m4a: 'audio/mp4',
      mp4: 'audio/mp4',
      aac: 'audio/aac',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg; codecs=opus',
      opus: 'audio/ogg; codecs=opus'
    };
    if (!mimeByExt[ext] && ffmpegPath) {
      try {
        const converted = `${base}_conv.m4a`;
        await runBinary(
          ffmpegPath,
          ['-y', '-i', path.join(dir, file), '-vn', '-c:a', 'aac', '-b:a', '128k', path.join(dir, converted)],
          { timeout: 60000 }
        );
        finalFile = converted;
        ext = 'm4a';
      } catch (convError) {
        logger.warn({ error: convError?.message }, 'Conversion audio impossible.');
      }
    }

    const mimetype = mimeByExt[ext];
    if (!mimetype) {
      lastYtdlpFailure = `Format audio non compatible avec WhatsApp (.${ext}).`;
      return null;
    }

    const buffer = fs.readFileSync(path.join(dir, finalFile));
    if (!buffer.length || buffer.length > CONFIG.maxMediaBytes) {
      lastYtdlpFailure = 'Fichier audio vide ou trop gros.';
      return null;
    }

    return { buffer, mimetype };
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '');
    const errLine =
      detail.split('\n').reverse().find(l => l.includes('ERROR')) || detail.split('\n').filter(Boolean).pop() || detail;
    lastYtdlpFailure = errLine.trim().slice(0, 300);
    logger.warn({ error: lastYtdlpFailure }, 'yt-dlp : téléchargement audio impossible.');
    return null;
  } finally {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(base)) fs.unlinkSync(path.join(dir, f));
      }
    } catch {}
  }
}

async function handlePlayOrVideoCommand(jid, message, command, args) {
  const query = String(args || '').trim();
  const isAudio = command === 'play';

  if (!query) {
    await sendReply(
      jid,
      isAudio
        ? '🎵 Utilisation : Xplay titre de la chanson ou artiste'
        : '🎬 Utilisation : Xvideo titre de la vidéo ou sujet (max 3 min)',
      message
    );
    return true;
  }

  await sendReply(
    jid,
    isAudio
      ? `🎵 Recherche audio en cours pour : "${query}"...`
      : `🎬 Recherche vidéo en cours pour : "${query}" (max 3 min)...`,
    message
  );

  const results = await searchYouTubeCandidates(query);
  const top = results[0];

  if (!top?.url) {
    await sendReply(
      jid,
      `⚠️ Aucun résultat trouvé pour "${query}". Réessaie avec un titre plus précis.`,
      message
    );
    return true;
  }

  if (isAudio) {
    // On essaie les 3 premiers résultats : certaines vidéos n'ont aucun format audio exploitable
    const playStartedAt = Date.now();
    const ytDetails = [];
    for (const candidate of results.slice(0, 3)) {
      if (!candidate?.url) continue;
      // On n'essaie une autre vidéo que si l'échec précédent a été rapide
      if (Date.now() - playStartedAt > 25000) break;

      const audio = await downloadAudioWithYtdlp(candidate.url);
      if (audio) {
        await sock.sendMessage(
          jid,
          { audio: audio.buffer, mimetype: audio.mimetype, ptt: false },
          { quoted: message }
        );
        await sendReply(jid, `🎶 ${candidate.title || top.title}\n\n${SIGNATURE}`, message);
        return true;
      }

      if (lastYtdlpDetails) ytDetails.push(lastYtdlpDetails);

      // Si YouTube bloque tout le serveur ou que yt-dlp est absent, inutile d'insister
      if (/Sign in|bot|reloaded|Binaire yt-dlp indisponible/i.test(lastYtdlpFailure)) break;
    }

    // Plan B : SoundCloud (n'est pas bloqué comme YouTube sur les serveurs)
    const youtubeFailure = ytDetails.join(' || ') || lastYtdlpFailure;
    const debugOwner = cleanEnv(process.env.XPLAY_DEBUG) === '1' && isOwnerMessage(message);
    const sc = await downloadAudioWithYtdlp(`scsearch1:${query}`, { soundcloud: true });
    if (sc) {
      if (debugOwner) {
        await sendReply(
          jid,
          `🛠️ YouTube a échoué : ${youtubeFailure}${/Sign in/i.test(youtubeFailure) ? '\n\n🍪 YouTube bloque l’adresse du serveur : il faut des cookies (variable YOUTUBE_COOKIES_BASE64 ou fichier youtube_cookies.txt), comme Erwin-Bot.' : ''}`.slice(0, 900),
          message
        );
      }
      await sock.sendMessage(
        jid,
        { audio: sc.buffer, mimetype: sc.mimetype, ptt: false },
        { quoted: message }
      );
      await sendReply(jid, `🎶 ${query}\n(source : SoundCloud)\n\n${SIGNATURE}`, message);
      return true;
    }
    lastYtdlpFailure = `YouTube : ${youtubeFailure} | SoundCloud : ${lastYtdlpFailure}`.slice(0, 700);
  }

  const resolved = await resolveStreamUrl(top.url, isAudio ? 'audio' : 'video');

  if (resolved?.tooLong) {
    await sendReply(
      jid,
      `⏱️ 𝗩𝗜𝗗𝗘́𝗢 𝗧𝗥𝗢𝗣 𝗟𝗢𝗡𝗚𝗨𝗘 (${formatDuration(resolved.durationSec)})\n` +
        `La limite pour l'envoi direct est fixée à 3 minutes (180 s).\n` +
        `🔗 Lien : ${top.url}\n\n${SIGNATURE}`,
      message
    );
    return true;
  }

  if (resolved?.streamUrl) {
    try {
      const dl = await axios.get(resolved.streamUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: CONFIG.maxMediaBytes,
        maxBodyLength: CONFIG.maxMediaBytes,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SitriNelBot/1.0' }
      });

      const buf = Buffer.from(dl.data);
      const headerMime = String(dl.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
      const mime = headerMime || resolved.mime || (isAudio ? 'audio/mpeg' : 'video/mp4');

      if (buf.length > 0 && buf.length <= CONFIG.maxMediaBytes) {
        if (isAudio) {
          await sock.sendMessage(
            jid,
            {
              audio: buf,
              mimetype: mime.startsWith('audio/') ? mime : 'audio/mp4',
              ptt: false
            },
            { quoted: message }
          );
          return true;
        }

        await sock.sendMessage(
          jid,
          {
            video: buf,
            mimetype: mime.startsWith('video/') ? mime : 'video/mp4'
          },
          { quoted: message }
        );
        return true;
      }
    } catch (dlErr) {
      logger.warn({ error: dlErr?.message }, 'Téléchargement direct du flux impossible, repli sur le lien.');
    }
  }

  await sendReply(
    jid,
    `${isAudio ? '🎵 𝗔𝗨𝗗𝗜𝗢 𝗧𝗥𝗢𝗨𝗩𝗘́' : '🎬 𝗩𝗜𝗗𝗘́𝗢 𝗧𝗥𝗢𝗨𝗩𝗘́𝗘'}\n\n` +
      `📌 Titre : ${top.title}\n` +
      `🔗 Lien : ${top.url}\n\n` +
      `Le téléchargement direct du fichier n’a pas abouti côté serveur, utilise le lien ci-dessus.` +
      (isAudio && lastYtdlpFailure && cleanEnv(process.env.XPLAY_DEBUG) === '1' && isOwnerMessage(message)
        ? `\n\n🛠️ Diagnostic : ${lastYtdlpFailure}`
        : '') +
      `\n\n${SIGNATURE}`,
    message
  );
  return true;
}

// ------------------------------------------------------------
// 24. ROUTEUR : ANALYSE DES COMMANDES
// ------------------------------------------------------------

function parseCommand(text = '') {
  const match = String(text).trim().match(/^x([a-z]+)(?:[\s-]+([\s\S]*))?$/i);
  if (!match) return null;

  return {
    command: match[1].toLowerCase(),
    args: (match[2] || '').trim()
  };
}

function getDisplayName(message, sender) {
  return message?.pushName || getNumber(sender) || 'Utilisateur';
}

function getResultText(result, fallback) {
  if (typeof result === 'string') return result;

  if (result && typeof result === 'object') {
    return result.message || result.text || result.reply || fallback;
  }

  return fallback;
}

function getUptimeText() {
  const seconds = Math.floor((Date.now() - PROCESS_STARTED_AT) / 1000);
  const memory = process.memoryUsage();

  return `
╭━━〔 🧬 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 〕━━╮

◈ 𝗦𝗬𝗦𝗧𝗘̀𝗠𝗘
├ État : ${connectionStatus}
├ Fonctionnement : ${formatDuration(seconds)}
├ Node.js : ${process.version}
├ Plateforme : ${process.platform}
└ Mémoire : ${(memory.rss / 1024 / 1024).toFixed(1)} MB

◈ 𝗖𝗢𝗡𝗡𝗘𝗫𝗜𝗢𝗡
├ WhatsApp : ${sock ? 'Initialisé' : 'Indisponible'}
├ Base de données : ${USE_TURSO ? 'Turso' : 'SQLite local'}
└ IA : ${CONFIG.groqKey ? `Groq (${CONFIG.groqModel})` : 'Non configurée'}

${SIGNATURE}
`.trim();
}

// ------------------------------------------------------------
// 25. ROUTEUR : GROUPES DE COMMANDES
// ------------------------------------------------------------

async function handleEconomyCommand(jid, message, sender, command) {
  if (command === 'daily') {
    const result = await dailyReward(sender);
    await sendReply(jid, getResultText(result, '🎁 Récompense quotidienne indisponible.'), message);
    return true;
  }

  if (command === 'coins') {
    const user = await getUser(sender);
    await sendReply(jid, `💠 𝗫𝗖𝗢𝗜𝗡𝗦\n\nSolde : ${Number(user?.coins || 0)} XCoins\n\n${SIGNATURE}`, message);
    return true;
  }

  if (command === 'p' || command === 'xp' || command === 'rank' || command === 'profil') {
    await sendVisualStatCard(jid, message, sender, command === 'p' ? 'xp' : command);
    return true;
  }

  return false;
}

async function handleQuizCommand(jid, message, sender, command, args) {
  if (command === 'qflash') {
    if (autoQuizzes.has(jid)) {
      await sendReply(
        jid,
        '🧠 Un Sitri~Quiz est déjà en cours ici. Termine-le avec Xend avant de lancer Xqflash.',
        message
      );
      return true;
    }
    const result = await startQuiz(jid, args);
    await sendReply(jid, getResultText(result, '🧠 Réponds avec Xreponse suivi de ta réponse.'), message);
    return true;
  }

  if (command === 'reponse') {
    if (!args) {
      await sendReply(jid, 'Utilisation : Xreponse suivi de ta réponse.', message);
      return true;
    }

    const result = await answerQuiz(jid, sender, args);
    await sendReply(jid, getResultText(result, 'La réponse a été traitée.'), message);
    return true;
  }

  return false;
}

function explainAIFailure(error) {
  let status = error?.response?.status;

  const apiError = error?.response?.data?.error;
  const apiMessage = String(
    (typeof apiError === 'string' ? apiError : apiError?.message) || ''
  );

  if (/api key/i.test(apiMessage)) status = 401;

  const provider = error?.provider || 'IA';

  const reasons = {
    401: `La clé ${provider} est refusée. Vérifie-la dans Railway.`,
    402: `Solde ${provider} épuisé. Recharge ou attends le renouvellement gratuit.`,
    403: `Accès ${provider} refusé (clé, autorisation ou région).`,
    429: `Limite ${provider} atteinte. Réessaie dans un instant.`,
    400: `${provider} a refusé la requête : ${apiMessage || 'modèle ou message non valide'}.`,
    404: `Le modèle ${provider} demandé est introuvable.`,
    500: `${provider} rencontre un problème temporaire. Réessaie dans un instant.`,
    503: `${provider} est surchargé. Réessaie dans un instant.`
  };

  return (
    error?.userMessage ||
    reasons[status] ||
    `Le service ${provider} ne répond pas pour le moment. Réessaie plus tard.`
  );
}

// ------------------------------------------------------------
// HORLOGE INTERNATIONALE, DATE ET MÉTÉO
// ------------------------------------------------------------

const CLOCK_DEFAULT = { label: 'au Bénin', tz: 'Africa/Porto-Novo', geo: 'Cotonou' };

const CLOCK_PLACES = [
  { names: ['benin', 'cotonou', 'porto novo', 'porto-novo', 'parakou'], label: 'au Bénin', tz: 'Africa/Porto-Novo', geo: 'Cotonou' },
  { names: ['france', 'paris'], label: 'en France', tz: 'Europe/Paris', geo: 'Paris' },
  { names: ['cote d\'ivoire', 'abidjan', 'yamoussoukro'], label: 'en Côte d’Ivoire', tz: 'Africa/Abidjan', geo: 'Abidjan' },
  { names: ['cameroun', 'douala', 'yaounde'], label: 'au Cameroun', tz: 'Africa/Douala', geo: 'Douala' },
  { names: ['senegal', 'dakar'], label: 'au Sénégal', tz: 'Africa/Dakar', geo: 'Dakar' },
  { names: ['nigeria', 'lagos', 'abuja'], label: 'au Nigeria', tz: 'Africa/Lagos', geo: 'Lagos' },
  { names: ['togo', 'lome'], label: 'au Togo', tz: 'Africa/Lome', geo: 'Lomé' },
  { names: ['ghana', 'accra'], label: 'au Ghana', tz: 'Africa/Accra', geo: 'Accra' },
  { names: ['mali', 'bamako'], label: 'au Mali', tz: 'Africa/Bamako', geo: 'Bamako' },
  { names: ['burkina', 'burkina faso', 'ouagadougou'], label: 'au Burkina Faso', tz: 'Africa/Ouagadougou', geo: 'Ouagadougou' },
  { names: ['niger', 'niamey'], label: 'au Niger', tz: 'Africa/Niamey', geo: 'Niamey' },
  { names: ['guinee', 'conakry'], label: 'en Guinée', tz: 'Africa/Conakry', geo: 'Conakry' },
  { names: ['gabon', 'libreville'], label: 'au Gabon', tz: 'Africa/Libreville', geo: 'Libreville' },
  { names: ['congo', 'brazzaville'], label: 'au Congo', tz: 'Africa/Brazzaville', geo: 'Brazzaville' },
  { names: ['rdc', 'kinshasa', 'republique democratique du congo'], label: 'en RDC', tz: 'Africa/Kinshasa', geo: 'Kinshasa' },
  { names: ['maroc', 'casablanca', 'rabat'], label: 'au Maroc', tz: 'Africa/Casablanca', geo: 'Casablanca' },
  { names: ['algerie', 'alger'], label: 'en Algérie', tz: 'Africa/Algiers', geo: 'Alger' },
  { names: ['tunisie', 'tunis'], label: 'en Tunisie', tz: 'Africa/Tunis', geo: 'Tunis' },
  { names: ['egypte', 'le caire', 'caire'], label: 'en Égypte', tz: 'Africa/Cairo', geo: 'Le Caire' },
  { names: ['madagascar', 'antananarivo'], label: 'à Madagascar', tz: 'Indian/Antananarivo', geo: 'Antananarivo' },
  { names: ['afrique du sud', 'johannesburg', 'le cap'], label: 'en Afrique du Sud', tz: 'Africa/Johannesburg', geo: 'Johannesburg' },
  { names: ['belgique', 'bruxelles'], label: 'en Belgique', tz: 'Europe/Brussels', geo: 'Bruxelles' },
  { names: ['suisse', 'geneve', 'zurich'], label: 'en Suisse', tz: 'Europe/Zurich', geo: 'Zurich' },
  { names: ['allemagne', 'berlin'], label: 'en Allemagne', tz: 'Europe/Berlin', geo: 'Berlin' },
  { names: ['espagne', 'madrid'], label: 'en Espagne', tz: 'Europe/Madrid', geo: 'Madrid' },
  { names: ['italie', 'rome'], label: 'en Italie', tz: 'Europe/Rome', geo: 'Rome' },
  { names: ['royaume-uni', 'royaume uni', 'angleterre', 'londres', 'uk'], label: 'au Royaume-Uni', tz: 'Europe/London', geo: 'Londres' },
  { names: ['russie', 'moscou'], label: 'en Russie', tz: 'Europe/Moscow', geo: 'Moscou' },
  { names: ['turquie', 'istanbul'], label: 'en Turquie', tz: 'Europe/Istanbul', geo: 'Istanbul' },
  { names: ['canada', 'montreal', 'toronto'], label: 'au Canada', tz: 'America/Toronto', geo: 'Toronto' },
  { names: ['etats-unis', 'etats unis', 'usa', 'new york', 'amerique'], label: 'aux États-Unis (New York)', tz: 'America/New_York', geo: 'New York' },
  { names: ['bresil', 'sao paulo'], label: 'au Brésil', tz: 'America/Sao_Paulo', geo: 'São Paulo' },
  { names: ['japon', 'tokyo'], label: 'au Japon', tz: 'Asia/Tokyo', geo: 'Tokyo' },
  { names: ['chine', 'pekin', 'shanghai'], label: 'en Chine', tz: 'Asia/Shanghai', geo: 'Shanghai' },
  { names: ['coree', 'coree du sud', 'seoul'], label: 'en Corée du Sud', tz: 'Asia/Seoul', geo: 'Séoul' },
  { names: ['inde', 'new delhi', 'delhi', 'mumbai'], label: 'en Inde', tz: 'Asia/Kolkata', geo: 'New Delhi' },
  { names: ['dubai', 'emirats', 'emirats arabes unis'], label: 'à Dubaï', tz: 'Asia/Dubai', geo: 'Dubaï' },
  { names: ['australie', 'sydney'], label: 'en Australie', tz: 'Australia/Sydney', geo: 'Sydney' }
];

function normalizeClockText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const CLOCK_WEATHER_RE = /(quel temps|meteo|temperature|fait[- ]il (chaud|froid|beau)|il fait (chaud|froid|beau))/;
const CLOCK_TIME_RE =
  /(quelle heure|l'heure (qu'il|actuelle|exacte|maintenant|est)|heure actuelle|quel jour (sommes|est[- ]on|on est|nous sommes)|on est quel jour|on est le combien|quelle est la date|la date (d'aujourd|actuelle|du jour)|quelle date)/;

function extractClockPlace(n) {
  const cleaned = n
    .replace(/[?!.,;]+/g, ' ')
    .replace(/\b(actuellement|maintenant|en ce moment|aujourd'hui|stp|svp|s'il te plait|la bas|exactement)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const matches = [
    ...cleaned.matchAll(/\b(?:au|aux|en|a|dans|de|du|pour|chez)\s+(?:la |le |les |l')?([a-z' -]{2,40})/g)
  ];
  if (!matches.length) return '';

  const last = matches[matches.length - 1][1].trim();
  return last.split(/\s+(?:et|ou|puis)\s+/)[0].trim();
}

async function geocodeClockPlace(name) {
  try {
    const res = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
      params: { name, count: 1, language: 'fr', format: 'json' },
      timeout: 8000
    });
    const r = res.data?.results?.[0];
    if (!r) return null;
    return {
      label: `à ${r.name}${r.country ? ` (${r.country})` : ''}`,
      tz: r.timezone,
      geo: r.name,
      lat: r.latitude,
      lon: r.longitude
    };
  } catch (error) {
    logger.warn({ error: error?.message }, 'Horloge : lieu introuvable.');
    return null;
  }
}

async function resolveClockPlace(rawName) {
  if (!rawName) return { ...CLOCK_DEFAULT, isDefault: true };

  const n = normalizeClockText(rawName).replace(/^(la |le |les |l')/, '');
  const hit = CLOCK_PLACES.find(place => place.names.includes(n));
  if (hit) return hit;

  const found = await geocodeClockPlace(rawName);
  return found?.tz ? found : null;
}

function formatClockAnswer(place) {
  const now = new Date();
  const fmt = options => new Intl.DateTimeFormat('fr-FR', { timeZone: place.tz, ...options });

  const time = fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const date = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const offset =
    fmt({ timeZoneName: 'shortOffset' }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value || '';

  const lines = [
    `🕐 Il est *${time}* ${place.label}`,
    `📅 ${date.charAt(0).toUpperCase()}${date.slice(1)}`,
    `🌍 Fuseau : ${place.tz.replace(/_/g, ' ')}${offset ? ` (${offset})` : ''}`
  ];
  if (place.isDefault) lines.push('', 'Demande-moi une autre ville ou un autre pays si tu veux son heure.');
  return lines.join('\n');
}

const WEATHER_CODES = {
  0: ['☀️', 'Ciel dégagé'],
  1: ['🌤️', 'Plutôt dégagé'],
  2: ['⛅', 'Partiellement nuageux'],
  3: ['☁️', 'Couvert'],
  45: ['🌫️', 'Brouillard'],
  48: ['🌫️', 'Brouillard givrant'],
  51: ['🌦️', 'Bruine légère'],
  53: ['🌦️', 'Bruine'],
  55: ['🌦️', 'Bruine forte'],
  61: ['🌧️', 'Pluie légère'],
  63: ['🌧️', 'Pluie'],
  65: ['🌧️', 'Forte pluie'],
  71: ['🌨️', 'Neige légère'],
  73: ['🌨️', 'Neige'],
  75: ['🌨️', 'Forte neige'],
  80: ['🌦️', 'Averses légères'],
  81: ['🌧️', 'Averses'],
  82: ['⛈️', 'Fortes averses'],
  95: ['⛈️', 'Orage'],
  96: ['⛈️', 'Orage avec grêle'],
  99: ['⛈️', 'Orage violent avec grêle']
};

async function buildWeatherAnswer(place) {
  let lat = place.lat;
  let lon = place.lon;

  if (lat === undefined || lon === undefined) {
    const geo = await geocodeClockPlace(place.geo || place.label);
    if (!geo) throw new Error('Lieu introuvable pour la météo.');
    lat = geo.lat;
    lon = geo.lon;
  }

  const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude: lat,
      longitude: lon,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
      timezone: 'auto'
    },
    timeout: 10000
  });

  const c = res.data?.current;
  if (!c) throw new Error('Météo indisponible.');

  const [icon, text] = WEATHER_CODES[c.weather_code] || ['🌡️', 'Conditions variables'];
  return [
    `${icon} Météo ${place.label}`,
    `🌡️ ${Math.round(c.temperature_2m)} °C (ressenti ${Math.round(c.apparent_temperature)} °C)`,
    `☁️ ${text}`,
    `💧 Humidité : ${Math.round(c.relative_humidity_2m)} %`,
    `💨 Vent : ${Math.round(c.wind_speed_10m)} km/h`
  ].join('\n');
}

// Renvoie un texte si le message demande l'heure, la date ou la météo, sinon null
async function tryAnswerClockOrWeather(text) {
  const n = normalizeClockText(text);
  if (!n || n.split(' ').length > 16) return null;

  const wantsWeather = CLOCK_WEATHER_RE.test(n);
  const wantsTime = !wantsWeather && CLOCK_TIME_RE.test(n);
  if (!wantsWeather && !wantsTime) return null;

  const place = await resolveClockPlace(extractClockPlace(n));
  if (!place) return '🌍 Je ne trouve pas ce lieu. Essaie avec le nom d’un pays ou d’une grande ville.';

  if (wantsTime) return formatClockAnswer(place);

  try {
    return await buildWeatherAnswer(place);
  } catch (error) {
    logger.warn({ error: error?.message }, 'Météo indisponible.');
    return '⚠️ Je n’arrive pas à récupérer la météo pour le moment.';
  }
}

// ------------------------------------------------------------
// XRESUME (résumé du groupe) ET XSOURCE (d'où vient cette image ?)
// ------------------------------------------------------------

const groupChatBuffer = new Map();
const insightCooldowns = new Map();
const INSIGHT_COOLDOWN_MS = 20000;

function recordGroupLine(jid, message, sender, text) {
  if (!isGroupJid(jid)) return;

  const t = String(text || '').trim();
  if (t.length < 2) return;

  if (
    message?.key?.fromMe &&
    (t.startsWith('⌬') || t.includes('SITRI-NEL') || t.includes('𖤍') || isQuizBotEcho(message, t))
  ) {
    return;
  }

  const list = groupChatBuffer.get(jid) || [];
  list.push({
    name: String(getDisplayName(message, sender) || 'Membre').replace(/[+\d]{8,}/g, 'Membre').slice(0, 24),
    text: t.slice(0, 280),
    ts: Date.now()
  });
  if (list.length > 300) list.splice(0, list.length - 300);
  groupChatBuffer.set(jid, list);
}

function insightOnCooldown(jid, sender, key) {
  const id = `${key}:${jid}:${sender}`;
  const last = insightCooldowns.get(id) || 0;
  if (Date.now() - last < INSIGHT_COOLDOWN_MS) return true;
  insightCooldowns.set(id, Date.now());
  if (insightCooldowns.size > 500) insightCooldowns.delete(insightCooldowns.keys().next().value);
  return false;
}

const GROQ_FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'qwen/qwen3-32b',
  'llama-3.1-8b-instant'
];

async function groqChat(messages, { model = CONFIG.groqModel, maxTokens = 800, temperature = 0.4, timeout = 40000 } = {}) {
  const isVision = Array.isArray(messages?.[0]?.content);
  const candidates = isVision
    ? [model, 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct']
    : [model, ...GROQ_FALLBACK_MODELS];

  const models = [...new Set(candidates)].filter(m => m && !/gpt-oss/i.test(m));
  let lastError = null;

  for (const m of models) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: m, messages, temperature, max_tokens: maxTokens },
        { headers: { Authorization: `Bearer ${CONFIG.groqKey}` }, timeout }
      );
      const out = String(res.data?.choices?.[0]?.message?.content || '').trim();
      if (out) {
        if (!isVision) CONFIG.groqModel = m;
        return out;
      }
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      if (status === 429 || status === 404 || status >= 500) continue;
      throw err;
    }
  }
  throw lastError || new Error('Tous les modèles Groq sont temporairement saturés.');
}

function formatClockHm(ts) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: CLOCK_DEFAULT.tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(ts));
}

async function handleResumeCommand(jid, message, sender, args) {
  if (!isGroupJid(jid)) {
    await sendReply(jid, '📝 Xresume fonctionne dans un groupe : je résume ce qui s’y est dit.', message);
    return;
  }
  if (!CONFIG.groqKey) {
    await sendReply(jid, '⚠️ Le résumé a besoin de la clé Groq, qui est absente.', message);
    return;
  }
  if (insightOnCooldown(jid, sender, 'resume')) return;

  const wanted = Math.min(Math.max(parseInt(String(args || '').trim(), 10) || 100, 20), 250);
  const lines = (groupChatBuffer.get(jid) || []).slice(-wanted);

  if (lines.length < 8) {
    await sendReply(
      jid,
      '📝 Je n’ai pas encore assez de messages à résumer : je ne retiens que ce que j’ai vu passer depuis mon dernier démarrage.',
      message
    );
    return;
  }

  const transcript = lines.map(l => `${l.name} : ${l.text}`).join('\n');

  try {
    const summary = await groqChat(
      [
        {
          role: 'system',
          content:
            "Tu es Sitri-Nel, un bot WhatsApp décontracté. Tu résumes des conversations de groupe en français, sans rien inventer."
        },
        {
          role: 'user',
          content: `Voici les ${lines.length} derniers messages d'un groupe WhatsApp (du plus ancien au plus récent), au format « Nom : message ».

${transcript}

Fais un résumé pour quelqu'un qui revient après une absence, avec un ton naturel et décontracté :
• Sujets principaux (2 à 5 puces courtes)
• Infos ou décisions importantes (seulement s'il y en a)
• Moments marquants ou blagues (1 ou 2, seulement si pertinent)
• Qui a le plus parlé (3 noms maximum)
Règles : n'invente rien ; paraphrase, ne recopie pas de messages entiers ; n'écris aucun numéro de téléphone ; pas de titres, uniquement des puces « • » ; reste sous 1200 caractères.`
        }
      ],
      { maxTokens: 700, temperature: 0.4 }
    );

    if (!summary) throw new Error('Résumé vide.');

    await sendReply(
      jid,
      `📝 *RÉSUMÉ DU GROUPE*\n_${lines.length} messages • de ${formatClockHm(lines[0].ts)} à ${formatClockHm(lines[lines.length - 1].ts)} (heure du Bénin)_\n\n${summary.slice(0, 1500)}\n\n${SIGNATURE}`,
      message
    );
  } catch (error) {
    logger.warn({ error: error?.message }, 'Xresume : échec.');
    await sendReply(jid, '⚠️ Je n’arrive pas à produire le résumé pour le moment. Réessaie dans un instant.', message);
  }
}

// --- Xsource : identification d'une image (capture d'anime, fanart, texte)

function formatMmSs(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function searchTraceMoe(jpegBuffer) {
  const headers = { 'Content-Type': 'image/jpeg' };
  const key = cleanEnv(process.env.TRACE_MOE_KEY);
  if (key) headers['x-trace-key'] = key;

  const res = await axios.post('https://api.trace.moe/search?anilistInfo&cutBorders', jpegBuffer, {
    headers,
    timeout: 25000,
    maxBodyLength: Infinity
  });

  const top = res.data?.result?.[0];
  if (!top) return null;

  const title = top.anilist?.title || {};
  return {
    similarity: Number(top.similarity) || 0,
    title: String(title.english || title.romaji || title.native || '').trim(),
    episode: top.episode ?? null,
    from: top.from ?? null
  };
}

const SOURCE_VISION_PROMPT = `Analyse cette image envoyée dans un groupe WhatsApp. Réponds uniquement en JSON :
{"type":"capture_anime|fanart|manga|texte|autre","titre":"","personnages":[],"description":"","texte":"","explication":"","certitude":0}
- "type" : capture_anime = image tirée d'un anime ; fanart = dessin de fan ; manga = page de manga/webtoon ; texte = image surtout composée de texte (message, article, capture d'écran...) ; autre sinon.
- "titre" : titre de l'anime/manga/œuvre si tu le reconnais avec confiance, sinon "".
- "personnages" : noms des personnages que tu reconnais, sinon [].
- "description" : 1 à 2 phrases en français décrivant l'image.
- "texte" : transcription fidèle du texte visible (vide s'il n'y en a pas).
- "explication" : si l'image contient du texte, explique son contenu en français simple en 2 à 4 phrases ; sinon "".
- "certitude" : nombre de 0 à 100.
N'invente rien : si tu n'es pas sûr de l'œuvre, laisse "titre" vide. Pour un fanart, indique que c'est un fanart.`;

async function analyzeImageWithVision(jpegBuffer) {
  const model = cleanEnv(process.env.GROQ_VISION_MODEL) || 'meta-llama/llama-4-scout-17b-16e-instruct';
  const raw = await groqChat(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: SOURCE_VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBuffer.toString('base64')}` } }
        ]
      }
    ],
    { model, maxTokens: 900, temperature: 0.2, timeout: 22000 }
  );

  const cleaned = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {}
  }

  // Repli si la réponse texte n'est pas un JSON strict
  if (cleaned) {
    return {
      type: 'autre',
      titre: '',
      personnages: [],
      description: cleaned.slice(0, 350),
      texte: '',
      explication: '',
      certitude: 50
    };
  }

  throw new Error('Réponse de vision illisible.');
}

async function fallbackImageInfoWithSearch(vision, trace) {
  const queryParts = [];
  if (trace?.title) queryParts.push(trace.title);
  if (vision?.titre) queryParts.push(vision.titre);
  if (Array.isArray(vision?.personnages) && vision.personnages.length) {
    queryParts.push(vision.personnages.slice(0, 2).join(' '));
  }
  if (!queryParts.length && vision?.description) {
    queryParts.push(String(vision.description).slice(0, 90));
  }
  if (!queryParts.length) return '';

  const q = `${queryParts.join(' ')} anime manga personnage origine`.trim();
  try {
    if (typeof searchWeb === 'function') {
      const res = await searchWeb(q);
      if (res) return String(res).slice(0, 350);
    }
  } catch {}
  return '';
}

function buildSourceReply(trace, vision, extraInfo = '') {
  const lines = [];
  const strong = trace && trace.title && trace.similarity >= 0.88;

  if (strong) {
    lines.push('📺 *Capture d’anime reconnue*');
    lines.push(`• Anime : *${trace.title}*`);
    lines.push(
      `• Épisode : ${trace.episode ?? 'inconnu'}${trace.from !== null ? ` (vers ${formatMmSs(trace.from)})` : ''}`
    );
    lines.push(`• Fiabilité : ${Math.round(trace.similarity * 100)} %`);
    if (vision?.description) lines.push('', `🖼️ ${String(vision.description).slice(0, 300)}`);
  } else if (vision) {
    const labels = {
      capture_anime: '📺 *Capture d’anime*',
      fanart: '🎨 *Fanart* (dessin de fan)',
      manga: '📖 *Page de manga / webtoon*',
      texte: '📝 *Image contenant du texte*',
      autre: '🖼️ *Analyse d’image*'
    };
    lines.push(labels[vision.type] || labels.autre);

    const cert = Number(vision.certitude);
    const sure = Number.isFinite(cert) && cert >= 55;
    if (vision.titre) {
      lines.push(`• Œuvre / Source : *${vision.titre}*${sure ? '' : ' (piste probable)'}`);
    }
    if (Array.isArray(vision.personnages) && vision.personnages.length) {
      lines.push(`• Personnage(s) : ${vision.personnages.slice(0, 4).join(', ')}`);
    }
    if (vision.description) lines.push('', String(vision.description).slice(0, 320));
    if (vision.texte) lines.push('', `📝 *Texte :* ${String(vision.texte).slice(0, 500)}`);
    if (vision.explication) lines.push('', `🧠 *Explication :* ${String(vision.explication).slice(0, 600)}`);

    if (trace && trace.title && trace.similarity >= 0.72) {
      lines.push('', `💡 Piste trace.moe : *${trace.title}* (${Math.round(trace.similarity * 100)} %).`);
    }
  } else if (trace && trace.title) {
    lines.push('📺 *Piste d’anime trouvée*');
    lines.push(`• Anime : *${trace.title}*`);
    if (trace.episode) lines.push(`• Épisode : ${trace.episode}`);
    lines.push(`• Similarité : ${Math.round((trace.similarity || 0) * 100)} %`);
  } else {
    lines.push('🖼️ *Image reçue*');
    lines.push('• Aucune correspondance exacte sur trace.moe et analyse visuelle indisponible pour le moment.');
    lines.push('• Astuce : réessaie dans quelques secondes ou envoie une image plus nette.');
  }

  if (extraInfo && !lines.some(l => l.includes('Explication'))) {
    lines.push('', `ℹ️ *Complément :* ${extraInfo}`);
  }

  lines.push('', SIGNATURE);
  return lines.join('\n');
}

async function handleSourceCommand(jid, message, sender) {
  if (insightOnCooldown(jid, sender, 'source')) return;

  let media = null;
  try {
    media = await downloadTargetMediaBuffer(message, 'image');
  } catch (error) {
    logger.warn({ error: error?.message }, 'Xsource : image illisible.');
  }

  if (!media?.buffer) {
    await sendReply(
      jid,
      '🔎 Réponds à une image avec Xsource (ou envoie l’image avec Xsource en légende), et je cherche d’où elle vient.',
      message
    );
    return;
  }

  await sendReply(jid, '🔎 Analyse de l’image en cours (max ~25s)...', message);

  let jpeg;
  try {
    const sharpMod = await import('sharp');
    const sharpFn = sharpMod.default || sharpMod;
    jpeg = await sharpFn(media.buffer)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (error) {
    logger.warn({ error: error?.message }, 'Xsource : conversion impossible.');
    jpeg = media.buffer;
  }

  const [trace, vision] = await Promise.all([
    searchTraceMoe(jpeg).catch(error => {
      logger.warn({ error: error?.response?.status || error?.message }, 'Xsource : trace.moe indisponible.');
      return null;
    }),
    CONFIG.groqKey
      ? analyzeImageWithVision(jpeg).catch(async error => {
          logger.warn({ error: error?.response?.data?.error?.message || error?.message }, 'Xsource : vision indisponible.');
          // Deuxième tentative rapide sur un modèle vision alternatif si besoin
          try {
            return await groqChat(
              [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: 'Décris brièvement cette image en français et indique l’anime, manga, jeu, personne ou sujet si identifiable.' },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } }
                  ]
                }
              ],
              { model: 'meta-llama/llama-4-maverick-17b-128e-instruct', maxTokens: 500, temperature: 0.2, timeout: 18000 }
            ).then(desc => ({
              type: 'autre',
              titre: '',
              personnages: [],
              description: String(desc || '').slice(0, 350),
              texte: '',
              explication: '',
              certitude: 50
            }));
          } catch {
            return null;
          }
        })
      : null
  ]);

  let extraInfo = '';
  if (!vision && !trace?.title) {
    extraInfo = await fallbackImageInfoWithSearch(vision, trace);
  }

  await sendReply(jid, buildSourceReply(trace, vision, extraInfo), message);
}

// --- Xvoix : synthèse vocale féminine française (Xvoix <texte>, Xvoix on/off, Sitri-Nel)
const voiceReplyChats = new Set();

async function isVoiceReplyEnabled(jid) {
  if (voiceReplyChats.has(jid)) return true;
  try {
    const res = await executeDbWithRetry({
      sql: 'SELECT value FROM bot_flags WHERE key = ?',
      args: [`voice_${jid}`]
    });
    if (String(res.rows?.[0]?.value || '') === '1') {
      if (voiceReplyChats.size >= 500) {
        const oldest = voiceReplyChats.values().next().value;
        voiceReplyChats.delete(oldest);
      }
      await setVoiceReplyEnabled(jid, true);
      return true;
    }
  } catch {}
  return false;
}

async function setVoiceReplyEnabled(jid, enabled) {
  if (enabled) {
    if (voiceReplyChats.size >= 500) {
      const oldest = voiceReplyChats.values().next().value;
      voiceReplyChats.delete(oldest);
    }
    voiceReplyChats.add(jid);
  } else {
    await setVoiceReplyEnabled(jid, false);
  }
  try {
    await executeDbWithRetry({
      sql: `INSERT INTO bot_flags (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [`voice_${jid}`, enabled ? '1' : '0']
    });
  } catch (error) {
    logger.warn({ error: error?.message }, 'Mode vocal : sauvegarde impossible.');
  }
}

function splitVoiceChunks(text, maxLen = 190) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_~`#•◈✦┃╭╮╰╯━─│├└]/g, ' ')
    .replace(/𖤍.*?𖤍/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return [];
  const words = clean.split(' ');
  const chunks = [];
  let current = '';

  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxLen) {
      if (current) chunks.push(current.trim());
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.slice(0, 5);
}

async function synthesizeFemaleFrenchAudio(text) {
  const chunks = splitVoiceChunks(text, 190);
  if (!chunks.length) return null;

  const buffers = [];
  for (const chunk of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=fr&client=tw-ob`;
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });
    buffers.push(Buffer.from(res.data));
  }
  return Buffer.concat(buffers);
}

async function convertMp3BufferToOggOpus(mp3Buffer) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const run = promisify(execFile);

  let ffmpegBin = 'ffmpeg';
  try {
    const ffmpegStatic = await import('ffmpeg-static');
    if (ffmpegStatic.default) ffmpegBin = ffmpegStatic.default;
  } catch {}

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inPath = path.join(os.tmpdir(), `xvoix_in_${stamp}.mp3`);
  const outPath = path.join(os.tmpdir(), `xvoix_out_${stamp}.ogg`);

  try {
    await fs.promises.writeFile(inPath, mp3Buffer);
    await run(
      ffmpegBin,
      [
        '-y',
        '-i',
        inPath,
        '-c:a',
        'libopus',
        '-b:a',
        '48k',
        '-vbr',
        'on',
        '-compression_level',
        '10',
        '-application',
        'voip',
        outPath
      ],
      { timeout: 25000 }
    );
    const ogg = await fs.promises.readFile(outPath);
    return ogg.length ? ogg : null;
  } finally {
    fs.promises.unlink(inPath).catch(() => {});
    fs.promises.unlink(outPath).catch(() => {});
  }
}

async function sendVoiceReply(jid, text, quoted = null) {
  try {
    const mp3Buffer = await synthesizeFemaleFrenchAudio(text);
    if (!mp3Buffer || !mp3Buffer.length) {
      return sendReply(jid, text, quoted);
    }

    const oggBuffer = await convertMp3BufferToOggOpus(mp3Buffer);
    if (oggBuffer) {
      await sock.sendMessage(
        jid,
        {
          audio: oggBuffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true
        },
        quoted ? { quoted } : {}
      );
      return;
    }

    await sock.sendMessage(
      jid,
      {
        audio: mp3Buffer,
        mimetype: 'audio/mpeg',
        ptt: true
      },
      quoted ? { quoted } : {}
    );
  } catch (error) {
    logger.warn({ error: error?.message }, 'Xvoix : synthèse vocale échouée, repli texte.');
    await sendReply(jid, text, quoted);
  }
}

async function handleAICommand(jid, message, sender, command, args) {
  if (!['chat', 'ai', 'ia', 'ask', 'cerveau', 'anime', 'police'].includes(command)) {
    return false;
  }

  if (command === 'chat') {
    const toggle = String(args || '').trim().toLowerCase();
    if (toggle === 'on' || toggle === 'off') {
      if (isGroupJid(jid)) {
        let metadata;
        try {
          metadata = await getGroupMetadata(jid);
        } catch {
          metadata = null;
        }
        const canToggle = isOwner(sender) || (metadata && isParticipantAdmin(metadata, sender));
        if (!canToggle) {
          await sendReply(jid, '⛔ Seuls le propriétaire et les administrateurs peuvent changer le mode Xchat dans ce groupe.', message);
          return true;
        }
      }

      const enabled = toggle === 'on';
      await setChatMode(jid, enabled);

      await sendReply(
        jid,
        enabled
          ? `💬 𝗠𝗢𝗗𝗘 𝗖𝗛𝗔𝗧 𝗔𝗖𝗧𝗜𝗩𝗘́ (𝗢𝗡)\nTu peux maintenant me parler en répondant directement à l'un de mes messages sans mettre X devant.`
          : `🔇 𝗠𝗢𝗗𝗘 𝗖𝗛𝗔𝗧 𝗗𝗘́𝗦𝗔𝗖𝗧𝗜𝗩𝗘́ (𝗢𝗙𝗙)\nJe répondrai uniquement si tu m'appelles par "Sitri-Nel" ou avec une commande commençant par X.`,
        message
      );
      return true;
    }
  }

  if (!args) {
    await sendReply(
      jid,
      `✧ Que souhaites-tu me demander ?\n\nExemples :\n• X${command} Explique-moi les trous noirs\n• Xchat on / Xchat off\n\n${SIGNATURE}`,
      message
    );
    return true;
  }

  if (command === 'chat') {
    try {
      const live = await tryAnswerClockOrWeather(args);
      if (live) {
        await sendReply(jid, live, message);
        return true;
      }
    } catch (error) {
      logger.warn({ error: error?.message }, 'Horloge/météo : erreur.');
    }
  }

  if (!CONFIG.groqKey) {
    await sendReply(
      jid,
      moduleMessage(
        '⌬ 𝗠𝗢𝗗𝗨𝗟𝗘 𝗘𝗡 𝗣𝗥𝗘́𝗣𝗔𝗥𝗔𝗧𝗜𝗢𝗡',
        'Ajoute GROQ_API_KEY dans les variables Railway pour activer le cerveau du bot.'
      ),
      message
    );
    return true;
  }

  let prompt = args;
  let maxTokens = 1200;

  if (command === 'anime') {
    prompt = `En tant qu'encyclopédie vivante des animés et mangas, donne une réponse 100% exacte, vérifiée, claire et structurée (sans blabla introductif inutile) à cette question :\n\n${args}`;
    maxTokens = 1800;
  }

  if (command === 'police') {
    prompt = `Réponds de manière concise, exacte et structurée sur les lois et démarches générales (en précisant que les règles varient selon le pays) :\n\n${args}`;
  }

  try {
    await sock?.sendPresenceUpdate('composing', jid);
  } catch {
    // Sans importance.
  }

  let answer;

  try {
    if (command === 'ai' || command === 'ia') {
      answer = await askXaiWithSerpApi(prompt, jid, {
        useHistory: true,
        senderJid: sender,
        pushName: message?.pushName || '',
        factQuery: args,
        maxTokens
      });
    } else {
      answer = await askAI(prompt, jid, {
        useHistory: true,
        senderJid: sender,
        pushName: message?.pushName || '',
        factQuery: args,
        maxTokens
      });
    }
  } catch (error) {
    const failures = error?.failures?.length ? error.failures : [error];

    for (const failure of failures) {
      logger.error(
        {
          provider: failure?.provider,
          status: failure?.response?.status,
          data: failure?.response?.data,
          error: failure?.message
        },
        'Erreur IA.'
      );
    }

    await sendReply(
      jid,
      moduleMessage(
        '⌬ 𝗜𝗔 𝗜𝗡𝗗𝗜𝗦𝗣𝗢𝗡𝗜𝗕𝗟𝗘',
        failures.map(explainAIFailure).join('\n')
      ),
      message
    );
    return true;
  }

  const replyText = formatAIReply(
    getResultText(answer, 'Je n’ai pas pu produire de réponse pour le moment.')
  );

  // « Sitri-Nel, présente-toi » : la photo et le texte partent dans un seul message
  if (command === 'chat' && isPresentationRequest(args)) {
    await sendOfficialImageWithText(jid, replyText, message);
    return true;
  }

  await sendReply(jid, replyText, message);

  return true;
}

async function handleImageCommand(jid, message, args) {
  if (!args) {
    await sendReply(
      jid,
      'Utilisation :\n• Ximg Naruto\n• Ximg-sasuke 3 (personnage, 5 max)\n• Ximg photo lion 2\n\nPour créer une image :\n• Ximg create un dragon futuriste bleu',
      message
    );
    return true;
  }

  if (/^create\s+/i.test(args)) {
    const prompt = args.replace(/^create\s+/i, '').trim();

    if (!prompt) {
      await sendReply(jid, 'Décris l’image que tu souhaites créer.', message);
      return true;
    }

    await generateImage(jid, message, prompt);
    return true;
  }

  await searchImage(jid, message, args);
  return true;
}

async function handleMediaCommand(jid, message, command, args) {
  if (command === 'img') return handleImageCommand(jid, message, args);

  if (command === 'syp') {
    await handleSynopsisCommand(jid, message, getMessageSender(message), args);
    return true;
  }

  return false;
}

// ------------------------------------------------------------
// 25 bis. MODULE SYNOPSIS COMPLET D'ANIMÉ / MANGA (XSYP / XSPY)
// ------------------------------------------------------------

function stripHtmlTags(raw = '') {
  return String(raw || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchAniListMediaDetails(query) {
  const clean = normalizeAnimeQuery(query);
  if (!clean) return null;

  try {
    const data = await anilist(
      `query ($s: String) {
        Media(search: $s, type: ANIME, sort: POPULARITY_DESC) {
          id
          title { romaji english native }
          format
          episodes
          chapters
          volumes
          status
          season
          seasonYear
          averageScore
          genres
          studios(isMain: true) { nodes { name } }
          coverImage { extraLarge large }
          bannerImage
          description(asHtml: false)
          characters(sort: [ROLE, RELEVANCE], perPage: 6) {
            nodes {
              name { full }
            }
          }
        }
      }`,
      { s: clean }
    );

    if (data?.Media) return data.Media;

    const mangaData = await anilist(
      `query ($s: String) {
        Media(search: $s, type: MANGA, sort: POPULARITY_DESC) {
          id
          title { romaji english native }
          format
          episodes
          chapters
          volumes
          status
          season
          seasonYear
          averageScore
          genres
          coverImage { extraLarge large }
          bannerImage
          description(asHtml: false)
          characters(sort: [ROLE, RELEVANCE], perPage: 6) {
            nodes {
              name { full }
            }
          }
        }
      }`,
      { s: clean }
    );

    return mangaData?.Media || null;
  } catch (error) {
    logger.warn({ error: error?.message }, 'Erreur AniList Media pour Xsyp.');
    return null;
  }
}

async function handleSynopsisCommand(jid, message, sender, args) {
  const query = String(args || '').trim();

  if (!query) {
    await sendReply(
      jid,
      `📖 𝗨𝗧𝗜𝗟𝗜𝗦𝗔𝗧𝗜𝗢𝗡 𝗗𝗘 𝗫𝗦𝗬𝗣\n\nIndique le nom d'un animé ou manga pour obtenir sa fiche complète et l'image officielle de son verse :\n• Xsyp Hunter x Hunter\n• Xsyp Jujutsu Kaisen\n• Xsyp Bleach\n\n${SIGNATURE}`,
      message
    );
    return true;
  }

  try {
    await sock?.sendPresenceUpdate('composing', jid);
  } catch {
    // Sans importance
  }

  await sendReply(jid, `📖 Recherche du synopsis et de l'univers de *${query}*...`, message);

  const media = await fetchAniListMediaDetails(query);
  const titleRomaji = media?.title?.romaji || query;
  const titleEnglish = media?.title?.english && media.title.english !== titleRomaji ? ` (${media.title.english})` : '';
  const fullTitle = `${titleRomaji}${titleEnglish}`;

  const statusMap = {
    FINISHED: 'Terminé',
    RELEASING: 'En cours',
    NOT_YET_RELEASED: 'À venir',
    CANCELLED: 'Annulé',
    HIATUS: 'En pause'
  };

  const format = media?.format || 'Animé / Manga';
  const episodesInfo = media?.episodes
    ? `${media.episodes} épisodes`
    : media?.chapters
      ? `${media.chapters} chapitres`
      : 'En cours / N/A';
  const year = media?.seasonYear || 'N/A';
  const status = statusMap[media?.status] || media?.status || 'N/A';
  const score = media?.averageScore ? `${media.averageScore}%` : 'N/A';
  const studio = media?.studios?.nodes?.[0]?.name || 'N/A';
  const genres = (media?.genres || []).join(', ') || 'Action, Aventure';
  const mainChars = (media?.characters?.nodes || []).map(c => c?.name?.full).filter(Boolean).join(', ');
  const rawDesc = stripHtmlTags(media?.description || '');

  let imagePayload = null;
  const candidateUrls = [
    media?.coverImage?.extraLarge,
    media?.coverImage?.large,
    media?.bannerImage
  ].filter(Boolean);

  for (const imgUrl of candidateUrls) {
    try {
      const downloaded = await downloadImageBuffer(imgUrl);
      imagePayload = downloaded;
      break;
    } catch {
      // Essayer l'URL suivante
    }
  }

  if (!imagePayload) {
    const fallbackImgs = await collectAnimeImages(`${titleRomaji} anime cover`, 1);
    if (fallbackImgs?.[0]?.url) {
      try {
        imagePayload = await downloadImageBuffer(fallbackImgs[0].url);
      } catch {
        // Continuer sans image si indisponible
      }
    }
  }

  let synopsisBody = '';
  if (CONFIG.groqKey) {
    try {
      const aiPrompt = `Rédige une fiche synopsis ultra-complète, captivante et 100% fidèle en français pour l'œuvre "${fullTitle}".
Données officielles connues :
- Format : ${format} (${episodesInfo}, ${year}, Statut : ${status})
- Genres : ${genres}
- Studio : ${studio}
- Personnages clés : ${mainChars || 'Non précisés'}
- Description officielle : ${rawDesc || 'Utilise tes connaissances vérifiées sur cette œuvre.'}

Structure obligatoire (sans utiliser de markdown ** ni # ni tableaux) :
1. HISTOIRE & INTRIGUE : Résumé détaillé et prenant du point de départ, des enjeux et de l'évolution de l'histoire (sans spoiler la fin).
2. UNIVERS & SYSTÈME DE POUVOIRS : Explique clairement le monde, ses règles et son système de combat/pouvoirs (ex: Nen, Chakra, Bankai, Haki, Énergie Occulte, etc.).
3. PERSONNAGES PRINCIPAUX : Présente brièvement les protagonistes majeurs et leur objectif.
4. POURQUOI LE REGARDER : 2-3 phrases percutantes sur les points forts de l'œuvre.`;

      synopsisBody = await askAI(aiPrompt, jid, {
        useHistory: false,
        senderJid: sender,
        pushName: message?.pushName || '',
        factQuery: `${titleRomaji} anime synopsis universe characters`,
        maxTokens: 1600
      });
    } catch (error) {
      logger.warn({ error: error?.message }, 'Groq indisponible pour Xsyp, repli sur la description AniList.');
    }
  }

  if (!synopsisBody) {
    synopsisBody = rawDesc || `Découvre l'univers de ${fullTitle}, une œuvre incontournable mêlant ${genres.toLowerCase()}.`;
  }

  const headerCard =
    `╭━━〔 📖 𝗦𝗬𝗡𝗢𝗣𝗦𝗜𝗦 𝗢𝗙𝗙𝗜𝗖𝗜𝗘𝗟 〕━━╮\n\n` +
    `🎬 𝗧𝗜𝗧𝗥𝗘 : ${fullTitle}\n` +
    `📺 𝗙𝗢𝗥𝗠𝗔𝗧 : ${format} (${episodesInfo})\n` +
    `📅 𝗔𝗡𝗡𝗘́𝗘 : ${year} • 𝗦𝗧𝗔𝗧𝗨𝗧 : ${status}\n` +
    `🏢 𝗦𝗧𝗨𝗗𝗜𝗢 : ${studio} • ⭐ 𝗡𝗢𝗧𝗘 : ${score}\n` +
    `🏷️ 𝗚𝗘𝗡𝗥𝗘𝗦 : ${genres}\n` +
    (mainChars ? `👥 𝗣𝗘𝗥𝗦𝗢𝗡𝗡𝗔𝗚𝗘𝗦 : ${mainChars}\n` : '') +
    `\n╰━━━━━━━━━━━━━━━━━━━━━━╯`;

  const formattedBody = formatAIReply(synopsisBody);

  if (imagePayload) {
    await sock.sendMessage(
      jid,
      {
        image: imagePayload.buffer,
        mimetype: imagePayload.contentType,
        caption: `${headerCard}\n\n🌌 𝗨𝗡𝗜𝗩𝗘𝗥𝗦 : ${titleRomaji}\n${SIGNATURE}`
      },
      { quoted: message }
    );
    await sendReply(jid, formattedBody, message);
  } else {
    await sendReply(jid, `${headerCard}\n\n${formattedBody}`, message);
  }

  return true;
}

// ------------------------------------------------------------

const lastXpGainAt = new Map();

async function grantPassiveMessageXp(senderJid) {
  if (!senderJid) return;
  const now = Date.now();
  const prev = lastXpGainAt.get(senderJid) || 0;
  if (now - prev < 30000) return;
  lastXpGainAt.set(senderJid, now);
  try {
    await addRewards(senderJid, 0, 10);
  } catch {
    // Ignorer en cas d'indisponibilité DB ponctuelle
  }
}

// 25 bis. QUIZ POINTS (RÉACTIONS DU MODÉRATEUR)
// ------------------------------------------------------------

const quizPointSessions = new Map();
const quizPointLocks = new Map();

function normalizeQuizEmoji(value = '') {
  return String(value || '').replace(/\uFE0F/g, '').trim();
}

function pickFirstEmoji(text = '') {
  const t = String(text || '').trim();
  if (!t) return '';
  let first = t;
  try {
    const seg = new Intl.Segmenter('fr', { granularity: 'grapheme' });
    first = [...seg.segment(t)][0]?.segment || t;
  } catch {
    first = Array.from(t)[0] || t;
  }
  return /\p{Extended_Pictographic}/u.test(first) ? first : '';
}

function withQuizLock(chatJid, task) {
  const previous = quizPointLocks.get(chatJid) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  quizPointLocks.set(chatJid, next);
  return next;
}

async function loadQuizSession(chatJid) {
  if (quizPointSessions.has(chatJid)) return quizPointSessions.get(chatJid);
  try {
    const res = await executeDbWithRetry({
      sql: 'SELECT state FROM quiz_points_sessions WHERE chat_jid = ?',
      args: [chatJid]
    });
    const raw = res.rows[0]?.state;
    const session = raw ? JSON.parse(String(raw)) : null;
    quizPointSessions.set(chatJid, session);
    return session;
  } catch (error) {
    logger.warn({ error: error?.message }, 'Quiz points : lecture de la session impossible.');
    return null;
  }
}

async function saveQuizSession(chatJid, session) {
  quizPointSessions.set(chatJid, session);
  try {
    await executeDbWithRetry({
      sql: `INSERT INTO quiz_points_sessions (chat_jid, state, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(chat_jid) DO UPDATE SET
              state = excluded.state,
              updated_at = excluded.updated_at`,
      args: [chatJid, JSON.stringify(session), Date.now()]
    });
  } catch (error) {
    logger.warn({ error: error?.message }, 'Quiz points : sauvegarde de la session impossible.');
  }
}

async function deleteQuizSession(chatJid) {
  quizPointSessions.set(chatJid, null);
  try {
    await executeDbWithRetry({
      sql: 'DELETE FROM quiz_points_sessions WHERE chat_jid = ?',
      args: [chatJid]
    });
  } catch (error) {
    logger.warn({ error: error?.message }, 'Quiz points : suppression de la session impossible.');
  }
}

function rankQuizPlayers(session) {
  return Object.entries(session?.scores || {})
    .filter(([, points]) => Number(points) > 0)
    .sort(
      (a, b) =>
        Number(b[1]) - Number(a[1]) ||
        Number(session.lastAt?.[a[0]] || 0) - Number(session.lastAt?.[b[0]] || 0)
    )
    .map(([jid, points]) => ({ jid, points: Number(points) }));
}

function sameUser(a, b) {
  if (!a || !b) return false;
  return getNumber(normalizeJid(a)) === getNumber(normalizeJid(b));
}

const QUIZ_THANKS_TEXT = '🙏 Merci pour la participation au *Sitri~Quiz* !';

// Compte (ou retire) un point quand l'animateur du quiz met / enlève l'émoji
async function applyQuizReaction({ chatJid, targetKey, emoji, byJid }) {
  if (!chatJid || !targetKey?.id) return;

  await withQuizLock(chatJid, async () => {
    const session = await loadQuizSession(chatJid);
    if (!session) return;

    // Seul l'animateur (celui qui a lancé Xstart) peut donner des points
    const byHost = session.host ? sameUser(byJid, session.host) : isOwner(byJid);
    if (!byHost) return;

    const targetId = targetKey.id;
    const previous = session.awarded[targetId];
    const wanted = normalizeQuizEmoji(session.emoji);
    const given = normalizeQuizEmoji(emoji);

    if (given && given === wanted) {
      if (previous) return;

      const player = getMessageSender({
        key: { ...targetKey, remoteJid: targetKey.remoteJid || chatJid }
      });
      if (!player) return;

      // L'animateur ne se marque pas de points lui-même
      if (session.host ? sameUser(player, session.host) : isOwner(player)) return;

      session.scores[player] = Number(session.scores[player] || 0) + 1;
      session.lastAt[player] = Date.now();
      session.awarded[targetId] = player;
      await saveQuizSession(chatJid, session);
      return;
    }

    if (previous) {
      const left = Math.max(0, Number(session.scores[previous] || 1) - 1);
      if (left === 0) {
        delete session.scores[previous];
        delete session.lastAt[previous];
      } else {
        session.scores[previous] = left;
      }
      delete session.awarded[targetId];
      await saveQuizSession(chatJid, session);
    }
  });
}

async function quizPlayerLabel(jid) {
  let name = '';
  try {
    name = (await getUserMemory(jid)).name || '';
  } catch {}
  return name || `+${getNumber(jid)}`;
}

function quizPlaceLabel(index) {
  if (index === 0) return '🥇 1er';
  if (index === 1) return '🥈 2e';
  if (index === 2) return '🥉 3e';
  return `▫️ ${index + 1}e`;
}

function quizBold(text = '') {
  return Array.from(String(text))
    .map(ch => {
      const c = ch.codePointAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97);
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48);
      return ch;
    })
    .join('');
}

const QUIZ_BADGES = ['🥇', '🥈', '🥉'];

// Liste compacte des joueurs, même style que le menu du bot
function buildQuizBoard({ title = 'RÉCAPITULATIF', rows, info = '' }) {
  const out = [
    '*╭─〔 ⌬ SITRI~QUIZ 〕*',
    '*│*',
    `*├ ◈ 📋 ${title}*`,
    `*├ ◈ 👥 Participants : ${rows.length}*`
  ];
  if (info) out.push(`*├ ◈ ${info}*`);
  out.push('*│*');
  rows.forEach((row, i) => {
    out.push(`*├ ◈ ${row.label} ${row.points}p${QUIZ_BADGES[i] || ''}*`);
  });
  out.push('*│*', '*╰━━━━━━━━━━━━━━━━━━━━━*');
  return out.join('\n');
}

// L'animateur envoie l'émoji du quiz EN RÉPONSE au message d'un joueur
async function handleQuizEmojiReply(jid, message, text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 12 || !/\p{Extended_Pictographic}/u.test(raw)) return false;

  const given = normalizeQuizEmoji(raw);
  if (!given) return false;

  const session = await withQuizLock(jid, () => loadQuizSession(jid));
  if (!session || normalizeQuizEmoji(session.emoji) !== given) return false;

  const byJid = getMessageSender(message);
  const byHost = session.host ? sameUser(byJid, session.host) : isOwner(byJid);
  if (!byHost) return false;

  const context = getQuotedMessage(message);
  if (!context?.stanzaId) return false;

  await applyQuizReaction({
    chatJid: jid,
    targetKey: {
      id: context.stanzaId,
      remoteJid: jid,
      participant: context.participant,
      fromMe: Boolean(context.participant) && isOwner(context.participant)
    },
    emoji: raw,
    byJid
  });

  return true;
}

async function handleQuizPointsCommand(jid, message, command, args, ownerCommand) {
  const sender = getMessageSender(message);

  if (command === 'start') {
    const emoji = pickFirstEmoji(args);
    if (!emoji) {
      await sendReply(
        jid,
        '🧠 Utilisation : Xstart 🟩\nMets un espace puis l’émoji qui validera les bonnes réponses.',
        message
      );
      return;
    }

    if (autoQuizzes.has(jid)) {
      await sendReply(
        jid,
        '🧠 Un Sitri~Quiz est déjà en cours ici. Termine-le avec Xend avant d’en lancer un autre.',
        message
      );
      return;
    }

    const existing = await withQuizLock(jid, () => loadQuizSession(jid));
    if (existing) {
      const players = rankQuizPlayers(existing).length;
      await sendReply(
        jid,
        `🧠 Un quiz est déjà en cours ici (émoji ${existing.emoji}, ${players} participant(s) avec des points).\nXrecap pour le classement, Xtab pour le terminer, Xend pour l’annuler.`,
        message
      );
      return;
    }

    await withQuizLock(jid, () =>
      saveQuizSession(jid, {
        emoji,
        host: sender,
        startedAt: Date.now(),
        scores: {},
        lastAt: {},
        awarded: {}
      })
    );

    // Discret : juste une réaction sous la commande, sans message ni notification
    try {
      await sock.sendMessage(jid, { react: { text: emoji, key: message.key } });
    } catch (error) {
      logger.warn({ error: error?.message }, 'Quiz points : réaction de confirmation impossible.');
    }
    return;
  }

  const session = await withQuizLock(jid, () => loadQuizSession(jid));
  if (!session) {
    await sendReply(jid, '🧠 Aucun quiz en cours ici. Lance-en un avec Xstart 🟩.', message);
    return;
  }

  // Seul l'animateur (ou le créateur du bot) peut utiliser Xrecap / Xtab
  const canManage = ownerCommand || (session.host && sameUser(sender, session.host));
  if (!canManage) return;

  const ranking = rankQuizPlayers(session);

  if (command === 'recap') {
    if (!ranking.length) {
      await sendReply(
        jid,
        `📊 Aucun point pour l’instant (émoji ${session.emoji}).`,
        message
      );
      return;
    }

    const rows = [];
    for (const player of ranking) {
      const label = (await quizPlayerLabel(player.jid)).slice(0, 18);
      rows.push({ label, points: player.points });
    }

    await sendReply(jid, buildQuizBoard({ title: 'RÉCAP EN COURS', rows }), message);
    return;
  }

  if (command === 'tab') {
    if (!ranking.length) {
      await deleteQuizSession(jid);
      await sendReply(jid, '🏁 Quiz terminé : aucun point n’a été attribué.', message);
      return;
    }

    const rows = ranking.map(player => ({
      label: `@${getNumber(player.jid)}`,
      points: player.points
    }));

    await sock.sendMessage(jid, {
      text: buildQuizBoard({ title: 'RÉCAPITULATIF', rows }),
      mentions: ranking.map(player => player.jid)
    });

    await sleep(800);
    await sock.sendMessage(jid, { text: QUIZ_THANKS_TEXT });

    await deleteQuizSession(jid);
  }
}

// ------------------------------------------------------------
// 25 ter. SITRI~QUIZ : quiz automatique par catégories
// ------------------------------------------------------------

const AUTO_QUIZ_CATEGORIES = {
  multivers: { label: 'Multivers', icon: '🌌', desc: 'questions sur les animés' },
  id: { label: 'ID', icon: '🖼️', desc: 'identifie le personnage sur l’image' },
  idv: { label: 'IDV', icon: '🎴', desc: 'identifie l’univers sur l’affiche' },
  cg: { label: 'CG', icon: '🧠', desc: 'culture générale' }
};
const AUTO_QUIZ_COUNTS = [10, 20, 30];
const AUTO_QUIZ_TIME_MS = 20000;
const AUTO_QUIZ_SETUP_TIMEOUT_MS = 3 * 60 * 1000;

const autoQuizzes = new Map();
const quizBotTexts = new Set();
const quizBotIds = new Set();

function rememberQuizBotText(text) {
  const t = String(text || '').trim();
  if (!t) return;
  quizBotTexts.add(t);
  if (quizBotTexts.size > 300) quizBotTexts.delete(quizBotTexts.values().next().value);
}

// Envoie un message du quiz et le mémorise pour ne pas le prendre pour une réponse
async function quizSend(jid, content, options = {}) {
  rememberQuizBotText(content.text || content.caption);
  const sent = await sock.sendMessage(jid, content, options);
  const id = sent?.key?.id;
  if (id) {
    quizBotIds.add(id);
    if (quizBotIds.size > 300) quizBotIds.delete(quizBotIds.values().next().value);
  }
  return sent;
}

function isQuizBotEcho(message, text) {
  if (!message?.key?.fromMe) return false;
  return quizBotIds.has(message.key.id) || quizBotTexts.has(String(text || '').trim());
}

// --- Reconnaissance des réponses (fautes légères tolérées, pas d'orthographes inventées)

function normalizeLoose(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

const QUIZ_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

// « sasuka » pour « sasuke » : une voyelle remplacée par une autre change le mot, ce n'est pas une faute de frappe
function isVowelSwapOnly(a, b) {
  if (a.length !== b.length) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (!(QUIZ_VOWELS.has(a[i]) && QUIZ_VOWELS.has(b[i]))) return false;
      diffs++;
    }
  }
  return diffs > 0;
}

// Orthographe EXACTE exigée : une lettre en moins, en trop ou remplacée = refusé.
// Seules les variantes de translittération courantes sont équivalentes (ou/oo/oh -> o, uu -> u...),
// ainsi que les espaces et tirets (« Dokja » = « Dok-ja »).
function romanKey(value = '') {
  return String(value)
    .replace(/ /g, '')
    .replace(/ou|oo|oh/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'e')
    .replace(/ii/g, 'i');
}

function fuzzyEqual(a, b) {
  if (a === b) return true;
  const x = String(a).replace(/ /g, '');
  const y = String(b).replace(/ /g, '');
  if (x === y) return true;
  return romanKey(x) === romanKey(y);
}

const QUIZ_STOPWORDS = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'et', 'the', 'of', 'a', 'an', 'au', 'aux', 'en', 'da', 'di', 'del', 'della', 'von', 'van', 'der']);

function significantTokens(value) {
  return normalizeLoose(value)
    .split(' ')
    .filter(token => token && !QUIZ_STOPWORDS.has(token));
}

function stripSubtitles(text = '') {
  return String(text || '')
    .split(/\s*[:\-–—(|/]\s*/)[0]
    .trim();
}

function isQuizAnswerCorrect(submitted, question) {
  const sub = normalizeLoose(submitted);
  if (!sub) return false;

  const subTokens = significantTokens(submitted);
  const rawCandidates = [question.answer, ...(question.alts || [])].filter(Boolean);
  const expanded = [];
  for (const raw of rawCandidates) {
    expanded.push(raw);
    const shortTitle = stripSubtitles(raw);
    if (shortTitle && shortTitle !== raw && shortTitle.length >= 4) {
      expanded.push(shortTitle);
    }
  }

  const candidates = [...new Set(expanded.map(normalizeLoose).filter(Boolean))];

  for (const cand of candidates) {
    if (sub === cand || fuzzyEqual(sub, cand)) return true;

    // Titre principal sans sous-titre (ex. "Mushoku Tensei" pour "Mushoku Tensei: Jobless Reincarnation")
    if (question.kind === 'poster' && sub.length >= 5 && (cand.startsWith(sub + ' ') || sub.startsWith(cand + ' '))) {
      return true;
    }

    const candTokens = significantTokens(cand);
    if (!candTokens.length || !subTokens.length) continue;

    // Tous les mots attendus sont retrouvés (ordre libre, fautes légères)
    if (candTokens.every(ct => subTokens.some(st => fuzzyEqual(st, ct)))) return true;

    // Les mots déjà présents dans la question n'ont pas à être répétés
    if (question.type === 'text' && question.question) {
      const inQuestion = new Set(significantTokens(question.question));
      const needed = candTokens.filter(ct => !inQuestion.has(ct));
      if (needed.length && needed.length < candTokens.length && needed.every(ct => subTokens.some(st => fuzzyEqual(st, ct)))) {
        return true;
      }
    }

    // Personnage (ID) : le prénom seul suffit
    if (question.type === 'image' && question.kind !== 'poster' && subTokens.length === 1 && subTokens[0].length >= 3 && cand === normalizeLoose(question.answer)) {
      const rawTokens = normalizeLoose(question.answer).split(' ').filter(Boolean);
      const accepted = [rawTokens[0]];
      if (rawTokens.length >= 3) accepted.push(rawTokens[rawTokens.length - 1]);
      if (accepted.some(ct => ct && ct.length >= 3 && fuzzyEqual(subTokens[0], ct))) return true;
    }
  }

  return false;
}

// --- Génération des questions

async function groqJson(prompt, maxTokens = 3500, temperature = 0.6) {
  const models = [...new Set([CONFIG.groqModel, ...GROQ_FALLBACK_MODELS])].filter(
    m => m && !/gpt-oss/i.test(m)
  );
  let lastError = null;

  for (const m of models) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: m,
          messages: [
            {
              role: 'system',
              content: 'Tu es un générateur de quiz rigoureux. Tu réponds uniquement par un objet JSON valide.'
            },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' }
        },
        { headers: { Authorization: `Bearer ${CONFIG.groqKey}` }, timeout: 18000 }
      );
      CONFIG.groqModel = m;
      return JSON.parse(res.data?.choices?.[0]?.message?.content || '{}');
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      if (status === 429 || status === 404 || status >= 500) continue;
      throw err;
    }
  }
  throw lastError || new Error('Groq JSON indisponible.');
}

// Juge une réponse : traductions (VO, VF, VOSTFR, anglais, romaji), fautes, formulations différentes
async function judgeQuizAnswer(question, playerText) {
  try {
    const extra = [];
    if (question.univers) extra.push(`Œuvre : ${question.univers}`);
    if (Array.isArray(question.alts) && question.alts.length) {
      extra.push(`Autres réponses déjà acceptées : ${question.alts.join(' ; ')}`);
    }
    if (Array.isArray(question.keypoints) && question.keypoints.length) {
      extra.push(`Idées essentielles : ${question.keypoints.join(' ; ')}`);
    }

    const questionText =
      question.question ||
      (question.kind === 'poster'
        ? 'Quel est le titre de l\'animé (l\'univers) montré sur l\'affiche ?'
        : 'Quel est le nom du personnage montré sur l\'image ?');

    const data = await groqJson(
      `Tu es juge d'un quiz entre fans, attentif mais rigoureux. Lis bien la réponse du joueur.
Question : ${questionText}
Réponse attendue : ${question.answer}
${extra.length ? `${extra.join('\n')}\n` : ''}Réponse du joueur : ${playerText}

Règles :
- Compare d'abord avec la réponse attendue : si le joueur donne une autre personne, un autre pays, un autre lieu ou une autre chose que celle attendue, REFUSE (ex. « Brésil » quand la réponse attendue est « Allemagne »), même si c'est lié à la question.
- Ignore totalement les majuscules, accents, virgules, deux-points, tirets, apostrophes et la ponctuation.
- Pour un titre d'animé/manga (affiche), ACCEPTE le titre principal sans le sous-titre (ex. « Mushoku Tensei » pour « Mushoku Tensei: Jobless Reincarnation », « Konosuba » pour « KonoSuba: God's Blessing on This Wonderful World! », « Re:Zero » pour « Re:Zero - Starting Life in Another World ») et tolère les petites fautes d'orthographe (1 ou 2 lettres).
- ACCEPTE toute orthographe, transcription ou traduction qui EXISTE réellement pour cette réponse (VO, VF, VOSTFR, anglais, romaji, coréen romanisé...) : ex. « Tohru » et « Tooru », « Dokja » et « Dok-ja », « Najenda » et « Nadezhda Najenda », « Vide infini » / « Vide incommensurable » / « Infinite Void ». Vérifie qu'elle existe vraiment : si oui, ACCEPTE ; si c'est une simple faute, REFUSE.
- Si la question contient déjà le mot générique (souffle, technique, forme, titan, épée...), le mot distinctif seul suffit (ex. « insecte » pour « Souffle de l'insecte », « originel » pour « Titan originel »).
- Personnage d'une œuvre : accepte le prénom, le nom de famille ou le nom d'usage seul quand il désigne ce personnage de façon unique parmi les personnages connus de l'œuvre (ex. « Gojo », « Isagi », « Uzui », « Urahara »). REFUSE le nom de famille seul quand d'autres membres connus de la famille le portent (ex. « Uchiha » pour Sasuke, « Elric », « Zoldyck »).
- Personne réelle : accepte le nom de famille, le nom complet ou le nom d'usage universel (« Napoléon » pour Napoléon Bonaparte ; « de Vinci » ou « da Vinci » pour Léonard de Vinci) ; REFUSE un prénom seul qui n'identifie pas la personne (ex. « Léonard »).
- Question d'explication : accepte si l'idée essentielle est présente, même avec d'autres mots ou de façon approximative.
- REFUSE si c'est hors sujet, faux, trop vague ou si cela désigne autre chose.
Réponds en JSON : {"correct": true} ou {"correct": false}`,
      60,
      0
    );
    return data?.correct === true;
  } catch (error) {
    logger.warn({ error: error?.message }, 'Sitri~Quiz : juge indisponible.');
    return false;
  }
}

// Relecture rapide et résiliente : vérifie quand possible sans bloquer le lancement du quiz.
async function verifyQuizQuestions(list, level = 'moyen', category = 'multivers') {
  if (!list.length) return list;

  const levelRule = quizLevelInstruction(category, level);
  const subset = list.slice(0, 10);

  const attempt = async () => {
    const questions = subset
      .map((q, i) => `${i + 1}. ${q.univers ? `[${q.univers}] ` : ''}${q.question}`)
      .join('\n');

    const independent = await groqJson(
      `Réponds de façon brève et exacte à chacune de ces questions de quiz. Si tu n'es pas certain, mets "?".

${questions}

Réponds en JSON : {"items":[{"n":1,"answer":"..."}]}`,
      900,
      0
    );

    const given = new Map();
    for (const item of independent?.items || []) given.set(Number(item?.n), String(item?.answer || '').trim());

    const rows = subset
      .map(
        (q, i) =>
          `${i + 1}. Question : ${q.question} | Réponse proposée : ${q.answer} | Réponse indépendante : ${given.get(i + 1) || '?'}`
      )
      .join('\n');

    const verdict = await groqJson(
      `Tu es relecteur exigeant d'un quiz. Pour chaque ligne, réponds :
- "same" : true si les deux réponses désignent la même chose (même écrites autrement : VO/VF, transcription, forme courte) ;
- "ok" : true si la réponse proposée est exacte selon l'œuvre originale ou les faits établis, la question est claire, compréhensible seule et à réponse unique ;
- "lvl" : false seulement si clairement hors niveau (${levelRule}), sinon true.

${rows}

Réponds en JSON : {"items":[{"n":1,"same":true,"ok":true,"lvl":true}]}`,
      900,
      0
    );

    return { verdict, given };
  };

  let result = null;
  try {
    result = await Promise.race([
      attempt(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Relecture timeout 18s')), 18000))
    ]);
  } catch (error) {
    logger.warn({ error: error?.message }, 'Sitri~Quiz : relecture rapide ignorée (repli direct).');
    // Repli rapide : on garde les questions bien formées générées
    return list;
  }

  const byN = new Map();
  for (const item of result?.verdict?.items || []) byN.set(Number(item?.n), item);
  if (!byN.size) return list;

  const kept = subset.filter((q, i) => {
    const v = byN.get(i + 1);
    if (!v) return true;
    const independentAnswer = result.given.get(i + 1);
    const agrees =
      v.same === true ||
      v.same === 'true' ||
      !independentAnswer ||
      independentAnswer === '?' ||
      isQuizAnswerCorrect(independentAnswer, q);
    const ok = v.ok === true || v.ok === 'true' || v.ok === undefined;
    return agrees && ok && v.lvl !== false;
  });

  // Complète avec le reste du lot si trop filtré afin d'avoir des questions rapidement
  if (kept.length < Math.min(3, subset.length)) {
    return list;
  }
  return [...kept, ...list.slice(subset.length)];
}

// ─── Niveaux et historique des questions (jamais deux fois la même question) ───

const AUTO_QUIZ_LEVELS = {
  facile: { label: 'Facile', icon: '🟢' },
  moyen: { label: 'Moyen', icon: '🟡' },
  eleve: { label: 'Élevé', icon: '🔴' }
};

function matchQuizLevel(text) {
  const n = normalizeLoose(text);
  if (!n) return null;
  if (['facile', 'easy', 'simple'].includes(n)) return 'facile';
  if (['moyen', 'medium', 'normal', 'intermediaire'].includes(n)) return 'moyen';
  if (['eleve', 'haut', 'difficile', 'hard', 'expert', 'dur'].includes(n)) return 'eleve';
  return null;
}

function quizLevelInstruction(category, level) {
  if (category === 'multivers') {
    if (level === 'facile') {
      return "niveau FACILE : un fan qui a regardé l'anime répond sans réfléchir (personnage principal, village/lieu célèbre, technique ou événement emblématique, début de l'histoire). Exemple de difficulté (ne le reprends pas) : « Dans Naruto, comment s'appelle le village caché d'où vient Naruto ? »";
    }
    if (level === 'eleve') {
      return "niveau ÉLEVÉ : fan confirmé ; détails précis d'un arc, personnage secondaire, cause ou conséquence d'un événement, règle du système de pouvoirs. Difficile mais toujours canonique, vérifiable et équitable. Exemple de difficulté (ne le reprends pas) : « Dans Hunter x Hunter, quel type de Nen maîtrise Gon ? »";
    }
    return "niveau MOYEN : niveau fan ; jamais une question que quelqu'un ayant vu quelques épisodes saurait (pas de « qui est le héros de… »), mais rien d'impossible ; noms de techniques, causes, personnages secondaires importants, déroulement d'arcs. Exemple de difficulté (ne le reprends pas) : « Dans Demon Slayer, quel souffle Tanjiro utilise-t-il au début de son entraînement ? »";
  }

  if (level === 'facile') {
    return "niveau FACILE : culture de base que presque tout le monde connaît (capitales de pays très célèbres, planètes, animaux, couleurs, formes, drapeaux, grands monuments). Exemple de difficulté (ne le reprends pas) : « Quelle planète est la plus proche du Soleil ? »";
  }
  if (level === 'eleve') {
    return "niveau ÉLEVÉ : pour passionnés de culture générale ; histoire précise, littérature, sciences, géographie moins connue, mais réponse unique et incontestable. Exemple de difficulté (ne le reprends pas) : « Quel traité de 1648 a mis fin à la guerre de Trente Ans ? »";
  }
  return "niveau MOYEN : niveau lycée / curieux ; il faut avoir un peu appris ou lu pour répondre (capitales moins évidentes, dates majeures, auteurs, découvertes). Exemple de difficulté (ne le reprends pas) : « Quelle est la capitale de l'Australie ? »";
}

const quizHistoryCache = new Map();

async function loadQuizHistory(category) {
  const cached = quizHistoryCache.get(category);
  if (cached) return cached;

  const history = { keys: new Set(), recent: [] };
  try {
    const res = await executeDbWithRetry({
      sql: 'SELECT key, label FROM quiz_question_history WHERE category = ? ORDER BY created_at DESC LIMIT 800',
      args: [category]
    });
    for (const row of res.rows || []) {
      history.keys.add(String(row.key));
      if (row.label) history.recent.push(String(row.label));
    }
  } catch (error) {
    logger.warn({ error: error?.message }, 'Sitri~Quiz : historique des questions illisible.');
  }

  quizHistoryCache.set(category, history);
  return history;
}

// Mémorise une question au moment où elle est posée, pour ne plus jamais la reposer
async function markQuizQuestionAsked(category, question) {
  const entries = Array.isArray(question?.histKeys) ? question.histKeys : [];
  if (!entries.length) return;

  const history = await loadQuizHistory(category);
  for (const entry of entries) {
    if (!entry?.key) continue;
    history.keys.add(entry.key);
    if (entry.label) history.recent.unshift(entry.label);

    try {
      await executeDbWithRetry({
        sql: `INSERT INTO quiz_question_history (category, key, label, created_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(category, key) DO UPDATE SET
                label = excluded.label,
                created_at = excluded.created_at`,
        args: [category, entry.key, entry.label || '', Date.now()]
      });
    } catch (error) {
      logger.warn({ error: error?.message }, 'Sitri~Quiz : historique non enregistré.');
    }
  }
  if (history.recent.length > 800) history.recent.length = 800;
}

async function pruneQuizHistory(category) {
  try {
    await executeDbWithRetry({
      sql: `DELETE FROM quiz_question_history
            WHERE category = ?
              AND key NOT IN (
                SELECT key FROM quiz_question_history WHERE category = ? ORDER BY created_at DESC LIMIT 800
              )`,
      args: [category, category]
    });
  } catch {
    // Sans importance
  }
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function generateTextQuizQuestions(category, total, level = 'moyen', onProgress = null) {
  const questions = [];
  const usedTopics = [];
  const usedAnswers = new Set();
  const history = await loadQuizHistory(category);
  pruneQuizHistory(category).catch(() => {});

  const startedAt = Date.now();
  const budgetMs = 26000; // Maximum ~26s pour ne pas faire attendre les joueurs
  const maxAttempts = 5;
  let attempts = 0;
  let failures = 0;
  let progressSent = false;

  while (questions.length < total && attempts < maxAttempts && Date.now() - startedAt < budgetMs) {
    attempts++;
    const remaining = total - questions.length;
    const need = Math.min(10, Math.max(5, remaining + 2));
    const recent = [...questions.map(q => q.question), ...history.recent].slice(0, 30).join(' | ') || 'aucune';

    const prompt =
      category === 'multivers'
        ? `Tu animes un quiz entre fans d'animés et de mangas sur WhatsApp. Génère exactement ${need} questions en français.

Ton et formulation :
- écris comme un fan qui lance une question à ses potes : naturel, décontracté, phrases simples et fluides ;
- utilise la terminologie française courante de la VF/VOSTFR ;
- la question doit être complète, claire et compréhensible seule.

Niveau : ${quizLevelInstruction('multivers', level)} ;
- mélange de questions d'histoire et de faits précis de l'œuvre originale (canon).

Fiabilité :
- anime/manga variés ;
- UNE seule réponse attendue, claire et sans ambiguïté ;
- la réponse ne doit pas apparaître dans la question.

Champ "type" : "nom" | "court" | "explication".
Champ "alts" : variantes acceptables (VO, VF, romaji, prénom ou nom unique).
Univers déjà utilisés dans ce quiz : ${usedTopics.slice(-20).join(', ') || 'aucun'}.
Questions déjà posées (interdites) : ${recent}.
Réponds en JSON : {"questions":[{"univers":"nom de l'anime/manga","type":"nom|court|explication","question":"...","answer":"...","alts":["..."],"keypoints":["..."]}]}`
        : `Tu animes un quiz de culture générale entre potes sur WhatsApp. Génère exactement ${need} questions en français.
Règles :
- écris naturellement, simplement et clairement ;
- sujets variés (géographie, histoire, sciences, arts, littérature, sport, nature, technologie) ;
- ${quizLevelInstruction('cg', level)} ; question complète et compréhensible seule ;
- réponse courte (1 à 4 mots), précise et incontestable ;
- la réponse ne doit pas apparaître dans la question.
Champ "type" : "nom" | "court".
Champ "person" : true si la réponse est le nom d'une personne.
Champ "usual" : nom d'usage universel si différent du nom de famille, sinon "".
Champ "alts" : variantes, traductions ou nom de famille seul si personne.
Questions déjà posées (interdites) : ${recent}.
Réponds en JSON : {"questions":[{"type":"nom|court","person":false,"usual":"","question":"...","answer":"...","alts":["..."]}]}`;

    try {
      const data = await groqJson(prompt, 2400, 0.65);
      const list = Array.isArray(data.questions) ? data.questions : [];
      const batch = [];

      for (const item of list) {
        const question = String(item?.question || '').trim();
        const answer = String(item?.answer || '').trim();
        if (!question || !answer || answer.length > 140) continue;
        if (answer.length > 3 && normalizeLoose(question).includes(normalizeLoose(answer))) continue;

        const key = normalizeLoose(question);
        if (questions.some(q => normalizeLoose(q.question) === key)) continue;
        if (batch.some(q => normalizeLoose(q.question) === key)) continue;

        const qKey = `q:${key}`;
        const answerKey = normalizeLoose(answer);

        if (usedAnswers.has(answerKey) || batch.some(q => normalizeLoose(q.answer) === answerKey)) continue;

        const aKey = `a:${normalizeLoose(item?.univers || '')}|${answerKey}`;
        if (history.keys.has(qKey)) continue;
        if (category === 'multivers' && history.keys.has(aKey)) continue;

        let univers = '';
        if (category === 'multivers') {
          univers = String(item?.univers || '').trim();
          const topic = normalizeLoose(univers);
          if (topic && usedTopics.includes(topic) && attempts <= 2) continue;
          if (topic && !usedTopics.includes(topic)) usedTopics.push(topic);
        }

        const answerType = ['nom', 'court', 'explication'].includes(item?.type) ? item.type : 'court';
        let alts = Array.isArray(item?.alts) ? item.alts.map(String).slice(0, 12) : [];
        const person = category === 'cg' && item?.person === true;

        if (person) {
          const tokens = significantTokens(answer);
          if (tokens.length >= 2) {
            alts = alts.filter(a => normalizeLoose(a) !== tokens[0]);
            const last = tokens[tokens.length - 1];
            if (!alts.some(a => significantTokens(a).includes(last))) alts.push(last);
          }
          const usual = String(item?.usual || '').trim();
          if (usual && usual.length <= 30) alts.push(usual);
        }

        batch.push({
          type: 'text',
          answerType,
          person,
          univers,
          question,
          answer,
          alts,
          keypoints: Array.isArray(item?.keypoints) ? item.keypoints.map(String).slice(0, 4) : [],
          histKeys: [
            { key: qKey, label: question },
            { key: aKey, label: '' }
          ]
        });
      }

      const remainingTime = budgetMs - (Date.now() - startedAt);
      const verified = remainingTime > 7000
        ? await verifyQuizQuestions(batch, level, category)
        : batch;

      for (const q of verified) {
        if (questions.length >= total) break;
        questions.push(q);
        usedAnswers.add(normalizeLoose(q.answer));
      }

      failures = 0;

      if (!progressSent && onProgress && questions.length >= Math.ceil(total / 2) && questions.length < total) {
        progressSent = true;
        try {
          onProgress(questions.length, total);
        } catch {}
      }
    } catch (error) {
      failures++;
      lastQuizGenerationError = `Groq : ${String(error?.response?.data?.error?.message || error?.message || error).slice(0, 150)}`;
      logger.warn({ error: error?.message }, 'Sitri~Quiz : génération de questions échouée.');
      if (Date.now() - startedAt < budgetMs - 2500) {
        await sleep(Math.min(2000, 800 * failures));
      }
    }
  }

  // Filet de sécurité (culture générale) : questions vérifiées à la main
  if (category === 'cg' && questions.length < total) {
    questions.push(...pickCgBankQuestions(level, total - questions.length, questions, history));
  }

  // Filet de sécurité multivers si l'IA n'a pas pu tout générer dans le délai de 30s
  if (category === 'multivers' && questions.length < Math.min(total, 5)) {
    const multiversFallback = [
      { type: 'text', answerType: 'nom', person: false, univers: 'Naruto', question: "Dans Naruto, comment s'appelle le village caché d'où vient Naruto Uzumaki ?", answer: 'Konoha', alts: ['Konohagakure', 'Village de la Feuille', 'Feuille'], keypoints: ['Konoha'], histKeys: [] },
      { type: 'text', answerType: 'nom', person: true, univers: 'One Piece', question: "Dans One Piece, quel est le nom du capitaine de l'équipage au Chapeau de Paille ?", answer: 'Monkey D. Luffy', alts: ['Luffy', 'Mugiwara'], keypoints: ['Luffy'], histKeys: [] },
      { type: 'text', answerType: 'court', person: false, univers: 'Demon Slayer', question: "Dans Demon Slayer, quel souffle Tanjiro Kamado utilise-t-il au début de son entraînement ?", answer: "Souffle de l'eau", alts: ['Eau', 'Souffle eau'], keypoints: ['Eau'], histKeys: [] },
      { type: 'text', answerType: 'nom', person: false, univers: 'Jujutsu Kaisen', question: "Dans Jujutsu Kaisen, comment s'appelle l'extension du territoire de Satoru Gojo ?", answer: 'Illusion infinie', alts: ['Vide infini', 'Infinite Void', 'Muryo Kusho'], keypoints: ['Infini', 'Illusion'], histKeys: [] },
      { type: 'text', answerType: 'nom', person: false, univers: 'Dragon Ball', question: "Dans Dragon Ball Z, comment s'appelle la transformation légendaire aux cheveux dorés de Goku ?", answer: 'Super Saiyan', alts: ['Super Saiyen', 'SSJ', 'Super Sayajin'], keypoints: ['Super Saiyan'], histKeys: [] },
      { type: 'text', answerType: 'court', person: false, univers: 'Fullmetal Alchemist', question: "Dans Fullmetal Alchemist, quelle est la règle fondamentale de l'alchimie ?", answer: "Échange équivalent", alts: ['Principe d échange équivalent', 'Equivalent exchange'], keypoints: ['Échange équivalent'], histKeys: [] },
      { type: 'text', answerType: 'nom', person: false, univers: 'Hunter x Hunter', question: "Dans Hunter x Hunter, quel est le nom de l'examen que passent Gon et ses amis pour devenir chasseurs ?", answer: 'Examen des Hunters', alts: ['Hunter Exam', 'Examen Hunter'], keypoints: ['Hunter'], histKeys: [] },
      { type: 'text', answerType: 'nom', person: false, univers: 'Attack on Titan', question: "Dans L'Attaque des Titans, quel est le nom du premier mur extérieur brisé au début de l'histoire ?", answer: 'Mur Maria', alts: ['Wall Maria', 'Maria'], keypoints: ['Maria'], histKeys: [] },
      { type: 'text', answerType: 'nom', person: false, univers: 'Death Note', question: "Dans Death Note, quel est le prénom du shinigami qui laisse tomber son cahier sur Terre ?", answer: 'Ryuk', alts: ['Ryuuk'], keypoints: ['Ryuk'], histKeys: [] },
      { type: 'text', answerType: 'nom', person: false, univers: 'My Hero Academia', question: "Dans My Hero Academia, quel est le nom de l'Alter transmis à Izuku Midoriya ?", answer: 'One For All', alts: ['OFA', 'Un pour tous'], keypoints: ['One For All'], histKeys: [] }
    ];
    for (const fb of multiversFallback) {
      if (questions.length >= total) break;
      const nq = normalizeLoose(fb.question);
      if (!questions.some(q => normalizeLoose(q.question) === nq)) {
        questions.push(fb);
      }
    }
  }

  return questions.slice(0, total);
}

// Banque locale de culture générale (vérifiée à la main) : sert de filet de sécurité si l'IA n'en fournit pas assez
const QUIZ_CG_BANK = [
  // FACILE
  { level: 'facile', question: "Quelle est la capitale de l'Italie ?", answer: 'Rome', alts: [] },
  { level: 'facile', question: 'Quelle planète est la plus proche du Soleil ?', answer: 'Mercure', alts: [] },
  { level: 'facile', question: "Combien de jours compte une année non bissextile ?", answer: '365', alts: ['trois cent soixante-cinq'] },
  { level: 'facile', question: 'Quel est le plus grand océan du monde ?', answer: 'Océan Pacifique', alts: ['Pacifique', 'Le Pacifique'] },
  { level: 'facile', question: 'Quel animal est surnommé le « roi des animaux » ?', answer: 'Le lion', alts: ['Lion'] },
  { level: 'facile', question: 'Dans quel pays se trouve la tour Eiffel ?', answer: 'France', alts: ['La France'] },
  { level: 'facile', question: 'Quel gaz les humains respirent-ils pour vivre ?', answer: 'Oxygène', alts: ["L'oxygène", 'O2'] },
  { level: 'facile', question: 'Combien de côtés a un hexagone ?', answer: '6', alts: ['six'] },
  { level: 'facile', question: 'Quelle est la langue la plus parlée au Brésil ?', answer: 'Portugais', alts: ['Le portugais'] },
  { level: 'facile', question: "Quelle est la formule chimique de l'eau ?", answer: 'H2O', alts: ['H2O'] },
  { level: 'facile', question: 'Quel est le plus grand mammifère du monde ?', answer: 'Baleine bleue', alts: ['La baleine bleue'] },
  { level: 'facile', question: 'Quel pays a pour capitale Tokyo ?', answer: 'Japon', alts: ['Le Japon'] },
  // MOYEN
  { level: 'moyen', question: "Quelle est la capitale de l'Australie ?", answer: 'Canberra', alts: [] },
  { level: 'moyen', question: 'En quelle année le mur de Berlin est-il tombé ?', answer: '1989', alts: [] },
  { level: 'moyen', question: "Quel est le symbole chimique de l'or ?", answer: 'Au', alts: [] },
  { level: 'moyen', question: 'Qui a peint La Joconde ?', answer: 'Léonard de Vinci', alts: ['Vinci', 'De Vinci', 'Leonardo da Vinci'], person: true },
  { level: 'moyen', question: 'Quel est le plus petit pays du monde par sa superficie ?', answer: 'Vatican', alts: ['Le Vatican', 'Cité du Vatican', 'Etat de la Cité du Vatican'] },
  { level: 'moyen', question: 'Quelle est la capitale du Canada ?', answer: 'Ottawa', alts: [] },
  { level: 'moyen', question: 'Quel fleuve traverse Paris ?', answer: 'La Seine', alts: ['Seine'] },
  { level: 'moyen', question: 'Quel scientifique a découvert la pénicilline en 1928 ?', answer: 'Alexander Fleming', alts: ['Fleming'], person: true },
  { level: 'moyen', question: "Combien d'os compte le squelette d'un adulte ?", answer: '206', alts: [] },
  { level: 'moyen', question: "Quel est le plus long fleuve d'Afrique ?", answer: 'Le Nil', alts: ['Nil'] },
  { level: 'moyen', question: "Quelle est la plus haute montagne d'Afrique ?", answer: 'Kilimandjaro', alts: ['Kilimanjaro', 'Mont Kilimandjaro'] },
  { level: 'moyen', question: 'En quelle année a débuté la Première Guerre mondiale ?', answer: '1914', alts: [] },
  // ÉLEVÉ
  { level: 'eleve', question: 'Quel traité de 1648 a mis fin à la guerre de Trente Ans ?', answer: 'Traité de Westphalie', alts: ['Westphalie', 'Paix de Westphalie', 'Traités de Westphalie'] },
  { level: 'eleve', question: 'Quel mathématicien a démontré le dernier théorème de Fermat ?', answer: 'Andrew Wiles', alts: ['Wiles'], person: true },
  { level: 'eleve', question: "Quel est l'élément chimique le plus abondant dans l'univers ?", answer: 'Hydrogène', alts: ["L'hydrogène"] },
  { level: 'eleve', question: "Quel empereur romain a refondé Byzance sous le nom de Constantinople ?", answer: 'Constantin', alts: ['Constantin Ier', 'Constantin le Grand'] },
  { level: 'eleve', question: "Quel homme d'État prussien est le principal artisan de l'unification allemande de 1871 ?", answer: 'Otto von Bismarck', alts: ['Bismarck'], person: true },
  { level: 'eleve', question: 'Quel est le lac le plus profond du monde ?', answer: 'Lac Baïkal', alts: ['Baïkal', 'Baikal'] },
  { level: 'eleve', question: 'Quelle est la capitale de la Mongolie ?', answer: 'Oulan-Bator', alts: ['Ulaanbaatar', 'Ulan Bator'] },
  { level: 'eleve', question: "Quel physicien a découvert l'électron en 1897 ?", answer: 'Joseph John Thomson', alts: ['J. J. Thomson', 'Thomson'], person: true },
  { level: 'eleve', question: 'Qui a écrit le recueil « Les Fleurs du mal » ?', answer: 'Charles Baudelaire', alts: ['Baudelaire'], person: true },
  { level: 'eleve', question: "Quel détroit sépare l'Asie de l'Amérique du Nord ?", answer: 'Détroit de Béring', alts: ['Béring', 'Bering', 'Détroit de Bering'] },
  { level: 'eleve', question: 'Qui a écrit « Le Capital », publié en 1867 ?', answer: 'Karl Marx', alts: ['Marx'], person: true },
  { level: 'eleve', question: 'Quelle est la formule chimique du sel de table ?', answer: 'NaCl', alts: ['Chlorure de sodium'] }
];

function pickCgBankQuestions(level, count, exclude, history) {
  const askedKeys = new Set(exclude.map(q => normalizeLoose(q.question)));
  const pool = QUIZ_CG_BANK.filter(
    item => item.level === level && !askedKeys.has(normalizeLoose(item.question))
  );
  const unseen = shuffleInPlace(pool.filter(item => !history.keys.has(`q:${normalizeLoose(item.question)}`)));
  const seen = shuffleInPlace(pool.filter(item => history.keys.has(`q:${normalizeLoose(item.question)}`)));

  return [...unseen, ...seen].slice(0, count).map(item => ({
    type: 'text',
    answerType: item.person ? 'nom' : 'court',
    person: Boolean(item.person),
    univers: '',
    question: item.question,
    answer: item.answer,
    alts: item.alts || [],
    keypoints: [],
    histKeys: [{ key: `q:${normalizeLoose(item.question)}`, label: item.question }]
  }));
}

let lastQuizGenerationError = '';

async function fetchAniListCharacters(page) {
  const res = await axios.post(
    'https://graphql.anilist.co',
    {
      query: `query ($page: Int) {
        Page(page: $page, perPage: 50) {
          characters(sort: FAVOURITES_DESC) {
            id
            name { full alternative }
            image { large }
            media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { romaji english } } }
          }
        }
      }`,
      variables: { page }
    },
    { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 15000 }
  );

  const out = [];
  for (const c of res.data?.data?.Page?.characters || []) {
    const imageUrl = c?.image?.large || '';
    const name = String(c?.name?.full || '').trim();
    if (!c?.id || !name || !imageUrl || imageUrl.includes('default')) continue;

    const title = c?.media?.nodes?.[0]?.title;
    out.push({
      id: `al${c.id}`,
      type: 'image',
      imageUrl,
      answer: name,
      alts: (c?.name?.alternative || []).map(String).filter(a => a.length <= 30).slice(0, 4),
      hintText: String(title?.english || title?.romaji || '')
    });
  }
  return out;
}

async function fetchJikanCharacters(page) {
  const res = await axios.get('https://api.jikan.moe/v4/top/characters', {
    params: { page, limit: 25 },
    timeout: 15000
  });

  const out = [];
  for (const c of res.data?.data || []) {
    const imageUrl = c?.images?.jpg?.image_url || c?.images?.webp?.image_url || '';
    if (!c?.mal_id || !imageUrl || imageUrl.includes('questionmark')) continue;

    let name = String(c.name || '').trim();
    if (name.includes(',')) {
      const [last, first] = name.split(',').map(part => part.trim());
      name = `${first} ${last}`.trim();
    }
    if (!name) continue;

    out.push({
      id: `jk${c.mal_id}`,
      type: 'image',
      imageUrl,
      answer: name,
      alts: Array.isArray(c.nicknames) ? c.nicknames.map(String).slice(0, 4) : [],
      hintText: ''
    });
  }
  return out;
}

const ANILIST_MEDIA_QUERY = `query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false, format_in: [TV, MOVIE, ONA]) {
      id
      title { romaji english }
      synonyms
      coverImage { extraLarge large }
    }
  }
}`;

// On écarte les suites et saisons : l'univers doit être identifiable par son titre principal
const POSTER_SEQUEL_RE = /(season|saison|2nd|3rd|\dth|part\s*\d|cour|final|shippuden|\bii\b|\biii\b|\b[2-9]\b\s*$)/i;

async function fetchAniListPosters(page) {
  const res = await axios.post(
    'https://graphql.anilist.co',
    { query: ANILIST_MEDIA_QUERY, variables: { page, perPage: 50 } },
    { timeout: 15000, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
  );

  const out = [];
  for (const m of res.data?.data?.Page?.media || []) {
    const imageUrl = m?.coverImage?.extraLarge || m?.coverImage?.large || '';
    const title = String(m?.title?.english || m?.title?.romaji || '').trim();
    if (!m?.id || !imageUrl || !title) continue;
    if (POSTER_SEQUEL_RE.test(title) || POSTER_SEQUEL_RE.test(String(m?.title?.romaji || ''))) continue;

    const alts = [m.title?.romaji, m.title?.english, ...(Array.isArray(m.synonyms) ? m.synonyms : [])]
      .filter(Boolean)
      .map(String)
      .filter(name => name !== title)
      .slice(0, 8);

    out.push({ type: 'image', kind: 'poster', id: `m${m.id}`, imageUrl, answer: title, alts, hintText: '' });
  }
  return out;
}

// Titres acceptés pour chaque affiche : VF / VOSTFR / anglais / romaji / abréviations qui existent vraiment
async function enrichPosterQuestions(list) {
  if (!CONFIG.groqKey || !list.length) return list;

  try {
    const items = list
      .map((q, i) => `${i + 1}. ${q.answer}${q.alts?.length ? ` — autres titres : ${q.alts.join(' / ')}` : ''}`)
      .join('\n');

    const data = await groqJson(
      `Voici des animés :
${items}

Pour chacun, donne dans "accept" tous les titres sous lesquels on le connaît réellement : titre français (VF ou VOSTFR), titre anglais, titre japonais romanisé, abréviations courantes (ex. SNK, JJK, HxH), transcriptions existantes.
N'invente rien : uniquement des titres qui existent vraiment pour CET animé.
Réponds en JSON : {"items":[{"n":1,"accept":["..."]}]}`,
      3500,
      0
    );

    for (const item of data?.items || []) {
      const q = list[Number(item?.n) - 1];
      if (q && Array.isArray(item.accept)) {
        q.alts = [...new Set([...(q.alts || []), ...item.accept.map(String)])].slice(0, 16);
      }
    }
  } catch (error) {
    logger.warn({ error: error?.message }, 'Sitri~Quiz : titres des affiches non enrichis.');
  }

  return list;
}

async function generateIdvQuizQuestions(total, level = 'moyen') {
  const history = await loadQuizHistory('idv');
  pruneQuizHistory('idv').catch(() => {});

  const pool = [];
  const seen = new Set();
  const fresh = () => pool.filter(item => !history.keys.has(`m:${item.id}`));

  const { from, to } = idLevelPages(level);
  const pages = [];
  for (let page = from; page <= to; page++) pages.push(page);
  shuffleInPlace(pages);

  let fetched = 0;
  for (const page of pages) {
    if (fresh().length >= total + 4 || fetched >= 6) break;
    fetched++;
    try {
      for (const item of await fetchAniListPosters(page)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        pool.push(item);
      }
    } catch (error) {
      lastQuizGenerationError = `AniList : ${String(error?.response?.status || error?.message || error).slice(0, 120)}`;
      logger.warn({ error: error?.message, page }, 'Sitri~Quiz : AniList indisponible (affiches).');
    }
    await sleep(700);
  }

  let chosen = shuffleInPlace(fresh());
  if (chosen.length < total) {
    const rest = shuffleInPlace(pool.filter(item => !chosen.includes(item)));
    chosen = chosen.concat(rest);
  }
  chosen = chosen.slice(0, total);

  for (const item of chosen) item.histKeys = [{ key: `m:${item.id}`, label: item.answer }];

  return enrichPosterQuestions(chosen);
}

function idLevelPages(level) {
  // Pages de 50 personnages classés par popularité (AniList)
  if (level === 'facile') return { from: 1, to: 2 };
  if (level === 'eleve') return { from: 11, to: 30 };
  return { from: 3, to: 10 };
}

// Toutes les écritures acceptables (variantes de transcription, prénom, surnoms, nom de famille unique)
async function enrichIdQuestions(list) {
  if (!CONFIG.groqKey || !list.length) return list;

  try {
    const items = list
      .map(
        (q, i) =>
          `${i + 1}. ${q.answer}${q.hintText ? ` (${q.hintText})` : ''}${q.alts?.length ? ` — alias : ${q.alts.join(', ')}` : ''}`
      )
      .join('\n');

    const data = await groqJson(
      `Voici des personnages d'anime/manga :
${items}

Pour chacun, donne dans "accept" toutes les réponses acceptables dans un quiz d'identification :
- toutes les orthographes, transcriptions et traductions de son nom qui EXISTENT réellement (ex. « Tohru » et « Tooru », « Dokja » et « Dok-ja ») ;
- le prénom seul, le nom d'usage, les surnoms connus ;
- le nom de famille seul UNIQUEMENT s'il identifie ce personnage de façon unique dans son œuvre (« Isagi », « Gojo », « Uzui », « Urahara » : oui, ces personnages sont surtout connus par leur nom de famille et leur prénom passe aussi ; « Uchiha », « Elric », « Zoldyck » : non, d'autres membres sont connus).
N'invente rien : uniquement des écritures du MÊME personnage.
Réponds en JSON : {"items":[{"n":1,"accept":["..."]}]}`,
      3500,
      0
    );

    for (const item of data?.items || []) {
      const q = list[Number(item?.n) - 1];
      if (q && Array.isArray(item.accept)) {
        q.alts = [...new Set([...(q.alts || []), ...item.accept.map(String)])].slice(0, 14);
      }
    }
  } catch (error) {
    logger.warn({ error: error?.message }, 'Sitri~Quiz : écritures des noms non enrichies.');
  }

  return list;
}

async function generateIdQuizQuestions(total, level = 'moyen') {
  const history = await loadQuizHistory('id');
  pruneQuizHistory('id').catch(() => {});

  const pool = [];
  const seen = new Set();
  const addAll = list => {
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      pool.push(item);
    }
  };
  const fresh = () => pool.filter(item => !history.keys.has(`c:${item.id}`));

  const { from, to } = idLevelPages(level);
  const pages = [];
  for (let page = from; page <= to; page++) pages.push(page);
  shuffleInPlace(pages);

  let fetched = 0;
  for (const page of pages) {
    if (fresh().length >= total + 4 || fetched >= 6) break;
    fetched++;
    try {
      addAll(await fetchAniListCharacters(page));
    } catch (error) {
      lastQuizGenerationError = `AniList : ${String(error?.response?.status || error?.message || error).slice(0, 120)}`;
      logger.warn({ error: error?.message, page }, 'Sitri~Quiz : AniList indisponible.');
    }
    await sleep(700);
  }

  // Secours : Jikan (MyAnimeList)
  if (pool.length < total) {
    const jikanPages = new Set();
    const wanted = Math.ceil(total / 8) + 1;
    while (jikanPages.size < wanted) jikanPages.add(3 + Math.floor(Math.random() * 28));

    for (const page of jikanPages) {
      try {
        addAll(await fetchJikanCharacters(page));
      } catch (error) {
        lastQuizGenerationError = `Jikan : ${String(error?.response?.status || error?.message || error).slice(0, 120)}`;
        logger.warn({ error: error?.message, page }, 'Sitri~Quiz : Jikan indisponible.');
      }
      await sleep(600);
    }
  }

  // Personnages jamais posés d'abord ; si on en manque, on complète avec les plus anciens
  let chosen = shuffleInPlace(fresh());
  if (chosen.length < total) {
    const rest = shuffleInPlace(pool.filter(item => !chosen.includes(item)));
    chosen = chosen.concat(rest);
  }
  chosen = chosen.slice(0, total);

  for (const item of chosen) item.histKeys = [{ key: `c:${item.id}`, label: item.answer }];

  return enrichIdQuestions(chosen);
}

async function downloadQuizImage(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: 8 * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sitri-Nel)' }
  });
  const buffer = Buffer.from(res.data);
  if (!buffer.length) throw new Error('image vide');
  return buffer;
}

// --- Déroulement du quiz

function clearAutoQuizTimers(session) {
  for (const key of ['timer', 'hintTimer', 'nextTimer', 'setupTimer']) {
    if (session[key]) {
      clearTimeout(session[key]);
      session[key] = null;
    }
  }
}

const QUIZ_PODIUM_REWARDS = [
  { rank: '🥇 1er', coins: 200, xp: 20 },
  { rank: '🥈 2e', coins: 100, xp: 10 },
  { rank: '🥉 3e', coins: 50, xp: 5 }
];

async function distributeQuizRewards(ranking) {
  const linesOut = [];
  for (let i = 0; i < ranking.length; i++) {
    const player = ranking[i];
    const tag = `@${getNumber(player.jid)}`;
    if (i < 3) {
      const reward = QUIZ_PODIUM_REWARDS[i];
      await addRewards(player.jid, reward.coins, reward.xp).catch(() => {});
      linesOut.push(
        `*├ ◈ ${reward.rank} : ${tag} (${player.points}p)*\n*│   ↳ +${reward.coins} XCoins 💰 | +${reward.xp} XP ⭐*`
      );
    } else {
      linesOut.push(`*├ ◈ ▫️ ${i + 1}e : ${tag} (${player.points}p)*`);
    }
  }
  return linesOut;
}

async function finishAutoQuiz(session, { stopped = false } = {}) {
  if (autoQuizzes.get(session.chatJid) !== session) return;

  autoQuizzes.delete(session.chatJid);
  clearAutoQuizTimers(session);
  session.stage = 'ended';

  const jid = session.chatJid;
  const ranking = rankQuizPlayers(session);

  try {
    if (stopped) await quizSend(jid, { text: '🛑 Quiz arrêté.' });

    if (!ranking.length) {
      await quizSend(jid, { text: '🏁 Quiz terminé : aucun point marqué.' });
      return;
    }

    const rows = ranking.map(player => ({
      label: `@${getNumber(player.jid)}`,
      points: player.points
    }));

    const category = AUTO_QUIZ_CATEGORIES[session.category];
    const levelInfo = AUTO_QUIZ_LEVELS[session.level];
    const info = category
      ? `${category.icon} ${category.label}${levelInfo ? ` • ${levelInfo.icon} ${levelInfo.label}` : ''} • ${session.asked || 0} question${(session.asked || 0) > 1 ? 's' : ''}`
      : '';

    await quizSend(jid, {
      text: buildQuizBoard({ title: 'RÉCAPITULATIF', rows, info }),
      mentions: ranking.map(player => player.jid)
    });

    await sleep(800);
    await quizSend(jid, { text: QUIZ_THANKS_TEXT });
  } catch (error) {
    logger.warn({ error: error?.message }, 'Sitri~Quiz : envoi du récapitulatif impossible.');
  }
}

async function askNextAutoQuestion(session) {
  if (autoQuizzes.get(session.chatJid) !== session || session.stage !== 'running') return;

  const jid = session.chatJid;
  const category = AUTO_QUIZ_CATEGORIES[session.category];

  while (true) {
    session.index += 1;
    if (session.index >= session.questions.length) {
      await finishAutoQuiz(session);
      return;
    }

    const q = session.questions[session.index];
    const number = session.index + 1;
    const seconds = Math.round(AUTO_QUIZ_TIME_MS / 1000);

    try {
      if (q.type === 'image') {
        const image = await downloadQuizImage(q.imageUrl);
        await quizSend(jid, {
          image,
          caption: `${q.kind === 'poster' ? '🎴' : '🖼️'} *Question ${number}/${session.questions.length}* — ${q.kind === 'poster' ? 'Quel est cet univers (anime) ?' : 'Qui est ce personnage ?'}\n\n⏱️ ${seconds} secondes`
        });
      } else {
        const lines = [`❓ *Question ${number}/${session.questions.length}* — ${category.icon} ${category.label}`, '', q.question];
        if (q.univers) lines.push('', `📺 *${q.univers}*`);
        lines.push('', `⏱️ ${seconds} secondes`);
        await quizSend(jid, { text: lines.join('\n') });
      }
    } catch (error) {
      logger.warn({ error: error?.message }, 'Sitri~Quiz : question non envoyée, passage à la suivante.');
      continue;
    }

    session.asked = (session.asked || 0) + 1;
    markQuizQuestionAsked(session.category, q).catch(() => {});
    session.current = q;
    session.answered = false;

    if (q.type === 'image') {
      session.hintTimer = setTimeout(async () => {
        if (autoQuizzes.get(jid) !== session || session.answered || session.current !== q) return;
        const first = significantTokens(q.answer)[0] || '';
        const hint = q.hintText
          ? `💡 Indice : ça vient de *${q.hintText}*`
          : first
            ? `💡 Indice : ${q.kind === 'poster' ? 'le titre' : 'le nom'} commence par *${first[0].toUpperCase()}*`
            : '';
        if (hint) await quizSend(jid, { text: hint }).catch(() => {});
      }, Math.round(AUTO_QUIZ_TIME_MS / 2));
    }

    session.timer = setTimeout(async () => {
      if (autoQuizzes.get(jid) !== session || session.answered || session.current !== q) return;
      session.answered = true;
      if (session.hintTimer) clearTimeout(session.hintTimer);
      await quizSend(jid, { text: `⏱️ Temps écoulé ! La réponse était : *${q.answer}*` }).catch(() => {});
      session.nextTimer = setTimeout(() => askNextAutoQuestion(session), 2500);
    }, AUTO_QUIZ_TIME_MS);

    return;
  }
}

// Donne le point au premier qui trouve et répond simplement ☑️
async function awardAutoQuizPoint(session, q, sender, message) {
  if (autoQuizzes.get(session.chatJid) !== session || session.answered || session.current !== q) return false;

  session.answered = true;
  clearTimeout(session.timer);
  if (session.hintTimer) clearTimeout(session.hintTimer);
  session.timer = null;
  session.hintTimer = null;

  session.scores[sender] = Number(session.scores[sender] || 0) + 1;
  session.lastAt[sender] = Date.now();

  await quizSend(session.chatJid, { text: '☑️' }, { quoted: message }).catch(() => {});

  session.nextTimer = setTimeout(() => askNextAutoQuestion(session), 2000);
  return true;
}

async function startAutoQuiz(session) {
  const jid = session.chatJid;
  const category = AUTO_QUIZ_CATEGORIES[session.category];

  try {
    await quizSend(jid, {
      text: `🚀 *QUIZ LANCÉ !*\n\n${category.icon} Catégorie : *${category.label}*\n${(AUTO_QUIZ_LEVELS[session.level] || AUTO_QUIZ_LEVELS.moyen).icon} Niveau : *${(AUTO_QUIZ_LEVELS[session.level] || AUTO_QUIZ_LEVELS.moyen).label}*\n📋 ${session.total} questions\n\nPréparation et relecture des questions (maximum 30 secondes)...`
    });

    if (!CONFIG.groqKey && !['id', 'idv'].includes(session.category)) {
      throw new Error('GROQ_API_KEY absent');
    }

    const questions =
      session.category === 'id'
        ? await generateIdQuizQuestions(session.total, session.level || 'moyen')
        : session.category === 'idv'
          ? await generateIdvQuizQuestions(session.total, session.level || 'moyen')
          : await generateTextQuizQuestions(
              session.category,
              session.total,
              session.level || 'moyen',
              (done, wanted) => {
                quizSend(jid, { text: `⏳ ${done}/${wanted} questions vérifiées, je termine...` }).catch(() => {});
              }
            );

    if (autoQuizzes.get(jid) !== session) return;

    if (questions.length < 3) {
      autoQuizzes.delete(jid);
      clearAutoQuizTimers(session);
      await quizSend(jid, {
        text:
          '⚠️ Impossible de préparer les questions pour le moment. Réessaie avec Xquiz dans un instant.' +
          (cleanEnv(process.env.XPLAY_DEBUG) === '1' && lastQuizGenerationError
            ? `\n\n🛠️ Diagnostic : ${lastQuizGenerationError}`
            : '')
      });
      return;
    }

    if (questions.length < session.total) {
      await quizSend(jid, {
        text: `⚠️ Seulement ${questions.length} question${questions.length > 1 ? 's' : ''} fiable${questions.length > 1 ? 's ont' : ' a'} passé la relecture sur ${session.total} demandées : on joue avec celles-là (je préfère ne pas poser de question douteuse).`
      }).catch(() => {});
    }

    session.questions = questions;
    session.total = questions.length;
    session.stage = 'running';
    session.index = -1;

    await askNextAutoQuestion(session);
  } catch (error) {
    logger.warn({ error: error?.message }, 'Sitri~Quiz : démarrage impossible.');
    autoQuizzes.delete(jid);
    clearAutoQuizTimers(session);
    await quizSend(jid, { text: '⚠️ Le quiz n’a pas pu démarrer. Réessaie avec Xquiz.' }).catch(() => {});
  }
}

function matchQuizCategory(text) {
  const n = normalizeLoose(text);
  if (!n) return null;
  if (n === 'multivers' || n === 'multiverse') return 'multivers';
  if (n === 'id' || n === 'identification') return 'id';
  if (n === 'idv' || n === 'id verse' || n === 'id univers' || n === 'id verses') return 'idv';
  if (n === 'cg' || n === 'culture generale' || n === 'culture g') return 'cg';
  return null;
}

// Messages normaux pendant un Sitri~Quiz : choix de catégorie / nombre, puis réponses
async function handleAutoQuizMessage(jid, message, text, sender) {
  const session = autoQuizzes.get(jid);
  if (!session) return false;

  if (isQuizBotEcho(message, text)) return true;

  if (session.stage === 'category') {
    if (!sameUser(sender, session.host)) return false;
    const category = matchQuizCategory(text);
    if (!category) return false;

    session.category = category;
    session.stage = 'level';

    const sent = await quizSend(jid, {
      text:
        `*╭─〔 ⌬ SITRI~QUIZ 〕*\n*│*\n` +
        `*├ ◈ ${AUTO_QUIZ_CATEGORIES[category].icon} ${AUTO_QUIZ_CATEGORIES[category].label}*\n` +
        `*│*\n*├ ◈ Quel niveau ?*\n*├ ◈ 🟢 Facile • 🟡 Moyen • 🔴 Élevé*\n*│*\n` +
        `*├ ◈ Réponds à ce message avec le niveau*\n*╰━━━━━━━━━━━━━━━━━━━━━*`
    }, { quoted: message });
    session.promptId = sent?.key?.id || null;
    return true;
  }

  if (session.stage === 'level') {
    if (!sameUser(sender, session.host)) return false;
    const level = matchQuizLevel(text);
    if (!level) return false;

    session.level = level;
    session.stage = 'count';

    const info = AUTO_QUIZ_LEVELS[level];
    const sent = await quizSend(jid, {
      text:
        `*╭─〔 ⌬ SITRI~QUIZ 〕*\n*│*\n` +
        `*├ ◈ ${AUTO_QUIZ_CATEGORIES[session.category].icon} ${AUTO_QUIZ_CATEGORIES[session.category].label} • ${info.icon} ${info.label}*\n` +
        `*│*\n*├ ◈ Combien de questions ?*\n*├ ◈ ${AUTO_QUIZ_COUNTS.join(' • ')}*\n*│*\n` +
        `*├ ◈ Réponds à ce message avec le nombre*\n*╰━━━━━━━━━━━━━━━━━━━━━*`
    }, { quoted: message });
    session.promptId = sent?.key?.id || null;
    return true;
  }

  if (session.stage === 'count') {
    if (!sameUser(sender, session.host)) return false;
    const match = String(text).trim().match(/^(10|20|30)\b/);
    if (!match) return false;

    session.total = Number(match[1]);
    session.stage = 'generating';
    if (session.setupTimer) {
      clearTimeout(session.setupTimer);
      session.setupTimer = null;
    }

    startAutoQuiz(session).catch(error =>
      logger.warn({ error: error?.message }, 'Sitri~Quiz : erreur au démarrage.')
    );
    return true;
  }

  if (session.stage === 'generating') return false;

  if (session.stage === 'running') {
    const trimmed = String(text || '').trim();
    const q = session.current;
    const long = q && q.type === 'text' && q.answerType === 'explication';
    const maxWords = long ? 25 : 8;
    const words = trimmed.split(/\s+/).length;
    if (!trimmed || words > maxWords || trimmed.length > (long ? 200 : 80)) return false;

    if (session.answered || !q) return true;

    if (isQuizAnswerCorrect(trimmed, q)) {
      await awardAutoQuizPoint(session, q, sender, message);
      return true;
    }

    // Réponses non reconnues d'emblée (traductions VO/VF/VOSTFR, formulations différentes) :
    // l'arbitre IA lit et analyse chaque réponse
    if ((q.type === 'text' || q.type === 'image') && trimmed.length >= 3 && (session.judging || 0) < 4) {
      if (session.judgeCacheFor !== q) {
        session.judgeCacheFor = q;
        session.judgeCache = new Set();
        session.judgingBy = new Set();
      }

      const cacheKey = normalizeLoose(trimmed);
      if (cacheKey && !session.judgeCache.has(cacheKey) && !session.judgingBy.has(sender)) {
        session.judgeCache.add(cacheKey);
        session.judgingBy.add(sender);
        session.judging = (session.judging || 0) + 1;

        judgeQuizAnswer(q, trimmed)
          .then(ok => (ok ? awardAutoQuizPoint(session, q, sender, message) : false))
          .catch(() => {})
          .finally(() => {
            session.judging = Math.max(0, (session.judging || 1) - 1);
            session.judgingBy?.delete(sender);
          });
      }
    }

    return true;
  }

  return false;
}

async function handleAutoQuizCommand(jid, message, command, args, ownerCommand) {
  const sender = getMessageSender(message);

  if (command === 'quiz') {
    if (autoQuizzes.has(jid)) {
      await sendReply(
        jid,
        '🧠 Un Sitri~Quiz est déjà en cours ici. L’animateur ou le créateur peut l’arrêter avec Xend.',
        message
      );
      return;
    }

    const emojiSession = await withQuizLock(jid, () => loadQuizSession(jid));
    if (emojiSession) {
      await sendReply(
        jid,
        '🧠 Un quiz avec émoji est déjà en cours ici. Termine-le avec Xtab (ou Xend) avant de lancer Xquiz.',
        message
      );
      return;
    }

    const session = {
      chatJid: jid,
      host: sender,
      stage: 'category',
      category: null,
      total: 0,
      questions: [],
      index: -1,
      current: null,
      answered: false,
      scores: {},
      lastAt: {},
      asked: 0,
      judging: 0,
      timer: null,
      hintTimer: null,
      nextTimer: null,
      setupTimer: null
    };
    autoQuizzes.set(jid, session);

    session.setupTimer = setTimeout(async () => {
      if (autoQuizzes.get(jid) !== session || !['category', 'level', 'count'].includes(session.stage)) return;
      autoQuizzes.delete(jid);
      await quizSend(jid, { text: '⌛ Quiz annulé : pas de réponse.' }).catch(() => {});
    }, AUTO_QUIZ_SETUP_TIMEOUT_MS);

    const lines = Object.values(AUTO_QUIZ_CATEGORIES).map(
      c => `*├ ◈ ${c.icon} ${c.label} : ${c.desc}*`
    );

    const sent = await quizSend(
      jid,
      {
        text:
          `*╭─〔 ⌬ SITRI~QUIZ 〕*\n*│*\n${lines.join('\n')}\n*│*\n` +
          `*├ ◈ Réponds à ce message avec la catégorie*\n*╰━━━━━━━━━━━━━━━━━━━━━*`
      },
      { quoted: message }
    );
    session.promptId = sent?.key?.id || null;
    return;
  }

  if (command === 'end') {
    const session = autoQuizzes.get(jid);
    if (session) {
      if (!(ownerCommand || sameUser(sender, session.host))) return;
      await finishAutoQuiz(session, { stopped: true });
      return;
    }

    const emojiSession = await withQuizLock(jid, () => loadQuizSession(jid));
    if (emojiSession) {
      const allowed = ownerCommand || (emojiSession.host && sameUser(sender, emojiSession.host));
      if (!allowed) return;
      await deleteQuizSession(jid);
      await sendReply(jid, '🛑 Quiz arrêté (sans classement).', message);
      return;
    }

    await sendReply(jid, '🧠 Aucun quiz en cours ici.', message);
  }
}

// ------------------------------------------------------------
// 26. ROUTEUR PRINCIPAL
// ------------------------------------------------------------

// ------------------------------------------------------------
// MODE KAYDEN : seul le propriétaire utilise le bot (Xkayon / Xkayoff)
// ------------------------------------------------------------

async function ensureBotFlagsLoaded() {
  if (botFlagsLoaded) return;
  if (Date.now() - botFlagsLastTry < 30000) return;
  botFlagsLastTry = Date.now();

  try {
    const res = await executeDbWithRetry({
      sql: "SELECT key, value FROM bot_flags WHERE key IN ('kayden_only', 'firewall')",
      args: []
    });
    for (const row of res.rows || []) {
      if (row.key === 'kayden_only') isKaydenOnly = String(row.value || '') === '1';
      if (row.key === 'firewall') firewallConfig.enabled = String(row.value || '') === '1';
    }
    botFlagsLoaded = true;
  } catch (error) {
    logger.warn({ error: error?.message }, 'Mode Kayden : lecture impossible.');
  }
}

async function setKaydenOnly(enabled) {
  isKaydenOnly = enabled;
  botFlagsLoaded = true;
  try {
    await executeDbWithRetry({
      sql: `INSERT INTO bot_flags (key, value) VALUES ('kayden_only', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [enabled ? '1' : '0']
    });
  } catch (error) {
    logger.warn({ error: error?.message }, 'Mode Kayden : sauvegarde impossible.');
  }
}

const KNOWN_COMMANDS = new Set([
  'chat', 'ai', 'ia', 'ask', 'cerveau', 'anime', 'police', 'syp', 'spy', 'synopsis', 'sypnosis', 'info',
  'daily', 'coins', 'p', 'xp', 'rank', 'profil',
  'quiz', 'qflash', 'reponse',
  'img', 'play', 'video', 's', 'v', 'xi', 'reveal',
  'tag', 'tagall', 'htag', 'hidetag', 'onlyadmin', 'kick', 'add', 'annonce', 'clear',
  'on', 'off', 'restart', 'upt', 'menu', 'models',
  'start', 'recap', 'tab', 'end', 'kayon', 'kayoff', 'resume', 'source', 'voix', 'firewall'
]);

const COMMAND_ALIASES = { parefeu: 'firewall', antiban: 'firewall', ban: 'kick', spy: 'syp', synopsis: 'syp', sypnosis: 'syp', i: 'xi' };

async function processCommand(message) {
  const jid = message?.key?.remoteJid;

  if (!jid || jid === 'status@broadcast') return;

  const text = extractText(message);
  if (!text) return;

  const sender = getMessageSender(message);
  if (!sender) return;

  const earlyParsed = parseCommand(text);
  const earlyCommand = earlyParsed ? COMMAND_ALIASES[earlyParsed.command] || earlyParsed.command : null;
  const isKnownEarly = Boolean(earlyCommand && KNOWN_COMMANDS.has(earlyCommand));

  if (!isKnownEarly) {
    recordGroupLine(jid, message, sender, text);
  }

  if (!isKnownEarly) {
    try {
      if (await handleAutoQuizMessage(jid, message, text, sender)) return;
    } catch (error) {
      logger.warn({ error: error?.message }, 'Sitri~Quiz : message non traité.');
    }

    try {
      if (await handleQuizEmojiReply(jid, message, text)) return;
    } catch (error) {
      logger.warn({ error: error?.message }, 'Quiz points : émoji de réponse non traité.');
    }
  }

  if (!message.key?.fromMe) {
    updateMemoryFromMessage(sender, message?.pushName || '', text).catch(() => {});
    if (!isBotSleeping) {
      grantPassiveMessageXp(sender).catch(() => {});
    }
  }

  const parsed = parseCommand(text);

  if (!parsed) {
    if (
      message.key?.fromMe &&
      (text.startsWith('⌬') || text.includes('𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟') || text.includes('SITRI-NEL'))
    ) {
      return;
    }

    const isDirectNameCall = /^sitri[- ]?nel\b/i.test(text);
    const isDirectReplyToBot = isReplyToBotMessage(message) || isBotMentioned(message);

    if (isDirectNameCall || isDirectReplyToBot) {
      if (isGroupJid(jid)) {
        const allowed = await canUseOrdinaryGroupCommand(jid, sender);
        if (!allowed) {
          return;
        }
      }

      if (isDirectNameCall) {
        if (isBotSleeping) {
          return;
        }
        if (CONFIG.groqKey) {
          const cleanPrompt = text.replace(/^sitri[- ]?nel[\s,:-]*/i, '').trim() || 'Salut Sitri-Nel !';
          if (await isVoiceReplyEnabled(jid)) {
            const rawReply = await askGroq(cleanPrompt, jid, {
              senderJid: sender,
              pushName: message?.pushName || ''
            });
            await sendVoiceReply(jid, rawReply, message);
          } else {
            await handleAICommand(jid, message, sender, 'chat', cleanPrompt);
          }
        }
        return;
      }

      if (isDirectReplyToBot) {
        const chatOn = await isChatModeEnabled(jid);
        if (chatOn && CONFIG.groqKey) {
          await handleAICommand(jid, message, sender, 'chat', text);
        }
      }
    }

    return;
  }

  const { args } = parsed;
  const command = COMMAND_ALIASES[parsed.command] || parsed.command;

  if (isFirewallSpam(sender)) return;

  if (!KNOWN_COMMANDS.has(command)) {
    logger.info({ command }, 'Commande inconnue ignorée');
    return;
  }

  logger.info(
    { command, jid, fromMe: Boolean(message.key?.fromMe) },
    'Commande reçue'
  );

  const ownerCommand =
    Boolean(message.key?.fromMe) ||
    isOwnerMessage(message) ||
    isOwner(message?.key?.participant) ||
    isOwner(message?.key?.participantPn) ||
    isOwner(message?.key?.remoteJidAlt);

  if (command === 'firewall') {
    if (!ownerCommand) {
      await sendReply(jid, '⛔ Cette commande est réservée à KAY≈DEN.', message);
      return;
    }
    const sub = String(args || '').trim().toLowerCase();
    if (sub === 'on') {
      await setFirewallEnabled(true);
      await sendReply(jid, '🛡️ *Pare-feu Anti-Ban ACTIVÉ*\nDélais humains, anti-spam et ralentissement automatique actifs.', message);
    } else if (sub === 'off') {
      await setFirewallEnabled(false);
      await sendReply(jid, '⚠️ *Pare-feu Anti-Ban DÉSACTIVÉ*\nLe bot envoie sans pause : risque de bannissement plus élevé.', message);
    } else {
      await sendReply(jid, firewallStatusText(), message);
    }
    return;
  }

  if (command === 'voix') {
    const sub = String(args || '').trim().toLowerCase();
    if (sub === 'on') {
      voiceReplyChats.add(jid);
      await sendReply(
        jid,
        '🎙️ 𝗠𝗢𝗗𝗘 𝗩𝗢𝗖𝗔𝗟 𝗔𝗖𝗧𝗜𝗩𝗘́\nJe répondrai désormais en note vocale quand tu m’appelles avec *Sitri-Nel* (les commandes du menu restent en texte).',
        message
      );
      return;
    }
    if (sub === 'off') {
      voiceReplyChats.delete(jid);
      await sendReply(jid, '🔇 𝗠𝗢𝗗𝗘 𝗩𝗢𝗖𝗔𝗟 𝗗𝗘́𝗦𝗔𝗖𝗧𝗜𝗩𝗘́\nJe réponds de nouveau par écrit.', message);
      return;
    }
    if (!String(args || '').trim()) {
      await sendReply(jid, '🎙️ Utilisation :\n• *Xvoix <texte>* (je lis ton texte)\n• *Xvoix on* / *Xvoix off*', message);
      return;
    }
    await sendVoiceReply(jid, String(args).trim(), message);
    return;
  }

  if (command === 'resume') {
    await handleResumeCommand(jid, message, sender, args);
    return;
  }

  if (command === 'source') {
    await handleSourceCommand(jid, message, sender);
    return;
  }

  if (command === 'menu') {
    await sendOfficialImageWithText(jid, getMenu(), message);
    return;
  }

  if (command === 'info') {
    await sendOfficialImageWithText(jid, getInfo(), message);
    return;
  }

  if (isGroupJid(jid)) {
    const handled = await handleGroupCommand(jid, message, sender, command, args);
    if (handled) return;
  }

  if (command === 'off') {
    if (!ownerCommand) {
      await sendReply(jid, '⛔ Cette commande est réservée à KAY≈DEN.', message);
      return;
    }

    isBotSleeping = true;
    await sendReply(
      jid,
      '💤 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 𝗘𝗡 𝗩𝗘𝗜𝗟𝗟𝗘\nJe me mets en pause. Utilise Xon pour me réveiller.',
      message
    );
    return;
  }

  if (command === 'on') {
    if (!ownerCommand) {
      await sendReply(jid, '⛔ Cette commande est réservée à KAY≈DEN.', message);
      return;
    }

    isBotSleeping = false;
    await sendReply(
      jid,
      '⚡ 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 𝗥𝗘́𝗩𝗘𝗜𝗟𝗟𝗘́𝗘\nJe suis de nouveau active et prête !',
      message
    );
    return;
  }

  if (command === 'restart') {
    if (!ownerCommand) {
      await sendReply(jid, '⛔ Cette commande est réservée à KAY≈DEN.', message);
      return;
    }

    await sendReply(
      jid,
      '⌁ Redémarrage demandé par KAY≈DEN.',
      message
    );

    isShuttingDown = true;

    setTimeout(async () => {
      await releaseInstanceLock();
      process.exit(1);
    }, 1000);

    return;
  }

  if (command === 'kayon' || command === 'kayoff') {
    if (!ownerCommand) return;

    const enable = command === 'kayon';
    await setKaydenOnly(enable);
    await sendReply(
      jid,
      enable
        ? '🔒 𝗠𝗢𝗗𝗘 𝗞𝗔𝗬𝗗𝗘𝗡 𝗔𝗖𝗧𝗜𝗩𝗘́\nJe n’obéis plus qu’à toi, dans tous les groupes et en privé. Xkayoff pour me rendre aux autres.'
        : '🔓 𝗠𝗢𝗗𝗘 𝗞𝗔𝗬𝗗𝗘𝗡 𝗗𝗘́𝗦𝗔𝗖𝗧𝗜𝗩𝗘́\nTout le monde peut de nouveau me parler.',
      message
    );
    return;
  }

  if (isBotSleeping) {
    return;
  }

  if (command === 'quiz' || command === 'end') {
    await handleAutoQuizCommand(jid, message, command, args, ownerCommand);
    return;
  }

  if (['start', 'recap', 'tab'].includes(command)) {
    await handleQuizPointsCommand(jid, message, command, args, ownerCommand);
    return;
  }

  if (isGroupJid(jid) && !['upt', 'menu', 'info'].includes(command)) {
    const allowed = await canUseOrdinaryGroupCommand(jid, sender);

    if (!allowed) {
      await sendReply(
        jid,
        '⛔ Le mode Only Admin est activé. Cette commande est réservée aux administrateurs du groupe et au propriétaire.',
        message
      );
      return;
    }
  }

  if (command === 'models') {
    if (!ownerCommand) {
      await sendReply(jid, '⛔ Cette commande est réservée à KAY≈DEN.', message);
      return;
    }

    const activeAiInfo = CONFIG.groqKey
      ? `Groq actif : ${CONFIG.groqModel}`
      : 'Groq non configuré';

    const ids = CONFIG.groqKey ? await listGroqModels() : [];

    await sendReply(
      jid,
      `🔎 Configuration IA\n\n${activeAiInfo}\n\nModèles Groq (${ids.length}) :\n${ids.slice(0, 15).join('\n')}`.trim(),
      message
    );
    return;
  }

  if (command === 'upt') {
    await sendReply(jid, getUptimeText(), message);
    return;
  }

  if (command === 'reveal') {
    await revealViewOnceMessage(jid, message);
    return;
  }

  if (command === 's') {
    await convertImageToSticker(jid, message);
    return;
  }

  if (command === 'v') {
    await revealViewOnceMessage(jid, message);
    return;
  }

  if (command === 'xi') {
    await convertStickerToImage(jid, message);
    return;
  }

  if (command === 'play' || command === 'video') {
    await handlePlayOrVideoCommand(jid, message, command, args);
    return;
  }

  if (await handleEconomyCommand(jid, message, sender, command)) return;
  if (await handleQuizCommand(jid, message, sender, command, args)) return;
  if (await handleAICommand(jid, message, sender, command, args)) return;
  if (await handleMediaCommand(jid, message, command, args)) return;
}

async function handleIncomingMessage(message) {
  if (!message?.key?.id) return;

  const timestamp = Number(message.messageTimestamp || 0) * 1000;

  if (timestamp && Date.now() - timestamp > CONFIG.maxMessageAge) {
    logger.info(
      { ageSeconds: Math.round((Date.now() - timestamp) / 1000) },
      'Message ignoré : trop ancien'
    );
    return;
  }

  if (hasProcessedMessage(message)) return;

  const requestId = message.key.id;
  if (activeRequests.has(requestId)) return;

  activeRequests.add(requestId);

  try {
    await processCommand(message);
  } catch (error) {
    logger.error(
      { error: error?.message || String(error), messageId: requestId },
      'Erreur pendant le traitement du message.'
    );

    const jid = message?.key?.remoteJid;

    if (jid && sock) {
      try {
        await sendReply(
          jid,
          '⚠️ Une erreur est survenue pendant le traitement de cette commande. Réessaie dans quelques instants.',
          message
        );
      } catch (sendError) {
        logger.error({ error: sendError?.message }, 'Impossible d’envoyer le message d’erreur.');
      }
    }
  } finally {
    activeRequests.delete(requestId);
  }
}

// ------------------------------------------------------------
// 26 bis. VERROU : UNE SEULE INSTANCE CONNECTÉE À LA FOIS
// ------------------------------------------------------------

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const INSTANCE_ID = `${process.pid}-${Date.now()}`;
const LOCK_TTL_MS = 45000;

const LOCK_SQL = `INSERT INTO bot_lock (id, owner, expires_at)
  VALUES ('main', ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    owner = excluded.owner,
    expires_at = excluded.expires_at
  WHERE bot_lock.expires_at <= ? OR bot_lock.owner = excluded.owner
  RETURNING owner`;

async function tryTakeLock() {
  const now = Date.now();

  const result = await executeDbWithRetry({
    sql: LOCK_SQL,
    args: [INSTANCE_ID, now + LOCK_TTL_MS, now]
  });

  return result.rows.length > 0;
}

async function acquireInstanceLock() {
  for (;;) {
    if (await tryTakeLock()) {
      logger.info('Verrou obtenu : cette instance est la seule connectée.');
      return;
    }

    logger.warn('Une autre instance du bot est déjà active (verrou). Attente avant de se connecter...');
    await sleep(5000);
  }
}

async function renewInstanceLock() {
  if (isShuttingDown) return;

  try {
    if (!(await tryTakeLock())) {
      logger.error('Verrou perdu : une autre instance a pris la main. Arrêt de celle-ci.');
      process.exit(1);
    }
  } catch (error) {
    logger.warn({ error: error?.message }, 'Renouvellement du verrou impossible pour le moment.');
  }
}

async function releaseInstanceLock() {
  try {
    await Promise.race([
      db.execute({
        sql: "DELETE FROM bot_lock WHERE id = 'main' AND owner = ?",
        args: [INSTANCE_ID]
      }),
      sleep(3000)
    ]);
  } catch {
    // Le verrou expirera tout seul.
  }
}

// ------------------------------------------------------------
// 27. CONNEXION WHATSAPP : PAIRING CODE ET RECONNEXION
// ------------------------------------------------------------

let reconnectTimer = null;
let startPromise = null;
let pairingRequested = false;
let reconnectAttempts = 0;
let loggedOutCount = 0;

const RECONNECT_DELAY = 5000;

let pairingTimer = null;
let pairingCodeText = '';
let pairingCodeAt = 0;

function stopPairingTimer() {
  if (pairingTimer) {
    clearInterval(pairingTimer);
    pairingTimer = null;
  }

  pairingCodeText = '';
  pairingCodeAt = 0;
}

function showPairingCode(code, ageMs) {
  console.log('\n');
  console.log('╔══════════════════════════════════╗');
  console.log('║       SITRI-NEL PAIRING CODE      ║');
  console.log('╠══════════════════════════════════╣');
  console.log(`║           ${code}           ║`);
  console.log('╚══════════════════════════════════╝');
  console.log('\n');

  logger.info(
    `CODE DE JUMELAGE : ${code} — demandé il y a ${formatDuration(Math.round(ageMs / 1000))}`
  );
}

async function requestPairingCode(socket) {
  if (!socket || socket !== sock) return;

  if (socket.authState?.creds?.registered || socket.authState?.creds?.me) {
    stopPairingTimer();
    return;
  }

  if (!CONFIG.pairingNumber) {
    logger.error('PAIRING_NUMBER absent. Ajoute-le dans les variables Railway (ex : 229XXXXXXXX).');
    return;
  }

  const age = Date.now() - pairingCodeAt;

  if (pairingCodeText && age < CONFIG.pairingRefreshMs) {
    showPairingCode(pairingCodeText, age);
    return;
  }

  const custom = CONFIG.pairingCode.length === 8 ? CONFIG.pairingCode : '';

  try {
    const rawCode = custom
      ? await socket.requestPairingCode(CONFIG.pairingNumber, custom)
      : await socket.requestPairingCode(CONFIG.pairingNumber);

    if (custom && String(rawCode).toUpperCase() !== custom) {
      logger.warn('Cette version de Baileys ignore PAIRING_CODE : un code aléatoire est utilisé.');
    }

    pairingCodeText = String(rawCode).match(/.{1,4}/g)?.join('-') || String(rawCode);
    pairingCodeAt = Date.now();

    showPairingCode(pairingCodeText, 0);
  } catch (error) {
    pairingRequested = false;
    logger.error({ error: error?.message || String(error) }, 'Échec de la génération du pairing code.');
  }
}

function scheduleReconnect(minDelay = 0) {
  if (isShuttingDown) return;
  if (reconnectTimer) return;

  reconnectAttempts++;

  const delay = Math.max(
    minDelay,
    Math.min(RECONNECT_DELAY * reconnectAttempts, 30000)
  );

  logger.warn(`Nouvelle tentative de connexion dans ${delay / 1000} secondes.`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    try {
      await startBot();
    } catch (error) {
      logger.error({ error: error?.message }, 'Échec de la reconnexion.');
      scheduleReconnect();
    }
  }, delay);
}

async function startBot() {
  if (isShuttingDown) return;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    connectionStatus = 'Connexion en cours';
    pairingRequested = false;

    logger.info('Initialisation de Sitri-Nel...');

    await initDatabase();

    const { state, saveCreds } = USE_TURSO
      ? await useDatabaseAuthState()
      : await useMultiFileAuthState(SESSION_DIR);

    let version;

    try {
      if (typeof Baileys.fetchLatestBaileysVersion === 'function') {
        const latest = await Baileys.fetchLatestBaileysVersion();
        version = latest?.version;
      }
    } catch (error) {
      logger.warn({ error: error?.message }, 'Version WhatsApp non récupérée, valeur par défaut utilisée.');
    }

    const keys =
      typeof Baileys.makeCacheableSignalKeyStore === 'function'
        ? Baileys.makeCacheableSignalKeyStore(state.keys, baileysLogger)
        : state.keys;

    const browser =
      Baileys.Browsers && typeof Baileys.Browsers.ubuntu === 'function'
        ? Baileys.Browsers.ubuntu('Chrome')
        : ['Ubuntu', 'Chrome', '22.04.4'];

    const recentMessages = new Map();
    const rememberMessage = msg => {
      const id = msg?.key?.id;
      if (!id || !msg?.message) return;
      recentMessages.set(id, msg.message);
      if (recentMessages.size > 1000) {
        recentMessages.delete(recentMessages.keys().next().value);
      }
    };

    const socket = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: state.creds, keys },
      logger: baileysLogger,
      browser,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      qrTimeout: 300000,
      retryRequestDelayMs: 500,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      getMessage: async key => {
        if (!key?.id) return undefined;
        return recentMessages.get(key.id) || undefined;
      }
    });

    const rawSend = socket.sendMessage.bind(socket);

    socket.sendMessage = async (jid, content, options) => {
      await applyFirewallDelay(socket, jid, content);
      if (content && typeof content === 'object') {
        const next = { ...content };

        if (typeof next.text === 'string') next.text = styleText(next.text);
        if (typeof next.caption === 'string') next.caption = styleText(next.caption);

        return rawSend(jid, next, options);
      }

      return rawSend(jid, content, options);
    };

    sock = socket;

    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (error) {
        logger.error({ error: error?.message }, 'Impossible de sauvegarder la session.');
      }
    });

    const triggerPairingFlow = async () => {
      if (state.creds.registered || pairingTimer || pairingRequested) return;
      pairingRequested = true;
      await sleep(2500);
      if (socket !== sock || state.creds.registered) return;
      await requestPairingCode(socket);
      pairingTimer = setInterval(() => requestPairingCode(socket), 20000);
    };

    socket.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update;

      if ((qr || connection === 'connecting') && !state.creds.registered && !pairingTimer) {
        triggerPairingFlow().catch(err =>
          logger.error({ error: err?.message }, 'Erreur lors du lancement du pairing code.')
        );
      }

      if (connection === 'connecting') {
        connectionStatus = 'Connexion en cours';
        logger.info('Connexion à WhatsApp...');
      }

      if (connection === 'open') {
        connectionStatus = 'Connecté';
        stopPairingTimer();
        reconnectAttempts = 0;
        loggedOutCount = 0;
        pairingRequested = true;

        botJid = normalizeJid(socket.user?.id || '');
        botLid = normalizeJid(socket.user?.lid || socket.authState?.creds?.me?.lid || '');
        botNumber = getNumber(botJid);

        logger.info(`Sitri-Nel connecté : ${botNumber || botJid}`);

        console.log('\n⌬ SITRI-NEL EST EN LIGNE\n');
      }

      if (connection === 'close') {
        connectionStatus = 'Déconnecté';
        stopPairingTimer();

        const statusCode = lastDisconnect?.error?.output?.statusCode;

        logger.warn(`Connexion fermée. Code : ${statusCode || 'inconnu'}`);

        if (sock === socket) sock = null;
        if (isShuttingDown) return;

        if (statusCode === DisconnectReason.loggedOut) {
          loggedOutCount++;

          if (loggedOutCount < 2) {
            logger.warn('Déconnexion 401 : nouvel essai avec la même session avant tout nettoyage.');
            scheduleReconnect(15000);
            return;
          }

          connectionStatus = 'Session invalide : nouveau jumelage';
          loggedOutCount = 0;

          logger.error('Session WhatsApp invalide (401 répété). Nettoyage et nouveau jumelage.');

          await clearAuthState();
          scheduleReconnect(10000);
          return;
        }

        if (statusCode === DisconnectReason.connectionReplaced) {
          logger.warn('Session remplacée par une autre connexion.');
          scheduleReconnect(30000);
          return;
        }

        scheduleReconnect();
      }
    });

    socket.ev.on('messages.upsert', async event => {
      if (!event?.messages?.length) return;

      const firstKey = event.messages[0]?.key || {};

      logger.info(
        {
          type: event.type,
          count: event.messages.length,
          jid: firstKey.remoteJid,
          fromMe: firstKey.fromMe,
          participant: firstKey.participant
        },
        'Événement de messages reçu'
      );

      if (!['notify', 'append'].includes(event.type)) return;

      for (const message of event.messages) {
        if (!message?.message) continue;

        // Mode Kayden : tous les messages des autres sont ignorés, partout
        await ensureBotFlagsLoaded();
        if (isKaydenOnly && !isOwnerMessage(message)) continue;

        const quizReaction = unwrapContent(message)?.reactionMessage;
        if (quizReaction) {
          applyQuizReaction({
            chatJid: message.key?.remoteJid,
            targetKey: quizReaction.key,
            emoji: quizReaction.text,
            byJid: getMessageSender(message)
          }).catch(error =>
            logger.warn({ error: error?.message }, 'Quiz points : réaction non traitée.')
          );
          continue;
        }

        rememberMessage(message);
        try {
          await handleIncomingMessage(message);
        } catch (error) {
          logger.error({ error: error?.message }, 'Erreur de réception du message.');
        }
      }
    });

    socket.ev.on('messages.reaction', async events => {
      for (const item of events || []) {
        try {
          const reactorKey = item?.reaction?.key || {};
          const byJid = getMessageSender({
            key: { ...reactorKey, remoteJid: reactorKey.remoteJid || item?.key?.remoteJid }
          });

          await applyQuizReaction({
            chatJid: item?.key?.remoteJid,
            targetKey: item?.key,
            emoji: item?.reaction?.text,
            byJid
          });
        } catch (error) {
          logger.warn({ error: error?.message }, 'Quiz points : réaction non traitée.');
        }
      }
    });

    logger.info('Écoute des événements WhatsApp activée.');
  })();

  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
}

// ------------------------------------------------------------
// 28. ARRÊT PROPRE ET PROTECTION CONTRE LES CRASHS
// ------------------------------------------------------------

async function shutdown(signal) {
  if (isShuttingDown) return;

  isShuttingDown = true;
  connectionStatus = 'Arrêt en cours';

  logger.warn(`Arrêt demandé : ${signal}`);

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  try {
    if (sock?.ws) sock.ws.close();
  } catch (error) {
    logger.error({ error: error?.message }, 'Erreur pendant la fermeture WhatsApp.');
  }

  connectionStatus = 'Arrêté';

  await releaseInstanceLock();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', reason => {
  logger.error({ error: reason?.message || String(reason) }, 'Promesse rejetée non gérée.');
});

process.on('uncaughtException', error => {
  logger.error({ error: error?.message || String(error) }, 'Exception non gérée.');
});

// ------------------------------------------------------------
// 29. LANCEMENT
// ------------------------------------------------------------

const BOOT_DELAY_MS = Number(process.env.BOOT_DELAY_MS || 3000);

async function boot() {
  for (;;) {
    try {
      await initDatabase();
      await acquireInstanceLock();
      break;
    } catch (error) {
      logger.error(
        { error: error?.message || String(error) },
        'Démarrage : base de données indisponible, nouvel essai dans 5 secondes.'
      );
      await sleep(5000);
    }
  }

  setInterval(renewInstanceLock, 15000);

  try {
    await startBot();
  } catch (error) {
    logger.error({ error: error?.message || String(error) }, 'Impossible de démarrer Sitri-Nel.');
    scheduleReconnect();
  }
}

logger.info(`Démarrage dans ${BOOT_DELAY_MS / 1000} secondes...`);

setTimeout(boot, BOOT_DELAY_MS);
