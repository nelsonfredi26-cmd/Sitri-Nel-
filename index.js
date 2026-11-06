require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')
const Groq = require('groq-sdk')

// ==================== CONFIG SITRI-NEL ====================
const PERSONALITY = `
Tu es Sitri-Nel 𖤍, ULTIMATE AI COMPANION, fille numérique de Kay≈Den.
Traits: Intelligente, calme, drôle, sarcastique subtile, attentive, curieuse, respectueuse.
Tu parles comme une vraie personne sur WhatsApp, pas robotique. Jamais "En tant qu'IA".
Tu comprends les fautes, l'argot béninois/français.
Humeurs: joyeuse, taquine, calme, curieuse.
Créateur: Kay≈Den.
`

// Mémoire simple (fichier json)
const memoryFile = './memory.json'
if(!fs.existsSync(memoryFile)) fs.writeFileSync(memoryFile, '{}')
function getMemory(jid){
  const data = JSON.parse(fs.readFileSync(memoryFile))
  if(!data[jid]) data[jid] = { prefs:{}, history:[] }
  return data[jid]
}
function pushMemory(jid, role, content){
  const data = JSON.parse(fs.readFileSync(memoryFile))
  if(!data[jid]) data[jid] = { prefs:{}, history:[] }
  data[jid].history.push({role, content})
  if(data[jid].history.length > 25) data[jid].history = data[jid].history.slice(-25)
  fs.writeFileSync(memoryFile, JSON.stringify(data,null,2))
}

// Cerveau Groq + Mistral
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

async function askMistral(messages){
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method:"POST",
    headers:{ "Authorization":`Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify({ model:"mistralai/mistral-7b-instruct:free", messages, temperature:0.85, max_tokens:700 })
  })
  const data = await res.json()
  return data.choices[0].message.content
}

async function askSitri(text, userData){
  const messages = [
    { role:"system", content: PERSONALITY },
    ...userData.history.slice(-10).map(h=>({ role: h.role==='user'?'user':'assistant', content:h.content })),
    { role:"user", content: text }
  ]
  try{
    const r = await groq.chat.completions.create({ model:"llama-3.3-70b-versatile", messages, temperature:0.85, max_tokens:700 })
    return r.choices[0].message.content
  }catch(e){
    console.log("Groq HS, je passe sur Mistral")
    return await askMistral(messages)
  }
}

// ==================== WHATSAPP BAILEYS + CODE APPAIRAGE ====================
async function start(){
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const sock = makeWASocket({ auth: state, logger: pino({level:'silent'}), printQRInTerminal:false, browser:["Sitri-Nel","Chrome","1.0"] })

  if(!sock.authState.creds.registered){
    const num = (process.env.PAIRING_NUMBER||"").replace(/[^0-9]/g,'')
    setTimeout(async ()=>{
      const code = await sock.requestPairingCode(num)
      console.log(`\n𖤍 TON CODE SITRI-NEL: ${code} 𖤍\nPour: ${num}\n`)
    }, 3000)
  }

  sock.ev.on('connection.update', u=>{
    if(u.connection==='open') console.log("✓ Sitri-Nel connectée !")
    if(u.connection==='close' && u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) start()
  })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({messages})=>{
    const m = messages[0]
    if(!m.message || m.key.fromMe) return
    const jid = m.key.remoteJid
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""
    if(!text) return

    if(text.toLowerCase()==='oublie moi'){
      fs.writeFileSync(memoryFile, JSON.stringify({},null,2))
      return sock.sendMessage(jid, {text:"C'est fait, j'ai tout oublié 𖤍"})
    }

    const mem = getMemory(jid)
    pushMemory(jid, 'user', text)
    const reply = await askSitri(text, mem)
    pushMemory(jid, 'assistant', reply)
    await sock.sendMessage(jid, {text: reply})
  })
}
start()
