import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} from "@whiskeysockets/baileys";
import { createClient } from "@libsql/client";
import axios from "axios";
import pino from "pino";
import qrcode from "qrcode-terminal";
import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";
import ytSearch from "yt-search";
import ytdl from "@distube/ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

// ============================================================================
// CONFIGURATION & CLIENTS
// ============================================================================
const CONFIG = {
  prefix: process.env.BOT_PREFIX || ".",
  groqApiKey: process.env.GROQ_API_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  pixabayApiKey: process.env.PIXABAY_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || "imagen-3.0-generate-002",
  dbUrl: process.env.TURSO_DATABASE_URL || "file:sitri_nel.db",
  dbAuthToken: process.env.TURSO_AUTH_TOKEN || undefined,
  tempDir: path.join(os.tmpdir(), "sitri-nel-media")
};

fs.mkdirSync(CONFIG.tempDir, { recursive: true });

const logger = pino({ level: process.env.LOG_LEVEL || "silent" });
const groq = CONFIG.groqApiKey ? new Groq({ apiKey: CONFIG.groqApiKey }) : null;
const ai = CONFIG.geminiApiKey ? new GoogleGenAI({ apiKey: CONFIG.geminiApiKey }) : null;
const db = createClient({
  url: CONFIG.dbUrl,
  authToken: CONFIG.dbAuthToken
});

async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getMessageText(msg) {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedId ||
    ""
  ).trim();
}

function cleanupFiles(filePaths = []) {
  for (const fp of filePaths) {
    try {
      if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // Ignorer les erreurs de suppression temporaire
    }
  }
}

// ============================================================================
// 1. GROS CERVEAU (GROQ + ANILIST GRAPHQL + MÉMOIRE SQLITE/TURSO)
// ============================================================================
async function queryAniList(searchTerm) {
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        title { romaji english native }
        episodes
        status
        seasonYear
        averageScore
        genres
        description(asHtml: false)
        coverImage { extraLarge large }
        characters(perPage: 5, sort: [ROLE, FAVOURITES_DESC]) {
          nodes {
            name { full }
          }
        }
      }
      Character(search: $search) {
        name { full native }
        gender
        age
        description(asHtml: false)
        image { large }
        media(perPage: 3, sort: POPULARITY_DESC) {
          nodes {
            title { romaji english }
          }
        }
      }
    }
  `;

  try {
    const res = await axios.post(
      "https://graphql.anilist.co",
      { query, variables: { search: searchTerm } },
      { timeout: 10000 }
    );
    return res.data?.data || null;
  } catch {
    return null;
  }
}

async function getChatHistory(chatJid, limit = 8) {
  const res = await db.execute({
    sql: "SELECT role, content FROM chat_history WHERE chat_jid = ? ORDER BY id DESC LIMIT ?",
    args: [chatJid, limit]
  });
  return res.rows.reverse().map((r) => ({
    role: r.role === "assistant" ? "assistant" : "user",
    content: String(r.content)
  }));
}

async function saveMessage(chatJid, role, content) {
  await db.execute({
    sql: "INSERT INTO chat_history (chat_jid, role, content) VALUES (?, ?, ?)",
    args: [chatJid, role, content]
  });
}

async function askBigBrain(chatJid, promptText) {
  if (!groq) {
    return "Clé GROQ_API_KEY manquante dans l'environnement.";
  }

  const aniData = await queryAniList(promptText);
  const history = await getChatHistory(chatJid, 6);

  const systemPrompt = [
    "Tu es Sitri-Nel, une intelligence artificielle ultra-précise, rapide et érudite.",
    "Tu réponds en français clair, direct et structuré.",
    "Tu maîtrises la culture générale, les sciences, l'histoire, la programmation et l'univers anime/manga avec une exactitude rigoureuse.",
    "Si des données AniList sont fournies, utilise-les en priorité pour les faits sur l'anime ou le personnage, et signale clairement si une information n'est pas confirmée."
  ].join(" ");

  const contextBlock = aniData
    ? `\n[DONNÉES ANILIST RÉFÉRENCE]\n${JSON.stringify({
        media: aniData.Media
          ? {
              titre: aniData.Media.title,
              episodes: aniData.Media.episodes,
              annee: aniData.Media.seasonYear,
              score: aniData.Media.averageScore,
              genres: aniData.Media.genres,
              personnages: aniData.Media.characters?.nodes?.map((n) => n.name.full),
              resume: aniData.Media.description?.slice(0, 500)
            }
          : null,
        character: aniData.Character
          ? {
              nom: aniData.Character.name,
              age: aniData.Character.age,
              animes: aniData.Character.media?.nodes?.map((m) => m.title.romaji || m.title.english),
              description: aniData.Character.description?.slice(0, 400)
            }
          : null
      })}`
    : "";

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: `${promptText}${contextBlock}` }
  ];

  const completion = await groq.chat.completions.create({
    model: CONFIG.groqModel,
    messages,
    temperature: 0.4,
    max_tokens: 1200
  });

  const answer =
    completion.choices?.[0]?.message?.content?.trim() ||
    "Aucune réponse générée.";

  await saveMessage(chatJid, "user", promptText);
  await saveMessage(chatJid, "assistant", answer);

  return answer;
}

// ============================================================================
// 2. RECHERCHE PHOTO DANS GRANDE BIBLIOTHÈQUE (PIXABAY + ANILIST + SHARP)
// ============================================================================
async function searchLibraryPhoto(query) {
  if (CONFIG.pixabayApiKey) {
    try {
      const res = await axios.get("https://pixabay.com/api/", {
        params: {
          key: CONFIG.pixabayApiKey,
          q: query,
          image_type: "all",
          safesearch: true,
          per_page: 10
        },
        timeout: 12000
      });
      const hits = res.data?.hits || [];
      if (hits.length > 0) {
        const picked = hits[Math.floor(Math.random() * Math.min(hits.length, 5))];
        const imgUrl = picked.largeImageURL || picked.webformatURL;
        const imgRes = await axios.get(imgUrl, { responseType: "arraybuffer", timeout: 15000 });
        const buffer = await sharp(Buffer.from(imgRes.data))
          .resize({ width: 1280, withoutEnlargement: true })
          .jpeg({ quality: 88 })
          .toBuffer();

        return {
          buffer,
          caption: `Photo trouvée : ${picked.tags || query}`
        };
      }
    } catch {
      // Fallback vers AniList
    }
  }

  const aniData = await queryAniList(query);
  const aniImgUrl =
    aniData?.Character?.image?.large ||
    aniData?.Media?.coverImage?.extraLarge ||
    aniData?.Media?.coverImage?.large;

  if (aniImgUrl) {
    const imgRes = await axios.get(aniImgUrl, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = await sharp(Buffer.from(imgRes.data))
      .resize({ width: 1280, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    const title =
      aniData?.Character?.name?.full ||
      aniData?.Media?.title?.english ||
      aniData?.Media?.title?.romaji ||
      query;

    return {
      buffer,
      caption: `Visuel trouvé : ${title}`
    };
  }

  return null;
}

// ============================================================================
// 3. SON (AUDIO) & VIDÉO DIRECTS (YT-SEARCH + YTDL + FFMPEG)
// ============================================================================
function convertToMp3(inputStream, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputStream)
      .audioBitrate(128)
      .audioCodec("libmp3lame")
      .format("mp3")
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

function transcodeToMp4(inputStream, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputStream)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-movflags +faststart", "-crf 26", "-preset veryfast"])
      .format("mp4")
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

async function fetchMediaFromYouTube(query, mode = "audio") {
  const searchRes = await ytSearch(query);
  const video = searchRes?.videos?.[0];
  if (!video || !video.url) {
    throw new Error("Aucun résultat trouvé.");
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (mode === "audio") {
    const outMp3 = path.join(CONFIG.tempDir, `${stamp}.mp3`);
    const audioStream = ytdl(video.url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25
    });
    await convertToMp3(audioStream, outMp3);
    const buffer = fs.readFileSync(outMp3);
    cleanupFiles([outMp3]);
    return {
      title: video.title,
      buffer
    };
  }

  const outMp4 = path.join(CONFIG.tempDir, `${stamp}.mp4`);
  const videoStream = ytdl(video.url, {
    filter: (fmt) => fmt.container === "mp4" && fmt.hasVideo && fmt.hasAudio,
    quality: "highest",
    highWaterMark: 1 << 25
  });
  await transcodeToMp4(videoStream, outMp4);
  const buffer = fs.readFileSync(outMp4);
  cleanupFiles([outMp4]);
  return {
    title: video.title,
    buffer
  };
}

// ============================================================================
// 4. GÉNÉRATION D'IMAGE & CARTES NUMÉRIQUES SANS TEXTE (.img / .carte)
// ============================================================================
async function generateCleanArt(prompt, { isCard = false } = {}) {
  if (!ai) {
    throw new Error("Clé GEMINI_API_KEY manquante dans l'environnement.");
  }

  const noTextGuardrail =
    "STRICT RULE: Pure visual artwork only. ZERO text, ZERO letters, ZERO words, ZERO numbers, ZERO symbols, ZERO logos, ZERO watermarks, ZERO captions, ZERO UI frames or borders with writing.";

  const finalPrompt = isCard
    ? [
        "Clean digital trading card illustration, full-bleed artwork of the subject,",
        "rich lighting, dramatic composition, ornate decorative frame made purely of shapes, glow and patterns,",
        prompt,
        noTextGuardrail
      ].join(" ")
    : [
        "High-detail digital illustration, crisp lighting, clean composition,",
        prompt,
        noTextGuardrail
      ].join(" ");

  const response = await ai.models.generateImages({
    model: CONFIG.geminiImageModel,
    prompt: finalPrompt,
    config: {
      numberOfImages: 1,
      outputMimeType: "image/jpeg",
      aspectRatio: isCard ? "3:4" : "1:1"
    }
  });

  const base64Img = response?.generatedImages?.[0]?.image?.imageBytes;
  if (!base64Img) {
    throw new Error("Aucune image retournée par le modèle.");
  }

  const rawBuffer = Buffer.from(base64Img, "base64");
  const cleanBuffer = await sharp(rawBuffer)
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();

  return cleanBuffer;
}

// ============================================================================
// ROUTEUR DE COMMANDES WHATSAPP
// ============================================================================
async function handleCommand(sock, msg) {
  const text = getMessageText(msg);
  if (!text.startsWith(CONFIG.prefix)) return;

  const chatJid = msg.key.remoteJid;
  if (!chatJid) return;

  const rawBody = text.slice(CONFIG.prefix.length).trim();
  const [cmdRaw, ...rest] = rawBody.split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  const arg = rest.join(" ").trim();

  try {
    // Gros cerveau : questions générales, sciences, histoire, anime
    if (["ia", "ask", "cerveau", "anime"].includes(cmd)) {
      if (!arg) {
        await sock.sendMessage(chatJid, { text: `Utilisation : ${CONFIG.prefix}${cmd} <ta question>` }, { quoted: msg });
        return;
      }
      await sock.sendPresenceUpdate("composing", chatJid);
      const reply = await askBigBrain(chatJid, arg);
      await sock.sendMessage(chatJid, { text: reply }, { quoted: msg });
      return;
    }

    // Recherche photo dans grande bibliothèque
    if (["photo", "imgsearch", "pic"].includes(cmd)) {
      if (!arg) {
        await sock.sendMessage(chatJid, { text: `Utilisation : ${CONFIG.prefix}${cmd} <mot-clé>` }, { quoted: msg });
        return;
      }
      await sock.sendPresenceUpdate("composing", chatJid);
      const found = await searchLibraryPhoto(arg);
      if (!found) {
        await sock.sendMessage(chatJid, { text: `Aucune photo trouvée pour "${arg}".` }, { quoted: msg });
        return;
      }
      await sock.sendMessage(
        chatJid,
        { image: found.buffer, caption: found.caption },
        { quoted: msg }
      );
      return;
    }

    // Envoi audio direct
    if (["son", "audio", "play", "mp3"].includes(cmd)) {
      if (!arg) {
        await sock.sendMessage(chatJid, { text: `Utilisation : ${CONFIG.prefix}${cmd} <titre ou artiste>` }, { quoted: msg });
        return;
      }
      await sock.sendMessage(chatJid, { text: `Recherche et préparation audio : *${arg}*...` }, { quoted: msg });
      const audio = await fetchMediaFromYouTube(arg, "audio");
      await sock.sendMessage(
        chatJid,
        {
          audio: audio.buffer,
          mimetype: "audio/mpeg",
          ptt: false
        },
        { quoted: msg }
      );
      return;
    }

    // Envoi vidéo direct
    if (["video", "vid", "mp4"].includes(cmd)) {
      if (!arg) {
        await sock.sendMessage(chatJid, { text: `Utilisation : ${CONFIG.prefix}${cmd} <titre ou recherche>` }, { quoted: msg });
        return;
      }
      await sock.sendMessage(chatJid, { text: `Préparation de la vidéo : *${arg}*...` }, { quoted: msg });
      const vid = await fetchMediaFromYouTube(arg, "video");
      await sock.sendMessage(
        chatJid,
        {
          video: vid.buffer,
          mimetype: "video/mp4",
          caption: vid.title
        },
        { quoted: msg }
      );
      return;
    }

    // Génération d'image numérique sans texte
    if (["gen", "image", "draw", "img"].includes(cmd)) {
      if (!arg) {
        await sock.sendMessage(chatJid, { text: `Utilisation : ${CONFIG.prefix}${cmd} <description visuelle>` }, { quoted: msg });
        return;
      }
      await sock.sendPresenceUpdate("composing", chatJid);
      const imgBuffer = await generateCleanArt(arg, { isCard: false });
      await sock.sendMessage(
        chatJid,
        { image: imgBuffer, caption: `Image générée : ${arg}` },
        { quoted: msg }
      );
      return;
    }

    // Génération de carte numérique sans texte
    if (["carte", "card"].includes(cmd)) {
      if (!arg) {
        await sock.sendMessage(chatJid, { text: `Utilisation : ${CONFIG.prefix}${cmd} <personnage ou sujet>` }, { quoted: msg });
        return;
      }
      await sock.sendPresenceUpdate("composing", chatJid);
      const cardBuffer = await generateCleanArt(arg, { isCard: true });
      await sock.sendMessage(
        chatJid,
        { image: cardBuffer, caption: `Carte numérique : ${arg}` },
        { quoted: msg }
      );
      return;
    }
  } catch (err) {
    await sock.sendMessage(
      chatJid,
      { text: `Erreur : ${err?.message || "opération impossible"}` },
      { quoted: msg }
    );
  }
}

// ============================================================================
// CONNEXION BAILEYS
// ============================================================================
async function startBot() {
  await initDb();
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: ["Sitri-Nel", "Chrome", "2.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      console.log("Sitri-Nel connecté à WhatsApp.");
    } else if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        await delay(3000);
        startBot();
      } else {
        console.log("Session déconnectée (loggedOut).");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      await handleCommand(sock, msg);
    }
  });
}

startBot();
