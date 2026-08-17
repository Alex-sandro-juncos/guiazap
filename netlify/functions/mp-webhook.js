// Recebe os avisos (webhooks) do Mercado Pago.
// - "payment" aprovado -> ativa o cadastro pendente correspondente, OU faz upgrade
//   de plano se já for um cadastro ativo que pagou o valor do Pacote Completo (migração).
// - "subscription_preapproval" com status diferente de "authorized" (cancelada, pausada) -> desativa.

const VALOR_PACOTE_COMPLETO = 10; // R$10 -> se o pagamento for igual/maior que isso, considera Pacote Completo

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

    async function atualizarSupabase(filtroQuery, campos) {
      const url = `${SUPABASE_URL}/rest/v1/profissionais?${filtroQuery}`;
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'return=representation'
        },
        body: JSON.stringify(campos)
      });
      return resp.json();
    }

    // ---------- PAGAMENTO APROVADO ----------
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

      const valorPago = payment.transaction_amount || 0;
      const planoPago = valorPago >= VALOR_PACOTE_COMPLETO ? 'completo' : 'basico';

      // Caso 1: existe um cadastro PENDENTE desse e-mail -> é um cadastro novo, ativa
      const emailFiltro = `user_email=eq.${encodeURIComponent(payerEmail)}`;
      const ativadoNovo = await atualizarSupabase(
        `${emailFiltro}&status_pagamento=eq.pendente`,
        { status_pagamento: 'ativo', plano: planoPago }
      );

      // Caso 2: se o valor pago foi do Pacote Completo, faz upgrade de qualquer
      // cadastro já ATIVO desse e-mail que ainda estava no plano básico (migração)
      let upgradeFeito = [];
      if (planoPago === 'completo') {
        upgradeFeito = await atualizarSupabase(
          `${emailFiltro}&status_pagamento=eq.ativo&plano=eq.basico`,
          { plano: 'completo' }
        );
      }

      return {
        statusCode: 200,
        body: `ativados: ${JSON.stringify(ativadoNovo)} | upgrades: ${JSON.stringify(upgradeFeito)}`
      };
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

      const emailFiltro = `user_email=eq.${encodeURIComponent(payerEmail)}`;

      if (status === 'authorized') {
        const updated = await atualizarSupabase(`${emailFiltro}&status_pagamento=eq.pendente`, { status_pagamento: 'ativo' });
        return { statusCode: 200, body: `reativado(s): ${JSON.stringify(updated)}` };
      } else {
        const updated = await atualizarSupabase(`${emailFiltro}&status_pagamento=eq.ativo`, { status_pagamento: 'pendente' });
        return { statusCode: 200, body: `desativado(s) por status "${status}": ${JSON.stringify(updated)}` };
      }
    }

    return { statusCode: 200, body: `ignorado (tipo "${type}" não tratado)` };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'erro no webhook: ' + err.message };
  }
};