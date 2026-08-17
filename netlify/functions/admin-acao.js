// Executa ações de moderação (suspender ou excluir empresa/produto) — só o e-mail admin consegue.

const ADMIN_EMAIL = 'contato@guiazap.shop';

exports.handler = async function (event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const body = JSON.parse(event.body || '{}');
    const { acao, tabela, id } = body;

    if (!['suspender', 'excluir'].includes(acao) || !['profissionais', 'produtos'].includes(tabela) || !id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'parâmetros inválidos' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const userData = await userResp.json();

    if (!userData.email || userData.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return { statusCode: 403, body: JSON.stringify({ error: 'acesso negado' }) };
    }

    if (acao === 'excluir') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao excluir' }) };
      return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
    }

    // suspender = só faz sentido pra "profissionais" (produtos não têm status_pagamento próprio)
    if (acao === 'suspender' && tabela === 'profissionais') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ status_pagamento: 'pendente' })
      });
      if (!resp.ok) return { statusCode: 500, body: JSON.stringify({ error: 'erro ao suspender' }) };
      return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'ação não suportada para essa tabela' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};