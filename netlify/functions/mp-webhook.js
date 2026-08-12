// Recebe os avisos (webhooks) do Mercado Pago quando um pagamento acontece.
// Quando um pagamento de assinatura é aprovado, ativa o cadastro correspondente no Supabase.

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');

    // O Mercado Pago manda vários tipos de notificação; só nos importa "payment"
    const paymentId = body.data && body.data.id;
    const type = body.type || body.topic;

    if (type !== 'payment' || !paymentId) {
      return { statusCode: 200, body: 'ignorado (não é pagamento)' };
    }

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 1. Busca os detalhes do pagamento no Mercado Pago
    const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await mpResp.json();

    if (payment.status !== 'approved') {
      return { statusCode: 200, body: `pagamento com status ${payment.status}, nada a fazer` };
    }

    const payerEmail = payment.payer && payment.payer.email;
    if (!payerEmail) {
      return { statusCode: 200, body: 'pagamento aprovado mas sem e-mail do pagador' };
    }

    // 2. Ativa o cadastro correspondente no Supabase (usando a chave secreta, só existe aqui no servidor)
    const updateResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?user_email=eq.${encodeURIComponent(payerEmail)}&status_pagamento=eq.pendente`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ status_pagamento: 'ativo' })
      }
    );
    const updated = await updateResp.json();

    return { statusCode: 200, body: `ativado(s): ${JSON.stringify(updated)}` };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'erro no webhook: ' + err.message };
  }
};