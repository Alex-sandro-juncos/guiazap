// Geração de imagem geral do Zeca — diferente do gerar-foto-produto-ia.js
// (que é preso a um produto/empresa específica do Pacote Vendas), este
// aqui é pro pedido solto dentro da conversa ("Zeca, gera uma imagem de
// X"), disponível pra qualquer um, com limite diário por nível de conta:
//
//   Visitante (sem login)  → 1 por dia (controlado por IP)
//   Grátis / sem empresa   → 1 por dia
//   Pacote Completo        → 3 por dia
//   Pacote Premium         → 7 por dia
//   Pacote Vendas          → sem limite
//
// "Visitante" controlado por IP, não por um identificador do aparelho —
// um identificador mandado pelo navegador dá pra apagar/trocar fácil,
// then IP é o que realmente sustenta esse limite do lado do servidor.
// Reaproveita o mesmo motor de geração (OpenAI) e o mesmo bucket "fotos"
// que o gerar-foto-produto-ia.js já usa.

const LIMITE_VISITANTE = 1;
const LIMITE_GRATIS = 1;
const LIMITE_COMPLETO = 3;
const LIMITE_PREMIUM = 7;
// Vendas não passa por essa checagem — sem limite.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { descricao } = JSON.parse(event.body || '{}');
    if (!descricao || !descricao.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'descreve o que você quer na imagem' }) };
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'geração de imagem não configurada (OPENAI_API_KEY)' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Descobre quem está pedindo e qual nível ele tem direito
    const authHeader = event.headers.authorization || event.headers.Authorization;
    let chaveLimite;
    let limiteDoDia;
    let nomeEmpresaParaMensagem = null;

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
      });
      if (!usuarioResp.ok) {
        return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
      }
      const usuario = await usuarioResp.json();
      chaveLimite = 'gerar-imagem-zeca:user:' + usuario.id;

      // O criador do GuiaZap (reconhecido pelo login, mesmo e-mail admin
      // do painel) não passa por esse limite — nunca por senha no chat
      const ADMIN_EMAIL_IMAGEM = 'contato@guiazap.shop';
      if ((usuario.email || '').toLowerCase() === ADMIN_EMAIL_IMAGEM.toLowerCase()) {
        limiteDoDia = null;
      } else {

      const empresasResp = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?user_id=eq.${usuario.id}&status_pagamento=eq.ativo&select=name,plano&order=plano.desc`,
        { headers: headersServico }
      );
      const empresas = await empresasResp.json();

      // Pega a empresa do maior nível que a pessoa tiver ativa
      const ordemPlanos = { vendas: 4, premium: 3, completo: 2, basico: 1 };
      const melhorEmpresa = (empresas || []).sort((a, b) => (ordemPlanos[b.plano] || 0) - (ordemPlanos[a.plano] || 0))[0];
      const plano = melhorEmpresa ? melhorEmpresa.plano : null;
      nomeEmpresaParaMensagem = melhorEmpresa ? melhorEmpresa.name : null;

      if (plano === 'vendas') {
        limiteDoDia = null; // sem limite
      } else if (plano === 'premium') {
        limiteDoDia = LIMITE_PREMIUM;
      } else if (plano === 'completo') {
        limiteDoDia = LIMITE_COMPLETO;
      } else {
        limiteDoDia = LIMITE_GRATIS; // sem empresa, ou só Pacote Contato
      }
      }
    } else {
      const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
      chaveLimite = 'gerar-imagem-zeca:ip:' + ip;
      limiteDoDia = LIMITE_VISITANTE;
    }

    // Só CONFERE o limite aqui (sem gastar ainda) — o desconto de verdade
    // só acontece depois que a imagem sai com sucesso, lá no fim da
    // function. Assim, se a geração falhar, a pessoa não perde a vez.
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
            body: JSON.stringify({ error: `Você já usou seu limite de ${limiteDoDia} imagem${limiteDoDia > 1 ? 'ns' : ''} hoje. ${authHeader ? 'Um pacote maior dá mais imagens por dia.' : 'Cria uma conta grátis ou volta amanhã.'}` })
          };
        }
      }
    }

    // Gera de verdade (mesmo motor do gerar-foto-produto-ia.js)
    const prompt = `Ilustração ou foto realista, boa qualidade: ${descricao.trim()}. Sem texto, sem marca d'água.`;

    const respGeracao = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-image-2', prompt, n: 1, size: '1024x1024' })
    });
    const dadosGeracao = await respGeracao.json();

    if (!respGeracao.ok || !dadosGeracao.data || !dadosGeracao.data[0]) {
      console.error('erro ao gerar imagem:', JSON.stringify(dadosGeracao));
      return { statusCode: 500, body: JSON.stringify({ error: 'não consegui gerar a imagem agora' }) };
    }

    let bufferImagem;
    if (dadosGeracao.data[0].b64_json) {
      bufferImagem = Buffer.from(dadosGeracao.data[0].b64_json, 'base64');
    } else if (dadosGeracao.data[0].url) {
      const respImagem = await fetch(dadosGeracao.data[0].url);
      bufferImagem = Buffer.from(await respImagem.arrayBuffer());
    } else {
      return { statusCode: 500, body: JSON.stringify({ error: 'a IA não devolveu uma imagem reconhecível' }) };
    }

    const nomeArquivo = `zeca-imagens/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const respUpload = await fetch(`${SUPABASE_URL}/storage/v1/object/fotos/${nomeArquivo}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'image/png' },
      body: bufferImagem
    });

    if (!respUpload.ok) {
      const erroUpload = await respUpload.text();
      console.error('erro ao salvar imagem no storage:', erroUpload);
      return { statusCode: 500, body: JSON.stringify({ error: 'gerei a imagem mas não consegui salvar, tenta de novo' }) };
    }

    const urlPublica = `${SUPABASE_URL}/storage/v1/object/public/fotos/${nomeArquivo}`;

    // Só agora, com a imagem já salva de verdade, desconta do limite diário
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

    return { statusCode: 200, body: JSON.stringify({ url: urlPublica, geradaPara: nomeEmpresaParaMensagem }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar imagem' }) };
  }
};