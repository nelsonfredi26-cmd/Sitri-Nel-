const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const pino = require('pino')
const axios = require('axios')

async function start(){
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const sock = makeWASocket({
    auth: state,
    logger: pino({level:'silent'}),
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    getMessage: async () => { return undefined }
  })

  sock.ev.on('connection.update', async (u)=>{
    if(u.connection === 'connecting' && !state.creds.registered){
      await new Promise(r => setTimeout(r, 3000))
      try{
        const code = await sock.requestPairingCode(process.env.PAIRING_NUMBER)
        console.log("𖤍 TON CODE: " + code)
      }catch(e){ console.log("Erreur code:", e.message) }
    }
    if(u.connection === 'open') console.log("✓ Sitri-Nel connectée !")
    if(u.connection === 'close') start()
  })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if(!m.message || m.key.fromMe) return
    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""
    if(!text) return
    const from = m.key.remoteJid
    const low = text.toLowerCase().trim()
    console.log("MSG:", text)

    if(low === 'ping'){
      await sock.sendMessage(from, { text: 'pong 🏓 Sitri-Nel est en ligne !' })
      return
    }
    if(low === 'salut' || low === 'cc' || low === 'bonjour' || low === 'yo'){
      await sock.sendMessage(from, { text: 'Salut 😘 C’est Sitri-Nel, je suis là ! Tu vas bien ?' })
      return
    }

    try{
      const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Tu es Sitri-Nel, une petite amie douce, drôle, taquine. Tu parles français simple, style Bénin. Réponses courtes, max 3 phrases.' },
          { role: 'user', content: text }
        ]
      }, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } })
      await sock.sendMessage(from, { text: res.data.choices[0].message.content })
    }catch(e){
      console.log("Erreur GROQ:", e.message)
      await sock.sendMessage(from, { text: 'Je suis là bébé, mais mon cerveau a bugué, réessaie 😅' })
    }
  })
}
start()
