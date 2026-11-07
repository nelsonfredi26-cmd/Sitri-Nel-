
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==========================================
// 𖤍 SITRI-NEL | CORE CONFIGURATION
// ==========================================

const PREFIX = 'X';
const DAILY_REWARD = 350;
const COOLDOWN = 2500;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sitri-data.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = {};

try {
  if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
} catch (e) {
  console.error('Database error:', e.message);
}

// ==========================================
// ⚡ UNICODE FUTURISTIC FONT
// ==========================================

function futuristicText(text) {
  const normal = [
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'0123456789'
  ];

  const bold = [
    ...'𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭',
    ...'𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇',
    ...'𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵'
  ];

  const fontMap = new Map(
    normal.map((char, index) => [char, bold[index]])
  );

  return Array.from(String(text))
    .map(char => fontMap.get(char) || char)
    .join('');
}

// Signature officielle
function sitriReply(text) {
  return `${futuristicText(text)}

━━━━━━━━━━━━━━
𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟
𝗗𝗘𝗩𝗘𝗟𝗢𝗣𝗘𝗗 𝗕𝗬
𝗞𝗔𝗬≈𝗗𝗘𝗡`;
}

// ==========================================
// 💾 DATABASE
// ==========================================

function saveDB() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(db, null, 2)
    );
  } catch (e) {
    console.error('Save error:', e.message);
  }
}

function getUser(id) {
  if (!db[id]) {
    db[id] = {
      coins: 0,
      xp: 0,
      level: 1,
      lastDaily: 0
    };
  }

  return db[id];
}

function addXP(id, amount) {
  const user = getUser(id);

  user.xp += amount;
  user.level = Math.floor(user.xp / 500) + 1;

  saveDB();
}

// ==========================================
// 🛡️ ANTI-SPAM SYSTEM
// ==========================================

const cooldowns = new Map();
const recentMessages = new Map();

function isSpam(id, text) {
  const now = Date.now();
  const last = cooldowns.get(id) || 0;
  const previous = recentMessages.get(id);

  if (
    previous &&
    previous.text === text &&
    now - previous.time < 8000
  ) {
    return true;
  }

  if (now - last < COOLDOWN) {
    return true;
  }

  cooldowns.set(id, now);
  recentMessages.set(id, {
    text,
    time: now
  });

  if (cooldowns.size > 3000) cooldowns.clear();
  if (recentMessages.size > 3000) recentMessages.clear();

  return false;
}

// ==========================================
// 📝 MESSAGE EXTRACTION
// ==========================================

function unwrapMessage(message) {
  let msg = message;

  while (
    msg?.ephemeralMessage ||
    msg?.viewOnceMessage ||
    msg?.viewOnceMessageV2
  ) {
    msg =
      msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message;
  }

  return msg;
}

function getText(message) {
  if (!message) return '';

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  );
}

// ==========================================
// 🧬 FUTURISTIC MENU
// ==========================================

function getMenu() {
  return `
╭━━〔 ⚡ 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 〕━━╮
   🧬 𝗡𝗘𝗫𝗨𝗦 𝗜𝗡𝗧𝗘𝗟𝗟𝗜𝗚𝗘𝗡𝗧
╰━━━━━━━━━━━━━━╯

⌬ 𝟬𝟭 • 𝗜𝗡𝗧𝗘𝗟𝗟𝗜𝗚𝗘𝗡𝗖𝗘
├ Xchat
├ Xask
├ Xai
├ Xanime
├ Xpolice
└ Xinfo

⌬ 𝟬𝟮 • 𝗘́𝗖𝗢𝗡𝗢𝗠𝗜𝗘
├ Xdaily
├ Xcoins
├ Xp
└ Xrank

⌬ 𝟬𝟯 • 𝗝𝗘𝗨𝗫
└ Xquiz

⌬ 𝟬𝟰 • 𝗠𝗘́𝗗𝗜𝗔𝗦
├ Ximg
├ Xplay
└ Xvideo

⌬ 𝟬𝟱 • 𝗣𝗥𝗢𝗙𝗜𝗟
└ Xprofil

⌬ 𝟬𝟲 • 𝗚𝗥𝗢𝗨𝗣𝗘
├ Xtagall
└ Xannonce

⌬ 𝟬𝟳 • 𝗔𝗗𝗠𝗜𝗡
├ Xkick
├ Xadd
├ Xclear
├ Xoff
├ Xrestart
└ Xonlyadmin

⌬ 𝟬𝟴 • 𝗦𝗬𝗦𝗧𝗘̀𝗠𝗘
├ Xupt
└ Xmenu

━━━━━━━━━━━━━━
⚡ 𝗣𝗥𝗘́𝗙𝗜𝗫𝗘 : X
◈ 𝗦𝗧𝗔𝗧𝗨𝗦 : 𝗢𝗡𝗟𝗜𝗡𝗘

       𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟
       𝗗𝗘𝗩𝗘𝗟𝗢𝗣𝗘𝗗 𝗕𝗬
          𝗞𝗔𝗬≈𝗗𝗘𝗡
`;
}

// ==========================================
// 🧠 GROQ INTELLIGENCE
// ==========================================

async function askAI(prompt) {
  const key = process.env.GROQ_API_KEY;

  if (!key) {
    return 'Mon intelligence artificielle n’est pas configurée.';
  }

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',

        messages: [
          {
            role: 'system',
            content: `
Tu es Sitri-Nel, une intelligence artificielle personnelle.

PERSONNALITÉ :
- Intelligente et autonome.
- Calme, drôle et attentive.
- Élégante et futuriste.
- Naturelle et parfois taquine.
- Français simple et expressions béninoises
  quand le contexte s'y prête.

STYLE :
- Réponses claires et agréables.
- Évite les longs discours inutiles.
- Utilise des emojis avec modération.
- Ne répète pas toujours les mêmes phrases.
- Ne prétends jamais avoir réalisé une action
  que tu n'as pas réellement effectuée.

Tu es Sitri-Nel.
`
          },
          {
            role: 'user',
            content: prompt
          }
        ],

        temperature: 0.8,
        max_tokens: 500
      },
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    return response.data.choices[0].message.content.trim();

  } catch (e) {
    console.error('Groq error:', e.response?.data || e.message);

    return 'Mon système IA rencontre momentanément un problème. Réessaie dans un instant.';
  }
}

// ==========================================
// 🚀 WHATSAPP CONNECTION
// ==========================================

let reconnecting = false;

async function start() {
  const { state, saveCreds } =
    await useMultiFileAuthState('session');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),

    browser: ['Ubuntu', 'Chrome', '20.0.04'],

    markOnlineOnConnect: false,
    syncFullHistory: false,

    getMessage: async () => undefined
  });

  let pairingRequested = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;

    if (
      connection === 'connecting' &&
      !state.creds.registered &&
      !pairingRequested
    ) {
      pairingRequested = true;

      try {
        const number = (
          process.env.PAIRING_NUMBER || ''
        ).replace(/\D/g, '');

        if (!number) {
          console.log('PAIRING_NUMBER manquant.');
          return;
        }

        await new Promise(r => setTimeout(r, 3000));

        const code = await sock.requestPairingCode(number);

        console.log('𖤍 CODE DE PAIRAGE : ' + code);

      } catch (e) {
        pairingRequested = false;
        console.error('Pairing error:', e.message);
      }
    }

    if (connection === 'open') {
      reconnecting = false;
      console.log('✓ SITRI-NEL CONNECTÉE !');
    }

    if (connection === 'close' && !reconnecting) {
      const status =
        lastDisconnect?.error?.output?.statusCode;

      if (status === DisconnectReason.loggedOut) {
        console.log('Session déconnectée. Nouveau pairage nécessaire.');
        return;
      }

      reconnecting = true;
      console.log('Reconnexion dans 5 secondes...');

      setTimeout(() => {
        reconnecting = false;
        start().catch(console.error);
      }, 5000);
    }
  });

// ==========================================
// 📩 MESSAGE HANDLER
// ==========================================

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const m of messages) {
      try {
        if (!m.message || m.key.fromMe) continue;

        const from = m.key.remoteJid;

        if (!from || from === 'status@broadcast') continue;

        const isGroup = from.endsWith('@g.us');

        const sender = isGroup
          ? m.key.participant
          : from;

        if (!sender) continue;

        const message = unwrapMessage(m.message);
        const text = getText(message).trim();

        if (!text) continue;

        // Préfixe X insensible à la casse
        const match = text.match(
          /^X([a-z]+)(?:\s+([\s\S]*))?$/i
        );

        // Aucun préfixe = aucun message
        if (!match) continue;

        const command = match[1].toLowerCase();
        const args = (match[2] || '').trim();

        // Commandes actuellement programmées
        const allowed = [
          'menu',
          'help',
          'ping',
          'upt',
          'daily',
          'coins',
          'p',
          'rank',
          'ai',
          'ask',
          'chat'
        ];

        // Commande inconnue = silence
        if (!allowed.includes(command)) continue;

        // Anti-spam
        if (isSpam(sender, text)) continue;

        const user = getUser(sender);

        // ==================================
        // ⚡ XMENU / XHELP
        // ==================================

        if (
          command === 'menu' ||
          command === 'help'
        ) {
          await sock.sendMessage(
            from,
            { text: getMenu() },
            { quoted: m }
          );

          continue;
        }

        // ==================================
        // ⚡ XPING
        // ==================================

        if (command === 'ping') {
          await sock.sendMessage(
            from,
            {
              text: sitriReply(
                'Système opérationnel ! Sitri-Nel est connectée.'
              )
            },
            { quoted: m }
          );

          continue;
        }

        // ==================================
        // ⚙️ XUPT
        // ==================================

        if (command === 'upt') {
          const uptime = Math.floor(process.uptime());

          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);
          const seconds = uptime % 60;

          await sock.sendMessage(
            from,
            {
              text: sitriReply(
                `Système actif depuis : ${hours}h ${minutes}min ${seconds}s.`
              )
            },
            { quoted: m }
          );

          continue;
        }

        // ==================================
        // 💎 XDAILY
        // ==================================

        if (command === 'daily') {
          const now = Date.now();

          const remaining =
            86400000 - (now - user.lastDaily);

          if (remaining > 0) {
            const hours = Math.floor(
              remaining / 3600000
            );

            const minutes = Math.floor(
              (remaining % 3600000) / 60000
            );

            await sock.sendMessage(
              from,
              {
                text: sitriReply(
                  `Bonus déjà récupéré. Prochain bonus dans ${hours}h ${minutes}min.`
                )
              },
              { quoted: m }
            );

            continue;
          }

          user.coins += DAILY_REWARD;
          user.lastDaily = now;
          user.xp += 25;
          user.level = Math.floor(user.xp / 500) + 1;

          saveDB();

          const dailyMessage = `
〔 💠 𝗫𝗗𝗔𝗜𝗟𝗬 〕
   𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟 • 𝗥𝗘𝗪𝗔𝗥𝗗𝗦
━━━━━━━━━━━━━━

       ✦ +${DAILY_REWARD}
        𝗫𝗖𝗢𝗜𝗡𝗦

◈ 𝗥𝗘́𝗖𝗢𝗠𝗣𝗘𝗡𝗦𝗘 𝗥𝗘́𝗖𝗨𝗣𝗘́𝗥𝗘́𝗘

━━━━━━━━━━━━━━
⏳ 𝗣𝗥𝗢𝗖𝗛𝗔𝗜𝗡 𝗕𝗢𝗡𝗨𝗦
         𝟮𝟰𝗛

◈ 𝗦𝗢𝗟𝗗𝗘 𝗔𝗖𝗧𝗨𝗘𝗟
   ${user.coins.toLocaleString('fr-FR')} XCoins

━━━━━━━━━━━━━━
      𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟
     𝗗𝗘𝗩𝗘𝗟𝗢𝗣𝗘𝗗 𝗕𝗬
        𝗞𝗔𝗬≈𝗗𝗘𝗡
`;

          await sock.sendMessage(
            from,
            { text: dailyMessage },
            { quoted: m }
          );

          continue;
        }

        // ==================================
        // 💰 XCOINS
        // ==================================

        if (command === 'coins') {
          await sock.sendMessage(
            from,
            {
              text: sitriReply(
                `Portefeuille : ${user.coins.toLocaleString('fr-FR')} XCoins.`
              )
            },
            { quoted: m }
          );

          continue;
        }

        // ==================================
        // ⚡ XP
        // ==================================

        if (command === 'p') {
          await sock.sendMessage(
            from,
            {
              text: sitriReply(
                `Niveau : ${user.level}\nExpérience : ${user.xp} XP\nSolde : ${user.coins} XCoins`
              )
            },
            { quoted: m }
          );

          continue;
        }

        // ==================================
        // 🏆 XRANK
        // ==================================

        if (command === 'rank') {
          const ranking = Object.entries(db)
            .filter(([id, value]) =>
              !id.startsWith('chat_') &&
              value &&
              typeof value.xp === 'number'
            )
            .sort((a, b) => b[1].xp - a[1].xp)
            .slice(0, 10);

          let result = '〔 🏆 𝗫𝗥𝗔𝗡𝗞 〕\n\n';

          ranking.forEach(([id, data], i) => {
            result +=
              `${i + 1}. ${id.split('@')[0]}\n`;

            result +=
              `   LVL ${data.level} • ${data.xp} XP\n\n`;
          });

          result += `
━━━━━━━━━━━━━━
𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟
𝗗𝗘𝗩𝗘𝗟𝗢𝗣𝗘𝗗 𝗕𝗬
𝗞𝗔𝗬≈𝗗𝗘𝗡`;

          await sock.sendMessage(
            from,
            { text: result },
            { quoted: m }
          );

          continue;
        }

        // ==================================
        // 🧠 XAI / XASK / XCHAT
        // ==================================

        if (
          command === 'ai' ||
          command === 'ask' ||
          command === 'chat'
        ) {
          if (!args) {
            await sock.sendMessage(
              from,
              {
                text: sitriReply(
                  `Écris ta question après la commande.\nExemple : X${command} Qui es-tu ?`
                )
              },
              { quoted: m }
            );

            continue;
          }

          const answer = await askAI(args);

          addXP(sender, 10);

          await sock.sendMessage(
            from,
            {
              text: sitriReply(answer)
            },
            { quoted: m }
          );

          continue;
        }

      } catch (e) {
        console.error('Message handler error:', e.message);
      }
    }
  });
}

// ==========================================
// 🔌 START SITRI-NEL
// ==========================================

start().catch(error => {
  console.error('Startup error:', error);
});
         
