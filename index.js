
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════
// SITRI-NEL • CONFIGURATION
// ═══════════════════════════════════

const PREFIX = "X";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GROQ_KEY = process.env.GROQ_API_KEY;
const PAIRING_NUMBER = process.env.PAIRING_NUMBER;
const OWNER_NUMBERS = (process.env.OWNER_NUMBERS || "")
  .split(",")
  .map(n => n.replace(/\D/g, ""))
  .filter(Boolean);

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "sitri-data.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return { users: {}, groups: {} };
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getUser(id, name = "Utilisateur") {
  if (!db.users[id]) {
    db.users[id] = {
      name,
      coins: 0,
      xp: 0,
      lastDaily: 0
    };
  }
  db.users[id].name = name || db.users[id].name;
  return db.users[id];
}

// ═══════════════════════════════════
// MENU OFFICIEL — NE PAS MODIFIER
// ═══════════════════════════════════

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

// ═══════════════════════════════════
// STYLE UNICODE GRAS
// ═══════════════════════════════════

function futuristic(text) {
  const normal = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bold = [
    ..."𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙",
    ..."𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳",
    ..."𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗"
  ].join("");

  const map = {};
  [...normal].forEach((c, i) => map[c] = [...bold][i]);

  return String(text).normalize("NFD").split("").map(c => {
    if (/\p{M}/u.test(c)) return c;
    return map[c] || c;
  }).join("").normalize("NFC");
}

// ═══════════════════════════════════
// GROQ • INTELLIGENCE ENGINE
// ═══════════════════════════════════

const conversations = new Map();

async function askGroq(userId, question, mode = "ai") {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY manquante.");

  const instructions = {
    chat: `Tu es Sitri-Nel, une intelligence artificielle sophistiquée.
Tu es calme, intelligente, naturelle, drôle avec subtilité et attentive.
Tu parles français par défaut. Tu peux utiliser d'autres langues si nécessaire.
Tu réponds comme une véritable interlocutrice, sans prétendre être humaine.
Tu conserves le contexte de la conversation.
Tes réponses sont utiles, précises et pas inutilement longues.`,

    ask: `Tu es Sitri-Nel, une intelligence artificielle experte.
Tu analyses les questions avec attention.
Tu donnes des réponses détaillées, structurées et pédagogiques.
Tu expliques les notions difficiles avec des exemples simples.
Tu ne prétends pas connaître une information si tu n'en es pas sûre.`,

    ai: `Tu es Sitri-Nel, une intelligence artificielle polyvalente.
Tu réponds aux questions de culture générale, sciences, technologie,
histoire, géographie, rédaction, raisonnement et vie quotidienne.
Tu es précise, naturelle, intelligente et claire.
Tu ne prétends pas connaître une information si tu n'en es pas sûre.`
  };

  let history = conversations.get(userId) || [];

  const messages = [
    { role: "system", content: instructions[mode] || instructions.ai },
    ...history,
    { role: "user", content: question }
  ];

  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: MODEL,
      messages,
      temperature: 0.7,
      max_completion_tokens: 1200
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );

  const answer = response.data?.choices?.[0]?.message?.content?.trim();

  if (!answer) throw new Error("Réponse vide reçue de Groq.");

  if (mode === "chat") {
    history.push(
      { role: "user", content: question },
      { role: "assistant", content: answer }
    );

    conversations.set(userId, history.slice(-12));
  }

  return answer;
}

// ═══════════════════════════════════
// OUTILS WHATSAPP
// ═══════════════════════════════════

function getText(message) {
  let msg = message;
  while (msg?.ephemeralMessage || msg?.viewOnceMessage || msg?.viewOnceMessageV2) {
    msg = msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message;
  }

  return msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    msg?.documentMessage?.caption ||
    msg?.buttonsResponseMessage?.selectedButtonId ||
    msg?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    "";
}

async function reply(sock, jid, text, quoted) {
  return sock.sendMessage(
    jid,
    { text: futuristic(text) },
    quoted ? { quoted } : {}
  );
}

function getNumber(jid) {
  return jid.split("@")[0].split(":")[0];
}

function isOwner(jid) {
  return OWNER_NUMBERS.includes(getNumber(jid));
}

async function isGroupAdmin(sock, jid, sender) {
  const metadata = await sock.groupMetadata(jid);
  const participant = metadata.participants.find(p =>
    p.id === sender || p.jid === sender
  );
  return participant?.admin === "admin" || participant?.admin === "superadmin";
}

async function getBotAdmin(sock, jid) {
  const metadata = await sock.groupMetadata(jid);
  const botNumber = getNumber(sock.user.id);
  const bot = metadata.participants.find(p => getNumber(p.id) === botNumber);
  return bot?.admin === "admin" || bot?.admin === "superadmin";
}

// ═══════════════════════════════════
// COMMANDES
// ═══════════════════════════════════

const quizList = [
  { q: "Quelle est la capitale du Japon ?", a: "Tokyo" },
  { q: "Combien de côtés possède un hexagone ?", a: "6" },
  { q: "Quelle planète est surnommée la planète rouge ?", a: "Mars" },
  { q: "Quel est le plus grand océan du monde ?", a: "Pacifique" },
  { q: "Combien font 12 × 8 ?", a: "96" }
];

const activeQuizzes = new Map();

async function handleCommand(sock, msg, command, args, jid, sender, user) {
  const isGroup = jid.endsWith("@g.us");
  const name = msg.pushName || "Utilisateur";
  const text = args.trim();

  switch (command) {

    // ───── SYSTEM ─────

    case "menu":
    case "help":
      return reply(sock, jid, getMenu(), msg);

    case "upt":
    case "ping":
      return reply(sock, jid,
        `⌬ SYSTEM ONLINE\n⌬ Latence : ${Date.now() - msg.messageTimestamp * 1000} ms\n⌬ Intelligence : ${MODEL}\n⌬ État : OPÉRATIONNEL`,
        msg
      );

    // ───── INTELLIGENCE ─────

    case "ai":
    case "ask":
    case "chat": {
      if (!text) {
        return reply(sock, jid,
          command === "chat"
            ? "Indique un sujet pour commencer notre conversation.\nExemple : Xchat Parlons de technologie."
            : "Ta question est attendue.\nExemple : Xai Quelle est la capitale de la France ?",
          msg
        );
      }

      await sock.sendMessage(jid, { react: { text: "🧠", key: msg.key } });

      try {
        const mode = command === "chat" ? "chat" :
          command === "ask" ? "ask" : "ai";

        const answer = await askGroq(sender, text, mode);

        user.xp += 5;
        saveDB();

        return reply(sock, jid,
          `⌬ 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟\n\n${answer}\n\n𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟`,
          msg
        );
      } catch (error) {
        console.error("GROQ ERROR:", error.response?.data || error.message);

        let errorMessage = "Une erreur technique empêche actuellement ma réponse.";

        if (error.response?.status === 401) {
          errorMessage = "La clé Groq est refusée. Vérifie GROQ_API_KEY sur Railway.";
        } else if (error.response?.status === 429) {
          errorMessage = "La limite de requêtes Groq est atteinte. Réessaie un peu plus tard.";
        } else if (error.response?.status === 400) {
          errorMessage = "Le modèle ou les paramètres Groq sont refusés. Vérifie GROQ_MODEL.";
        } else if (error.code === "ECONNABORTED") {
          errorMessage = "Le serveur IA met trop de temps à répondre. Réessaie.";
        }

        return reply(sock, jid,
          `⌬ 𝗦𝗬𝗦𝗧𝗘𝗠 𝗔𝗟𝗘𝗥𝗧\n\n${errorMessage}\n\nCode : ${error.response?.status || error.code || "UNKNOWN"}`,
          msg
        );
      }
    }

    case "anime":
      if (!text) return reply(sock, jid, "Exemple : Xanime Présente-moi One Piece.", msg);
      try {
        return reply(sock, jid, await askGroq(sender,
          `Réponds à cette demande concernant les animes : ${text}`, "ai"), msg);
      } catch (e) {
        console.error(e.message);
        return reply(sock, jid, "Le module anime est temporairement indisponible.", msg);
      }

    case "police":
      if (!text) return reply(sock, jid, "Exemple : Xpolice Corrige ce texte : ...", msg);
      try {
        return reply(sock, jid, await askGroq(sender,
          `Corrige le texte suivant en conservant son sens. Donne la version corrigée et une courte explication : ${text}`,
          "ask"), msg);
      } catch (e) {
        console.error(e.message);
        return reply(sock, jid, "Le module de correction est temporairement indisponible.", msg);
      }

    case "info":
      return reply(sock, jid,
        `𖤍 𝗦𝗜𝗧𝗥𝗜-𝗡𝗘𝗟\n\nIntelligence artificielle conversationnelle.\nCréation : KAY≈DEN\nMoteur IA : Groq\nModèle : ${MODEL}\nPréfixe : X\nVersion : 1.0`,
        msg
      );

    // ───── ECONOMY ─────

    case "daily": {
      const now = Date.now();
      const cooldown = 24 * 60 * 60 * 1000;
      const remaining = cooldown - (now - user.lastDaily);

      if (remaining > 0) {
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);

        return reply(sock, jid,
          `⌬ 𝗥𝗘𝗖𝗛𝗔𝗥𝗚𝗘 𝗘𝗡 𝗖𝗢𝗨𝗥𝗦\n\nProchaine récompense dans ${hours}h ${minutes}min.`,
          msg
        );
      }

      user.lastDaily = now;
      user.coins += 350;
      user.xp += 25;
      saveDB();

      return reply(sock, jid,
        `╭━━〔 💰 𝗫𝗗𝗔𝗜𝗟𝗬 🧬 〕━━╮\n\n⌬ Récompense quotidienne : +350 XCoins\n⌬ Expérience : +25 XP\n\nSolde : ${user.coins} XCoins\n\n╰━━━━━━━━━━━━━━━━━━╯`,
        msg
      );
    }

    case "coins":
      return reply(sock, jid,
        `⌬ 𝗫𝗖𝗢𝗜𝗡𝗦\n\nUtilisateur : ${name}\nSolde : ${user.coins} XCoins`,
        msg
      );

    case "p":
      return reply(sock, jid,
        `⌬ 𝗣𝗥𝗢𝗚𝗥𝗘𝗦𝗦𝗜𝗢𝗡\n\nXP : ${user.xp}\nNiveau : ${Math.floor(user.xp / 500) + 1}\nProchain niveau : ${500 - (user.xp % 500)} XP`,
        msg
      );

    case "rank": {
      const ranking = Object.entries(db.users)
        .sort((a, b) => b[1].xp - a[1].xp)
        .slice(0, 10);

      const lines = ranking.map(([id, u], i) =>
        `${i + 1}. ${u.name || getNumber(id)} — ${u.xp} XP`
      );

      return reply(sock, jid,
        `⌬ 𝗫𝗥𝗔𝗡𝗞 • TOP 10\n\n${lines.join("\n") || "Aucun classement disponible."}`,
        msg
      );
    }

    // ───── ENTERTAINMENT ─────

    case "quiz": {
      const quiz = quizList[Math.floor(Math.random() * quizList.length)];
      activeQuizzes.set(sender, quiz);

      return reply(sock, jid,
        `╭━━〔 🧩 𝗫𝗤𝗨𝗜𝗭 〕━━╮\n\n${quiz.q}\n\nRéponds avec : Xreponse ta réponse\n\n╰━━━━━━━━━━━━━━━━━━╯`,
        msg
      );
    }

    case "reponse": {
      const quiz = activeQuizzes.get(sender);
      if (!quiz) return reply(sock, jid, "Aucun quiz actif. Lance Xquiz.", msg);

      activeQuizzes.delete(sender);

      if (text.toLowerCase().trim() === quiz.a.toLowerCase()) {
        user.coins += 30;
        user.xp += 20;
        saveDB();
        return reply(sock, jid, "⌬ Réponse exacte ! +30 XCoins et +20 XP.", msg);
      }

      return reply(sock, jid, `Réponse incorrecte. La bonne réponse était : ${quiz.a}`, msg);
    }

    // ───── PROFILE ─────

    case "profil":
    case "profile":
      return reply(sock, jid,
        `╭━━〔 👤 𝗣𝗥𝗢𝗙𝗜𝗟 〕━━╮\n\nNom : ${name}\nXP : ${user.xp}\nNiveau : ${Math.floor(user.xp / 500) + 1}\nXCoins : ${user.coins}\n\n╰━━━━━━━━━━━━━━━━━━╯`,
        msg
      );

    // ───── GROUP ─────

    case "tagall": {
      if (!isGroup) return reply(sock, jid, "Cette commande fonctionne dans un groupe.", msg);

      const admin = await isGroupAdmin(sock, jid, sender);
      if (!admin && !isOwner(sender)) return reply(sock, jid, "Commande réservée aux administrateurs.", msg);

      const metadata = await sock.groupMetadata(jid);
      const mentions = metadata.participants.map(p => p.id);
      const message = text || "⌬ Attention, rassemblement demandé.";

      return sock.sendMessage(jid, {
        text: futuristic(message),
        mentions
      }, { quoted: msg });
    }

    case "annonce": {
      if (!isGroup) return reply(sock, jid, "Cette commande fonctionne dans un groupe.", msg);
      if (!text) return reply(sock, jid, "Ajoute le texte de ton annonce.", msg);

      const admin = await isGroupAdmin(sock, jid, sender);
      if (!admin && !isOwner(sender)) return reply(sock, jid, "Commande réservée aux administrateurs.", msg);

      return reply(sock, jid, `⌬ 𝗔𝗡𝗡𝗢𝗡𝗖𝗘\n\n${text}\n\n𖤍 SITRI-NEL`, msg);
    }

    case "kick": {
      if (!isGroup) return reply(sock, jid, "Cette commande fonctionne dans un groupe.", msg);

      const admin = await isGroupAdmin(sock, jid, sender);
      const botAdmin = await getBotAdmin(sock, jid);

      if (!admin && !isOwner(sender)) return reply(sock, jid, "Commande réservée aux administrateurs.", msg);
      if (!botAdmin) return reply(sock, jid, "Je dois être administratrice du groupe pour effectuer cette action.", msg);

      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        || msg.message?.extendedTextMessage?.contextInfo?.participant;

      if (!target) return reply(sock, jid, "Mentionne un membre ou réponds à son message.", msg);

      await sock.groupParticipantsUpdate(jid, [target], "remove");
      return reply(sock, jid, "⌬ Action effectuée.", msg);
    }

    case "add": {
      if (!isGroup) return reply(sock, jid, "Cette commande fonctionne dans un groupe.", msg);

      const admin = await isGroupAdmin(sock, jid, sender);
      const botAdmin = await getBotAdmin(sock, jid);

      if (!admin && !isOwner(sender)) return reply(sock, jid, "Commande réservée aux administrateurs.", msg);
      if (!botAdmin) return reply(sock, jid, "Je dois être administratrice du groupe.", msg);

      const number = text.replace(/\D/g, "");
      if (number.length < 8) return reply(sock, jid, "Indique un numéro avec son indicatif.", msg);

      await sock.groupParticipantsUpdate(jid, [`${number}@s.whatsapp.net`], "add");
      return reply(sock, jid, "⌬ Demande d'ajout transmise à WhatsApp.", msg);
    }

    case "onlyadmin": {
      if (!isGroup) return reply(sock, jid, "Cette commande fonctionne dans un groupe.", msg);

      const admin = await isGroupAdmin(sock, jid, sender);
      const botAdmin = await getBotAdmin(sock, jid);

      if (!admin && !isOwner(sender)) return reply(sock, jid, "Commande réservée aux administrateurs.", msg);
      if (!botAdmin) return reply(sock, jid, "Je dois être administratrice du groupe.", msg);

      const metadata = await sock.groupMetadata(jid);
      const enable = metadata.announce !== true;

      await sock.groupSettingUpdate(jid, enable ? "announcement" : "not_announcement");

      return reply(sock, jid,
        enable ? "⌬ Mode administrateurs activé." : "⌬ Mode messages ouvert à tous.",
        msg
      );
    }

    case "clear": {
      const quoted = msg.message?.extendedTextMessage?.contextInfo;
      if (!quoted?.stanzaId) return reply(sock, jid, "Réponds au message que tu souhaites supprimer.", msg);

      const admin = isGroup ? await isGroupAdmin(sock, jid, sender) : isOwner(sender);
      if (!admin && !isOwner(sender)) return reply(sock, jid, "Autorisation insuffisante.", msg);

      await sock.sendMessage(jid, {
        delete: {
          remoteJid: jid,
          fromMe: quoted.participant ? false : true,
          id: quoted.stanzaId,
          participant: quoted.participant
        }
      });

      return;
    }

    // ───── MULTIMEDIA ─────

    case "img":
    case "play":
    case "video":
      return reply(sock, jid,
        `⌬ 𝗠𝗢𝗗𝗨𝗟𝗘 𝗡𝗢𝗡 𝗖𝗢𝗡𝗙𝗜𝗚𝗨𝗥𝗘\n\nLa commande ${PREFIX}${command} est prévue dans le menu, mais son service externe n'est pas encore relié.\nJe ne vais pas simuler un résultat.`,
        msg
      );

    // ───── OWNER ─────

    case "off":
      if (!isOwner(sender)) return reply(sock, jid, "Commande réservée au propriétaire.", msg);
      await reply(sock, jid, "⌬ Déconnexion demandée.", msg);
      return sock.logout();

    case "restart":
      if (!isOwner(sender)) return reply(sock, jid, "Commande réservée au propriétaire.", msg);
      await reply(sock, jid, "⌬ Redémarrage du système...", msg);
      setTimeout(() => process.exit(0), 1000);
      return;

    default:
      return;
  }
}

// ═══════════════════════════════════
// CONNEXION WHATSAPP
// ═══════════════════════════════════

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Sitri-Nel", "Chrome", "1.0.0"],
    markOnlineOnConnect: true,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  // ═══════════════════════════════════
// CODE D'ASSOCIATION WHATSAPP
// ═══════════════════════════════════

let pairingRequested = false;

sock.ev.on("connection.update", async ({ connection }) => {
  if (
    connection === "open" &&
    !state.creds.registered &&
    PAIRING_NUMBER &&
    !pairingRequested
  ) {
    pairingRequested = true;

    try {
      const number = PAIRING_NUMBER.replace(/\D/g, "");

      const code = await sock.requestPairingCode(number);

      console.log("════════════════════════════");
      console.log("SITRI-NEL PAIRING CODE:", code);
      console.log("════════════════════════════");
    } catch (error) {
      pairingRequested = false;
      console.error("PAIRING ERROR:", error);
    }
  }
});

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("SITRI-NEL CONNECTED SUCCESSFULLY");
    }

    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;

      console.log("CONNECTION CLOSED:", status);

      if (status !== DisconnectReason.loggedOut) {
        setTimeout(startBot, 5000);
      } else {
        console.log("Session déconnectée. Une nouvelle association est nécessaire.");
      }
    }
  });

  
  // ═════════════════════════════════
  // RÉCEPTION DES MESSAGES
  // ═════════════════════════════════

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        if (!jid || jid === "status@broadcast") continue;

        const sender = msg.key.participant || jid;
        const name = msg.pushName || "Utilisateur";
        const user = getUser(sender, name);

        const body = getText(msg.message).trim();
        if (!body) continue;

        const match = body.match(/^X([a-z]+)(?:\s+([\s\S]*))?$/i);
        if (!match) continue;

        const command = match[1].toLowerCase();
        const args = match[2] || "";

        console.log(`COMMAND: X${command} | FROM: ${sender}`);

        await handleCommand(
          sock,
          msg,
          command,
          args,
          jid,
          sender,
          user
        ); in

      } catch (error) {
        console.error("MESSAGE ERROR:", error.stack || error);

        try {
          await reply(
            sock,
            msg.key.remoteJid,
            "⌬ Une erreur est survenue pendant le traitement de cette commande."
          );
        } catch {}
      }
    }
  });
}

startBot().catch(error => {
  console.error("STARTUP ERROR:", error);
  process.exit(1);
});
        
