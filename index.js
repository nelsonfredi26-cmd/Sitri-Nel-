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

function buildSystemPrompt(userProfile = {}) {
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
- Créateur : KAY≈DEN (tu le reconnais immédiatement comme ton créateur avec fierté, humour et complicité).
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

  if (key.fromMe) {
    return normalizeJid(
      botJid ||
        sock?.user?.id ||
        key.participant ||
        (CONFIG.pairingNumber ? `${CONFIG.pairingNumber}@s.whatsapp.net` : '') ||
        key.remoteJid ||
        ''
    );
  }

  const isGroup = isGroupJid(key.remoteJid);

  const raw = isGroup
    ? pickPhoneJid(key.participantPn, key.participantAlt, key.participant)
    : pickPhoneJid(key.senderPn, key.remoteJidAlt, key.remoteJid);

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

function getMenu() {
  return `⟢ 𝗔𝗥𝗧𝗜𝗙𝗜𝗖𝗜𝗔𝗟 𝗜𝗡𝗧𝗘𝗟𝗟𝗜𝗚𝗘𝗡𝗖𝗘 ⟣

━━━━━━━━━━━━━━━━━━━━━━━
       ✎𝗠𝗔𝗜𝗡 𝗖𝗢𝗡𝗧𝗥𝗢𝗟 𝗣𝗔𝗡𝗘𝗟
━━━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟭 ⌬ 𝗖𝗢𝗚𝗡𝗜𝗧𝗜𝗩𝗘 〕
│
├ ◈ 𝚇𝚌𝚑𝚊𝚝 𝚘𝚗 / 𝚘𝚏𝚏
├ ◈ 𝚇𝚊𝚜𝚔
├ ◈ 𝚇𝚊𝚒
├ ◈ 𝚇𝚊𝚗𝚒𝚖𝚎
├ ◈ 𝚇𝚜𝚢𝚙 (𝚜𝚢𝚗𝚘𝚙𝚜𝚒𝚜)
├ ◈ 𝚇𝚙𝚘𝚕𝚒𝚌𝚎
├ ◈ 𝚇𝚒𝚗𝚏𝚘
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟮 ⌬ 𝗘𝗖𝗢𝗡𝗢𝗠𝗬 〕
│
├ ◈ 𝚇𝚍𝚊𝚒𝚕𝚢
├ ◈ 𝚇𝚌𝚘𝚒𝚗𝚜
├ ◈ 𝚇𝚙
├ ◈ 𝚇𝚛𝚊𝚗𝚔
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟯 ⌬ 𝗘𝗡𝗧𝗘𝗥𝗧𝗔𝗜𝗡𝗠𝗘𝗡𝗧 〕
│
╰ ◈ 𝚇𝚚𝚞𝚒𝚣
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟰 ⌬ 𝗠𝗨𝗟𝗧𝗜𝗠𝗘𝗗𝗜𝗔 〕
│
├ ◈ 𝚇𝚒𝚖𝚐
├ ◈ 𝚇𝚜 (𝚜𝚝𝚒𝚌𝚔𝚎𝚛)
├ ◈ 𝚇𝚟 (𝚟𝚞𝚎 𝚞𝚗𝚒𝚚𝚞𝚎)
├ ◈ 𝚇𝚒 (𝚜𝚝𝚒𝚌𝚔𝚎𝚛 ➜ 𝚒𝚖𝚊𝚐𝚎)
├ ◈ 𝚇𝚙𝚕𝚊𝚢
├ ◈ 𝚇𝚟𝚒𝚍𝚎𝚘
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟱 ⌬ 𝗜𝗗𝗘𝗡𝗧𝗜𝗧𝗬 〕
│
╰ ◈ 𝚇𝚙𝚛𝚘𝚏𝚒𝚕
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟲 ⌬ 𝗡𝗘𝗧𝗪𝗢𝗥𝗞 〕
│
├ ◈ 𝚇𝚝𝚊𝚐𝚊𝚕𝚕
├ ◈ 𝚇𝚑𝚝𝚊𝚐
├ ◈ 𝚇𝚊𝚗𝚗𝚘𝚗𝚌𝚎
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟳 ⌬ 𝗖𝗢𝗡𝗧𝗥𝗢𝗟 〕
│
├ ◈ 𝚇𝚔𝚒𝚌𝚔
├ ◈ 𝚇𝚊𝚍𝚍
├ ◈ 𝚇𝚌𝚕𝚎𝚊𝚛
├ ◈ 𝚇𝚘𝚗
├ ◈ 𝚇𝚘𝚏𝚏
├ ◈ 𝚇𝚛𝚎𝚜𝚝𝚊𝚛𝚝
├ ◈ 𝚇𝚘𝚗𝚕𝚢𝚊𝚍𝚖𝚒𝚗
│
╰━━━━━━━━━━━━━━━━━━━━━

╭─〔 𝟬𝟴 ⌬ 𝗦𝗬𝗦𝗧𝗘𝗠 〕
│
├ ◈ 𝚇𝚞𝚙𝚝
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
      .filter(id => !/whisper|guard|tts|audio|distil|prompt-guard/i.test(id));
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
    : '👑 Rang maximal atteint : Legend'
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
  const displayName =
    mem.name ||
    (targetJid === sender ? getDisplayName(message, targetJid) : getNumber(targetJid) || 'Utilisateur');

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
    return { success: false, message: 'Aucun quiz actif. Lance Xquiz pour commencer.' };
  }

  const quiz = existing.rows[0];

  if (Number(quiz.expires_at) <= now) {
    await db.execute({
      sql: `DELETE FROM active_quizzes WHERE group_jid = ? AND expires_at <= ?`,
      args: [chatJid, now]
    });

    return {
      success: false,
      message: `⌛ Le temps du quiz est écoulé ! La bonne réponse était : ${quiz.answer}.\nLance un nouveau Xquiz.`
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
      'https://pipedapi.moomoo.me',
      'https://api.piped.private.coffee',
      'https://pipedapi.leptons.xyz'
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
      'https://invidious.privacyredirect.com',
      'https://invidious.protokolla.fi',
      'https://yewtu.be'
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

// Binaire autonome de yt-dlp (sans Python), téléchargé au besoin
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const YTDLP_BIN = path.join(os.tmpdir(), 'sitri-nel-ytdlp', 'yt-dlp');
let ytdlpReadyPromise = null;

async function runBinary(file, args, options = {}) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  return promisify(execFile)(file, args, { maxBuffer: 25 * 1024 * 1024, ...options });
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

// Cookies YouTube : fichier cookies.txt local, base64 (YOUTUBE_COOKIES_BASE64),
// ou texte collé tel quel (YOUTUBE_COOKIES) : format Netscape ou "nom=valeur; nom2=valeur2"
function buildYoutubeCookiesFile() {
  const localCookiesFile = path.join(ROOT_DIR, 'cookies.txt');
  let raw = '';

  const b64 = cleanEnv(process.env.YOUTUBE_COOKIES_BASE64);
  if (b64) {
    raw = Buffer.from(b64, 'base64').toString('utf8');
  } else if (String(process.env.YOUTUBE_COOKIES || '').trim()) {
    raw = String(process.env.YOUTUBE_COOKIES || '').trim();
  } else if (fs.existsSync(localCookiesFile)) {
    try {
      raw = fs.readFileSync(localCookiesFile, 'utf8').trim();
    } catch {
      raw = '';
    }
  }

  if (!raw) return '';

  if (!raw.includes('\n') && raw.includes('\\n')) raw = raw.replace(/\\n/g, '\n');

  if (raw.startsWith('# Netscape') || raw.includes('\t')) {
    return raw.endsWith('\n') ? raw : `${raw}\n`;
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

// Téléchargement audio avec yt-dlp (multi-clients + fallback anti-"The page needs to be reloaded")
// Téléchargement audio avec yt-dlp (multi-clients + fallback format souple)
async function downloadAudioWithYtdlp(videoUrl) {
  lastYtdlpFailure = '';

  let bin;
  try {
    bin = await ensureYtdlpBinary();
  } catch (error) {
    lastYtdlpFailure = `Binaire yt-dlp indisponible : ${String(error?.message || error).slice(0, 200)}`;
    return null;
  }

  const dir = path.join(os.tmpdir(), 'sitri-nel-play');
  fs.mkdirSync(dir, { recursive: true });

  const cookiesContent = buildYoutubeCookiesFile();
  let ffmpegBin = '';
  try {
    const ffmpegStatic = await import('ffmpeg-static');
    if (ffmpegStatic.default) ffmpegBin = ffmpegStatic.default;
  } catch {
    // sans ffmpeg : on garde le format d'origine
  }

  const maxMb = Math.floor(CONFIG.maxMediaBytes / (1024 * 1024));

  // Clients yt-dlp compatibles avec les formats actuels YouTube (évite "Requested format is not available")
  const extractorProfiles = [
    {
      name: 'default+mweb',
      extractorArgs: null,
      format: 'ba/b'
    },
    {
      name: 'tv_embedded',
      extractorArgs: 'youtube:player_client=tv_embedded',
      format: 'ba/b'
    },
    {
      name: 'ios+web',
      extractorArgs: 'youtube:player_client=ios,web',
      format: 'ba/b'
    },
    {
      name: 'android_vr',
      extractorArgs: 'youtube:player_client=android_vr',
      format: 'ba/b'
    }
  ];

  const mimeByExt = {
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg; codecs=opus',
    opus: 'audio/ogg; codecs=opus',
    webm: 'audio/webm'
  };

  for (const profile of extractorProfiles) {
    const base = `play_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let cookiesPath = null;

    try {
      const args = [
        videoUrl,
        '-o', path.join(dir, `${base}.%(ext)s`),
        '-f', profile.format,
        '--no-playlist',
        '--no-warnings',
        '--no-check-certificates',
        '--geo-bypass',
        '--force-ipv4',
        '--retries', '2',
        '--fragment-retries', '2',
        '--socket-timeout', '20',
        '--max-filesize', `${maxMb}M`,
        '--add-header', 'Accept-Language:fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        '--add-header', 'Referer:https://www.youtube.com/'
      ];

      if (profile.extractorArgs) {
        args.push('--extractor-args', profile.extractorArgs);
      }

      if (ffmpegBin) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '5', '--ffmpeg-location', ffmpegBin);
      }

      if (cookiesContent) {
        cookiesPath = path.join(dir, `${base}_cookies.txt`);
        fs.writeFileSync(cookiesPath, cookiesContent);
        args.push('--cookies', cookiesPath);
      }

      await runBinary(bin, args, { timeout: 90000 });

      const file = fs.readdirSync(dir).find(n => n.startsWith(base) && !n.endsWith('_cookies.txt'));
      if (!file) {
        lastYtdlpFailure = `[${profile.name}] Aucun fichier audio produit.`;
        continue;
      }

      const ext = path.extname(file).slice(1).toLowerCase();
      const mimetype = mimeByExt[ext] || 'audio/mp4';
      const buffer = fs.readFileSync(path.join(dir, file));

      if (!buffer.length || buffer.length > CONFIG.maxMediaBytes) {
        lastYtdlpFailure = `[${profile.name}] Fichier audio vide ou trop gros.`;
        continue;
      }

      return { buffer, mimetype };
    } catch (error) {
      const detail = String(error?.stderr || error?.message || '');
      const errLine =
        detail.split('\n').reverse().find(l => l.includes('ERROR')) ||
        detail.split('\n').filter(Boolean).pop() ||
        detail;
      lastYtdlpFailure = `[${profile.name}] ${errLine.trim().slice(0, 260)}`;
      logger.warn({ profile: profile.name, error: lastYtdlpFailure }, 'yt-dlp : tentative audio échouée.');
    } finally {
      try {
        for (const f of fs.readdirSync(dir)) {
          if (f.startsWith(base)) fs.unlinkSync(path.join(dir, f));
        }
      } catch {}
    }
  }

  return null;
}

// Secours : flux Cobalt/Piped/Invidious puis recherche directe sur Audius
async function downloadAudioFallbackFromWeb(query, videoUrl) {
  const resolved = await resolveStreamUrl(videoUrl, 'audio');
  if (resolved?.streamUrl) {
    try {
      const dl = await axios.get(resolved.streamUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: CONFIG.maxMediaBytes,
        maxBodyLength: CONFIG.maxMediaBytes,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          Referer: 'https://www.youtube.com/'
        }
      });
      const buf = Buffer.from(dl.data);
      const headerMime = String(dl.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
      const mime = headerMime || resolved.mime || 'audio/mp4';
      if (buf.length > 1024 && buf.length <= CONFIG.maxMediaBytes) {
        return {
          buffer: buf,
          mimetype: mime.startsWith('audio/') ? mime : 'audio/mp4'
        };
      }
    } catch (err) {
      logger.warn({ error: err?.message }, 'Flux direct resolveStreamUrl impossible.');
    }
  }

  const cleanSearch = String(query || '')
    .replace(/\((?:official|audio|video|lyrics|slowed|reverb|clip|hd|4k)[^)]*\)/gi, '')
    .replace(/\[(?:official|audio|video|lyrics|slowed|reverb|clip|hd|4k)[^\]]*\]/gi, '')
    .trim();

  if (cleanSearch) {
    const audiusHosts = [
      'https://discoveryprovider.audius.co',
      'https://discoveryprovider2.audius.co',
      'https://audius-discovery-1.cultur3stake.com'
    ];
    for (const host of audiusHosts) {
      try {
        const searchRes = await axios.get(`${host}/v1/tracks/search`, {
          params: { query: cleanSearch, app_name: 'SitriNelBot' },
          timeout: 8000
        });
        const track = (searchRes.data?.data || []).find(t => t?.id && t?.is_streamable !== false);
        if (track?.id) {
          const streamRes = await axios.get(`${host}/v1/tracks/${track.id}/stream`, {
            params: { app_name: 'SitriNelBot' },
            responseType: 'arraybuffer',
            timeout: 25000,
            maxContentLength: CONFIG.maxMediaBytes,
            maxBodyLength: CONFIG.maxMediaBytes,
            maxRedirects: 5
          });
          const buf = Buffer.from(streamRes.data);
          if (buf.length > 4096 && buf.length <= CONFIG.maxMediaBytes) {
            return {
              buffer: buf,
              mimetype: 'audio/mpeg',
              matchedTitle: `${track.title}${track.user?.name ? ` - ${track.user.name}` : ''}`
            };
          }
        }
      } catch {
        // Host suivant
      }
    }
  }

  return null;
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
      ? `🎵 Recherche et téléchargement audio pour : "${query}"...`
      : `🎬 Recherche vidéo en cours pour : "${query}" (max 3 min)...`,
    message
  );

  // Permet aussi de coller directement un lien YouTube après Xplay / Xvideo
  const directId = extractYouTubeId(query);
  const results = directId
    ? [{ title: query, url: `https://www.youtube.com/watch?v=${directId}` }]
    : await searchYouTubeCandidates(query);

  const candidates = results.slice(0, 3);

  if (!candidates.length) {
    await sendReply(
      jid,
      `⚠️ Aucun résultat trouvé pour "${query}". Réessaie avec un titre plus précis.`,
      message
    );
    return true;
  }

  const top = candidates[0];

  if (isAudio) {
    for (const candidate of candidates) {
      const audio = await downloadAudioWithYtdlp(candidate.url);
      if (audio?.buffer) {
        await sock.sendMessage(
          jid,
          {
            audio: audio.buffer,
            mimetype: audio.mimetype,
            ptt: false
          },
          { quoted: message }
        );
        await sendReply(jid, `🎶 *${candidate.title}*\n\n${SIGNATURE}`, message);
        return true;
      }
    }

    const fallbackAudio = await downloadAudioFallbackFromWeb(query, top.url);
    if (fallbackAudio?.buffer) {
      await sock.sendMessage(
        jid,
        {
          audio: fallbackAudio.buffer,
          mimetype: fallbackAudio.mimetype,
          ptt: false
        },
        { quoted: message }
      );
      await sendReply(
        jid,
        `🎶 *${fallbackAudio.matchedTitle || top.title}*\n\n${SIGNATURE}`,
        message
      );
      return true;
    }
  } else {
    const resolved = await resolveStreamUrl(top.url, 'video');

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
        const mime = headerMime || resolved.mime || 'video/mp4';

        if (buf.length > 0 && buf.length <= CONFIG.maxMediaBytes) {
          await sock.sendMessage(
            jid,
            {
              video: buf,
              mimetype: mime.startsWith('video/') ? mime : 'video/mp4',
              caption: `🎬 *${top.title}*\n\n${SIGNATURE}`
            },
            { quoted: message }
          );
          return true;
        }
      } catch (dlErr) {
        logger.warn({ error: dlErr?.message }, 'Téléchargement direct vidéo impossible, repli sur le lien.');
      }
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

async function multimediaNotIntegrated(jid, message, command, args = '') {
  return handlePlayOrVideoCommand(jid, message, command, args);
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
  if (command === 'quiz') {
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

  await sendReply(
    jid,
    formatAIReply(
      getResultText(answer, 'Je n’ai pas pu produire de réponse pour le moment.')
    ),
    message
  );

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

  if (command === 'play' || command === 'video') {
    await handlePlayOrVideoCommand(jid, message, command, args);
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
function buildQuizBoard({ title, rows }) {
  const out = [`*╭─〔 ⌬ ${title} 〕*`, '*│*'];
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
  cg: { label: 'CG', icon: '🧠', desc: 'culture générale' }
};
const AUTO_QUIZ_COUNTS = [10, 20, 30];
const AUTO_QUIZ_TIME_MS = 30000;
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

function fuzzyEqual(a, b) {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  if (len <= 4) return false;
  const maxD = len <= 7 ? 1 : 2;
  if (Math.abs(a.length - b.length) > maxD) return false;
  return levenshtein(a, b) <= maxD;
}

const QUIZ_STOPWORDS = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'et', 'the', 'of', 'a', 'an', 'au', 'aux', 'en']);

function significantTokens(value) {
  return normalizeLoose(value)
    .split(' ')
    .filter(token => token && !QUIZ_STOPWORDS.has(token));
}

function isQuizAnswerCorrect(submitted, question) {
  const sub = normalizeLoose(submitted);
  if (!sub) return false;

  const subTokens = significantTokens(submitted);
  const candidates = [question.answer, ...(question.alts || [])]
    .map(normalizeLoose)
    .filter(Boolean);

  for (const cand of candidates) {
    if (sub === cand || fuzzyEqual(sub, cand)) return true;

    const candTokens = significantTokens(cand);
    if (!candTokens.length || !subTokens.length) continue;

    // Tous les mots attendus sont retrouvés (ordre libre, fautes légères)
    if (candTokens.every(ct => subTokens.some(st => fuzzyEqual(st, ct)))) return true;

    // Personnage : un seul mot du nom suffit (prénom ou nom)
    if (
      question.type === 'image' &&
      subTokens.length === 1 &&
      subTokens[0].length >= 3 &&
      candTokens.some(ct => ct.length >= 3 && fuzzyEqual(subTokens[0], ct))
    ) {
      return true;
    }
  }

  return false;
}

// --- Génération des questions

async function groqJson(prompt, maxTokens = 3500) {
  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: CONFIG.groqModel,
      messages: [
        {
          role: 'system',
          content: 'Tu es un générateur de quiz rigoureux. Tu réponds uniquement par un objet JSON valide.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.6,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' }
    },
    { headers: { Authorization: `Bearer ${CONFIG.groqKey}` }, timeout: 45000 }
  );
  return JSON.parse(res.data?.choices?.[0]?.message?.content || '{}');
}

async function generateTextQuizQuestions(category, total) {
  const questions = [];
  const usedTopics = [];
  let attempts = 0;

  while (questions.length < total && attempts < 6) {
    attempts++;
    const need = Math.min(10, total - questions.length);

    const alts =
      'Dans "alts", mets les autres écritures acceptables de la réponse (orthographes ou traductions réellement utilisées, sans rien inventer), sinon une liste vide.';
    const prompt =
      category === 'multivers'
        ? `Génère exactement ${need} questions de quiz en français sur les animés et mangas.
Règles :
- une seule question par univers : chaque question porte sur un anime/manga DIFFÉRENT ;
- difficulté moyenne : ni trop facile (pas de question que tout le monde connaît), ni très difficile ;
- réponse courte (1 à 4 mots), précise et incontestable ;
- ne pose que des questions dont tu es absolument certain de la réponse, n'invente rien ;
- la réponse ne doit pas apparaître dans la question.
Univers déjà utilisés (interdits) : ${usedTopics.join(', ') || 'aucun'}.
${alts}
Réponds en JSON : {"questions":[{"univers":"nom de l'anime","question":"...","answer":"...","alts":["..."]}]}`
        : `Génère exactement ${need} questions de culture générale en français.
Règles :
- sujets variés (géographie, histoire, sciences, arts, littérature, sport, nature, technologie) ;
- difficulté moyenne : ni trop facile, ni très difficile ;
- réponse courte (1 à 4 mots), précise et incontestable ;
- ne pose que des questions dont tu es absolument certain de la réponse, n'invente rien ;
- la réponse ne doit pas apparaître dans la question.
Questions déjà posées (interdites) : ${questions.map(q => q.question).slice(-30).join(' | ') || 'aucune'}.
${alts}
Réponds en JSON : {"questions":[{"question":"...","answer":"...","alts":["..."]}]}`;

    try {
      const data = await groqJson(prompt);
      const list = Array.isArray(data.questions) ? data.questions : [];

      for (const item of list) {
        const question = String(item?.question || '').trim();
        const answer = String(item?.answer || '').trim();
        if (!question || !answer || answer.length > 60) continue;

        const key = normalizeLoose(question);
        if (questions.some(q => normalizeLoose(q.question) === key)) continue;

        if (category === 'multivers' && item?.univers) {
          const topic = normalizeLoose(item.univers);
          if (topic && usedTopics.includes(topic)) continue;
          if (topic) usedTopics.push(topic);
        }

        questions.push({
          type: 'text',
          question,
          answer,
          alts: Array.isArray(item?.alts) ? item.alts.map(String).slice(0, 8) : []
        });

        if (questions.length >= total) break;
      }
    } catch (error) {
      logger.warn({ error: error?.message }, 'Sitri~Quiz : génération de questions échouée.');
    }
  }

  return questions;
}

async function generateIdQuizQuestions(total) {
  // Pages 3 à 30 du classement des personnages : connus, mais pas les plus évidents
  const pages = new Set();
  const wanted = Math.ceil(total / 7) + 1;
  while (pages.size < wanted) pages.add(3 + Math.floor(Math.random() * 28));

  const pool = [];
  const seen = new Set();

  for (const page of pages) {
    try {
      const res = await axios.get('https://api.jikan.moe/v4/top/characters', {
        params: { page, limit: 25 },
        timeout: 15000
      });

      for (const c of res.data?.data || []) {
        const imageUrl = c?.images?.jpg?.image_url || c?.images?.webp?.image_url || '';
        if (!c?.mal_id || seen.has(c.mal_id) || !imageUrl || imageUrl.includes('questionmark')) continue;

        let name = String(c.name || '').trim();
        if (name.includes(',')) {
          const [last, first] = name.split(',').map(part => part.trim());
          name = `${first} ${last}`.trim();
        }
        if (!name) continue;

        seen.add(c.mal_id);
        pool.push({
          type: 'image',
          imageUrl,
          answer: name,
          alts: Array.isArray(c.nicknames) ? c.nicknames.map(String).slice(0, 6) : []
        });
      }
    } catch (error) {
      logger.warn({ error: error?.message, page }, 'Sitri~Quiz : récupération des personnages échouée.');
    }
    await sleep(450);
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, total);
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

    await quizSend(jid, {
      text: buildQuizBoard({ title: 'RÉCAPITULATIF', rows }),
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
        await quizSend(jid, {
          image: { url: q.imageUrl },
          caption: `🖼️ *Question ${number}/${session.questions.length}* — Qui est ce personnage ?\n\n⏱️ ${seconds} secondes`
        });
      } else {
        await quizSend(jid, {
          text: `❓ *Question ${number}/${session.questions.length}* — ${category.icon} ${category.label}\n\n${q.question}\n\n⏱️ ${seconds} secondes`
        });
      }
    } catch (error) {
      logger.warn({ error: error?.message }, 'Sitri~Quiz : question non envoyée, passage à la suivante.');
      continue;
    }

    session.current = q;
    session.answered = false;

    if (q.type === 'image') {
      session.hintTimer = setTimeout(async () => {
        if (autoQuizzes.get(jid) !== session || session.answered || session.current !== q) return;
        const first = significantTokens(q.answer)[0] || '';
        if (first) {
          await quizSend(jid, { text: `💡 Indice : le prénom ou le nom commence par *${first[0].toUpperCase()}*` }).catch(() => {});
        }
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

async function startAutoQuiz(session) {
  const jid = session.chatJid;
  const category = AUTO_QUIZ_CATEGORIES[session.category];

  try {
    await quizSend(jid, {
      text: `🚀 *QUIZ LANCÉ !*\n\n${category.icon} Catégorie : *${category.label}*\n📋 ${session.total} questions\n\nPréparation des questions...`
    });

    if (!CONFIG.groqKey && session.category !== 'id') {
      throw new Error('GROQ_API_KEY absent');
    }

    const questions =
      session.category === 'id'
        ? await generateIdQuizQuestions(session.total)
        : await generateTextQuizQuestions(session.category, session.total);

    if (autoQuizzes.get(jid) !== session) return;

    if (questions.length < 3) {
      autoQuizzes.delete(jid);
      clearAutoQuizTimers(session);
      await quizSend(jid, {
        text: '⚠️ Impossible de préparer les questions pour le moment. Réessaie avec Xquiz dans un instant.'
      });
      return;
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
    session.stage = 'count';

    const sent = await quizSend(jid, {
      text:
        `*╭─〔 ⌬ SITRI~QUIZ 〕*\n*│*\n` +
        `*├ ◈ ${AUTO_QUIZ_CATEGORIES[category].icon} ${AUTO_QUIZ_CATEGORIES[category].label}*\n` +
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
    const words = trimmed.split(/\s+/).length;
    if (!trimmed || words > 8 || trimmed.length > 80) return false;

    if (session.answered || !session.current) return true;
    if (!isQuizAnswerCorrect(trimmed, session.current)) return true;

    // Bonne réponse : le premier qui trouve gagne le point
    session.answered = true;
    const q = session.current;
    clearTimeout(session.timer);
    if (session.hintTimer) clearTimeout(session.hintTimer);
    session.timer = null;
    session.hintTimer = null;

    session.scores[sender] = Number(session.scores[sender] || 0) + 1;
    session.lastAt[sender] = Date.now();

    await quizSend(
      jid,
      {
        text: `✅ @${getNumber(sender)} a trouvé : *${q.answer}* (+1 point)`,
        mentions: [sender]
      },
      { quoted: message }
    ).catch(() => {});

    session.nextTimer = setTimeout(() => askNextAutoQuestion(session), 2500);
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
      timer: null,
      hintTimer: null,
      nextTimer: null,
      setupTimer: null
    };
    autoQuizzes.set(jid, session);

    session.setupTimer = setTimeout(async () => {
      if (autoQuizzes.get(jid) !== session || !['category', 'count'].includes(session.stage)) return;
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

const KNOWN_COMMANDS = new Set([
  'chat', 'ai', 'ia', 'ask', 'cerveau', 'anime', 'police', 'syp', 'spy', 'synopsis', 'sypnosis', 'info',
  'daily', 'coins', 'p', 'rank', 'profil',
  'quiz', 'reponse',
  'img', 'play', 'video', 's', 'v', 'xi', 'reveal',
  'tag', 'tagall', 'htag', 'hidetag', 'onlyadmin', 'kick', 'add', 'annonce', 'clear',
  'on', 'off', 'restart', 'upt', 'menu', 'models',
  'start', 'recap', 'tab', 'end'
]);

const COMMAND_ALIASES = { ban: 'kick', spy: 'syp', synopsis: 'syp', sypnosis: 'syp', i: 'xi' };

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
          await handleAICommand(jid, message, sender, 'chat', cleanPrompt);
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

  if (command === 'menu') {
    await sendOfficialImage(jid, message);
    await sendReply(jid, getMenu(), message);
    return;
  }

  if (command === 'info') {
    await sendOfficialImage(jid, message);
    await sendReply(jid, getInfo(), message);
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

    socket.sendMessage = (jid, content, options) => {
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
