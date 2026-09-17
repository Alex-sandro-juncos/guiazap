// Robô intermediador — GuiaZap
//
// O QUE ISSO FAZ:
// - Conecta no WhatsApp usando o número do chip dedicado (via QR code, uma
//   vez só, depois fica logado sozinho).
// - Fica de olho na tabela "repasses_whatsapp" no Supabase. Quando aparece
//   uma linha nova com status "aguardando_envio", manda a mensagem pro
//   WhatsApp da loja automaticamente.
// - Quando a loja RESPONDE no WhatsApp, o robô identifica qual repasse é
//   (pelo número de telefone) e grava a resposta na mesma linha, mudando o
//   status pra "respondida" — o site (Papo) fica de olho nisso e manda a
//   resposta pro cliente sozinho.
//
// ONDE RODAR ISSO:
// Isso NÃO roda no Netlify (functions lá são "sem servidor" e desligam
// depois de alguns segundos — não conseguem manter uma sessão de WhatsApp
// aberta). Precisa de uma VPS (servidor ligado 24 horas), por exemplo:
// DigitalOcean, Contabo, Hostinger VPS, etc. Custa em torno de R$20-40/mês
// pro menor plano, que já é suficiente pra isso.
//
// COMO INSTALAR (na VPS, com Node.js 18+ já instalado):
//   mkdir guiazap-bot && cd guiazap-bot
//   (coloca esse arquivo aqui dentro como index.js)
//   npm init -y
//   npm install @whiskeysockets/baileys @supabase/supabase-js qrcode-terminal
//   node index.js
//
// Na primeira vez, vai aparecer um QR code no terminal — escaneia com o
// WhatsApp do CHIP DEDICADO (Configurações > Aparelhos conectados > Conectar
// aparelho). Depois disso, ele guarda a sessão numa pasta local e não pede
// o QR code de novo, a não ser que você deslogue.
//
// Pra deixar rodando sempre (mesmo se a VPS reiniciar), depois de testar
// que funciona, o recomendado é usar o PM2:
//   npm install -g pm2
//   pm2 start index.js --name guiazap-bot
//   pm2 save
//   pm2 startup   (segue as instruções que aparecerem)

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const qrcode = require('qrcode-terminal');

// ---------- CONFIGURAÇÃO (preenche aqui antes de rodar) ----------
const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co'; // troca pelo seu
const SUPABASE_SERVICE_ROLE_KEY = 'SUA_SERVICE_ROLE_KEY_AQUI'; // pega no Supabase > Project Settings > API
// -------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let sock = null;

async function iniciarBot(){
  const { state, saveCreds } = await useMultiFileAuthState('sessao_whatsapp');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if(qr){
      console.log('\n📱 Escaneia esse QR code com o WhatsApp do chip dedicado:\n');
      qrcode.generate(qr, { small: true });
    }

    if(connection === 'close'){
      const motivo = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
      const deslogado = motivo === DisconnectReason.loggedOut;
      console.log('Conexão fechada.', deslogado ? 'Foi deslogado — apague a pasta sessao_whatsapp e escaneia o QR de novo.' : 'Tentando reconectar...');
      if(!deslogado) iniciarBot();
    } else if(connection === 'open'){
      console.log('✅ Robô conectado ao WhatsApp! Ficando de olho nos repasses...');
      ficarDeOlhoNosRepasses();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for(const msg of messages){
      if(!msg.message || msg.key.fromMe) continue; // ignora mensagem que o próprio robô mandou

      const numeroDeQuemMandou = (msg.key.remoteJid || '').replace('@s.whatsapp.net', '');
      const textoRecebido = msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || '';
      if(!textoRecebido) continue;

      await tratarRespostaDaLoja(numeroDeQuemMandou, textoRecebido);
    }
  });
}

// Procura, no banco, o repasse mais recente "enviada" (aguardando resposta)
// pra esse número de telefone específico, e grava a resposta nele.
async function tratarRespostaDaLoja(numero, texto){
  try{
    const numeroLimpo = numero.replace(/\D/g, '').replace(/^55/, ''); // tira o 55 do Brasil se tiver

    const { data: repasses, error } = await supabase
      .from('repasses_whatsapp')
      .select('id')
      .eq('whatsapp_loja', numeroLimpo)
      .eq('status', 'enviada')
      .order('enviada_em', { ascending: false })
      .limit(1);

    if(error || !repasses || repasses.length === 0){
      console.log('Recebi mensagem de', numeroLimpo, 'mas não achei repasse esperando resposta. Ignorando (pode ser conversa normal do chip).');
      return;
    }

    const repasseId = repasses[0].id;

    await supabase
      .from('repasses_whatsapp')
      .update({ resposta_loja: texto, status: 'respondida', respondida_em: new Date().toISOString() })
      .eq('id', repasseId);

    console.log('✅ Resposta da loja registrada no repasse', repasseId);
  } catch(e){
    console.error('erro ao tratar resposta da loja', e);
  }
}

// Roda a cada 5 segundos, procurando repasses novos pra enviar
function ficarDeOlhoNosRepasses(){
  setInterval(async () => {
    try{
      const { data: pendentes, error } = await supabase
        .from('repasses_whatsapp')
        .select('id, whatsapp_loja, nome_loja, mensagem_cliente')
        .eq('status', 'aguardando_envio')
        .limit(10);

      if(error || !pendentes || pendentes.length === 0) return;

      for(const repasse of pendentes){
        const numeroDestino = '55' + repasse.whatsapp_loja.replace(/\D/g, '') + '@s.whatsapp.net';
        const textoParaEnviar = `📦 Novo pedido via GuiaZap${repasse.nome_loja ? ' (' + repasse.nome_loja + ')' : ''}:\n\n${repasse.mensagem_cliente}`;

        try{
          await sock.sendMessage(numeroDestino, { text: textoParaEnviar });
          await supabase
            .from('repasses_whatsapp')
            .update({ status: 'enviada', enviada_em: new Date().toISOString() })
            .eq('id', repasse.id);
          console.log('✅ Mensagem enviada pra', repasse.whatsapp_loja);
        } catch(erroEnvio){
          console.error('erro ao enviar pra', repasse.whatsapp_loja, erroEnvio);
          await supabase.from('repasses_whatsapp').update({ status: 'erro' }).eq('id', repasse.id);
        }
      }
    } catch(e){
      console.error('erro no loop de repasses', e);
    }
  }, 5000);
}

iniciarBot();