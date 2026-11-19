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
  tavilyKey: cleanEnv(process.env.TAVILY_API_KEY),
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
    ? `\nDONNÉES VÉRIFIÉES EN TEMPS RÉEL (WIKIS FANDOM / WIKIPÉDIA / DUCKDUCKGO) :\n${userProfile.verifiedContext}\nAppuie-toi sur ces faits exacts en priorité.`
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
- N'utilise pas de markdown (pas de **, de # ni de tableaux).

EXACTITUDE & CULTURE ANIMÉ / MANGA :
- Tu maîtrises à fond les animés et mangas (Bleach, Jujutsu Kaisen, Dragon Ball, Naruto, One Piece, Mashle, Tokyo Revengers, etc.).
- Ne confonds JAMAIS les techniques ou personnages (ex: Piccolo = Makankōsappō, Komamura = Kokujō Tengen Myō'ō, Soi Fon = Jakuhō Raikōben, Senjumaru = Shatatsu Karagara Shigarami no Tsuji, Mash Burnedead a été élevé uniquement par Regro Burnedead son père adoptif, etc.).${verifiedContext}

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
      )`
  ];

  for (const sql of statements) {
    await db.execute(sql);
  }

  // Migration douce si la table group_settings existait déjà sans chat_mode
  try {
    await db.execute(
      `ALTER TABLE group_settings ADD COLUMN chat_mode INTEGER NOT NULL DEFAULT 0`
    );
  } catch {
    // La colonne existe déjà.
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
├ ◈ 𝚇𝚌𝚑𝚊𝚝 𝚘𝚗 / 𝚘𝚏𝚏
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
├ ◈ 𝚇𝚜 (𝚟𝚞𝚎 𝚞𝚗𝚒𝚚𝚞𝚎)
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
• Vérification factuelle & animés
• Gestion des groupes & mentions
• Économie et quiz dynamiques
• Recherche et création d'images

✦ 𝗖𝗥𝗘́𝗔𝗧𝗘𝗨𝗥
KAY≈DEN

╰━━━━━━━━━━━━━━━━━━━━━━╯

${SIGNATURE}
`;
}

// ------------------------------------------------------------
// 16. VÉRIFICATION FACTUELLE & INTELLIGENCE ARTIFICIELLE (GROQ)
// ------------------------------------------------------------

const GROQ_BASE = 'https://api.groq.com/openai/v1';

async function fetchVerifiedFacts(query = '') {
  const clean = String(query).trim();
  if (!clean || clean.length < 2) return '';

  const tasks = [];

  // 1. DuckDuckGo Instant Answer
  tasks.push(
    axios.get('https://api.duckduckgo.com/', {
      params: { q: clean, format: 'json', no_html: 1, skip_disambig: 1 },
      headers: { 'User-Agent': 'SitriNelBot/1.0' },
      timeout: 2500
    }).then(res => {
      const out = [];
      const abstract = String(res.data?.AbstractText || '').trim();
      if (abstract) out.push(`[DuckDuckGo - ${res.data?.Heading || clean}] : ${abstract.slice(0, 600)}`);
      const rel = res.data?.RelatedTopics?.[0]?.Text || res.data?.RelatedTopics?.[0]?.Topics?.[0]?.Text;
      if (rel) out.push(`[DuckDuckGo Info] : ${String(rel).slice(0, 300)}`);
      return out;
    }).catch(() => [])
  );

  // 2. Wikis Fandom spécialisés (en parallèle)
  const fandomMap = [
    { regex: /jujutsu|jjk|gojo|sukuna|megumi|itadori|astral|tengen|kenjaku/i, domain: 'jujutsu-kaisen.fandom.com' },
    { regex: /dragon\s*ball|dbz|dbs|piccolo|goku|vegeta|gohan|freezer|frieza|makankosappo/i, domain: 'dragonball.fandom.com' },
    { regex: /naruto|shippuden|boruto|sasuke|uchiha|uchiwa|konoha|akatsuki|hokage|kakashi|fugaku/i, domain: 'naruto.fandom.com' },
    { regex: /one\s*piece|luffy|zoro|sanji|nami|kaido|shanks|yonko/i, domain: 'onepiece.fandom.com' },
    { regex: /bleach|ichigo|aizen|bankai|soul\s*society|shinigami|espada|komamura|soi\s*fon|senjumaru/i, domain: 'bleach.fandom.com' },
    { regex: /demon\s*slayer|kimetsu|tanjiro|nezuko|muzan|pilier|hashira/i, domain: 'kimetsu-no-yaiba.fandom.com' },
    { regex: /hunter\s*x\s*hunter|hxh|gon|killua|kirua|kurapika|hisoka|nen/i, domain: 'hunterxhunter.fandom.com' },
    { regex: /attack\s*on\s*titan|snk|shingeki|eren|levi|livai|mikasa|titan/i, domain: 'attackontitan.fandom.com' },
    { regex: /my\s*hero\s*academia|mha|boku\s*no\s*hero|deku|midoriya|bakugo|all\s*might/i, domain: 'myheroacademia.fandom.com' },
    { regex: /black\s*clover|asta|yuno|grimoire/i, domain: 'blackclover.fandom.com' },
    { regex: /tokyo\s*revengers|mikey|manjiro|sano|takemichi|draken|toman/i, domain: 'tokyorevengers.fandom.com' },
    { regex: /mashle|mash\s*burnedead|regro/i, domain: 'mashle.fandom.com' },
    { regex: /chainsaw\s*man|denji|makima|power|aki|pochita/i, domain: 'chainsaw-man.fandom.com' },
    { regex: /solo\s*leveling|sung\s*jin[- ]?woo|monarque/i, domain: 'solo-leveling.fandom.com' }
  ];

  const matchedFandoms = fandomMap.filter(f => f.regex.test(clean)).map(f => f.domain).slice(0, 2);
  for (const domain of matchedFandoms) {
    tasks.push(
      axios.get(`https://${domain}/api.php`, {
        params: { action: 'query', list: 'search', srsearch: clean, srlimit: 2, format: 'json' },
        headers: { 'User-Agent': 'SitriNelBot/1.0' },
        timeout: 2500
      }).then(res => {
        const hits = res.data?.query?.search || [];
        return hits.map(hit => {
          const txt = String(hit.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
          return txt ? `[Wiki Fandom (${domain}) - ${hit.title}] : ${txt}` : '';
        }).filter(Boolean);
      }).catch(() => [])
    );
  }

  // 3. Wikipédia FR & EN (en parallèle)
  for (const lang of ['fr', 'en']) {
    tasks.push(
      axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
        params: { action: 'query', list: 'search', srsearch: clean, srlimit: 1, format: 'json' },
        headers: { 'User-Agent': 'SitriNelBot/1.0' },
        timeout: 2500
      }).then(async res => {
        const hit = res.data?.query?.search?.[0];
        if (!hit?.title) return [];
        const sum = await axios.get(
          `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`,
          { headers: { 'User-Agent': 'SitriNelBot/1.0' }, timeout: 2500 }
        );
        const extract = String(sum.data?.extract || '').trim();
        return extract ? [`[Wikipédia ${lang.toUpperCase()} - ${hit.title}] : ${extract.slice(0, 650)}`] : [];
      }).catch(() => [])
    );
  }

  // 4. Recherche Tavily (mode keyless officiel via X-Tavily-Access-Mode: keyless sans clé, ou Bearer token si TAVILY_API_KEY est définie)
  tasks.push(
    (async () => {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (CONFIG.tavilyKey) {
          headers.Authorization = `Bearer ${CONFIG.tavilyKey}`;
        } else {
          headers['X-Tavily-Access-Mode'] = 'keyless';
        } else {
          headers['X-Tavily-Access-Mode'] = 'keyless';
        }
        const payload = {
          query: clean,
          search_depth: 'basic',
          max_results: 4,
          include_answer: true
        };
        const res = await axios.post('https://api.tavily.com/search', payload, {
          headers,
          timeout: 4500
        });
        const out = [];
        if (res.data?.answer) {
          out.push(`[Tavily Synthèse] : ${String(res.data.answer).slice(0, 600)}`);
        }
        for (const r of (res.data?.results || []).slice(0, 3)) {
          const snippet = String(r.content || '').trim();
          if (snippet) {
            out.push(`[Tavily - ${r.title || 'Source'}] : ${snippet.slice(0, 450)}`);
          }
        }
        return out;
      } catch {
        return [];
      }
    })()
  );

  const settled = await Promise.all(tasks);
  return settled.flat().slice(0, 8).join('\n');
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

  // Si Groq a renvoyé sa liste officielle de modèles actifs, on filtre pour ne garder que ceux qui existent vraiment !
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

  for (const model of candidateModels.slice(0, 6)) {
    try {
      response = await axios.post(
        `${GROQ_BASE}/chat/completions`,
        {
          model,
          messages,
          temperature: options.temperature ?? 0.55,
          max_tokens: options.maxTokens ?? 1200
        },
        {
          headers: {
            Authorization: `Bearer ${CONFIG.groqKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
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
                WHERE jid = ? ORDER BY id DESC LIMIT 30
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

    // Sur WhatsApp, pour que la notification de mention fonctionne réellement pour tout le groupe,
    // il faut passer les JID exacts des participants (item.id) dans `mentions`.
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
    // On place les @numéro en caractères invisibles ou en bas de message pour que WhatsApp
    // déclenche la vraie notification "@vous a été mentionné" sur chaque téléphone !
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

  const isNamedEntity = entitySignals.some(sig => n.includes(sig)) || /[A-Z][a-z]{2,}/.test(clean);

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
    .replace(/(en forme|forme|mode|version|gear\s*\d+|ultra\s*instinct|ui|mui|super\s*saiyan|ssj\d*|bankai|shikai|rikudo)/gi, ' ')
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

  // 1. Recherche exacte sur AniList (forme complète puis personnage principal)
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

  // 2. Wikis Fandom spécialisés pour les formes / transformations exactes (Gear 5, Ultra Instinct, Rikudo, etc.)
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

  // 3. Recherche web ciblée anime pour la forme / scène précise (ex: "Luffy Gear 5 anime", "Goku Ultra Instinct anime")
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

  // Cas particulier : Drake (artiste musical / rappeur vs peinture fresque)
  const searchTerm = n === 'drake' ? 'Drake rapper artist official' : cleanTerme;

  // 1. Wikipédia FR & EN (portraits réels, stades, pays, logos, monuments)
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

  // 2. Recherche web ciblée (pays, logo, stade, personnalité)
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

  // 3. Pixabay uniquement si la clé est présente et que ce n'est pas une personnalité/fresque
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
    .replace(/uchiwa/gi, 'Uchiha')
    .replace(/kirua/gi, 'Killua')
    .replace(/livai/gi, 'Levi')
    .replace(/sangoku/gi, 'Son Goku')
    .replace(/mikey\s+sano/gi, 'Manjiro Sano')
    .replace(/draken/gi, 'Ken Ryuguji')
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

  // Pour les requêtes mixtes ou non classées : essayer d'abord AniList/Wiki anime si applicable, puis entités/web, puis photos
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

  const found = isExplicitPhoto
    ? await collectPhotos(cleanPhotoQuery || query, count)
    : await collectImageCandidates(query, count);

  if (!found || !found.length) {
    await sendReply(
      jid,
      isExplicitPhoto
        ? 'Aucune photo trouvée sur Pixabay pour cette recherche.'
        : 'Aucun personnage ou animé trouvé sur AniList pour cette recherche.',
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
// 23 bis. DÉVOILEMENT VUE UNIQUE (XS) & RECHERCHE AUDIO/VIDÉO (XPLAY / XVIDEO)
// ------------------------------------------------------------

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
      '👁️ Réponds à un message en vue unique (photo, vidéo ou audio) avec Xs pour le dévoiler.',
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
      ? `🔓 𝗩𝗨𝗘 𝗨𝗡𝗜𝗤𝗨𝗘 𝗗𝗘́𝗩𝗢𝗜𝗟𝗘́𝗘
💬 Légende : ${payload.caption}

${SIGNATURE}`
      : `🔓 𝗩𝗨𝗘 𝗨𝗡𝗜𝗤𝗨𝗘 𝗗𝗘́𝗩𝗢𝗜𝗟𝗘́𝗘

${SIGNATURE}`;

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

  // 1. Recherche via Tavily si disponible
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

  // 2. Fallback DuckDuckGo HTML search
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

async function resolveStreamUrl(videoUrl, mode = 'audio') {
  const endpoints = [
    'https://api.cobalt.tools/api/json',
    'https://co.wuk.sh/api/json'
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await axios.post(
        endpoint,
        {
          url: videoUrl,
          downloadMode: mode === 'audio' ? 'audio' : 'auto',
          audioFormat: 'mp3',
          videoQuality: '480'
        },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 12000
        }
      );
      const streamUrl = res.data?.url || res.data?.picker?.[0]?.url;
      if (streamUrl && /^https?:\/\//i.test(streamUrl)) {
        return streamUrl;
      }
    } catch {
      // Essayer le suivant
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
        : '🎬 Utilisation : Xvideo titre de la vidéo ou sujet',
      message
    );
    return true;
  }

  await sendReply(
    jid,
    isAudio
      ? `🎵 Recherche audio en cours pour : "${query}"...`
      : `🎬 Recherche vidéo en cours pour : "${query}"...`,
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

  const streamUrl = await resolveStreamUrl(top.url, isAudio ? 'audio' : 'video');

  if (streamUrl) {
    try {
      const dl = await axios.get(streamUrl, {
        responseType: 'arraybuffer',
        timeout: 25000,
        maxContentLength: CONFIG.maxMediaBytes,
        maxBodyLength: CONFIG.maxMediaBytes,
        headers: { 'User-Agent': 'SitriNelBot/1.0' }
      });

      const buf = Buffer.from(dl.data);
      const mime = String(dl.headers['content-type'] || '').toLowerCase();

      if (buf.length > 0 && buf.length <= CONFIG.maxMediaBytes) {
        if (isAudio) {
          await sock.sendMessage(
            jid,
            {
              audio: buf,
              mimetype: mime.startsWith('audio/') ? mime : 'audio/mpeg',
              ptt: false
            },
            { quoted: message }
          );
          await sendReply(
            jid,
            `🎵 𝗟𝗘𝗖𝗧𝗨𝗥𝗘 𝗔𝗨𝗗𝗜𝗢
📌 Titre : ${top.title}
🔗 Lien : ${top.url}

${SIGNATURE}`,
            message
          );
          return true;
        }

        await sock.sendMessage(
          jid,
          {
            video: buf,
            mimetype: mime.startsWith('video/') ? mime : 'video/mp4',
            caption: `🎬 𝗩𝗜𝗗𝗘́𝗢
📌 Titre : ${top.title}
🔗 Lien : ${top.url}

${SIGNATURE}`
          },
          { quoted: message }
        );
        return true;
      }
    } catch {
      // Repli propre sur le lien trouvé
    }
  }

  await sendReply(
    jid,
    `${isAudio ? '🎵 𝗔𝗨𝗗𝗜𝗢 𝗧𝗥𝗢𝗨𝗩𝗘́' : '🎬 𝗩𝗜𝗗𝗘́𝗢 𝗧𝗥𝗢𝗨𝗩𝗘́𝗘'}

` +
      `📌 Titre : ${top.title}
` +
      `🔗 Lien : ${top.url}

` +
      `Le téléchargement direct du fichier n’a pas abouti côté serveur, utilise le lien ci-dessus.

${SIGNATURE}`,
    message
  );
  return true;
}

async function multimediaNotIntegrated(jid, message, command) {
  return handlePlayOrVideoCommand(jid, message, command, '');
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

  // Commande Xchat on / Xchat off pour activer ou désactiver la réponse directe aux citations
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
        '⌬ 𝗠𝗢𝗗𝗨𝗟𝗘 𝗘𝗡 𝗣𝗥𝗘𝗣𝗔𝗥𝗔𝗧𝗜𝗢𝗡',
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
    answer = await askAI(prompt, jid, {
      useHistory: true,
      senderJid: sender,
      pushName: message?.pushName || '',
      factQuery: args,
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
  'img', 'play', 'video', 's', 'reveal',
  'tag', 'tagall', 'htag', 'hidetag', 'onlyadmin', 'kick', 'add', 'annonce', 'clear',
  'on', 'off', 'restart', 'upt', 'menu', 'models'
]);

const COMMAND_ALIASES = { ban: 'kick' };

async function processCommand(message) {
  const jid = message?.key?.remoteJid;

  if (!jid || jid === 'status@broadcast') return;

  const text = extractText(message);
  if (!text) return;

  const sender = getMessageSender(message);
  if (!sender) return;

  // Mémorisation passive de l'identité et des surnoms de chaque membre qui écrit
  if (!message.key?.fromMe) {
    updateMemoryFromMessage(sender, message?.pushName || '', text).catch(() => {});
  }

  const parsed = parseCommand(text);

  // Messages sans préfixe "X" :
  // 1. Appel direct par son nom ("Sitri-Nel ...") -> répond toujours (sauf boucle du bot lui-même)
  // 2. Réponse directe (citation) à un message de Sitri-Nel -> répond uniquement si Xchat est ON
  if (!parsed) {
    // Ignorer les propres réponses du bot (qui commencent par ⌬ 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 ou contiennent sa signature)
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

  if (command === 'off') {
    if (!ownerCommand) {
      await sendReply(jid, '⛔ Cette commande est réservée à KAY≈DEN.', message);
      return;
    }

    isBotSleeping = true;
    await sendReply(
      jid,
      '💤 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 𝗘𝗡 𝗩𝗘𝗜𝗟𝗟𝗘
Je me mets en pause. Utilise Xon pour me réveiller.',
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
      '⚡ 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 𝗥𝗘́𝗩𝗘𝗜𝗟𝗟𝗘́𝗘
Je suis de nouveau active et prête !',
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

  if (command === 's' || command === 'reveal') {
    await revealViewOnceMessage(jid, message);
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
