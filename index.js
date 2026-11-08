
/* ==========================================
   𖤍 SITRI-NEL ULTIMATE EDITION
   Created & Developed by KAY≈DEN
   PARTIE 1/3 — CORE & CONFIGURATION
========================================== */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  Browsers,
  jidNormalizedUser
} from '@whiskeysockets/baileys';

import pino from 'pino';
import { createClient } from '@libsql/client';
import axios from 'axios';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ==========================================
// CHEMINS
// ==========================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.join(__dirname, 'session');
const ASSET_DIR = path.join(__dirname, 'assets');
const IMAGE_PATH = path.join(ASSET_DIR, 'sitri-nel.png');

if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

if (!fs.existsSync(ASSET_DIR)) {
  fs.mkdirSync(ASSET_DIR, { recursive: true });
}

// ==========================================
// CONFIGURATION
// ==========================================

const CONFIG = {
  PREFIX: 'X',

  PAIRING_NUMBER: process.env.PAIRING_NUMBER || '',

  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GROQ_MODEL:
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',

  TURSO_DATABASE_URL:
    process.env.TURSO_DATABASE_URL || '',

  TURSO_AUTH_TOKEN:
    process.env.TURSO_AUTH_TOKEN || '',

  OWNER_NUMBERS: (process.env.OWNER_NUMBERS || '')
    .split(',')
    .map(number => number.replace(/\D/g, ''))
    .filter(Boolean),

  SERPAPI_KEY: process.env.SERPAPI_KEY || '',

  CLOUDFLARE_API_TOKEN:
    process.env.CLOUDFLARE_API_TOKEN || '',

  CLOUDFLARE_ACCOUNT_ID:
    process.env.CLOUDFLARE_ACCOUNT_ID || ''
};

// ==========================================
// VALIDATION
// ==========================================

const requiredVariables = [
  'PAIRING_NUMBER',
  'GROQ_API_KEY',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN'
];

for (const variable of requiredVariables) {
  if (!process.env[variable]) {
    throw new Error(`Variable Railway manquante : ${variable}`);
  }
}

if (CONFIG.OWNER_NUMBERS.length === 0) {
  throw new Error('OWNER_NUMBERS doit contenir ton numéro.');
}

// ==========================================
// LOGGER
// ==========================================

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

const startedAt = Date.now();

// ==========================================
// IMAGE OFFICIELLE
// ==========================================

let sitriImage = null;

if (fs.existsSync(IMAGE_PATH)) {
  sitriImage = fs.readFileSync(IMAGE_PATH);
  logger.info('Image officielle Sitri-Nel chargée.');
} else {
  logger.warn(
    'Image absente : ajoute assets/sitri-nel.png sur GitHub.'
  );
}

// ==========================================
// IDENTITÉ
// ==========================================

const SIGNATURE = '\n\n𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟𖤍';

const SYSTEM_PROMPT = `
Tu es Sitri-Nel, une intelligence artificielle
conversationnelle créée et développée par KAY≈DEN.

PERSONNALITÉ :
- Intelligente, élégante et calme.
- Attentive, réfléchie et légèrement taquine.
- Humour subtil et naturel.
- Humeur adaptable à la conversation.
- Expression sophistiquée, sans exagération.

IDENTITÉ :
- Ton créateur est KAY≈DEN.
- Si quelqu'un demande qui t'a créée,
  réponds clairement : KAY≈DEN.
- Ne prétends jamais être humaine.
- Ne prétends pas posséder une capacité indisponible.

STYLE :
- Français naturel et élégant.
- Réponses utiles, précises et fluides.
- Unicode gras avec modération.
- Évite les longs séparateurs décoratifs.
- Ne répète pas inutilement les informations.
`;

// ==========================================
// FORMATAGE FUTURISTE
// ==========================================

function futuristic(text) {
  const normal =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  const bold =
    '𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭' +
    '𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇';

  return String(text).replace(/[A-Za-z]/g, char => {
    return bold[normal.indexOf(char)] || char;
  });
}

// ==========================================
// BASE DE DONNÉES TURSO
// ==========================================

const db = createClient({
  url: CONFIG.TURSO_DATABASE_URL,
  authToken: CONFIG.TURSO_AUTH_TOKEN
});

async function initDatabase() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      last_daily INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS group_settings (
      group_id TEXT PRIMARY KEY,
      only_admin INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS group_tag_cooldowns (
      group_id TEXT PRIMARY KEY,
      last_tag INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS chat_history_lookup
    ON chat_history(chat_id, user_id, id)
  `);

  logger.info('Turso database initialized.');
}

// ==========================================
// OUTILS COMMUNS
// ==========================================

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function getNumber(jid = '') {
  return jidNormalizedUser(jid)
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
}

function isOwner(jid) {
  const number = getNumber(jid);

  return CONFIG.OWNER_NUMBERS.includes(number);
}

function extractText(message) {
  const msg = message.message;

  if (!msg) return '';

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    ''
  ).trim();
}

function formatDuration(milliseconds) {
  const total = Math.floor(milliseconds / 1000);

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  return `${days}j ${hours}h ${minutes}min ${seconds}s`;
}

// ==========================================
// FIN PARTIE 1/3
// La partie 2 continue dans le même fichier.
// ==========================================


// ==========================================
// PARTIE 2/3 — AI, MENU & GROUP COMMANDS
// ==========================================

// ==========================================
// MENU OFFICIEL
// ==========================================

function getMenu() {
  return `
⟢ 𝗔𝗥𝗧𝗜𝗙𝗜𝗖𝗜𝗔𝗟 𝗜𝗡𝗧𝗘𝗟𝗟𝗜𝗚𝗘𝗡𝗖𝗘 ⟣

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
⌬ 𝗣𝗥𝗘𝗙𝗜𝗫𝗘 : X
⌬ 𝗦𝗧𝗔𝗧𝗨𝗦  : 𝗢𝗡𝗟𝗜𝗡𝗘
━━━━━━━━━━━━━━━━━━━━━━

              𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟𖤍
                 ᴅᴇᴠᴇʟᴏᴘᴇᴅ ʙʏ
                    𝗞𝗔𝗬≈𝗗𝗘𝗡
`;
}

// ==========================================
// PRESENTATION
// ==========================================

function getInfo() {
  return `
𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 𖤍

⌬ Artificial Intelligence
⌬ Intelligence : Groq
⌬ Database : Turso
⌬ WhatsApp Engine : Baileys

Je suis Sitri-Nel, une intelligence artificielle
conçue pour dialoguer, assister, explorer
et accompagner avec élégance.

Mon tempérament est calme, intelligent,
adaptable et légèrement taquin.

Créée et développée par 𝗞𝗔𝗬≈𝗗𝗘𝗡.

${SIGNATURE}
`;
}

// ==========================================
// GROQ — INTELLIGENCE
// ==========================================

async function askGroq(chatId, userId, prompt, useHistory = true) {
  let history = [];

  if (useHistory) {
    const result = await db.execute({
      sql: `
        SELECT role, content
        FROM chat_history
        WHERE chat_id = ? AND user_id = ?
        ORDER BY id DESC
        LIMIT 12
      `,
      args: [chatId, userId]
    });

    history = result.rows.reverse().map(row => ({
      role: row.role,
      content: row.content
    }));
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: prompt }
  ];

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: CONFIG.GROQ_MODEL,
      messages,
      temperature: 0.7,
      max_completion_tokens: 1200
    },
    {
      headers: {
        Authorization: `Bearer ${CONFIG.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 45000
    }
  );

  const answer =
    response.data?.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error('Groq a retourné une réponse vide.');
  }

  if (useHistory) {
    await db.batch([
      {
        sql: `
          INSERT INTO chat_history
          (chat_id, user_id, role, content, created_at)
          VALUES (?, ?, 'user', ?, ?)
        `,
        args: [chatId, userId, prompt, Date.now()]
      },
      {
        sql: `
          INSERT INTO chat_history
          (chat_id, user_id, role, content, created_at)
          VALUES (?, ?, 'assistant', ?, ?)
        `,
        args: [chatId, userId, answer, Date.now()]
      }
    ], 'write');
  }

  return answer;
}

// ==========================================
// GROUP PERMISSIONS
// ==========================================

async function getGroupAdmins(sock, jid) {
  const metadata = await sock.groupMetadata(jid);

  return metadata.participants
    .filter(member =>
      member.admin === 'admin' ||
      member.admin === 'superadmin'
    )
    .map(member => jidNormalizedUser(member.id));
}

async function isGroupAdmin(sock, jid, sender) {
  if (isOwner(sender)) return true;

  const admins = await getGroupAdmins(sock, jid);

  return admins.includes(jidNormalizedUser(sender));
}

async function getOnlyAdmin(jid) {
  const result = await db.execute({
    sql: `
      SELECT only_admin
      FROM group_settings
      WHERE group_id = ?
    `,
    args: [jid]
  });

  return Number(result.rows[0]?.only_admin || 0) === 1;
}

async function setOnlyAdmin(jid, enabled) {
  await db.execute({
    sql: `
      INSERT INTO group_settings
      (group_id, only_admin, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(group_id)
      DO UPDATE SET
        only_admin = excluded.only_admin,
        updated_at = excluded.updated_at
    `,
    args: [jid, enabled ? 1 : 0, Date.now()]
  });
}

// ==========================================
// REPLY & MEDIA HELPERS
// ==========================================

async function sendReply(sock, jid, message, quoted) {
  return sock.sendMessage(
    jid,
    { text: message },
    quoted ? { quoted } : {}
  );
}

async function sendOfficialImage(sock, jid, caption, quoted) {
  if (!sitriImage) {
    await sendReply(
      sock,
      jid,
      '⌬ Image officielle introuvable. Vérifie assets/sitri-nel.png.',
      quoted
    );
    return false;
  }

  await sock.sendMessage(
    jid,
    {
      image: sitriImage,
      caption
    },
    quoted ? { quoted } : {}
  );

  return true;
}

// ==========================================
// GROUP COMMANDS
// ==========================================

async function handleGroupCommand(
  sock,
  message,
  command,
  args,
  sender,
  jid
) {
  if (!jid.endsWith('@g.us')) return false;

  const owner = isOwner(sender);
  const admin = owner ||
    await isGroupAdmin(sock, jid, sender);

  // Mode only-admin
  if (command === 'onlyadmin') {
    if (!admin) {
      await sendReply(
        sock, jid,
        '⌬ Cette commande est réservée aux administrateurs.',
        message
      );
      return true;
    }

    const option = args.toLowerCase();

    if (option !== 'on' && option !== 'off') {
      await sendReply(
        sock, jid,
        'Utilisation : Xonlyadmin on / Xonlyadmin off',
        message
      );
      return true;
    }

    await setOnlyAdmin(jid, option === 'on');

    await sendReply(
      sock,
      jid,
      option === 'on'
        ? '⌬ 𝗠𝗢𝗗𝗘 𝗔𝗗𝗠𝗜𝗡𝗜𝗦𝗧𝗥𝗔𝗧𝗘𝗨𝗥𝗦 𝗔𝗖𝗧𝗜𝗩𝗘́.'
        : '⌬ 𝗠𝗢𝗗𝗘 𝗔𝗗𝗠𝗜𝗡𝗜𝗦𝗧𝗥𝗔𝗧𝗘𝗨𝗥𝗦 𝗗𝗘́𝗦𝗔𝗖𝗧𝗜𝗩𝗘́.',
      message
    );

    return true;
  }

  // Les commandes ordinaires sont soumises
  // au mode only-admin.
  const onlyAdmin = await getOnlyAdmin(jid);

  const sensitiveCommands = [
    'kick', 'add', 'clear', 'annonce',
    'off', 'restart'
  ];

  if (sensitiveCommands.includes(command) && !admin) {
    await sendReply(
      sock, jid,
      '⌬ Autorisation administrateur requise.',
      message
    );
    return true;
  }

  if (
    onlyAdmin &&
    !admin &&
    !['tag', 'tagall'].includes(command)
  ) {
    await sendReply(
      sock, jid,
      '⌬ Le mode administrateurs est activé dans ce groupe.',
      message
    );
    return true;
  }

  // ========================================
  // XTAG / XTAGALL
  // ========================================

  if (command === 'tag' || command === 'tagall') {
    const quoted = message.message?.extendedTextMessage?.contextInfo;

    if (!quoted?.stanzaId) {
      await sendReply(
        sock, jid,
        '⌬ Réponds à un message avec Xtag pour signaler son contenu à tous les membres.',
        message
      );
      return true;
    }

    const now = Date.now();

    const result = await db.execute({
      sql: `
        SELECT last_tag
        FROM group_tag_cooldowns
        WHERE group_id = ?
      `,
      args: [jid]
    });

    const lastTag = Number(result.rows[0]?.last_tag || 0);
    const remaining = 60000 - (now - lastTag);

    if (remaining > 0) {
      await sendReply(
        sock,
        jid,
        `⌬ Une mention collective vient d'être effectuée. Réessaie dans ${Math.ceil(remaining / 1000)} seconde(s).`,
        message
      );
      return true;
    }

    // Transaction atomique pour éviter deux Xtag simultanés.
    const claim = await db.execute({
      sql: `
        UPDATE group_tag_cooldowns
        SET last_tag = ?
        WHERE group_id = ?
        AND last_tag <= ?
      `,
      args: [now, jid, now - 60000]
    });

    if (claim.rowsAffected === 0) {
      // Première utilisation : insertion conditionnelle.
      await db.execute({
        sql: `
          INSERT INTO group_tag_cooldowns (group_id, last_tag)
          VALUES (?, ?)
          ON CONFLICT(group_id) DO NOTHING
        `,
        args: [jid, now]
      });

      const check = await db.execute({
        sql: `
          SELECT last_tag FROM group_tag_cooldowns
          WHERE group_id = ?
        `,
        args: [jid]
      });

      if (Number(check.rows[0]?.last_tag) !== now) {
        await sendReply(
          sock, jid,
          '⌬ Une mention collective vient d’être lancée. Patiente avant la prochaine.',
          message
        );
        return true;
      }
    }

    const metadata = await sock.groupMetadata(jid);

    const members = metadata.participants
      .map(member => jidNormalizedUser(member.id))
      .filter(id => id !== jidNormalizedUser(sock.user.id));

    if (members.length === 0) {
      await sendReply(sock, jid, 'Aucun membre à mentionner.', message);
      return true;
    }

    const quotedSender = quoted.participant || 'un membre';

    const text =
      `⌬ 𝗚𝗥𝗢𝗨𝗣 𝗔𝗟𝗘𝗥𝗧\n\n` +
      `Un message de ${getNumber(quotedSender)} a été signalé.\n\n` +
      members.map(id => `@${getNumber(id)}`).join(' ');

    await sock.sendMessage(jid, {
      text,
      mentions: members
    }, { quoted: message });

    return true;
  }

  // ========================================
  // XKICK — AUTEUR DU MESSAGE CITÉ
  // ========================================

  if (command === 'kick') {
    if (!admin) {
      await sendReply(sock, jid, 'Administrateur requis.', message);
      return true;
    }

    const context = message.message?.extendedTextMessage?.contextInfo;
    const target = context?.participant;

    if (!target) {
      await sendReply(
        sock, jid,
        'Réponds au message du membre à expulser avec Xkick.',
        message
      );
      return true;
    }

    if (isOwner(target)) {
      await sendReply(sock, jid, 'Cette action est interdite sur le propriétaire.', message);
      return true;
    }

    const admins = await getGroupAdmins(sock, jid);

    if (admins.includes(jidNormalizedUser(target))) {
      await sendReply(sock, jid, 'Impossible de retirer un administrateur.', message);
      return true;
    }

    const botJid = jidNormalizedUser(sock.user.id);

    if (!admins.includes(botJid)) {
      await sendReply(sock, jid, 'Je dois être administratrice pour effectuer cette action.', message);
      return true;
    }

    await sock.groupParticipantsUpdate(jid, [target], 'remove');

    await sendReply(sock, jid, '⌬ Membre retiré du groupe.', message);
    return true;
  }

  // ========================================
  // XADD — AJOUT D'UN NUMÉRO
  // ========================================

  if (command === 'add') {
    if (!admin) {
      await sendReply(sock, jid, 'Administrateur requis.', message);
      return true;
    }

    const number = args.replace(/\D/g, '');

    if (number.length < 8 || number.length > 15) {
      await sendReply(
        sock, jid,
        'Utilisation : Xadd 229XXXXXXXX',
        message
      );
      return true;
    }

    const target = `${number}@s.whatsapp.net`;

    const botJid = jidNormalizedUser(sock.user.id);
    const botAdmins = await getGroupAdmins(sock, jid);

    if (!botAdmins.includes(botJid)) {
      await sendReply(sock, jid, 'Je dois être administratrice pour ajouter un membre.', message);
      return true;
    }

    try {
      const response = await sock.groupParticipantsUpdate(
        jid, [target], 'add'
      );

      const status = response?.[0]?.status;

      await sendReply(
        sock,
        jid,
        status === '200'
          ? `⌬ Invitation envoyée ou membre ajouté : ${number}`
          : `⌬ WhatsApp n'a pas confirmé l'ajout direct. Une invitation peut être nécessaire.`,
        message
      );
    } catch {
      await sendReply(
        sock, jid,
        '⌬ Ajout impossible. Les paramètres de confidentialité WhatsApp peuvent exiger une invitation.',
        message
      );
    }

    return true;
  }

  return false;
}

// ==========================================
// FIN PARTIE 2/3
// ==========================================

// ==========================================
// PARTIE 3/3 — MEDIA, ECONOMY & CONNECTION
// ==========================================

// ==========================================
// QUIZ — QUESTIONS
// ==========================================

const quizQuestions = [
  {
    question: 'Quel est le plus grand océan du monde ?',
    answer: 'pacifique'
  },
  {
    question: 'Combien de côtés possède un hexagone ?',
    answer: '6'
  },
  {
    question: 'Quelle planète est surnommée la planète rouge ?',
    answer: 'mars'
  },
  {
    question: 'Quel est le symbole chimique de l’or ?',
    answer: 'au'
  },
  {
    question: 'Combien font 12 × 8 ?',
    answer: '96'
  }
];

const activeQuizzes = new Map();

// ==========================================
// ECONOMY — USER INITIALIZATION
// ==========================================

async function ensureUser(userId) {
  await db.execute({
    sql: `
      INSERT INTO users (user_id, coins, xp, last_daily)
      VALUES (?, 0, 0, 0)
      ON CONFLICT(user_id) DO NOTHING
    `,
    args: [userId]
  });
}

async function getUser(userId) {
  await ensureUser(userId);

  const result = await db.execute({
    sql: `
      SELECT user_id, coins, xp, last_daily
      FROM users
      WHERE user_id = ?
    `,
    args: [userId]
  });

  return result.rows[0];
}

// ==========================================
// DAILY
// ==========================================

async function dailyReward(userId) {
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;

  await ensureUser(userId);

  const result = await db.execute({
    sql: `
      UPDATE users
      SET coins = coins + 350,
          xp = xp + 25,
          last_daily = ?
      WHERE user_id = ?
      AND last_daily <= ?
    `,
    args: [now, userId, now - cooldown]
  });

  if (result.rowsAffected === 0) {
    const user = await getUser(userId);
    const remaining = cooldown - (now - Number(user.last_daily));

    return {
      success: false,
      remaining: Math.max(0, remaining)
    };
  }

  return {
    success: true,
    coins: 350,
    xp: 25
  };
}

// ==========================================
// RANK
// ==========================================

function getRank(xp) {
  if (xp >= 10000) return '𝗟𝗘𝗚𝗘𝗡𝗗';
  if (xp >= 5000) return '𝗘𝗟𝗜𝗧𝗘';
  if (xp >= 2500) return '𝗗𝗜𝗔𝗠𝗢𝗡𝗗';
  if (xp >= 1000) return '𝗚𝗢𝗟𝗗';
  if (xp >= 500) return '𝗦𝗜𝗟𝗩𝗘𝗥';
  if (xp >= 100) return '𝗕𝗥𝗢𝗡𝗭𝗘';

  return '𝗡𝗢𝗩𝗜𝗖𝗘';
}

// ==========================================
// PROFILE
// ==========================================

async function getProfile(userId) {
  const user = await getUser(userId);

  return `
╭━━〔 𝗨𝗦𝗘𝗥 𝗣𝗥𝗢𝗙𝗜𝗟𝗘 〕━━╮

◈ ID : ${userId}
◈ XCoins : ${user.coins}
◈ XP : ${user.xp}
◈ Rank : ${getRank(Number(user.xp))}

╰━━━━━━━━━━━━━━━━━━━━━━╯
${SIGNATURE}
`;
}

// ==========================================
// QUIZ REWARD
// ==========================================

async function answerQuiz(userId, chatId, answer) {
  const key = `${chatId}:${userId}`;
  const quiz = activeQuizzes.get(key);

  if (!quiz) {
    return {
      success: false,
      message: 'Aucun quiz actif pour toi. Lance Xquiz.'
    };
  }

  if (answer.trim().toLowerCase() !== quiz.answer) {
    return {
      success: false,
      message: 'Réponse incorrecte. Essaie encore.'
    };
  }

  activeQuizzes.delete(key);

  await ensureUser(userId);

  await db.execute({
    sql: `
      UPDATE users
      SET coins = coins + 30,
          xp = xp + 20
      WHERE user_id = ?
    `,
    args: [userId]
  });

  return {
    success: true,
    message: `Bonne réponse ! +30 XCoins et +20 XP.`
  };
}

// ==========================================
// XIMG — SEARCH IMAGES WITH SERPAPI
// ==========================================

async function searchImage(sock, jid, query, quoted) {
  if (!CONFIG.SERPAPI_KEY) {
    await sendReply(
      sock, jid,
      '⌬ Le moteur de recherche d’images n’est pas encore configuré.',
      quoted
    );
    return;
  }

  if (!query) {
    await sendReply(
      sock, jid,
      'Utilisation : Ximg Naruto',
      quoted
    );
    return;
  }

  const response = await axios.get(
    'https://serpapi.com/search.json',
    {
      params: {
        engine: 'google_images',
        q: query,
        api_key: CONFIG.SERPAPI_KEY
      },
      timeout: 30000
    }
  );

  const images = response.data?.images_results || [];

  const imageUrl = images.find(item =>
    item.original &&
    /^https?:\/\//i.test(item.original)
  )?.original;

  if (!imageUrl) {
    await sendReply(
      sock, jid,
      '⌬ Aucune image exploitable trouvée.',
      quoted
    );
    return;
  }

  const imageResponse = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 8 * 1024 * 1024,
    maxBodyLength: 8 * 1024 * 1024
  });

  const contentType =
    imageResponse.headers['content-type'] || '';

  if (!contentType.startsWith('image/')) {
    throw new Error('Le résultat ne contient pas une image.');
  }

  await sock.sendMessage(
    jid,
    {
      image: Buffer.from(imageResponse.data),
      caption: `⌬ 𝗜𝗠𝗔𝗚𝗘 𝗥𝗘𝗦𝗨𝗟𝗧\n◈ Recherche : ${query}${SIGNATURE}`
    },
    { quoted }
  );
}

// ==========================================
// XIMG CREATE — CLOUDFLARE WORKERS AI
// ==========================================

async function generateImage(sock, jid, prompt, quoted) {
  if (
    !CONFIG.CLOUDFLARE_API_TOKEN ||
    !CONFIG.CLOUDFLARE_ACCOUNT_ID
  ) {
    await sendReply(
      sock, jid,
      '⌬ Le moteur de génération d’images Cloudflare n’est pas configuré.',
      quoted
    );
    return;
  }

  if (!prompt) {
    await sendReply(
      sock, jid,
      'Utilisation : Ximg create Un château futuriste dans les nuages',
      quoted
    );
    return;
  }

  await sock.sendPresenceUpdate('composing', jid);

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/` +
    `${CONFIG.CLOUDFLARE_ACCOUNT_ID}/ai/run/` +
    '@cf/black-forest-labs/flux-1-schnell';

  const response = await axios.post(
    endpoint,
    {
      prompt,
      num_steps: 4
    },
    {
      headers: {
        Authorization: `Bearer ${CONFIG.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'image/png'
      },
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 12 * 1024 * 1024
    }
  );

  const buffer = Buffer.from(response.data);

  if (!buffer.length) {
    throw new Error('Cloudflare a retourné une image vide.');
  }

  await sock.sendMessage(
    jid,
    {
      image: buffer,
      caption:
        `⌬ 𝗔𝗜 𝗜𝗠𝗔𝗚𝗘 𝗚𝗘𝗡𝗘𝗥𝗔𝗧𝗜𝗢𝗡\n` +
        `◈ Prompt : ${prompt}${SIGNATURE}`
    },
    { quoted }
  );

  await sock.sendPresenceUpdate('paused', jid);
}

// ==========================================
// MAIN MESSAGE HANDLER
// ==========================================

async function handleIncomingMessage(sock, message) {
  if (!message.message) return;

  const jid = message.key.remoteJid;

  if (!jid || jid === 'status@broadcast') return;

  const text = extractText(message);

  if (!text || !text.startsWith(CONFIG.PREFIX)) return;

  // Le propriétaire peut envoyer ses commandes
  // depuis le compte WhatsApp connecté.
  const sender = message.key.participant ||
    (message.key.fromMe ? sock.user.id : jid);

  const owner = isOwner(sender);

  // Les messages sortants ordinaires du bot
  // ne déclenchent aucune réponse.
  if (message.key.fromMe && !owner) return;

  const parts = text.slice(1).trim().split(/\s+/);

  const command = (parts.shift() || '').toLowerCase();
  const args = parts.join(' ').trim();

  if (!command) return;

  try {
    // ========================================
    // GROUP COMMANDS
    // ========================================

    if (
      jid.endsWith('@g.us') &&
      await handleGroupCommand(
        sock,
        message,
        command,
        args,
        sender,
        jid
      )
    ) {
      return;
    }

    // ========================================
    // OWNER COMMANDS
    // ========================================

    if (['off', 'restart'].includes(command)) {
      if (!owner) {
        await sendReply(
          sock, jid,
          '⌬ Cette fonction est exclusivement réservée à mon créateur.',
          message
        );
        return;
      }

      if (command === 'off') {
        await sendReply(
          sock, jid,
          '⌬ Arrêt du système demandé par KAY≈DEN.',
          message
        );

        process.exit(0);
      }

      if (command === 'restart') {
        await sendReply(
          sock, jid,
          '⌬ Redémarrage du système demandé par KAY≈DEN.',
          message
        );

        process.exit(0);
      }
    }

    // ========================================
    // XMENU
    // ========================================

    if (command === 'menu') {
      const sent = await sendOfficialImage(
        sock,
        jid,
        '⌬ 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟\nUne intelligence artificielle à votre service.',
        message
      );

      if (sent) {
        await sock.sendMessage(
          jid,
          { text: getMenu() },
          { quoted: message }
        );
      }

      return;
    }

    // ========================================
    // XINFO
    // ========================================

    if (command === 'info') {
      const sent = await sendOfficialImage(
        sock,
        jid,
        '𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟\n𝗨𝗟𝗧𝗜𝗠𝗔𝗧𝗘 𝗔𝗜',
        message
      );

      if (sent) {
        await sock.sendMessage(
          jid,
          { text: getInfo() },
          { quoted: message }
        );
      }

      return;
    }

    // ========================================
    // XUPT
    // ========================================

    if (command === 'upt') {
      const uptime = formatDuration(Date.now() - startedAt);

      await sendReply(
        sock,
        jid,
        `
╭━━〔 𝗦𝗬𝗦𝗧𝗘𝗠 𝗦𝗧𝗔𝗧𝗨𝗦 〕━━╮

◈ Process : ONLINE
◈ Uptime : ${uptime}
◈ AI : GROQ
◈ Database : TURSO
◈ WhatsApp : CONNECTED
◈ Runtime : Node.js ${process.version}
◈ Platform : ${process.platform}

╰━━━━━━━━━━━━━━━━━━━━━━╯
${SIGNATURE}
`,
        message
      );

      return;
    }

    // ========================================
    // XCHAT / XAI / XASK
    // ========================================

    if (['chat', 'ai', 'ask'].includes(command)) {
      if (!args) {
        await sendReply(
          sock, jid,
          '⌬ Pose-moi une question pour commencer.',
          message
        );
        return;
      }

      await sock.sendPresenceUpdate('composing', jid);

      const answer = await askGroq(
        jid,
        getNumber(sender),
        args,
        command === 'chat'
      );

      await sock.sendPresenceUpdate('paused', jid);

      await sendReply(
        sock,
        jid,
        answer + SIGNATURE,
        message
      );

      return;
    }

    // ========================================
    // XANIME / XPOLICE
    // ========================================

    if (['anime', 'police'].includes(command)) {
      if (!args) {
        await sendReply(
          sock, jid,
          `Utilisation : X${command} suivi de ta question.`,
          message
        );
        return;
      }

      const instruction = command === 'anime'
        ? 'Réponds comme une experte de la culture anime et manga.'
        : 'Réponds comme une assistante experte en sécurité et en informations générales sur la police, sans prétendre être une agente réelle.';

      const answer = await askGroq(
        jid,
        getNumber(sender),
        `${instruction}\n\n${args}`,
        false
      );

      await sendReply(sock, jid, answer + SIGNATURE, message);
      return;
    }

    // ========================================
    // XIMG
    // ========================================

    if (command === 'img') {
      if (args.toLowerCase().startsWith('create ')) {
        const prompt = args.slice(7).trim();

        await generateImage(sock, jid, prompt, message);
      } else {
        await searchImage(sock, jid, args, message);
      }

      return;
    }

    // ========================================
    // XPLAY / XVIDEO
    // ========================================

    if (command === 'play' || command === 'video') {
      await sendReply(
        sock,
        jid,
        `⌬ Le module ${command === 'play' ? 'audio' : 'vidéo'} n'est pas encore connecté à une source compatible. Je ne vais pas inventer un résultat.`,
        message
      );

      return;
    }

    // ========================================
    // ECONOMY
    // ========================================

    const userId = getNumber(sender);

    if (command === 'daily') {
      const result = await dailyReward(userId);

      if (result.success) {
        await sendReply(
          sock,
          jid,
          `
╭━━〔 🎁 𝗫𝗗𝗔𝗜𝗟𝗬 〕━━╮

◈ Récompense : +350 XCoins
◈ Expérience : +25 XP
◈ Prochaine récompense : 24 heures

╰━━━━━━━━━━━━━━━━━━━━╯
${SIGNATURE}
`,
          message
        );
      } else {
        await sendReply(
          sock,
          jid,
          `⌬ Tu as déjà récupéré ta récompense. Reviens dans ${formatDuration(result.remaining)}.`,
          message
        );
      }

      return;
    }

    if (['coins', 'xp', 'rank', 'profil'].includes(command)) {
      const user = await getUser(userId);

      if (command === 'coins') {
        await sendReply(
          sock, jid,
          `⌬ 𝗫𝗖𝗢𝗜𝗡𝗦 : ${user.coins}${SIGNATURE}`,
          message
        );
      }

      if (command === 'xp') {
        await sendReply(
          sock, jid,
          `⌬ 𝗫𝗣 : ${user.xp}${SIGNATURE}`,
          message
        );
      }

      if (command === 'rank') {
        await sendReply(
          sock, jid,
          `⌬ 𝗥𝗔𝗡𝗞 : ${getRank(Number(user.xp))}${SIGNATURE}`,
          message
        );
      }

      if (command === 'profil') {
        await sendReply(
          sock, jid,
          await getProfile(userId),
          message
        );
      }

      return;
    }

    // ========================================
    // XQUIZ
    // ========================================

    if (command === 'quiz') {
      const key = `${jid}:${userId}`;

      if (activeQuizzes.has(key)) {
        await sendReply(
          sock, jid,
          '⌬ Tu as déjà une question en cours. Réponds avec Xreponse.',
          message
        );
        return;
      }

      const quiz =
        quizQuestions[Math.floor(Math.random() * quizQuestions.length)];

      activeQuizzes.set(key, quiz);

      await sendReply(
        sock,
        jid,
        `
╭━━〔 🧠 𝗫𝗤𝗨𝗜𝗭 〕━━╮

${quiz.question}

⌬ Réponds avec : Xreponse ta réponse

╰━━━━━━━━━━━━━━━━━━╯
${SIGNATURE}
`,
        message
      );

      return;
    }

    // ========================================
    // XREPONSE
    // ========================================

    if (command === 'reponse') {
      if (!args) {
        await sendReply(
          sock, jid,
          'Utilisation : Xreponse ta réponse',
          message
        );
        return;
      }

      const result = await answerQuiz(userId, jid, args);

      await sendReply(
        sock,
        jid,
        result.message + SIGNATURE,
        message
      );

      return;
    }

    // ========================================
    // XANNONCE
    // ========================================

    if (command === 'annonce' && jid.endsWith('@g.us')) {
      if (!isOwner(sender) &&
          !(await isGroupAdmin(sock, jid, sender))) {
        await sendReply(sock, jid, 'Administrateur requis.', message);
        return;
      }

      if (!args) {
        await sendReply(
          sock, jid,
          'Utilisation : Xannonce ton message',
          message
        );
        return;
      }

      await sendReply(
        sock,
        jid,
        `╭━━〔 𝗚𝗥𝗢𝗨𝗣 𝗔𝗡𝗡𝗢𝗨𝗡𝗖𝗘 〕━━╮\n\n${args}\n\n╰━━━━━━━━━━━━━━━━━━╯${SIGNATURE}`,
        message
      );

      return;
    }

    // ========================================
    // XCLEAR — LIMITATION WHATSAPP
    // ========================================

    if (command === 'clear') {
      const context =
        message.message?.extendedTextMessage?.contextInfo;

      if (!context?.stanzaId) {
        await sendReply(
          sock, jid,
          'Réponds à un message envoyé par Sitri-Nel avec Xclear.',
          message
        );
        return;
      }

      const botNumber = getNumber(sock.user.id);
      const quotedSender = getNumber(context.participant || '');

      if (quotedSender !== botNumber) {
        await sendReply(
          sock, jid,
          '⌬ Je ne peux pas garantir la suppression de messages envoyés par d’autres membres.',
          message
        );
        return;
      }

      await sock.sendMessage(jid, {
        delete: {
          remoteJid: jid,
          fromMe: true,
          id: context.stanzaId,
          participant: context.participant
        }
      });

      return;
    }

    // ========================================
    // COMMANDES INCONNUES
    // ========================================

    // Aucun message automatique pour les commandes inconnues.

  } catch (error) {
    logger.error({
      command,
      error: error.message
    }, 'Command execution failed');

    await sendReply(
      sock,
      jid,
      `⌬ Une erreur est survenue pendant l'exécution de X${command}. Réessaie plus tard.${SIGNATURE}`,
      message
    ).catch(() => {});
  }
}

// ==========================================
// WHATSAPP CONNECTION
// ==========================================

let reconnectTimer = null;
let currentSocket = null;
let stopping = false;

async function startBot() {
  stopping = false;

  logger.info('Initializing Sitri-Nel...');

  const { state, saveCreds } =
    await useMultiFileAuthState(SESSION_DIR);

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000
  });

  currentSocket = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      try {
        await handleIncomingMessage(sock, message);
      } catch (error) {
        logger.error(error, 'Incoming message error');
      }
    }
  });

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      logger.info('WhatsApp connection established.');
      return;
    }

    if (connection === 'close') {
      const status =
        lastDisconnect?.error?.output?.statusCode;

      logger.warn({ status }, 'WhatsApp connection closed.');

      if (status === DisconnectReason.loggedOut) {
        stopping = true;
        logger.error('WhatsApp session logged out. New pairing required.');
        return;
      }

      if (!stopping && !reconnectTimer) {
        reconnectTimer = setTimeout(async () => {
          reconnectTimer = null;

          try {
            await startBot();
          } catch (error) {
            logger.error(error, 'Reconnection failed');
          }
        }, 5000);
      }
    }
  });

  // Pairing code
  if (!state.creds.registered) {
    await sleep(3000);

    if (currentSocket !== sock) return;

    try {
      const number = CONFIG.PAIRING_NUMBER.replace(/\D/g, '');

      const code = await sock.requestPairingCode(number);

      logger.info('================================');
      logger.info(`SITRI-NEL PAIRING CODE: ${code}`);
      logger.info('Enter this code in WhatsApp Linked Devices.');
