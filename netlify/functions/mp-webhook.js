// Recebe os avisos (webhooks) do Mercado Pago.
// - "payment" aprovado -> ativa o cadastro pendente correspondente.
// - "subscription_preapproval" com status diferente de "authorized" (cancelada, pausada) -> desativa o(s) cadastro(s) ativos daquele e-mail.

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const type = body.type || body.topic;
    const dataId = body.data && body.data.id;

    if (!dataId) {
      return { statusCode: 200, body: 'ignorado (sem data.id)' };
    }

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    async function atualizarStatus(email, novoStatus, statusAtualFiltro) {
      const url = `${SUPABASE_URL}/rest/v1/profissionais?user_email=eq.${encodeURIComponent(email)}&status_pagamento=eq.${statusAtualFiltro}`;
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ status_pagamento: novoStatus })
      });
      return resp.json();
    }

    // ---------- PAGAMENTO APROVADO -> ATIVA ----------
    if (type === 'payment') {
      const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
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

      const updated = await atualizarStatus(payerEmail, 'ativo', 'pendente');
      return { statusCode: 200, body: `ativado(s): ${JSON.stringify(updated)}` };
    }

    // ---------- ASSINATURA CANCELADA/PAUSADA -> DESATIVA ----------
    if (type === 'subscription_preapproval') {
      const mpResp = await fetch(`https://api.mercadopago.com/preapproval/${dataId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const subscription = await mpResp.json();

      const payerEmail = subscription.payer_email;
      const status = subscription.status; // "authorized", "paused", "cancelled"

      if (!payerEmail) {
        return { statusCode: 200, body: 'assinatura sem e-mail do pagador' };
      }

      if (status === 'authorized') {
        // Assinatura ativa/reativada -> garante que o cadastro fica ativo
        const updated = await atualizarStatus(payerEmail, 'ativo', 'pendente');
        return { statusCode: 200, body: `reativado(s): ${JSON.stringify(updated)}` };
      } else {
        // cancelled ou paused -> volta para pendente (some da busca pública)
        const updated = await atualizarStatus(payerEmail, 'pendente', 'ativo');
        return { statusCode: 200, body: `desativado(s) por status "${status}": ${JSON.stringify(updated)}` };
      }
    }

    return { statusCode: 200, body: `ignorado (tipo "${type}" não tratado)` };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'erro no webhook: ' + err.message };
  }
};