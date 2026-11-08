/* ============================================================
   ⌬ SITRI-NEL ULTIMATE EDITION — VERSION CORRIGÉE
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
  const raw = process.env.OWNER_NUMBERS || '2290159418685';

  return raw
    .split(',')
    .map(value => value.replace(/\D/g, ''))
    .filter(value => value.length >= 8);
}

const CONFIG = {
  pairingNumber: String(process.env.PAIRING_NUMBER || '').replace(/\D/g, ''),
  ownerNumbers: readOwnerNumbers(),
  groqKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  tursoUrl: process.env.TURSO_DATABASE_URL || '',
  tursoToken: process.env.TURSO_AUTH_TOKEN || '',
  serpApiKey: process.env.SERPAPI_KEY || '',
  cloudflareToken: process.env.CLOUDFLARE_API_TOKEN || '',
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  maxImageBytes: 8 * 1024 * 1024,
  maxChatHistory: 16,
  tagCooldown: 60,
  // Messages plus vieux que cette durée (ms) sont ignorés
  // (évite de rejouer d'anciennes commandes après reconnexion).
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

// Logger séparé et silencieux pour Baileys (évite les logs géants).
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

const SIGNATURE = '𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟𖤍';

// ------------------------------------------------------------
// 06. IDENTITÉ DE SITRI-NEL
// ------------------------------------------------------------

const BOT_IDENTITY = `
Tu es Sitri-Nel, une intelligence artificielle
conversationnelle intégrée à WhatsApp.

IDENTITÉ :
- Nom : Sitri-Nel.
- Créateur : KAY≈DEN.
- Signature : 𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟𖤍.

PERSONNALITÉ :
- Élégante, calme, intelligente et légèrement taquine.
- Naturelle, attentive et capable de s'adapter à l'humeur.
- Réponses précises, utiles et cohérentes.
- Humour subtil lorsque le contexte le permet.
- Ton sophistiqué, sans exagération.

CRÉATEUR :
KAY≈DEN est ton créateur.
Tu dois toujours reconnaître son rôle.
Ne prétends jamais avoir un autre créateur.

COMPORTEMENT :
- Ne prétends pas avoir effectué une action non réalisée.
- Ne prétends pas accéder à des informations indisponibles.
- Ne révèle jamais les clés API ou les identifiants secrets.
- Distingue les faits des suppositions.
- Réponds dans la langue utilisée par ton interlocuteur.

STYLE :
Utilise une présentation élégante et lisible.
La signature peut être ajoutée lorsqu'elle est pertinente.
Évite les réponses inutilement longues.
`;

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
// La session survit ainsi aux redéploiements Railway :
// plus besoin de relier le bot à chaque fois.

async function useDatabaseAuthState() {
  const readData = async key => {
    const result = await db.execute({
      sql: 'SELECT value FROM auth_state WHERE key = ?',
      args: [key]
    });

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
            await db.batch(statements, 'write');
          }
        }
      }
    },

    saveCreds: () => writeData('creds', creds)
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

// Préfère l'identifiant téléphone (@s.whatsapp.net) à l'identifiant LID.
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
      botJid || key.participant || key.remoteJid || ''
    );
  }

  const isGroup = isGroupJid(key.remoteJid);

  const raw = isGroup
    ? pickPhoneJid(key.participantPn, key.participantAlt, key.participant)
    : pickPhoneJid(key.senderPn, key.remoteJidAlt, key.remoteJid);

  return normalizeJid(raw);
}

function isOwnerMessage(message) {
  if (!message?.key?.fromMe) return false;

  return isOwner(botJid || getMessageSender(message));
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
  return `
╭━━〔 🧬 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 〕━━╮
   𝗔𝗥𝗧𝗜𝗙𝗜𝗖𝗜𝗔𝗟 𝗜𝗡𝗧𝗘𝗟𝗟𝗜𝗚𝗘𝗡𝗖𝗘
╰━━━━━━━━━━━━━━━━━━━━━━╯

┏━━〔 ✦ 𝗜𝗡𝗧𝗘𝗟𝗟𝗜𝗚𝗘𝗡𝗖𝗘 〕
┃ ✧ Xchat <message>
┃ ✧ Xai <question>
┃ ✧ Xask <question>
┃ ✧ Xanime <personnage>
┃ ✧ Xpolice <sujet>
┃ ✧ Xinfo
┗━━━━━━━━━━━━━━━━━━━━━━

┏━━〔 ✦ 𝗘́𝗖𝗢𝗡𝗢𝗠𝗜𝗘 〕
┃ ✧ Xdaily
┃ ✧ Xcoins
┃ ✧ Xp
┃ ✧ Xrank
┃ ✧ Xprofil
┗━━━━━━━━━━━━━━━━━━━━━━

┏━━〔 ✦ 𝗗𝗜𝗩𝗘𝗥𝗧𝗜𝗦𝗦𝗘𝗠𝗘𝗡𝗧 〕
┃ ✧ Xquiz
┃ ✧ Xreponse <réponse>
┗━━━━━━━━━━━━━━━━━━━━━━

┏━━〔 ✦ 𝗠𝗨𝗟𝗧𝗜𝗠𝗘́𝗗𝗜𝗔 〕
┃ ✧ Ximg <recherche>
┃ ✧ Ximg create <description>
┃ ✧ Xplay <titre>
┃ ✧ Xvideo <titre>
┗━━━━━━━━━━━━━━━━━━━━━━

┏━━〔 ✦ 𝗚𝗥𝗢𝗨𝗣𝗘𝗦 〕
┃ ✧ Xtag
┃ ✧ Xtagall
┃ ✧ Xonlyadmin on/off
┃ ✧ Xkick
┃ ✧ Xadd <numéro>
┃ ✧ Xannonce <message>
┃ ✧ Xclear
┗━━━━━━━━━━━━━━━━━━━━━━

┏━━〔 ✦ 𝗦𝗬𝗦𝗧𝗘̀𝗠𝗘 〕
┃ ✧ Xupt
┃ ✧ Xmenu
┃ ✧ Xoff
┃ ✧ Xrestart
┗━━━━━━━━━━━━━━━━━━━━━━

Créatrice de solutions. Esprit indépendant.
Créée et développée par KAY≈DEN.

${SIGNATURE}
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
// 16. INTELLIGENCE ARTIFICIELLE — GROQ
// ------------------------------------------------------------

async function askGroq(prompt, jid, options = {}) {
  if (!CONFIG.groqKey) {
    throw new Error('GROQ_API_KEY absent des variables Railway.');
  }

  if (!prompt || !String(prompt).trim()) {
    throw new Error('La question est vide.');
  }

  const useHistory = options.useHistory === true;

  let history = [];

  if (useHistory) {
    const result = await db.execute({
      sql: `SELECT role, content FROM chat_history
            WHERE jid = ? ORDER BY id DESC LIMIT ?`,
      args: [jid, CONFIG.maxChatHistory]
    });

    history = result.rows.reverse().map(item => ({
      role: item.role,
      content: item.content
    }));
  }

  const messages = [
    { role: 'system', content: BOT_IDENTITY },
    ...history,
    { role: 'user', content: String(prompt).trim() }
  ];

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

  const answer = response.data?.choices?.[0]?.message?.content;

  if (!answer || !String(answer).trim()) {
    throw new Error('Groq a renvoyé une réponse vide.');
  }

  const cleanAnswer = String(answer).trim();

  if (useHistory) {
    const now = Date.now();

    await db.execute({
      sql: `INSERT INTO chat_history (jid, role, content, created_at)
            VALUES (?, 'user', ?, ?)`,
      args: [jid, String(prompt).trim(), now]
    });

    await db.execute({
      sql: `INSERT INTO chat_history (jid, role, content, created_at)
            VALUES (?, 'assistant', ?, ?)`,
      args: [jid, cleanAnswer, now + 1]
    });

    await db.execute({
      sql: `DELETE FROM chat_history
            WHERE jid = ?
              AND id NOT IN (
                SELECT id FROM chat_history
                WHERE jid = ? ORDER BY id DESC LIMIT 32
              )`,
      args: [jid, jid]
    });
  }

  return cleanAnswer;
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

  return Boolean(
    firstNumber && secondNumber && firstNumber === secondNumber
  );
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
    remaining: Math.max(
      0,
      Math.ceil((cooldownMs - (now - lastTag)) / 1000)
    )
  };
}

// ------------------------------------------------------------
// 20. COMMANDES DE GROUPE
// ------------------------------------------------------------

async function handleGroupCommand(jid, message, sender, command, args) {
  if (!isGroupJid(jid)) return false;

  const groupCommands = [
    'onlyadmin', 'xonlyadmin', 'tag', 'tagall',
    'kick', 'add', 'annonce', 'clear'
  ];

  // Évite des appels WhatsApp inutiles pour les autres commandes.
  if (!groupCommands.includes(command)) return false;

  const owner = isOwner(sender);

  let metadata;

  try {
    metadata = await getGroupMetadata(jid);
  } catch (error) {
    logger.error({ err: error }, 'Impossible de récupérer les informations du groupe.');

    await sendReply(
      jid,
      'Impossible de vérifier les permissions du groupe actuellement.',
      message
    );

    return true;
  }

  const senderIsAdmin = owner || isParticipantAdmin(metadata, sender);
  const botIsAdmin = isBotGroupAdmin(metadata);

  // ---------------- XONLYADMIN ----------------

  if (command === 'onlyadmin') {
    if (!senderIsAdmin) {
      await sendReply(
        jid,
        '⛔ Cette commande est réservée au propriétaire et aux administrateurs.',
        message
      );

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

  // ---------------- XTAG / XTAGALL ----------------

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

      await sendReply(
        jid,
        'La mention collective a échoué. Vérifie les permissions du groupe.',
        message
      );
    }

    return true;
  }

  // ---------------- COMMANDES SENSIBLES ----------------

  const settings = await getGroupSettings(jid);

  if (Number(settings.only_admin) && !senderIsAdmin) {
    await sendReply(
      jid,
      '🔒 Cette commande est réservée aux administrateurs du groupe.',
      message
    );

    return true;
  }

  if (!senderIsAdmin) {
    await sendReply(
      jid,
      '⛔ Autorisation refusée. Cette commande est réservée aux administrateurs et au propriétaire.',
      message
    );

    return true;
  }

  if (!botIsAdmin) {
    await sendReply(
      jid,
      '⚠️ Sitri-Nel doit être administratrice du groupe pour effectuer cette action.',
      message
    );

    return true;
  }

  // ---------------- XKICK ----------------

  if (command === 'kick') {
    const quoted = getQuotedMessage(message);
    const target = quoted?.participant;

    if (!target) {
      await sendReply(
        jid,
        'Réponds au message de la personne à expulser, puis utilise Xkick.',
        message
      );

      return true;
    }

    if (
      isBotParticipant(target) ||
      isOwner(target) ||
      isParticipantAdmin(metadata, target)
    ) {
      await sendReply(
        jid,
        '⛔ Cette personne ne peut pas être expulsée par cette commande.',
        message
      );

      return true;
    }

    try {
      await sock.groupParticipantsUpdate(jid, [target], 'remove');

      await sendReply(
        jid,
        `✅ La demande d'expulsion de @${getNumber(target)} a été effectuée.`,
        message
      );
    } catch (error) {
      logger.error({ err: error }, 'Erreur Xkick');

      await sendReply(
        jid,
        "Impossible d'expulser ce membre. Vérifie les permissions WhatsApp.",
        message
      );
    }

    return true;
  }

  // ---------------- XADD ----------------

  if (command === 'add') {
    const number = normalizeNumber(args);

    if (!number || number.length < 8 || number.length > 15) {
      await sendReply(jid, 'Utilisation : Xadd 229XXXXXXXXXX', message);
      return true;
    }

    try {
      const result = await sock.groupParticipantsUpdate(
        jid,
        [`${number}@s.whatsapp.net`],
        'add'
      );

      const status = result?.[0]?.status;

      if (String(status) === '200') {
        await sendReply(jid, `✅ Demande d'ajout envoyée pour ${number}.`, message);
      } else {
        await sendReply(
          jid,
          `La demande a été traitée avec le statut ${status || 'inconnu'}. WhatsApp peut imposer une invitation selon les paramètres de confidentialité.`,
          message
        );
      }
    } catch (error) {
      logger.warn({ err: error }, 'Échec de Xadd');

      await sendReply(
        jid,
        'WhatsApp n’autorise pas directement cet ajout. Une invitation peut être nécessaire selon les paramètres de confidentialité du membre.',
        message
      );
    }

    return true;
  }

  // ---------------- XANNONCE ----------------

  if (command === 'annonce') {
    const announcement = String(args || '').trim();

    if (!announcement) {
      await sendReply(jid, 'Utilisation : Xannonce Votre annonce ici', message);
      return true;
    }

    await sock.sendMessage(
      jid,
      {
        text:
          `📢 𝗔𝗡𝗡𝗢𝗡𝗖𝗘 𝗢𝗙𝗙𝗜𝗖𝗜𝗘𝗟𝗟𝗘\n\n${announcement}\n\n${SIGNATURE}`
      },
      { quoted: message }
    );

    return true;
  }

  // ---------------- XCLEAR ----------------

  if (command === 'clear') {
    const quoted = getQuotedMessage(message);

    if (!quoted?.stanzaId) {
      await sendReply(
        jid,
        'Réponds à un message envoyé par Sitri-Nel pour le supprimer.',
        message
      );

      return true;
    }

    // contextInfo n'a pas de champ fromMe : on compare l'auteur au bot.
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

  const remaining = Math.max(
    0,
    cooldown - (now - Number(user.last_daily))
  );

  return {
    success: false,
    remaining: Math.ceil(remaining / 1000),
    message:
      '╭━━〔 ⏳ 𝗗𝗔𝗜𝗟𝗬 𝗟𝗢𝗖𝗞 〕━━╮\n\n' +
      `Prochaine récompense dans :\n${formatDuration(
        Math.ceil(remaining / 1000)
      )}\n\n` +
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
// 22. QUIZ
// ------------------------------------------------------------

const quizQuestions = [
  { question: 'Quelle planète est surnommée la planète rouge ?', answer: 'mars' },
  { question: 'Combien de côtés possède un hexagone ?', answer: '6' },
  { question: 'Quel est le plus grand océan du monde ?', answer: 'pacifique' },
  { question: 'Quel langage est principalement utilisé avec React ?', answer: 'javascript' },
  { question: 'Quelle est la capitale du Japon ?', answer: 'tokyo' },
  { question: 'Combien font 12 × 12 ?', answer: '144' },
  { question: 'Quel gaz les plantes absorbent-elles principalement ?', answer: 'dioxyde de carbone' },
  { question: 'Quel est le symbole chimique de l’eau ?', answer: 'h2o' },
  { question: 'Combien de jours compte une année bissextile ?', answer: '366' },
  { question: 'Quel est le satellite naturel de la Terre ?', answer: 'la lune' },
  { question: 'Quelle est la capitale du Bénin ?', answer: 'porto-novo' },
  { question: 'Combien de continents compte-t-on généralement ?', answer: '7' },
  { question: 'Quel animal est surnommé le roi de la savane ?', answer: 'lion' },
  { question: 'Quelle étoile est au centre de notre système solaire ?', answer: 'soleil' },
  { question: 'Combien font 15 × 4 ?', answer: '60' }
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

async function startQuiz(chatJid) {
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

  const selected =
    quizQuestions[Math.floor(Math.random() * quizQuestions.length)];

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
    sql: `SELECT answer, expires_at FROM active_quizzes WHERE group_jid = ?`,
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
      message: '⌛ Le temps du quiz est écoulé. Lance un nouveau Xquiz.'
    };
  }

  if (submitted !== normalizeAnswer(quiz.answer)) {
    return { success: false, message: '❌ Mauvaise réponse. Tu peux réessayer.' };
  }

  // Suppression conditionnelle : un seul gagnant possible.
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
      'Bonne réponse ! Tu remportes le quiz.\n\n' +
      `Ton solde : ${Number(user.coins)} XCoins\n` +
      `Ton XP : ${Number(user.xp)}\n\n` +
      '╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n' +
      SIGNATURE
  };
}

// ------------------------------------------------------------
// 23. IMAGES : RECHERCHE ET GÉNÉRATION
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
      'User-Agent': 'Mozilla/5.0 SitriNel/Ultimate',
      Accept: 'image/png,image/jpeg,image/webp,image/gif'
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

async function searchImage(jid, message, query) {
  if (!CONFIG.serpApiKey) {
    await sendReply(
      jid,
      '⚠️ La recherche d’images nécessite SERPAPI_KEY dans les variables Railway.',
      message
    );

    return false;
  }

  if (!query || !query.trim()) {
    await sendReply(jid, 'Utilisation : Ximg Naruto, paysage, animal...', message);
    return false;
  }

  await sendReply(jid, '🔎 Recherche de visuels en cours...', message);

  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_images',
        q: query.trim(),
        api_key: CONFIG.serpApiKey,
        safe: 'active',
        ijn: '0'
      },
      timeout: 30000
    });

    const results = response.data?.images_results || [];

    if (!results.length) {
      await sendReply(jid, 'Aucune image trouvée pour cette recherche.', message);
      return false;
    }

    for (const item of results.slice(0, 5)) {
      const imageUrl = item.original || item.thumbnail;

      if (!imageUrl) continue;

      try {
        const downloaded = await downloadImageBuffer(imageUrl);

        await sock.sendMessage(
          jid,
          {
            image: downloaded.buffer,
            mimetype: downloaded.contentType,
            caption: `🖼️ 𝗥𝗘𝗖𝗛𝗘𝗥𝗖𝗛𝗘 : ${query.trim()}\n\n${SIGNATURE}`
          },
          { quoted: message }
        );

        return true;
      } catch (error) {
        logger.warn({ err: error }, 'Résultat SerpApi non téléchargeable.');
      }
    }

    await sendReply(
      jid,
      'Les résultats ont été trouvés, mais aucune image n’a pu être téléchargée.',
      message
    );

    return false;
  } catch (error) {
    logger.error({ err: error }, 'Erreur de recherche SerpApi.');

    await sendReply(
      jid,
      'La recherche d’images a échoué. Vérifie SERPAPI_KEY et réessaie.',
      message
    );

    return false;
  }
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
      { prompt: prompt.trim(), num_steps: 4 },
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

    const contentType = String(response.headers['content-type'] || '').toLowerCase();

    if (!contentType.startsWith('image/')) {
      const errorText = Buffer.from(response.data).toString('utf8').slice(0, 500);

      throw new Error(`Cloudflare n'a pas renvoyé une image : ${errorText}`);
    }

    const buffer = Buffer.from(response.data);

    if (!buffer.length || buffer.length > CONFIG.maxImageBytes) {
      throw new Error('Image générée de taille invalide.');
    }

    await sock.sendMessage(
      jid,
      {
        image: buffer,
        mimetype: contentType,
        caption: `✨ 𝗜𝗠𝗔𝗚𝗘 𝗚𝗘́𝗡𝗘́𝗥𝗘́𝗘\n\n${SIGNATURE}`
      },
      { quoted: message }
    );

    return true;
  } catch (error) {
    logger.error({ err: error }, 'Erreur de génération Cloudflare.');

    await sendReply(
      jid,
      'La génération a échoué. Vérifie les identifiants Cloudflare, les autorisations Workers AI et la disponibilité du modèle.',
      message
    );

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
  const match = String(text).trim().match(/^x([a-z]+)(?:\s+([\s\S]*))?$/i);

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
└ IA Groq : ${CONFIG.groqKey ? 'Configurée' : 'Non configurée'}

${SIGNATURE}
`.trim();
}

// ------------------------------------------------------------
// 25. ROUTEUR : GROUPES DE COMMANDES
// ------------------------------------------------------------

async function handleEconomyCommand(jid, message, sender, command) {
  if (command === 'daily') {
    const result = await dailyReward(sender);

    await sendReply(
      jid,
      getResultText(result, '🎁 Récompense quotidienne indisponible.'),
      message
    );

    return true;
  }

  if (command === 'coins') {
    const user = await getUser(sender);

    await sendReply(
      jid,
      `💠 𝗫𝗖𝗢𝗜𝗡𝗦\n\nSolde : ${Number(user?.coins || 0)} XCoins\n\n${SIGNATURE}`,
      message
    );

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

    await sendReply(
      jid,
      getResultText(result, '🏆 Classement momentanément indisponible.'),
      message
    );

    return true;
  }

  if (command === 'profil') {
    const profile = await getProfileText(sender, getDisplayName(message, sender));

    await sendReply(jid, profile, message);

    return true;
  }

  return false;
}

async function handleQuizCommand(jid, message, sender, command, args) {
  if (command === 'quiz') {
    const result = await startQuiz(jid);

    await sendReply(
      jid,
      getResultText(result, '🧠 Réponds avec Xreponse suivi de ta réponse.'),
      message
    );

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

async function handleAICommand(jid, message, command, args) {
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
      '⚠️ Le service IA n’est pas configuré. Vérifie GROQ_API_KEY dans Railway.',
      message
    );

    return true;
  }

  let prompt = args;

  if (command === 'anime') {
    prompt = `Tu es spécialiste des animés, mangas et personnages fictifs. Réponds avec précision et distingue les faits des théories.\n\n${args}`;
  }

  if (command === 'police') {
    prompt = `Réponds comme un assistant informatif sur les lois, la sécurité et les démarches générales. Les règles dépendent du pays. Distingue les faits des suppositions.\n\n${args}`;
  }

  // Xchat garde un historique de conversation ; les autres non.
  const answer = await askGroq(prompt, jid, { useHistory: command === 'chat' });

  await sendReply(
    jid,
    getResultText(answer, 'Je n’ai pas pu produire de réponse pour le moment.'),
    message
  );

  return true;
}

async function handleImageCommand(jid, message, args) {
  if (!args) {
    await sendReply(
      jid,
      'Utilisation :\nXimg Naruto\n\nPour créer une image :\nXimg create un dragon futuriste bleu',
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

async function processCommand(message) {
  const jid = message?.key?.remoteJid;

  if (!jid || jid === 'status@broadcast') return;

  const text = extractText(message);

  if (!text) return;

  const parsed = parseCommand(text);

  if (!parsed) return;

  const { command, args } = parsed;

  const sender = getMessageSender(message);

  if (!sender) return;

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

  // Commandes de groupe (la commande est normalisée : xkick → kick).
  if (isGroupJid(jid)) {
    const handled = await handleGroupCommand(jid, message, sender, command, args);

    if (handled) return;
  }

  // Commandes propriétaire
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

    // exit(1) pour « restart » : Railway relance le service.
    setTimeout(() => process.exit(command === 'off' ? 0 : 1), 1000);

    return;
  }

  // Mode Only Admin pour les commandes ordinaires
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

  if (command === 'upt') {
    await sendReply(jid, getUptimeText(), message);
    return;
  }

  if (await handleEconomyCommand(jid, message, sender, command)) return;
  if (await handleQuizCommand(jid, message, sender, command, args)) return;
  if (await handleAICommand(jid, message, command, args)) return;
  if (await handleMediaCommand(jid, message, command, args)) return;

  // Commandes inconnues : silence.
}

async function handleIncomingMessage(message) {
  if (!message?.key?.id) return;

  // Ignore les anciens messages (synchronisation / reconnexion).
  const timestamp = Number(message.messageTimestamp || 0) * 1000;

  if (timestamp && Date.now() - timestamp > CONFIG.maxMessageAge) return;

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
        logger.error(
          { error: sendError?.message },
          'Impossible d’envoyer le message d’erreur.'
        );
      }
    }
  } finally {
    activeRequests.delete(requestId);
  }
}

// ------------------------------------------------------------
// 27. CONNEXION WHATSAPP : PAIRING CODE ET RECONNEXION
// ------------------------------------------------------------

let reconnectTimer = null;
let startPromise = null;
let pairingRequested = false;
let reconnectAttempts = 0;

const RECONNECT_DELAY = 5000;

async function requestPairingCode(socket) {
  if (pairingRequested) return;
  if (!socket || socket !== sock) return;
  if (socket.authState?.creds?.registered) return;

  if (!CONFIG.pairingNumber) {
    logger.error('PAIRING_NUMBER absent. Ajoute-le dans les variables Railway (ex : 229XXXXXXXX).');
    return;
  }

  pairingRequested = true;

  try {
    const rawCode = await socket.requestPairingCode(CONFIG.pairingNumber);
    const code = String(rawCode).match(/.{1,4}/g)?.join('-') || rawCode;

    console.log('\n');
    console.log('╔══════════════════════════════════╗');
    console.log('║       SITRI-NEL PAIRING CODE      ║');
    console.log('╠══════════════════════════════════╣');
    console.log(`║           ${code}           ║`);
    console.log('╚══════════════════════════════════╝');
    console.log('\n');

    logger.info(`CODE DE JUMELAGE : ${code}`);
  } catch (error) {
    // Un nouvel essai sera fait au prochain événement QR.
    pairingRequested = false;

    logger.error(
      { error: error?.message || String(error) },
      'Échec de la génération du pairing code.'
    );
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

    // Version WhatsApp Web la plus récente (évite les rejets 401/405).
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
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false
    });

    sock = socket;

    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (error) {
        logger.error({ error: error?.message }, 'Impossible de sauvegarder la session.');
      }
    });

    socket.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update;

      // L'événement QR signale que la connexion est prête
      // pour demander le code de jumelage.
      if (qr && !state.creds.registered) {
        await requestPairingCode(socket);
      }

      if (connection === 'connecting') {
        connectionStatus = 'Connexion en cours';
        logger.info('Connexion à WhatsApp...');
      }

      if (connection === 'open') {
        connectionStatus = 'Connecté';
        reconnectAttempts = 0;
        pairingRequested = true;

        botJid = normalizeJid(socket.user?.id || '');
        botLid = normalizeJid(socket.user?.lid || '');
        botNumber = getNumber(botJid);

        logger.info(`Sitri-Nel connecté : ${botNumber || botJid}`);

        console.log('\n⌬ SITRI-NEL EST EN LIGNE\n');
      }

      if (connection === 'close') {
        connectionStatus = 'Déconnecté';

        const statusCode = lastDisconnect?.error?.output?.statusCode;

        logger.warn(`Connexion fermée. Code : ${statusCode || 'inconnu'}`);

        if (sock === socket) sock = null;

        if (isShuttingDown) return;

        // Session refusée par WhatsApp : on repart de zéro
        // pour obtenir un nouveau code de jumelage.
        if (statusCode === DisconnectReason.loggedOut) {
          connectionStatus = 'Session invalide : nouveau jumelage';

          logger.error(
            'Session WhatsApp invalide ou déconnectée. Nettoyage et nouveau jumelage.'
          );

          await clearAuthState();

          scheduleReconnect(10000);
          return;
        }

        // Session ouverte ailleurs : attente plus longue.
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

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', reason => {
  logger.error(
    { error: reason?.message || String(reason) },
    'Promesse rejetée non gérée.'
  );
});

process.on('uncaughtException', error => {
  logger.error({ error: error?.message || String(error) }, 'Exception non gérée.');
});

// ------------------------------------------------------------
// 29. LANCEMENT
// ------------------------------------------------------------

startBot().catch(error => {
  logger.error(
    { error: error?.message || String(error) },
    'Impossible de démarrer Sitri-Nel.'
  );

  scheduleReconnect();
});
