// Gera um áudio (narração de uma voz só, ou diálogo entre duas vozes)
// sobre um tema pedido — pra pessoa baixar e usar em vídeo, redes
// sociais, etc. Dois passos:
// 1. Escreve o roteiro de verdade (texto) usando o mesmo motor de texto
//    do Zeca (chamarIABarata — hoje Claude Haiku, com Gemini de reserva).
// 2. Transforma esse roteiro em áudio de verdade usando a voz (TTS) da
//    OpenAI — devolve o mp3 pronto em base64, igual o gerar-pdf-zeca.js
//    faz com o PDF. Nada fica salvo no servidor.
//
// Mesmo esquema de limite diário por nível de conta que o resto do Zeca
// (gerar-imagem-zeca.js), incluindo a exceção pro criador confirmada só
// pelo login.

const { chamarIABarata } = require('./ia-barata-helper');

const ADMIN_EMAIL_AUDIO = 'contato@guiazap.shop';

const LIMITE_VISITANTE = 1;
const LIMITE_GRATIS = 1;
const LIMITE_COMPLETO = 3;
const LIMITE_PREMIUM = 7;
// Vendas e o criador não passam por essa checagem — sem limite.

// Vozes disponíveis na API de TTS da OpenAI, mapeadas pros termos que a
// pessoa pode pedir em português (ver campo voz_pedida no zeca-chat.js).
const VOZES_OPENAI = {
  neutra: 'alloy',
  grave: 'onyx',
  masculina: 'onyx',
  aguda: 'nova',
  feminina: 'nova',
  calma: 'shimmer',
  energetica: 'fable',
  energética: 'fable'
};

function normalizarVoz(pedido, padrao) {
  if (!pedido) return padrao;
  const chave = String(pedido).toLowerCase().trim();
  return VOZES_OPENAI[chave] || padrao;
}

// Chama a API de texto-pra-fala da OpenAI e devolve o áudio como Buffer
// (mp3), ou null se der erro.
async function chamarTTS(texto, voz) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  try {
    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'tts-1', voice: voz, input: texto })
    });
    if (!resp.ok) {
      const erroTexto = await resp.text();
      console.error('erro OpenAI TTS:', erroTexto);
      return null;
    }
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    console.error('erro ao chamar TTS:', e);
    return null;
  }
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { tema, formato, vozPedida, voz2Pedida, duracaoPedida } = JSON.parse(event.body || '{}');
    if (!tema || !tema.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'descreve sobre o que é o áudio' }) };
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'geração de áudio não configurada (OPENAI_API_KEY)' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Descobre quem está pedindo e o limite diário do nível dele — mesmo
    // padrão do gerar-imagem-zeca.js (criador reconhecido só pelo login).
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let chaveLimite;
    let limiteDoDia;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
      });
      if (!usuarioResp.ok) {
        return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
      }
      const usuario = await usuarioResp.json();
      chaveLimite = 'gerar-audio-zeca:user:' + usuario.id;

      if ((usuario.email || '').toLowerCase() === ADMIN_EMAIL_AUDIO.toLowerCase()) {
        limiteDoDia = null;
      } else {
        const empresasResp = await fetch(
          `${SUPABASE_URL}/rest/v1/profissionais?user_id=eq.${usuario.id}&status_pagamento=eq.ativo&select=plano`,
          { headers: headersServico }
        );
        const empresas = await empresasResp.json();
        const ordemPlanos = { vendas: 4, premium: 3, completo: 2, basico: 1 };
        const melhorEmpresa = (empresas || []).sort((a, b) => (ordemPlanos[b.plano] || 0) - (ordemPlanos[a.plano] || 0))[0];
        const plano = melhorEmpresa ? melhorEmpresa.plano : null;

        if (plano === 'vendas') limiteDoDia = null;
        else if (plano === 'premium') limiteDoDia = LIMITE_PREMIUM;
        else if (plano === 'completo') limiteDoDia = LIMITE_COMPLETO;
        else limiteDoDia = LIMITE_GRATIS;
      }
    } else {
      const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
      chaveLimite = 'gerar-audio-zeca:ip:' + ip;
      limiteDoDia = LIMITE_VISITANTE;
    }

    let registroLimiteAtual = null;
    if (limiteDoDia !== null) {
      const buscaLimiteResp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chaveLimite)}`, { headers: headersServico });
      const registrosLimite = await buscaLimiteResp.json();
      registroLimiteAtual = registrosLimite[0] || null;

      if (registroLimiteAtual) {
        const horasPassadas = (new Date() - new Date(registroLimiteAtual.janela_inicio)) / 3600000;
        if (horasPassadas < 24 && registroLimiteAtual.contagem >= limiteDoDia) {
          return {
            statusCode: 429,
            body: JSON.stringify({ error: `Você já usou seu limite de ${limiteDoDia} áudio${limiteDoDia > 1 ? 's' : ''} hoje. ${authHeader ? 'Um pacote maior dá mais áudios por dia.' : 'Cria uma conta grátis ou volta amanhã.'}` })
          };
        }
      }
    }

    const ehDialogo = formato === 'dialogo';
    let roteiroTexto;
    let audioBuffer;

    if (ehDialogo) {
      const promptRoteiro = `Escreva um roteiro de diálogo curto e natural entre duas pessoas ("A" e "B") sobre o tema: "${tema.trim()}". ${duracaoPedida ? `Duração aproximada pedida: ${duracaoPedida}.` : 'Curto e objetivo — bom pra usar como narração/trilha em vídeo de rede social.'} Português do Brasil, tom natural de conversa (não de texto formal lido em voz alta).
Responda APENAS com JSON válido: {"falas": [{"quem": "A", "texto": "..."}, {"quem": "B", "texto": "..."}]}`;

      const ia = await chamarIABarata(promptRoteiro, tema, 1200, false);
      if (!ia.ok || !ia.json || !Array.isArray(ia.json.falas) || ia.json.falas.length === 0) {
        return { statusCode: 500, body: JSON.stringify({ error: 'não consegui escrever o roteiro do diálogo agora. Tenta de novo?' }) };
      }

      const falas = ia.json.falas.slice(0, 24); // teto de segurança — evita roteiro gigante estourando tempo/custo
      const vozA = normalizarVoz(vozPedida, 'onyx');
      const vozB = normalizarVoz(voz2Pedida, vozA === 'nova' ? 'onyx' : 'nova');

      // Chama a TTS de todas as falas em paralelo (não uma de cada vez) —
      // com até 24 falas, gravar sequencialmente arrisca estourar o tempo
      // limite da função. Guarda a ordem original pra concatenar certo.
      const falasValidas = falas.filter(f => f && f.texto && f.texto.trim());
      const buffersComOrdem = await Promise.all(
        falasValidas.map(async (fala) => {
          const voz = fala.quem === 'B' ? vozB : vozA;
          const buffer = await chamarTTS(fala.texto.trim(), voz);
          return buffer;
        })
      );
      const buffers = buffersComOrdem.filter(Boolean);
      if (buffers.length === 0) {
        return { statusCode: 500, body: JSON.stringify({ error: 'não consegui gravar o áudio do diálogo agora. Tenta de novo?' }) };
      }

      audioBuffer = Buffer.concat(buffers);
      roteiroTexto = falasValidas.map(f => `${f.quem === 'B' ? 'B' : 'A'}: ${f.texto}`).join('\n');
    } else {
      const promptRoteiro = `Escreva um texto de narração (uma voz só, sem indicar personagens ou diálogo) sobre o tema: "${tema.trim()}". ${duracaoPedida ? `Duração aproximada pedida: ${duracaoPedida}.` : 'Curto e objetivo — bom pra narração de vídeo de rede social (uns 30-40 segundos falado).'} Português do Brasil, texto corrido, sem formatação (sem markdown, sem tópicos), pronto pra ser lido em voz alta.
Responda APENAS com JSON válido: {"texto": "..."}`;

      const ia = await chamarIABarata(promptRoteiro, tema, 900, false);
      if (!ia.ok || !ia.json || !ia.json.texto || !ia.json.texto.trim()) {
        return { statusCode: 500, body: JSON.stringify({ error: 'não consegui escrever o roteiro agora. Tenta de novo?' }) };
      }

      const voz = normalizarVoz(vozPedida, 'alloy');
      audioBuffer = await chamarTTS(ia.json.texto.trim(), voz);
      if (!audioBuffer) {
        return { statusCode: 500, body: JSON.stringify({ error: 'não consegui gravar esse áudio agora. Tenta de novo?' }) };
      }
      roteiroTexto = ia.json.texto.trim();
    }

    // Só desconta do limite diário DEPOIS que o áudio saiu com sucesso —
    // mesmo padrão do resto do Zeca, pra não gastar a vez da pessoa se
    // algo falhar no meio do caminho.
    if (limiteDoDia !== null) {
      const agora = new Date();
      if (registroLimiteAtual) {
        const horasPassadas = (agora - new Date(registroLimiteAtual.janela_inicio)) / 3600000;
        const novaContagem = horasPassadas >= 24 ? 1 : registroLimiteAtual.contagem + 1;
        const novaJanela = horasPassadas >= 24 ? agora.toISOString() : registroLimiteAtual.janela_inicio;
        await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chaveLimite)}`, {
          method: 'PATCH', headers: headersServico, body: JSON.stringify({ contagem: novaContagem, janela_inicio: novaJanela })
        });
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico`, {
          method: 'POST', headers: headersServico, body: JSON.stringify({ chave: chaveLimite, contagem: 1, janela_inicio: agora.toISOString() })
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        audioBase64: audioBuffer.toString('base64'),
        roteiro: roteiroTexto
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar áudio' }) };
  }
};