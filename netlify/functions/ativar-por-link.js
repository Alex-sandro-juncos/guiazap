// Consome o token gerado pelo admin-enviar-link-ativacao.js: confere que o
// token existe, ainda não foi usado, e não passou de 7 dias — aí ativa o
// cadastro de graça e marca o token como usado (nunca pode ser reusado).
//
// Não exige login: o próprio token já É a prova de identidade (só quem
// recebeu o e-mail tem o link). Por isso o token é um UUID longo,
// impossível de adivinhar por tentativa.

const VALIDADE_DIAS = 7;

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { token } = JSON.parse(event.body || '{}');
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'token é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const linkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/links_ativacao?token=eq.${encodeURIComponent(token)}&select=token,profissional_id,usado,created_at,profissionais(name,status_pagamento)`,
      { headers }
    );
    const linkData = await linkResp.json();
    const link = linkData[0];

    if (!link) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Link inválido.' }) };
    }
    if (link.usado) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Esse link já foi usado antes.' }) };
    }

    const diasDesdeGeracao = (Date.now() - new Date(link.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (diasDesdeGeracao > VALIDADE_DIAS) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Esse link expirou. Peça um novo link de ativação.' }) };
    }

    // Marca o token como usado ANTES de ativar — mesmo que algo falhe
    // depois, o token nunca fica reutilizável
    await fetch(`${SUPABASE_URL}/rest/v1/links_ativacao?token=eq.${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ usado: true })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${link.profissional_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status_pagamento: 'ativo' })
    });

    const nomeEmpresa = link.profissionais ? link.profissionais.name : null;
    return { statusCode: 200, body: JSON.stringify({ ativado: true, nomeEmpresa }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao ativar cadastro' }) };
  }
};