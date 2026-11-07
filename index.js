const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')

async function start(){
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const sock = makeWASocket({
    auth: state,
    logger: pino({level:'silent'}),
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    markOnlineOnConnect: false
  })

  // Si pas encore enregistré, on demande le code SEULEMENT quand la connexion est prête
  if(!state.creds.registered){
    sock.ev.on('connection.update', async (u)=>{
      if(u.connection === 'connecting'){
        // On attend 3 sec que ça se stabilise
        await new Promise(r => setTimeout(r, 3000))
        try{
          const code = await sock.requestPairingCode(process.env.PAIRING_NUMBER)
          console.log("𖤍 TON CODE: " + code)
        }catch(e){
          console.log("Erreur code, je réessaie...")
        }
      }
      if(u.connection === 'open') console.log("✓ Sitri-Nel connectée !")
      if(u.connection === 'close'){
        console.log("Fermé, je redémarre...")
        start()
      }
    })
  } else {
    sock.ev.on('connection.update', (u)=>{
      if(u.connection === 'open') console.log("✓ Sitri-Nel connectée !")
      if(u.connection === 'close') start()
    })
  }

  sock.ev.on('creds.update', saveCreds)
}
start()
