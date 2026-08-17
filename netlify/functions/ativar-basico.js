// Ativa automaticamente um cadastro do Pacote 1 (grátis) — sem precisar de
// pagamento nem cupom. Só funciona pra cadastros que realmente escolheram
// o plano "basico"; o Pacote 2 (pago) continua exigindo pagamento ou cupom.

exports.handler = async function (event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const body = JSON.parse(event.body || '{}');
    const { profissionalId } = body;
    if (!profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cadastro não informado' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const userData = await userResp.json();
    if (!userData.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida' }) };
    }

    // Confirma que o cadastro é do usuário E que o plano dele é "basico" (grátis)
    const cadastroResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${userData.id}&plano=eq.basico&select=id`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const cadastros = await cadastroResp.json();
    if (!cadastros[0]) {
      return { statusCode: 403, body: JSON.stringify({ error: 'cadastro não encontrado ou não é do plano grátis' }) };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ status_pagamento: 'ativo' })
    });

    return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};