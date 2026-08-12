// Recebe um pedido de cancelamento vindo do site (usuário logado clicou em "Cancelar assinatura").
// 1. Confirma quem é o usuário de verdade (usando o token de login dele, nunca confiando só no e-mail enviado).
// 2. Busca a assinatura ativa desse e-mail no Mercado Pago.
// 3. Cancela ela.
// 4. Já desativa o cadastro no Supabase na hora (sem esperar o webhook).

exports.handler = async function (event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    // 1. Confirma o usuário real a partir do token de login (não confia em e-mail vindo do front-end)
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`
      }
    });
    const userData = await userResp.json();
    const email = userData.email;

    if (!email) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida' }) };
    }

    // 2. Busca a assinatura ativa desse e-mail no Mercado Pago
    const searchResp = await fetch(
      `https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized&limit=1`,
      { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
    );
    const searchData = await searchResp.json();
    const assinatura = searchData.results && searchData.results[0];

    if (!assinatura) {
      return { statusCode: 404, body: JSON.stringify({ error: 'nenhuma assinatura ativa encontrada para este e-mail' }) };
    }

    // 3. Cancela a assinatura
    const cancelResp = await fetch(`https://api.mercadopago.com/preapproval/${assinatura.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({ status: 'cancelled' })
    });
    if (!cancelResp.ok) {
      const errBody = await cancelResp.text();
      return { statusCode: 500, body: JSON.stringify({ error: 'falha ao cancelar no Mercado Pago', detalhe: errBody }) };
    }

    // 4. Desativa o(s) cadastro(s) já, sem esperar o webhook
    await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?user_email=eq.${encodeURIComponent(email)}&status_pagamento=eq.ativo`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ status_pagamento: 'pendente' })
      }
    );

    return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};