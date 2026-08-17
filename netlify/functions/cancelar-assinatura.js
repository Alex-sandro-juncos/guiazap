// Recebe um pedido de desativação vindo do site (usuário logado clicou em "Desativar cadastro").
// 1. Confirma quem é o usuário de verdade (usando o token de login dele, nunca confiando só no e-mail enviado).
// 2. Se existir uma assinatura de verdade no Mercado Pago pra esse e-mail, cancela ela também.
//    Se não existir (cadastro grátis, ou foi ativado manualmente sem assinatura real), segue em frente sem erro.
// 3. Desativa o cadastro no Supabase de qualquer forma.

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

    // 2. Se existir assinatura real no Mercado Pago pra esse e-mail, cancela ela também
    // (mas não é obrigatório existir — cadastros grátis ou ativados manualmente não têm nenhuma)
    try {
      const searchResp = await fetch(
        `https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized&limit=1`,
        { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
      );
      const searchData = await searchResp.json();
      const assinatura = searchData.results && searchData.results[0];

      if (assinatura) {
        await fetch(`https://api.mercadopago.com/preapproval/${assinatura.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MP_ACCESS_TOKEN}`
          },
          body: JSON.stringify({ status: 'cancelled' })
        });
      }
    } catch (e) {
      console.error('erro ao tentar cancelar no Mercado Pago (seguindo mesmo assim)', e);
    }

    // 3. Desativa o(s) cadastro(s) de qualquer forma, com ou sem assinatura real no Mercado Pago
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