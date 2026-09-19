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
const { verificarCreditoZeca, consumirCreditoZeca } = require('./zeca-limites-helper');

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

// Antes, a duração pedida ("10 segundos") só entrava como uma dica solta
// no prompt ("Duração aproximada pedida: 10 segundos") — a IA não tem
// noção real de quantas palavras cabem em 10 segundos de fala, então
// ignorava na prática e escrevia o tamanho que "parecia razoável" pra
// ela (ex: pediram 10s e saiu 23s). Corrige convertendo o tempo pedido
// num alvo de PALAVRAS de verdade, usando uma cadência média de fala em
// português (~2,5 palavras/segundo, perto de 150 palavras/minuto).
const PALAVRAS_POR_SEGUNDO = 2.5;

function estimarSegundosPedidos(duracaoTexto) {
  if (!duracaoTexto) return null;
  const texto = String(duracaoTexto).toLowerCase();
  const matchMinutos = texto.match(/(\d+(?:[.,]\d+)?)\s*min/);
  if (matchMinutos) return parseFloat(matchMinutos[1].replace(',', '.')) * 60;
  const matchSegundos = texto.match(/(\d+(?:[.,]\d+)?)\s*(seg|s\b)/);
  if (matchSegundos) return parseFloat(matchSegundos[1].replace(',', '.'));
  if (/bem curto|bem r[áa]pido|curtinho/.test(texto)) return 8;
  if (/curto|r[áa]pido/.test(texto)) return 15;
  if (/longo|comprido|extenso/.test(texto)) return 60;
  return null; // não deu pra entender a duração pedida — usa o padrão
}

// duracaoTexto: o que a pessoa pediu em palavras livres (ou null).
// segundosPadrao: usado só quando não veio duração nenhuma.
function instrucaoDuracao(duracaoTexto, segundosPadrao) {
  const segundos = estimarSegundosPedidos(duracaoTexto) || segundosPadrao;
  if (!segundos) return 'Curto e objetivo — bom pra usar em vídeo de rede social.';
  const palavrasAlvo = Math.max(5, Math.round(segundos * PALAVRAS_POR_SEGUNDO));
  const margem = Math.max(3, Math.round(palavrasAlvo * 0.2));
  return `Duração pedida: aproximadamente ${Math.round(segundos)} segundos de áudio falado. Isso significa que o texto (se for diálogo, a SOMA de todas as falas juntas) precisa ter entre ${Math.max(3, palavrasAlvo - margem)} e ${palavrasAlvo + margem} palavras — NÃO estoure isso, mesmo que pareça curto demais pra "encaixar tudo" sobre o tema. É melhor cortar conteúdo e focar no essencial do que ultrapassar a duração pedida.`;
}

// A API de TTS da OpenAI já suporta nativamente controlar a velocidade
// da fala (parâmetro "speed", de 0.25x até 4x) — bem melhor que tentar
// acelerar o mp3 depois de pronto (perderia qualidade/tom). Aceita tanto
// um número solto ("1.5", "1,5") quanto frases tipo "mais rápido",
// "bem devagar". Sempre limitado ao intervalo que a API aceita.
function normalizarVelocidade(pedido) {
  if (!pedido) return 1;
  const texto = String(pedido).toLowerCase().trim();
  const matchNumero = texto.match(/(\d+(?:[.,]\d+)?)/);
  if (matchNumero) {
    const valor = parseFloat(matchNumero[1].replace(',', '.'));
    if (!isNaN(valor)) return Math.min(4, Math.max(0.25, valor));
  }
  if (/mais r[áa]pid|acelerad|rapidinho/.test(texto)) return 1.25;
  if (/bem r[áa]pid|bem acelerad/.test(texto)) return 1.5;
  if (/mais devagar|mais lent/.test(texto)) return 0.85;
  if (/bem devagar|bem lent/.test(texto)) return 0.7;
  return 1;
}

// Chama a API de texto-pra-fala da OpenAI e devolve o áudio como Buffer
// (mp3), ou null se der erro.
async function chamarTTS(texto, voz, velocidade) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  try {
    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'tts-1', voice: voz, input: texto, speed: velocidade || 1 })
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

    const { tema, formato, vozPedida, voz2Pedida, duracaoPedida, velocidadePedida } = JSON.parse(event.body || '{}');
    const velocidade = normalizarVelocidade(velocidadePedida);
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
    let usuarioIdLogado = null;

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
      usuarioIdLogado = usuario.id;

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
    let usandoCredito = false;
    if (limiteDoDia !== null) {
      const buscaLimiteResp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chaveLimite)}`, { headers: headersServico });
      const registrosLimite = await buscaLimiteResp.json();
      registroLimiteAtual = registrosLimite[0] || null;

      if (registroLimiteAtual) {
        const horasPassadas = (new Date() - new Date(registroLimiteAtual.janela_inicio)) / 3600000;
        if (horasPassadas < 24 && registroLimiteAtual.contagem >= limiteDoDia) {
          let saldoCredito = 0;
          if (usuarioIdLogado) {
            const credito = await verificarCreditoZeca(usuarioIdLogado, headersServico, SUPABASE_URL);
            saldoCredito = credito.saldo;
          }
          if (saldoCredito > 0) {
            usandoCredito = true;
          } else {
            return {
              statusCode: 429,
              body: JSON.stringify({
                error: `Você já usou seu limite de ${limiteDoDia} áudio${limiteDoDia > 1 ? 's' : ''} hoje. ${authHeader ? 'Você pode comprar um pacote de créditos extras pra continuar usando hoje mesmo.' : 'Cria uma conta grátis ou volta amanhã.'}`,
                comprarCreditos: !!authHeader
              })
            };
          }
        }
      }
    }

    const ehDialogo = formato === 'dialogo';
    let roteiroTexto;
    let audioBuffer;

    if (ehDialogo) {
      const promptRoteiro = `Escreva um roteiro de diálogo curto e natural entre duas pessoas ("A" e "B") sobre o tema: "${tema.trim()}". ${instrucaoDuracao(duracaoPedida, 30)} Português do Brasil, tom natural de conversa (não de texto formal lido em voz alta).
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
          const buffer = await chamarTTS(fala.texto.trim(), voz, velocidade);
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
      const promptRoteiro = `Escreva um texto de narração (uma voz só, sem indicar personagens ou diálogo) sobre o tema: "${tema.trim()}". ${instrucaoDuracao(duracaoPedida, 35)} Português do Brasil, texto corrido, sem formatação (sem markdown, sem tópicos), pronto pra ser lido em voz alta.
Responda APENAS com JSON válido: {"texto": "..."}`;

      const ia = await chamarIABarata(promptRoteiro, tema, 900, false);
      if (!ia.ok || !ia.json || !ia.json.texto || !ia.json.texto.trim()) {
        return { statusCode: 500, body: JSON.stringify({ error: 'não consegui escrever o roteiro agora. Tenta de novo?' }) };
      }

      const voz = normalizarVoz(vozPedida, 'alloy');
      audioBuffer = await chamarTTS(ia.json.texto.trim(), voz, velocidade);
      if (!audioBuffer) {
        return { statusCode: 500, body: JSON.stringify({ error: 'não consegui gravar esse áudio agora. Tenta de novo?' }) };
      }
      roteiroTexto = ia.json.texto.trim();
    }

    // Só desconta do limite diário DEPOIS que o áudio saiu com sucesso —
    // mesmo padrão do resto do Zeca, pra não gastar a vez da pessoa se
    // algo falhar no meio do caminho.
    if (usandoCredito) {
      await consumirCreditoZeca(usuarioIdLogado, headersServico, SUPABASE_URL);
    } else if (limiteDoDia !== null) {
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