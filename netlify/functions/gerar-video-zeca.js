// Gera um vídeo com avatar falando (HeyGen) sobre um tema pedido. Só
// Premium e Vendas têm acesso — Completo fica só com áudio, conforme
// definido. Diferente de imagem/áudio, o vídeo da HeyGen demora MINUTOS
// pra ficar pronto — não dá pra esperar isso numa Netlify Function normal
// (timeout curto). Por isso o fluxo é em 2 passos:
// 1. Essa function (gerar-video-zeca.js) escreve o roteiro, manda pra
//    HeyGen começar a gerar, e devolve na hora um videoId (não o vídeo
//    pronto ainda).
// 2. O front-end pergunta de tempos em tempos pra
//    verificar-video-zeca.js se já terminou, até vir a URL final.
//
// Precisa das variáveis de ambiente no Netlify:
//   HEYGEN_API_KEY            — chave da API (painel HeyGen > Developers > API)
//   HEYGEN_AVATAR_ID_FEMININO — avatar padrão (voz feminina)
//   HEYGEN_AVATAR_ID_MASCULINO — avatar padrão (voz masculina)
//   HEYGEN_VOICE_ID_FEMININO  — voz feminina (português do Brasil)
//   HEYGEN_VOICE_ID_MASCULINO — voz masculina (português do Brasil)
// A pessoa pode pedir "com voz de homem"/"de mulher" — sem pedir nada,
// usa feminina como padrão.

const { chamarIABarata } = require('./ia-barata-helper');
const { verificarCreditoZeca, consumirCreditoZeca } = require('./zeca-limites-helper');

const ADMIN_EMAIL_VIDEO = 'contato@guiazap.shop';

// Vídeo é de longe o recurso mais caro do Zeca — bem mais caro que
// imagem/áudio (a HeyGen cobra por vídeo, não tenho o preço exato do seu
// plano ainda). Enquanto isso, o vídeo NÃO vem incluído de graça em
// NENHUM plano (nem Premium, nem Vendas) — só sai pagando com crédito
// extra, pra garantir que você nunca subsidia um custo que ainda não foi
// confirmado. "Completo" e "grátis" continuam de fora por completo (nem
// com crédito — é upsell pro Premium/Vendas).
// Assim que você confirmar o preço real por vídeo na HeyGen, a gente volta
// aqui e recalcula se dá pra incluir um pouquinho de graça em cada plano.
const JANELA_LIMITE_HORAS = 24 * 7;
const LIMITE_PREMIUM = 0; // nenhum incluído de graça — só crédito
const LIMITE_VENDAS = 0; // nenhum incluído de graça — só crédito

// Cada crédito comprado (pacote de R$7 = 5 créditos) é dimensionado pro
// custo de imagem/áudio — vídeo custa muito mais que isso na HeyGen, então
// cada vídeo pago com crédito consome vários de uma vez, não 1.
const CUSTO_CREDITOS_VIDEO = 3;

const PALAVRAS_POR_SEGUNDO = 2.5;
function instrucaoDuracaoVideo(duracaoTexto) {
  const texto = String(duracaoTexto || '').toLowerCase();
  let segundos = 20; // padrão curto, bom pra rede social
  const matchSegundos = texto.match(/(\d+(?:[.,]\d+)?)\s*(seg|s\b)/);
  const matchMinutos = texto.match(/(\d+(?:[.,]\d+)?)\s*min/);
  if (matchMinutos) segundos = parseFloat(matchMinutos[1].replace(',', '.')) * 60;
  else if (matchSegundos) segundos = parseFloat(matchSegundos[1].replace(',', '.'));
  // Teto de segurança — vídeo mais longo = muito mais caro na HeyGen.
  segundos = Math.min(60, Math.max(6, segundos));
  const palavrasAlvo = Math.max(8, Math.round(segundos * PALAVRAS_POR_SEGUNDO));
  return { segundos, instrucao: `Duração pedida: aproximadamente ${Math.round(segundos)} segundos falados — o texto precisa ter perto de ${palavrasAlvo} palavras, sem estourar isso.` };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
    const HEYGEN_AVATAR_ID_FEMININO = process.env.HEYGEN_AVATAR_ID_FEMININO;
    const HEYGEN_AVATAR_ID_MASCULINO = process.env.HEYGEN_AVATAR_ID_MASCULINO;
    const HEYGEN_VOICE_ID_FEMININO = process.env.HEYGEN_VOICE_ID_FEMININO;
    const HEYGEN_VOICE_ID_MASCULINO = process.env.HEYGEN_VOICE_ID_MASCULINO;
    if (!HEYGEN_API_KEY || !HEYGEN_AVATAR_ID_FEMININO || !HEYGEN_AVATAR_ID_MASCULINO || !HEYGEN_VOICE_ID_FEMININO || !HEYGEN_VOICE_ID_MASCULINO) {
      return { statusCode: 500, body: JSON.stringify({ error: 'geração de vídeo não configurada (faltam variáveis HEYGEN_* no Netlify — precisa de API_KEY e AVATAR_ID/VOICE_ID pros dois gêneros)' }) };
    }

    const { tema, duracaoPedida, generoPedido } = JSON.parse(event.body || '{}');
    if (!tema || !tema.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'descreve sobre o que é o vídeo' }) };
    }
    const usarMasculino = String(generoPedido || '').toLowerCase().startsWith('masc');
    const HEYGEN_AVATAR_ID = usarMasculino ? HEYGEN_AVATAR_ID_MASCULINO : HEYGEN_AVATAR_ID_FEMININO;
    const HEYGEN_VOICE_ID = usarMasculino ? HEYGEN_VOICE_ID_MASCULINO : HEYGEN_VOICE_ID_FEMININO;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Vídeo exige login — diferente de imagem/áudio, não tem acesso de
    // visitante nem de plano grátis/completo.
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Vídeo é um recurso dos planos Premium e Vendas — entra na sua conta primeiro.' }) };
    }
    const token = authHeader.replace('Bearer ', '');
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();
    const souCriador = (usuario.email || '').toLowerCase() === ADMIN_EMAIL_VIDEO.toLowerCase();

    let limiteDoDia = null; // null = sem limite (só o criador)
    let plano = null;
    if (!souCriador) {
      const empresasResp = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?user_id=eq.${usuario.id}&status_pagamento=eq.ativo&select=plano,zeca_plano_pago`,
        { headers: headersServico }
      );
      const empresas = await empresasResp.json();
      const ordemPlanos = { vendas: 4, premium: 3, completo: 2, basico: 1 };
      const melhorEmpresa = (empresas || []).sort((a, b) => (ordemPlanos[b.plano] || 0) - (ordemPlanos[a.plano] || 0))[0];
      // Só conta se realmente PAGO — plano manual/cupom não libera vídeo.
      plano = melhorEmpresa && melhorEmpresa.zeca_plano_pago ? melhorEmpresa.plano : null;

      if (plano === 'vendas') {
        limiteDoDia = LIMITE_VENDAS;
      } else if (plano === 'premium') {
        limiteDoDia = LIMITE_PREMIUM;
      } else {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Vídeo é exclusivo dos planos Premium e Vendas. Seu plano atual não inclui isso — dá uma olhada nos pacotes pra fazer upgrade.' })
        };
      }
    }

    const chaveLimite = 'gerar-video-zeca:user:' + usuario.id;
    let registroLimiteAtual = null;
    let usandoCredito = false;
    if (limiteDoDia !== null) {
      // limiteDoDia === 0 (Premium/Vendas sem preço da HeyGen confirmado
      // ainda) significa "nenhum de graça" — precisa ir direto pro crédito,
      // mesmo sem nenhum registro de uso anterior (senão o PRIMEIRO pedido
      // de todo mundo passaria batido, já que não existe registro ainda
      // pra comparar contra o limite).
      let estourouLimiteGratis = limiteDoDia === 0;

      if (!estourouLimiteGratis) {
        const buscaLimiteResp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chaveLimite)}`, { headers: headersServico });
        const registrosLimite = await buscaLimiteResp.json();
        registroLimiteAtual = registrosLimite[0] || null;

        if (registroLimiteAtual) {
          const horasPassadas = (new Date() - new Date(registroLimiteAtual.janela_inicio)) / 3600000;
          if (horasPassadas < JANELA_LIMITE_HORAS && registroLimiteAtual.contagem >= limiteDoDia) {
            estourouLimiteGratis = true;
          }
        }
      }

      if (estourouLimiteGratis) {
        // Vídeo custa MUITO mais que imagem/áudio pra você — um crédito
        // comum (R$7 = 5 créditos) não cobre o custo real de um vídeo.
        // Por isso cada vídeo gasto por crédito consome CUSTO_CREDITOS_VIDEO
        // créditos de uma vez, não 1 igual os outros recursos.
        const credito = await verificarCreditoZeca(usuario.id, headersServico, SUPABASE_URL);
        if (credito.saldo >= CUSTO_CREDITOS_VIDEO) {
          usandoCredito = true;
        } else {
          const mensagemLimite = limiteDoDia === 0
            ? `Vídeo ainda não vem incluído de graça no seu plano — sai só comprando crédito (consome ${CUSTO_CREDITOS_VIDEO} créditos por vídeo, é bem mais caro que imagem/áudio).`
            : `Você já usou seu limite de ${limiteDoDia} vídeo${limiteDoDia > 1 ? 's' : ''} essa semana. Vídeo consome ${CUSTO_CREDITOS_VIDEO} créditos por vez — você pode comprar mais créditos pra continuar.`;
          return {
            statusCode: 429,
            body: JSON.stringify({ error: mensagemLimite, comprarCreditos: true })
          };
        }
      }
    }

    // --- Escreve o roteiro (curto, de propósito — vídeo com avatar falando) ---
    const { instrucao } = instrucaoDuracaoVideo(duracaoPedida);
    const promptRoteiro = `Escreva um texto curto de narração (uma voz só, sem indicar personagens) pra um vídeo com avatar falando, sobre o tema: "${tema.trim()}". ${instrucao} Português do Brasil, texto corrido, natural de ser falado em voz alta, sem formatação.
Responda APENAS com JSON válido: {"texto": "..."}`;

    const ia = await chamarIABarata(promptRoteiro, tema, 600, false);
    if (!ia.ok || !ia.json || !ia.json.texto || !ia.json.texto.trim()) {
      return { statusCode: 500, body: JSON.stringify({ error: 'não consegui escrever o roteiro do vídeo agora. Tenta de novo?' }) };
    }
    const roteiroTexto = ia.json.texto.trim();

    // --- Manda pra HeyGen começar a gerar (não espera terminar) ---
    const respHeyGen = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': HEYGEN_API_KEY },
      body: JSON.stringify({
        dimension: { width: 720, height: 1280 }, // vertical — bom pra WhatsApp Status/Reels/Stories
        video_inputs: [
          {
            character: { type: 'avatar', avatar_id: HEYGEN_AVATAR_ID, avatar_style: 'normal' },
            voice: { type: 'text', voice_id: HEYGEN_VOICE_ID, input_text: roteiroTexto },
            background: { type: 'color', value: '#f6f6fc' }
          }
        ]
      })
    });
    const dadosHeyGen = await respHeyGen.json();
    const videoId = dadosHeyGen && dadosHeyGen.data && dadosHeyGen.data.video_id;

    if (!respHeyGen.ok || !videoId) {
      console.error('erro ao iniciar geração de vídeo na HeyGen:', JSON.stringify(dadosHeyGen));
      return { statusCode: 500, body: JSON.stringify({ error: 'não consegui começar a gerar o vídeo agora. Tenta de novo?' }) };
    }

    // Desconta do limite (ou do crédito) já aqui — a geração foi aceita
    // com sucesso pela HeyGen, que é o "sucesso" possível de confirmar
    // nesse primeiro passo (o resultado final só sai depois, por polling).
    if (usandoCredito) {
      await consumirCreditoZeca(usuario.id, headersServico, SUPABASE_URL, CUSTO_CREDITOS_VIDEO);
    } else if (limiteDoDia !== null) {
      const agora = new Date();
      if (registroLimiteAtual) {
        const horasPassadas = (agora - new Date(registroLimiteAtual.janela_inicio)) / 3600000;
        const novaContagem = horasPassadas >= JANELA_LIMITE_HORAS ? 1 : registroLimiteAtual.contagem + 1;
        const novaJanela = horasPassadas >= JANELA_LIMITE_HORAS ? agora.toISOString() : registroLimiteAtual.janela_inicio;
        await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chaveLimite)}`, {
          method: 'PATCH', headers: headersServico, body: JSON.stringify({ contagem: novaContagem, janela_inicio: novaJanela })
        });
      } else {
        await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico`, {
          method: 'POST', headers: headersServico, body: JSON.stringify({ chave: chaveLimite, contagem: 1, janela_inicio: agora.toISOString() })
        });
      }
    }

    return { statusCode: 200, body: JSON.stringify({ videoId, roteiro: roteiroTexto }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar vídeo' }) };
  }
};