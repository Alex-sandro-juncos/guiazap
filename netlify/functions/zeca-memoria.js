// Gerencia a memória do Zeca — opt-in (a pessoa precisa ativar), sem
// prazo de expiração automática. Uma única function com várias ações
// (campo "acao" no corpo do pedido), todas exigindo login e conferindo
// que a pessoa só mexe nas PRÓPRIAS conversas.
//
// Limite de espaço: 30 conversas por pessoa, 300 mensagens por conversa
// (checado aqui e também em zeca-chat.js na hora de gravar mensagem).

const LIMITE_CONVERSAS = 30;
const LIMITE_MENSAGENS_POR_CONVERSA = 300;

async function autenticar(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) return null;
  return resp.json();
}

function headersServico() {
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const usuario = await autenticar(event);
    if (!usuario) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const headers = headersServico();
    const { acao, conversaId, titulo, mensagemPessoa, respostaZeca } = JSON.parse(event.body || '{}');

    // --- Status: ativada ou não, e quantas conversas já tem ---
    if (acao === 'status') {
      const prefResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_preferencias_usuario?user_id=eq.${usuario.id}&select=memoria_ativada`, { headers });
      const prefData = await prefResp.json();
      const ativada = prefData[0] ? prefData[0].memoria_ativada : false;

      const contagemResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas?user_id=eq.${usuario.id}&select=id`, { headers: { ...headers, Prefer: 'count=exact' } });
      const totalConversas = parseInt((contagemResp.headers.get('content-range') || '/0').split('/')[1] || '0', 10);

      return { statusCode: 200, body: JSON.stringify({ ativada, totalConversas, limiteConversas: LIMITE_CONVERSAS }) };
    }

    // --- Ativar / desativar ---
    if (acao === 'ativar' || acao === 'desativar') {
      const novoValor = acao === 'ativar';
      await fetch(`${SUPABASE_URL}/rest/v1/zeca_preferencias_usuario?on_conflict=user_id`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: usuario.id, memoria_ativada: novoValor, updated_at: new Date().toISOString() })
      });
      return { statusCode: 200, body: JSON.stringify({ ativada: novoValor }) };
    }

    // --- Listar conversas (só id, título e data — não traz as mensagens) ---
    if (acao === 'listar_conversas') {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/zeca_conversas?user_id=eq.${usuario.id}&select=id,titulo,updated_at&order=updated_at.desc`,
        { headers }
      );
      const conversas = await resp.json();
      return { statusCode: 200, body: JSON.stringify({ conversas }) };
    }

    // --- Abrir uma conversa (mensagens dela) ---
    if (acao === 'obter_conversa') {
      if (!conversaId) return { statusCode: 400, body: JSON.stringify({ error: 'conversaId é obrigatório' }) };

      // Confere que a conversa é da pessoa mesmo antes de devolver qualquer coisa
      const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas?id=eq.${conversaId}&user_id=eq.${usuario.id}&select=id,titulo`, { headers });
      const donoData = await donoResp.json();
      if (!donoData[0]) return { statusCode: 403, body: JSON.stringify({ error: 'essa conversa não é sua' }) };

      const mensagensResp = await fetch(
        `${SUPABASE_URL}/rest/v1/zeca_mensagens?conversa_id=eq.${conversaId}&select=remetente,texto,created_at&order=created_at.asc`,
        { headers }
      );
      const mensagens = await mensagensResp.json();
      return { statusCode: 200, body: JSON.stringify({ titulo: donoData[0].titulo, mensagens }) };
    }

    // --- Renomear conversa ---
    if (acao === 'renomear_conversa') {
      if (!conversaId || !titulo || !titulo.trim()) return { statusCode: 400, body: JSON.stringify({ error: 'conversaId e titulo são obrigatórios' }) };
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas?id=eq.${conversaId}&user_id=eq.${usuario.id}`, {
        method: 'PATCH', headers, body: JSON.stringify({ titulo: titulo.trim().slice(0, 80), updated_at: new Date().toISOString() })
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao renomear' }) };
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // --- Apagar uma conversa ---
    if (acao === 'apagar_conversa') {
      if (!conversaId) return { statusCode: 400, body: JSON.stringify({ error: 'conversaId é obrigatório' }) };
      // O ?user_id=eq garante que só apaga se for dono — mesmo que
      // alguém tente passar um id de conversa de outra pessoa
      await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas?id=eq.${conversaId}&user_id=eq.${usuario.id}`, {
        method: 'DELETE', headers
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // --- Salvar uma troca "por fora" do fluxo normal de texto ---
    // Usado pelo front-end depois de gerar_imagem/gerar_audio/executar_codigo
    // e edição de imagem — esses tipos de resposta especiais respondem
    // direto pra outra function (gerar-audio-zeca.js etc.), sem passar de
    // novo pelo zeca-chat.js, então sem isso a conversa salva NUNCA ficava
    // sabendo que aquele áudio/imagem/código foi gerado (o Zeca "esquecia"
    // na hora que a pessoa perguntava algo sobre aquilo depois).
    if (acao === 'salvar_mensagem') {
      if (!mensagemPessoa || !respostaZeca) return { statusCode: 400, body: JSON.stringify({ error: 'mensagemPessoa e respostaZeca são obrigatórios' }) };
      const conversaIdSalva = await module.exports.salvarTrocaDeMensagens(usuario.id, conversaId || null, mensagemPessoa, respostaZeca);
      return { statusCode: 200, body: JSON.stringify({ conversaId: conversaIdSalva }) };
    }

    // --- Apagar tudo (todas as conversas da pessoa) ---
    if (acao === 'apagar_tudo') {
      await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas?user_id=eq.${usuario.id}`, {
        method: 'DELETE', headers
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'ação desconhecida' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerenciar memória do Zeca' }) };
  }
};

module.exports.LIMITE_CONVERSAS = LIMITE_CONVERSAS;
module.exports.LIMITE_MENSAGENS_POR_CONVERSA = LIMITE_MENSAGENS_POR_CONVERSA;

// --- Helpers reaproveitados pelo zeca-chat.js, pra salvar a troca de
// mensagens direto na conversa certa quando a memória está ativada ---

module.exports.memoriaAtivada = async function (usuarioId) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_preferencias_usuario?user_id=eq.${usuarioId}&select=memoria_ativada`, { headers: headersServico() });
  const data = await resp.json();
  return data[0] ? data[0].memoria_ativada : false;
};

module.exports.carregarHistoricoConversa = async function (conversaId, usuarioId, limite) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const headers = headersServico();
  const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas?id=eq.${conversaId}&user_id=eq.${usuarioId}&select=id`, { headers });
  const donoData = await donoResp.json();
  if (!donoData[0]) return [];

  // Por padrão só pega as últimas 20 (contexto normal do dia a dia, mais
  // barato). Quando a pessoa claramente está pedindo pra resgatar algo
  // "lá do início" da conversa, zeca-chat.js chama com um limite bem
  // maior (até o teto de LIMITE_MENSAGENS_POR_CONVERSA) pra buscar de
  // verdade no que foi salvo, em vez do Zeca inventar uma resposta.
  const limiteFinal = limite && limite > 0 ? Math.min(limite, LIMITE_MENSAGENS_POR_CONVERSA) : 20;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_mensagens?conversa_id=eq.${conversaId}&select=remetente,texto&order=created_at.desc&limit=${limiteFinal}`, { headers });
  const mensagens = await resp.json();
  return mensagens.reverse().map(m => ({ de: m.remetente, texto: m.texto }));
};

// Salva a troca (pergunta da pessoa + resposta do Zeca). Se não tiver
// conversaId, cria uma conversa nova (checando o limite de 30 antes).
// Devolve o conversaId usado (novo ou o que já veio), ou null se não deu
// pra salvar (limite de conversas ou de mensagens estourado).
module.exports.salvarTrocaDeMensagens = async function (usuarioId, conversaIdExistente, mensagemPessoa, respostaZeca) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const headers = headersServico();
  let conversaId = conversaIdExistente;

  if (!conversaId) {
    const contagemResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas?user_id=eq.${usuarioId}&select=id`, { headers: { ...headers, Prefer: 'count=exact' } });
    const total = parseInt((contagemResp.headers.get('content-range') || '/0').split('/')[1] || '0', 10);
    if (total >= LIMITE_CONVERSAS) return null; // cheio — front avisa a pessoa a apagar uma antiga

    const tituloAuto = mensagemPessoa.trim().slice(0, 60) || 'Nova conversa';
    const criarResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: usuarioId, titulo: tituloAuto })
    });
    const criarData = await criarResp.json();
    if (!criarData[0]) return null;
    conversaId = criarData[0].id;
  } else {
    const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas?id=eq.${conversaId}&user_id=eq.${usuarioId}&select=id`, { headers });
    const donoData = await donoResp.json();
    if (!donoData[0]) return null;

    const contagemMsgResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_mensagens?conversa_id=eq.${conversaId}&select=id`, { headers: { ...headers, Prefer: 'count=exact' } });
    const totalMsg = parseInt((contagemMsgResp.headers.get('content-range') || '/0').split('/')[1] || '0', 10);
    if (totalMsg >= LIMITE_MENSAGENS_POR_CONVERSA) return conversaId;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/zeca_mensagens`, {
    method: 'POST', headers, body: JSON.stringify([
      { conversa_id: conversaId, remetente: 'pessoa', texto: mensagemPessoa },
      { conversa_id: conversaId, remetente: 'zeca', texto: respostaZeca }
    ])
  });
  await fetch(`${SUPABASE_URL}/rest/v1/zeca_conversas?id=eq.${conversaId}`, {
    method: 'PATCH', headers, body: JSON.stringify({ updated_at: new Date().toISOString() })
  });

  return conversaId;
};