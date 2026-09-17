// Manda uma mensagem (tipo aviso de promoção) pra TODOS os contatos que já
// conversaram com uma empresa no Papo. Tem um limite de uso (1x por dia por
// empresa) pra evitar virar spam — a empresa é dona da lista, mas ainda
// assim precisa ter bom senso de uso.

const LIMITE_HORAS_ENTRE_ENVIOS = 24;

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { profissionalId, mensagem } = JSON.parse(event.body || '{}');
    if (!profissionalId || !mensagem || !mensagem.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId e mensagem são obrigatórios' }) };
    }
    if (mensagem.length > 500) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Mensagem muito longa (máximo 500 caracteres).' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Confere login e que quem está pedindo é DONO dessa empresa
    const tokenUsuario = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    if (!tokenUsuario) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenUsuario}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();

    const empresaResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=id,name,user_id,ultimo_envio_massa`, { headers });
    const empresas = await empresaResp.json();
    const empresa = empresas[0];
    if (!empresa || empresa.user_id !== usuario.id) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Essa empresa não é sua.' }) };
    }

    if (empresa.ultimo_envio_massa) {
      const horasDesdeUltimo = (Date.now() - new Date(empresa.ultimo_envio_massa).getTime()) / (1000 * 60 * 60);
      if (horasDesdeUltimo < LIMITE_HORAS_ENTRE_ENVIOS) {
        const faltam = Math.ceil(LIMITE_HORAS_ENTRE_ENVIOS - horasDesdeUltimo);
        return { statusCode: 429, body: JSON.stringify({ error: `Você já mandou uma mensagem em massa recentemente. Espera mais ${faltam}h pra mandar outra.` }) };
      }
    }

    // Busca todas as conversas dessa empresa que AINDA aceitam receber
    // esse tipo de mensagem — quem já clicou pra sair fica de fora
    const conversasResp = await fetch(`${SUPABASE_URL}/rest/v1/conversas?profissional_id=eq.${profissionalId}&aceita_mensagens_massa=eq.true&select=id`, { headers });
    const conversas = await conversasResp.json();

    if (!conversas || conversas.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, total: 0 }) };
    }

    const agora = new Date().toISOString();

    const mensagens = conversas.map(c => ({
      conversa_id: c.id,
      remetente_user_id: empresa.user_id,
      tipo: 'texto',
      texto: `📢 *${empresa.name}*\n\n${mensagem.trim()}\n\n_Não quer mais receber avisos como esse? https://guiazap.shop/cancelar-avisos.html?conversa=${c.id}_`,
      lida: false,
      enviado_por_bot: false
    }));

    // Insere em lotes de 100 pra não estourar limite de tamanho da requisição
    for (let i = 0; i < mensagens.length; i += 100) {
      const lote = mensagens.slice(i, i + 100);
      await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(lote)
      });
    }

    // Atualiza "ultima_mensagem_em" de todas as conversas de uma vez
    await fetch(`${SUPABASE_URL}/rest/v1/conversas?profissional_id=eq.${profissionalId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ultima_mensagem_em: agora })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ultimo_envio_massa: agora })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, total: conversas.length }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao enviar mensagem em massa' }) };
  }
};