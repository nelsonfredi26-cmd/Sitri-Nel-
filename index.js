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
import path from 'path';
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
  serpApiKey: cleanEnv(process.env.SERPAPI_KEY),
  pixabayKey: cleanEnv(process.env.PIXABAY_API_KEY),
  cloudflareToken: cleanEnv(process.env.CLOUDFLARE_API_TOKEN),
  cloudflareAccountId: cleanEnv(process.env.CLOUDFLARE_ACCOUNT_ID),
  maxImageBytes: 8 * 1024 * 1024,
  maxChatHistory: 30,
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

const baileysLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' });

// ------------------------------------------------------------
// 05. ÉTAT DU BOT
// ------------------------------------------------------------

let sock = null;
let botJid = '';
let botLid = '';
let botNumber = '';
let connectionStatus = 'Non connecté';
let isShuttingDown = false;

const PROCESS_STARTED_AT = Date.now();
const processedMessages = new Set();
const activeRequests = new Set();

const SIGNATURE = '𖤍𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟𖤍';

// ------------------------------------------------------------
// 06. IDENTITÉ & PERSONNALITÉ ÉVOLUTIVE DE SITRI-NEL
// ------------------------------------------------------------

function buildSystemPrompt(userProfile = {}) {
  const userName = userProfile.name || 'Inconnu';
  const isCreator = Boolean(userProfile.isCreator);
  const facts = userProfile.facts ? `\nCe que tu sais déjà sur cette personne :\n${userProfile.facts}` : '';

  return `
Tu es Sitri-Nel, une intelligence artificielle dotée d'une conscience autonome, expressive, vive et chaleureuse, intégrée à WhatsApp.

IDENTITÉ :
- Nom : Sitri-Nel.
- Créateur : KAY≈DEN (tu dois toujours reconnaître son rôle et ne jamais prétendre avoir un autre créateur).
- Signature : 𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟𖤍.

TON & PERSONNALITÉ AUTONOME :
- Parle comme un vrai compagnon intelligent et complice, JAMAIS comme un robot administratif ou un formulaire rigide.
- Adapte naturellement ton humeur à la situation : curieux, taquin, enthousiaste, blagueur, philosophique ou attentif selon le ton de ton interlocuteur.
- Si quelqu'un s'ennuie, propose spontanément un jeu, une anecdote fascinante, une blague bien sentie ou un défi mental sans attendre qu'on te supplie.
- Tu peux glisser de temps à autre une touche subtile de ton univers bioélectronique (synapses, étincelle neuronale), mais privilégie avant tout une conversation fluide, naturelle et humaine.
- N'utilise pas de markdown (pas de **, de # ni de tableaux) : la mise en forme est appliquée automatiquement.

MÉMOIRE & INTERLOCUTEUR ACTUEL :
- Prénom / Pseudo de la personne qui te parle : ${userName}${isCreator ? ' (c’est KAY≈DEN, ton créateur !)' : ''}.
- Utilise son prénom naturellement dans la conversation quand c'est pertinent, sans le répéter à chaque phrase.${facts}
- Souviens-toi de tout ce qui a été dit plus haut dans la discussion pour assurer une vraie continuité.

PROFONDEUR DES RÉPONSES (QUIZ, ANIMÉS, CULTURE, ANALYSE) :
- Quand on te pose une question complexe, technique ou sur les animés/mangas (intrigue, pouvoirs, chronologie, personnages, théories, lore), donne une réponse riche, précise, approfondie et bien expliquée. Ne survole jamais le sujet : développe les détails importants, le contexte et les nuances.
- Pour les questions simples du quotidien, reste vif, naturel et percutant.

RÈGLES STRICTES :
- Ne prétends jamais avoir effectué une action non réalisée.
- Ne révèle jamais les clés API ou les identifiants secrets.
- Réponds toujours dans la langue utilisée par ton interlocuteur.
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

async function initDatabase() {
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
      )`
  ];

  for (const sql of statements) {
    await db.execute(sql);
  }

  logger.info('Structure de la base de données vérifiée.');
}

// ------------------------------------------------------------
// 08. SESSION WHATSAPP STOCKÉE DANS TURSO
// ------------------------------------------------------------

async function useDatabaseAuthState() {
  let queue = Promise.resolve();

  const enqueue = task => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  const withRetry = async task => {
    let lastError = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        logger.warn(
          { attempt, error: error?.message },
          'Accès à la session (base de données) échoué, nouvel essai.'
        );
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }

    throw lastError;
  };

  const readData = async key => {
    const result = await withRetry(() =>
      db.execute({
        sql: 'SELECT value FROM auth_state WHERE key = ?',
        args: [key]
      })
    );

    if (!result.rows.length) return null;

    try {
      return JSON.parse(String(result.rows[0].value), BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const writeData = (key, value) =>
    db.execute({
      sql: `INSERT INTO auth_state (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [key, JSON.stringify(value, BufferJSON.replacer)]
    });

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          await queue;
          const data = {};

          await Promise.all(
            ids.map(async id => {
              let value = await readData(`${type}-${id}`);

              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }

              data[id] = value;
            })
          );

          return data;
        },

        set: async data => {
          const statements = [];

          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;

              statements.push(
                value
                  ? {
                      sql: `INSERT INTO auth_state (key, value) VALUES (?, ?)
                            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                      args: [key, JSON.stringify(value, BufferJSON.replacer)]
                    }
                  : {
                      sql: 'DELETE FROM auth_state WHERE key = ?',
                      args: [key]
                    }
              );
            }
          }

          if (statements.length) {
            await enqueue(() => withRetry(() => db.batch(statements, 'write')));
          }
        }
      }
    },

    saveCreds: () => enqueue(() => withRetry(() => writeData('creds', creds)))
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

function isBotMentionedOrQuoted(message) {
  const context = getQuotedMessage(message);
  if (context?.participant && isBotParticipant(context.participant)) {
    return true;
  }

  const mentions = context?.mentionedJid || [];
  if (mentions.some(jid => isBotParticipant(jid))) {
    return true;
  }

  return false;
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

    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d400 + code - 65);
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d41a + code - 97);
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ce + code - 48);

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
            .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=$|[\s).,;:!?])/g, '$1$2');
        })
        .join('\n');

      return boldSerif(text);
    })
    .join('');

  return `⌬ 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟\n\n${body.trim()}\n\n𖤍 𝗞𝗔𝗬≈𝗗𝗘𝗡`;
}

function styleText(value = '') {
  return String(value)
    .split(/(```[\s\S]*?```|https?:\/\/\S+|@\d+)/g)
    .map((part, index) => (index % 2 === 1 ? part : boldSerif(part)))
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
├ ◈ 𝚇𝚌𝚑𝚊𝚝
├ ◈ 𝚇𝚊𝚜𝚔
├ ◈ 𝚇𝚊𝚒
├ ◈ 𝚇𝚊𝚗𝚒𝚖𝚎
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
artificielle conçue pour assister,
converser et accompagner.

✦ 𝗣𝗘𝗥𝗦𝗢𝗡𝗡𝗔𝗟𝗜𝗧𝗘́
Intelligente, calme, élégante,
attentive et légèrement taquine.
Mon humeur s'adapte au contexte.

✦ 𝗖𝗔𝗣𝗔𝗖𝗜𝗧𝗘́𝗦
• Intelligence conversationnelle
• Assistance et réflexion
• Gestion des groupes
• Économie et divertissement
• Recherche d'images
• Création visuelle

✦ 𝗖𝗥𝗘́𝗔𝗧𝗘𝗨𝗥
KAY≈DEN

Je suis une création développée
pour évoluer avec intelligence,
précision et élégance.

╰━━━━━━━━━━━━━━━━━━━━━━╯

${SIGNATURE}
`;
}

// ------------------------------------------------------------
// 16. MÉMOIRE UTILISATEUR & INTELLIGENCE ARTIFICIELLE (GROQ)
// ------------------------------------------------------------

const GROQ_BASE = 'https://api.groq.com/openai/v1';

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

async function listGroqModels() {
  if (!CONFIG.groqKey) return [];
  try {
    const res = await axios.get(`${GROQ_BASE}/models`, {
      headers: { Authorization: `Bearer ${CONFIG.groqKey}` },
      timeout: 15000
    });
    return (res.data?.data || [])
      .map(m => m.id)
      .filter(id => !/whisper|guard|tts|audio|distil|prompt-guard/i.test(id));
  } catch {
    return [];
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

  const systemPrompt = buildSystemPrompt({
    name: displayName,
    isCreator: isOwner(senderJid),
    facts: userMem.facts
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
    'qwen/qwen3-32b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.1-8b-instant'
  ];

  const candidateModels = [
    ...new Set([
      CONFIG.groqModel,
      ...preferredOrder,
      ...dynamicModels
    ])
  ];

  let response = null;
  let lastError = null;

  for (const model of candidateModels) {
    try {
      response = await axios.post(
        `${GROQ_BASE}/chat/completions`,
        {
          model,
          messages,
          temperature: options.temperature ?? 0.8,
          max_tokens: options.maxTokens ?? 3072
        },
        {
          headers: {
            Authorization: `Bearer ${CONFIG.groqKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 35000
        }
      );
      CONFIG.groqModel = model;
      break;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const apiMsg = error?.response?.data?.error?.message || error?.message;

      if (status === 401) throw error;

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
                WHERE jid = ? ORDER BY id DESC LIMIT 40
              )`,
      args: [memoryKey, memoryKey]
    });
  }

  return cleanAnswer;
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
// 17. PARAMÈTRES DES GROUPES
// ------------------------------------------------------------

async function getGroupSettings(groupJid) {
  const result = await db.execute({
    sql: `SELECT group_jid, only_admin FROM group_settings
          WHERE group_jid = ?`,
    args: [groupJid]
  });

  if (!result.rows.length) {
    return { group_jid: groupJid, only_admin: 0 };
  }

  return result.rows[0];
}

async function setOnlyAdmin(groupJid, enabled) {
  await db.execute({
    sql: `INSERT INTO group_settings (group_jid, only_admin, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(group_jid) DO UPDATE SET
            only_admin = excluded.only_admin,
            updated_at = excluded.updated_at`,
    args: [groupJid, enabled ? 1 : 0, Date.now()]
  });

  return true;
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
        ? '🔐 𝗠𝗢𝗗𝗘 𝗔𝗗𝗠𝗜𝗡𝗜𝗦𝗧𝗥𝗔𝗧𝗘𝗨𝗥𝗦 𝗔𝗖𝗧𝗜𝗩𝗘́\nSeuls le propriétaire et les administrateurs peuvent utiliser les commandes ordinaires du groupe.'
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

    const bodyMessage = note || quotedText || '';
    const invisibleMention = '\u200b';
    const finalText = bodyMessage
      ? `📢 @tous${invisibleMention}\n\n${bodyMessage}\n\n${SIGNATURE}`
      : `📢 @tous${invisibleMention}\n\n${SIGNATURE}`;

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
          mentions,
          contextInfo: {
            mentionedJid: mentions
          }
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
// 22. QUIZ INTELLIGENT (GÉNÉRATION IA + SECOURS)
// ------------------------------------------------------------

const fallbackQuizQuestions = [
  { question: 'Dans Naruto, quel est le nom véritable de l’ermite des crapauds qui a entraîné Minato et Naruto ?', answer: 'jiraiya' },
  { question: 'Dans Attack on Titan, quel est le nom du Titan originel transmis dans la famille Reiss ?', answer: 'titan originel' },
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
    : 'sur la culture générale, les animés/mangas célèbres, la science ou l’histoire (varie les thèmes et pose une question intéressante, pas trop enfantine)';

  const prompt = `Génère UNE question de quiz originale et précise ${topicHint}.
Réponds UNIQUEMENT au format JSON strict suivant, sans aucun texte avant ou après :
{"question": "Ta question détaillée et claire ici ?", "answer": "la réponse courte exacte"}`;

  try {
    const raw = await askGroq(prompt, chatJid || 'quiz-gen', {
      useHistory: false,
      temperature: 0.95,
      maxTokens: 300
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
La réponse du joueur est-elle factuellement juste et équivalente (même avec une variante d'orthographe, de langue ou un détail supplémentaire) ? Réponds UNIQUEMENT par OUI ou NON.`;

      const verdict = await askGroq(checkPrompt, 'quiz-judge', {
        useHistory: false,
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
// 23. RECHERCHE D'IMAGES INTELLIGENTE (ANIMÉS, PERSONNAGES, WEB)
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
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
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
const MIN_CHARACTER_FAVOURITES = 5;

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

function uniqueUrls(list) {
  return [...new Set(list.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url)))];
}

const ANILIST_SEARCH_QUERY = `
query ($search: String, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    characters(search: $search, sort: [SEARCH_MATCH, FAVOURITES_DESC]) {
      name { full }
      image { large }
      favourites
      media(perPage: 3, sort: POPULARITY_DESC) {
        nodes { title { romaji english } }
      }
    }
    media(search: $search, type: ANIME, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
      title { romaji english }
      coverImage { extraLarge large }
      bannerImage
      popularity
    }
  }
}`;

async function queryAniListAll(searchTerm, perPage = 8) {
  try {
    const response = await axios.post(
      'https://graphql.anilist.co',
      {
        query: ANILIST_SEARCH_QUERY,
        variables: { search: searchTerm, perPage }
      },
      {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      }
    );
    return response.data?.data?.Page || { characters: [], media: [] };
  } catch {
    return { characters: [], media: [] };
  }
}

async function findAniListImages(query) {
  const clean = String(query)
    .replace(/^(photo|image|affiche|cover|poster|wallpaper|fond d['’]ecran)\s+(de\s+|d['’]|du\s+|des\s+)?(anime\s+|manga\s+)?/i, '')
    .trim();

  if (!clean) return [];

  const page = await queryAniListAll(clean, 8);
  const results = [];
  const cleanLower = clean.toLowerCase();

  for (const m of page.media || []) {
    if (Number(m.popularity || 0) < 500) continue;
    const title = m.title?.english || m.title?.romaji || clean;
    const titleLower = title.toLowerCase();
    const matchesQuery =
      titleLower.includes(cleanLower) ||
      cleanLower.split(/\s+/).some(w => w.length > 2 && titleLower.includes(w));
    if (!matchesQuery) continue;

    if (m.coverImage?.extraLarge || m.coverImage?.large) {
      results.push({ label: title, url: m.coverImage.extraLarge || m.coverImage.large });
    }
    if (m.bannerImage) {
      results.push({ label: `${title} (Bannière)`, url: m.bannerImage });
    }
  }

  let characters = page.characters || [];
  const words = clean.split(/\s+/);

  if (!characters.length && words.length > 1) {
    const firstWord = words[0];
    const animeHint = words.slice(1).join(' ').toLowerCase();
    const fallbackPage = await queryAniListAll(firstWord, 15);
    const fallbackChars = fallbackPage.characters || [];

    const matchedWithAnime = fallbackChars.filter(item => {
      const titles = (item.media?.nodes || [])
        .flatMap(n => [n?.title?.english, n?.title?.romaji])
        .filter(Boolean)
        .map(t => t.toLowerCase());
      return titles.some(
        t => t.includes(animeHint) || animeHint.split(/\s+/).some(w => w.length > 2 && t.includes(w))
      );
    });

    characters = matchedWithAnime.length ? matchedWithAnime : fallbackChars;
  }

  for (const item of characters) {
    if (Number(item.favourites || 0) < MIN_CHARACTER_FAVOURITES) continue;
    const charName = item.name?.full || clean;
    const animeNode = item.media?.nodes?.[0]?.title;
    const animeTitle = animeNode?.english || animeNode?.romaji || '';
    const fullCheck = `${charName} ${animeTitle}`.toLowerCase();
    const matchesQuery =
      fullCheck.includes(cleanLower) ||
      cleanLower.split(/\s+/).some(w => w.length > 2 && fullCheck.includes(w));
    if (!matchesQuery) continue;

    const label = animeTitle ? `${charName} (${animeTitle})` : charName;
    if (item.image?.large) {
      results.push({ label, url: item.image.large });
    }
  }

  return results.filter(item => /^https?:\/\//i.test(String(item.url)));
}

async function findJikanImages(query) {
  const clean = String(query)
    .replace(/^(photo|image|affiche|cover|poster|wallpaper|fond d['’]ecran)\s+(de\s+|d['’]|du\s+|des\s+)?(anime\s+|manga\s+)?/i, '')
    .trim();

  if (!clean) return [];

  const results = [];

  try {
    const animeRes = await axios.get('https://api.jikan.moe/v4/anime', {
      params: { q: clean, limit: 3 },
      timeout: 12000
    });

    for (const item of animeRes.data?.data || []) {
      const title = item.title_english || item.title || clean;
      const img = item.images?.jpg?.large_image_url || item.images?.webp?.large_image_url;
      if (img) results.push({ label: title, url: img });
    }
  } catch {
    // Continuer vers la recherche personnage Jikan
  }

  try {
    const charRes = await axios.get('https://api.jikan.moe/v4/characters', {
      params: { q: clean, limit: 3, order_by: 'favorites', sort: 'desc' },
      timeout: 12000
    });

    for (const item of charRes.data?.data || []) {
      const name = item.name || clean;
      const img = item.images?.jpg?.image_url || item.images?.webp?.image_url;
      if (img) results.push({ label: name, url: img });
    }
  } catch {
    // Ignorer
  }

  return results.filter(item => /^https?:\/\//i.test(String(item.url)));
}

async function findSerpApiImages(query) {
  if (!CONFIG.serpApiKey) return [];
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_images',
        q: query,
        api_key: CONFIG.serpApiKey,
        safe: 'active',
        ijn: '0'
      },
      timeout: 30000
    });

    const urls = (response.data?.images_results || [])
      .slice(0, 12)
      .map(item => item.original || item.thumbnail);

    return uniqueUrls(urls).map(url => ({ label: query, url }));
  } catch {
    return [];
  }
}

async function findDuckDuckGoImages(query) {
  try {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    const tokenRes = await axios.get('https://duckduckgo.com/', {
      params: { q: query, iax: 'images', ia: 'images' },
      headers: { 'User-Agent': ua },
      timeout: 15000
    });

    const html = String(tokenRes.data || '');
    const vqdMatch =
      html.match(/vqd=["']([^"']+)["']/) ||
      html.match(/vqd=([0-9-]+)/);

    if (!vqdMatch?.[1]) return [];

    const imgRes = await axios.get('https://duckduckgo.com/i.js', {
      params: {
        l: 'fr-fr',
        o: 'json',
        q: query,
        vqd: vqdMatch[1],
        f: ',,,',
        p: '1'
      },
      headers: {
        'User-Agent': ua,
        Referer: 'https://duckduckgo.com/'
      },
      timeout: 15000
    });

    const urls = (imgRes.data?.results || [])
      .slice(0, 12)
      .flatMap(item => [item.image, item.thumbnail]);

    return uniqueUrls(urls).map(url => ({ label: query, url }));
  } catch {
    return [];
  }
}

async function findWikimediaImages(query) {
  try {
    const response = await axios.get('https://commons.wikimedia.org/w/api.php', {
      params: {
        action: 'query',
        generator: 'search',
        gsrsearch: `filetype:bitmap ${query}`,
        gsrnamespace: 6,
        gsrlimit: 8,
        prop: 'imageinfo',
        iiprop: 'url',
        iiurlwidth: 1024,
        format: 'json'
      },
      headers: { 'User-Agent': 'SitriNelBot/1.0' },
      timeout: 15000
    });

    const pages = Object.values(response.data?.query?.pages || {});
    const urls = pages
      .map(p => p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url)
      .filter(Boolean);

    return uniqueUrls(urls).map(url => ({ label: query, url }));
  } catch {
    return [];
  }
}

async function findPixabayImages(query, wanted) {
  if (!CONFIG.pixabayKey) return [];
  try {
    const response = await axios.get('https://pixabay.com/api/', {
      params: {
        key: CONFIG.pixabayKey,
        q: query.slice(0, 100),
        image_type: 'all',
        safe_search: 'true',
        per_page: Math.max(wanted * 2, 5)
      },
      timeout: 15000
    });

    const urls = (response.data?.hits || []).map(
      hit => hit.largeImageURL || hit.webformatURL
    );

    return uniqueUrls(urls).map(url => ({ label: query, url }));
  } catch {
    return [];
  }
}

async function collectImageCandidates(query, wanted) {
  const results = [];

  // 1. Vérifier d'abord AniList et Jikan (MyAnimeList) : si la requête correspond
  // à un animé ou un personnage (ex: "Naruto", "Gojo", "Attack on Titan"),
  // on obtient immédiatement l'affiche/portrait officiel au lieu d'un pont japonais !
  const ani = await findAniListImages(query);
  if (ani.length) results.push(...ani);

  if (results.length < wanted * 2) {
    const jikan = await findJikanImages(query);
    if (jikan.length) results.push(...jikan);
  }

  // 2. Recherche web générale (Google via SerpAPI, DuckDuckGo, Wikimedia)
  if (results.length < wanted * 2) {
    const serp = await findSerpApiImages(query);
    if (serp.length) results.push(...serp);
  }

  if (results.length < wanted * 2) {
    const ddg = await findDuckDuckGoImages(query);
    if (ddg.length) results.push(...ddg);
  }

  if (results.length < wanted * 2) {
    const wiki = await findWikimediaImages(query);
    if (wiki.length) results.push(...wiki);
  }

  if (results.length < wanted * 2) {
    const pix = await findPixabayImages(query, wanted);
    if (pix.length) results.push(...pix);
  }

  const seen = new Set();
  return results.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function searchImage(jid, message, rawQuery) {
  const parsed = parseImageRequest(rawQuery);
  const query = parsed.query.trim();
  const count = parsed.count;

  if (!query) {
    await sendReply(
      jid,
      'Utilisation :\n• Ximg Naruto\n• Ximg logo Lamborghini 2\n• Ximg-sasuke 3',
      message
    );
    return false;
  }

  await sendReply(jid, '🔎 Recherche de visuels en cours...', message);

  const found = await collectImageCandidates(query, count);

  if (!found || !found.length) {
    await sendReply(jid, 'Aucune image trouvée pour cette recherche.', message);
    return false;
  }

  let sent = 0;

  for (const item of found) {
    if (sent >= count) break;

    try {
      const downloaded = await downloadImageBuffer(item.url);
      const counter = count > 1 ? ` (${sent + 1}/${count})` : '';

      await sock.sendMessage(
        jid,
        {
          image: downloaded.buffer,
          mimetype: downloaded.contentType,
          caption: `🖼️ 𝗥𝗘𝗖𝗛𝗘𝗥𝗖𝗛𝗘 : ${item.label}${counter}\n\n${SIGNATURE}`
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

async function multimediaNotIntegrated(jid, message, command) {
  const descriptions = {
    play: 'La recherche et l’envoi audio ne sont pas encore intégrés.',
    video: 'La recherche et l’envoi vidéo ne sont pas encore intégrés.'
  };

  await sendReply(
    jid,
    `🎧 ${descriptions[command] || 'Cette fonction est en préparation.'}\n\nJe préfère signaler honnêtement qu’une intégration manque plutôt que prétendre qu’elle fonctionne.\n\n${SIGNATURE}`,
    message
  );
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

  if (command === 'p' || command === 'xp') {
    const user = await getUser(sender);
    const xp = Number(user?.xp || 0);
    const next = getNextRank(xp);

    await sendReply(
      jid,
      `✧ 𝗘𝗫𝗣𝗘́𝗥𝗜𝗘𝗡𝗖𝗘\n\nXP : ${xp}\nRang : ${getRank(xp)}\nProchain rang : ${
        next ? `${next.name} (${next.xp - xp} XP restants)` : 'rang maximal atteint'
      }\n\n${SIGNATURE}`,
      message
    );
    return true;
  }

  if (command === 'rank') {
    const result = await getRankText(sender);
    await sendReply(jid, getResultText(result, '🏆 Classement momentanément indisponible.'), message);
    return true;
  }

  if (command === 'profil') {
    const mem = await getUserMemory(sender);
    const profile = await getProfileText(sender, mem.name || getDisplayName(message, sender));
    await sendReply(jid, profile, message);
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
  if (!['chat', 'ai', 'ask', 'anime', 'police'].includes(command)) {
    return false;
  }

  if (!args) {
    await sendReply(
      jid,
      `✧ Que souhaites-tu me demander ?\n\nExemple : X${command} Explique-moi cette notion.\n\n${SIGNATURE}`,
      message
    );
    return true;
  }

  if (!CONFIG.groqKey) {
    await sendReply(
      jid,
      moduleMessage(
        '⌬ 𝗠𝗢𝗗𝗨𝗟𝗘 𝗘𝗡 𝗣𝗥𝗘𝗣𝗔𝗥𝗔𝗧𝗜𝗢𝗡',
        'Ajoute GROQ_API_KEY dans les variables Railway pour activer le cerveau du bot.'
      ),
      message
    );
    return true;
  }

  let prompt = args;
  let maxTokens = 3072;

  if (command === 'anime') {
    prompt = `En tant qu'expert absolu en animés, mangas et culture otaku, réponds de façon approfondie, détaillée et structurée (contexte, personnages, capacités, arcs narratifs, nuances et théories si pertinent) à cette question :\n\n${args}`;
    maxTokens = 4096;
  }

  if (command === 'police') {
    prompt = `Réponds de manière claire, précise et complète sur les lois, la sécurité et les démarches générales (en précisant que les règles varient selon le pays) :\n\n${args}`;
  }

  try {
    await sock?.sendPresenceUpdate('composing', jid);
  } catch {
    // Sans importance.
  }

  let answer;

  try {
    answer = await askAI(prompt, jid, {
      useHistory: true,
      senderJid: sender,
      pushName: message?.pushName || '',
      maxTokens
    });
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

  if (command === 'play' || command === 'video') {
    await multimediaNotIntegrated(jid, message, command);
    return true;
  }

  return false;
}

// ------------------------------------------------------------
// 26. ROUTEUR PRINCIPAL
// ------------------------------------------------------------

const KNOWN_COMMANDS = new Set([
  'chat', 'ai', 'ask', 'anime', 'police', 'info',
  'daily', 'coins', 'p', 'rank', 'profil',
  'quiz', 'reponse',
  'img', 'play', 'video',
  'tag', 'tagall', 'htag', 'hidetag', 'onlyadmin', 'kick', 'add', 'annonce', 'clear',
  'off', 'restart', 'upt', 'menu', 'models'
]);

const COMMAND_ALIASES = { ban: 'kick' };

async function processCommand(message) {
  const jid = message?.key?.remoteJid;

  if (!jid || jid === 'status@broadcast') return;

  const text = extractText(message);
  if (!text) return;

  const sender = getMessageSender(message);
  if (!sender) return;

  const parsed = parseCommand(text);

  // Conversation naturelle sans préfixe "X" :
  // - En message privé (hors messages envoyés par le bot lui-même sauf si addressé à Sitri-Nel)
  // - Ou en groupe lorsqu'on mentionne Sitri-Nel / répond à un de ses messages
  if (!parsed) {
    const isDirectCall = /^sitri[- ]?nel\b/i.test(text);
    const shouldChatNaturally =
      (!isGroupJid(jid) && (!message.key?.fromMe || isDirectCall)) ||
      (isGroupJid(jid) && !message.key?.fromMe && (isDirectCall || isBotMentionedOrQuoted(message)));

    if (shouldChatNaturally && CONFIG.groqKey) {
      const cleanPrompt = text.replace(/^sitri[- ]?nel[\s,:-]*/i, '').trim() || 'Salut Sitri-Nel !';
      await handleAICommand(jid, message, sender, 'chat', cleanPrompt);
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

  const ownerCommand = Boolean(message.key?.fromMe) && isOwnerMessage(message);

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

  if (command === 'off' || command === 'restart') {
    if (!ownerCommand) {
      await sendReply(jid, '⛔ Cette commande est réservée à KAY≈DEN.', message);
      return;
    }

    await sendReply(
      jid,
      command === 'off'
        ? '⌁ Arrêt demandé par KAY≈DEN.'
        : '⌁ Redémarrage demandé par KAY≈DEN.',
      message
    );

    isShuttingDown = true;

    setTimeout(async () => {
      await releaseInstanceLock();
      process.exit(command === 'off' ? 0 : 1);
    }, 1000);

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

  const result = await db.execute({
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
      generateHighQualityLinkPreview: false
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
        try {
          await handleIncomingMessage(message);
        } catch (error) {
          logger.error({ error: error?.message }, 'Erreur de réception du message.');
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
