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
      }catch(e){}
    }
    if(u.connection === 'open') console.log("✓ Sitri-Nel connectée !")
    if(u.connection === 'close') start()
  })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if(!m.message || m.key.fromMe) return
    const from = m.key.remoteJid

    // 1. ON IGNORE TOUS LES GROUPES
    if(from.endsWith('@g.us')) return

    const text = m.message.conversation || m.message.extendedTextMessage?.text || ""
    if(!text) return

    // 2. ON IGNORE TOUT SI ÇA NE COMMENCE PAS PAR !
    if(!text.startsWith('!')) return

    const cmd = text.slice(1).trim().toLowerCase()
    const args = text.slice(1).trim().slice(cmd.split(' ')[0].length).trim()
    console.log("COMMANDE:", text)

    if(cmd === 'ping'){
      await sock.sendMessage(from, { text: 'pong 🏓 Sitri-Nel est en ligne !' })
      return
    }
    if(cmd === 'salut' || cmd === 'cc' || cmd === 'bonjour'){
      await sock.sendMessage(from, { text: 'Salut 😘 C’est Sitri-Nel, je suis là !' })
      return
    }
    if(cmd === 'help' || cmd === 'menu'){
      await sock.sendMessage(from, { text: '✨ Commandes Sitri-Nel :\n\n!ping - voir si je suis en ligne\n!salut - me saluer\n!ai [ta question] - parler avec moi\n\nExemple: !ai tu vas bien ?' })
      return
    }
    if(cmd.startsWith('ai')){
      if(!args){
        await sock.sendMessage(from, { text: 'Dis-moi quelque chose bébé 😘 Ex: !ai tu fais quoi ?' })
        return
      }
      try{
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'Tu es Sitri-Nel, une petite amie douce, drôle, taquine. Tu parles français simple, style Bénin. Réponses courtes, max 3 phrases.' },
            { role: 'user', content: args }
          ]
        }, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } })
        await sock.sendMessage(from, { text: res.data.choices[0].message.content })
      }catch(e){
        await sock.sendMessage(from, { text: 'Mon cerveau a bugué bébé, réessaie 😅' })
      }
      return
    }
  })
}
start()
