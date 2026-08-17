// Recebe um pedido de resgate de cupom (usuário logado digitou um código).
// 1. Confirma quem é o usuário de verdade (pelo token de login).
// 2. Verifica se o cupom existe, está ativo e ainda tem usos disponíveis.
// 3. Ativa o cadastro (sem cobrar nada) e desconta um uso do cupom.

exports.handler = async function (event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const body = JSON.parse(event.body || '{}');
    const { codigo, profissionalId } = body;

    if (!codigo || !profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'código ou cadastro não informado' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 1. Confirma o usuário real a partir do token
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const userData = await userResp.json();
    if (!userData.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida' }) };
    }

    // 2. Busca o cupom
    const cupomResp = await fetch(
      `${SUPABASE_URL}/rest/v1/cupons?codigo=eq.${encodeURIComponent(codigo.trim().toUpperCase())}&select=*`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const cupons = await cupomResp.json();
    const cupom = cupons[0];

    if (!cupom || !cupom.ativo) {
      return { statusCode: 404, body: JSON.stringify({ error: 'cupom inválido ou inexistente' }) };
    }
    if (cupom.usos_atuais >= cupom.usos_maximos) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cupom esgotado' }) };
    }

    // 3. Confirma que o cadastro pertence mesmo a esse usuário, e ativa
    const cadastroResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${userData.id}&select=id,status_pagamento`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const cadastros = await cadastroResp.json();
    if (!cadastros[0]) {
      return { statusCode: 403, body: JSON.stringify({ error: 'esse cadastro não pertence a você' }) };
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

    // Desconta um uso do cupom
    await fetch(`${SUPABASE_URL}/rest/v1/cupons?codigo=eq.${encodeURIComponent(cupom.codigo)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ usos_atuais: cupom.usos_atuais + 1 })
    });

    return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};