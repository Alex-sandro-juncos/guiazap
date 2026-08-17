// Recebe os avisos (webhooks) do Mercado Pago.
// - "payment" aprovado -> ativa o cadastro pendente correspondente, OU faz upgrade
//   de plano se já for um cadastro ativo que pagou o valor do Pacote Completo (migração).
// - "payment" recusado/com problema -> avisa a empresa por e-mail.
// - "subscription_preapproval" com status diferente de "authorized" (cancelada, pausada) ->
//   desativa e avisa por e-mail.

const VALOR_PACOTE_COMPLETO = 10; // R$10 -> se o pagamento for igual/maior que isso, considera Pacote Completo
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

async function enviarEmail(destinatario, assunto, html){
  if(!RESEND_API_KEY || !destinatario) return;
  try{
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: EMAIL_REMETENTE,
        to: [destinatario],
        subject: assunto,
        html
      })
    });
  } catch(e){
    console.error('erro ao enviar e-mail', e);
  }
}

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

    // ---------- PAGAMENTO (aprovado ou recusado) ----------
    if (type === 'payment') {
      const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const payment = await mpResp.json();
      const payerEmail = payment.payer && payment.payer.email;

      if (payment.status !== 'approved') {
        // Pagamento recusado, pendente ou com problema -> avisa por e-mail (se tiver e-mail e não for a primeira tentativa de um cadastro novo, que ainda nem existe)
        if (payerEmail && (payment.status === 'rejected' || payment.status === 'in_process')) {
          await enviarEmail(
            payerEmail,
            'Problema no pagamento da sua assinatura GuiaZap',
            `<p>Olá!</p>
             <p>Identificamos um problema com o pagamento da sua assinatura no GuiaZap (status: <b>${payment.status}</b>).</p>
             <p>Isso pode acontecer por cartão vencido, sem limite disponível, ou recusa do banco.</p>
             <p>Acesse <a href="https://guiazap.shop">guiazap.shop</a>, entre na sua conta e tente novamente pelo botão "Pagar agora" no seu cadastro.</p>
             <p>Qualquer dúvida, fale com a gente: contato@guiazap.shop</p>`
          );
        }
        return { statusCode: 200, body: `pagamento com status ${payment.status}, e-mail enviado se aplicável` };
      }

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

    // ---------- ASSINATURA CANCELADA/PAUSADA -> DESATIVA + AVISA ----------
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

        await enviarEmail(
          payerEmail,
          'Sua assinatura GuiaZap foi desativada',
          `<p>Olá!</p>
           <p>Sua assinatura no GuiaZap foi ${status === 'cancelled' ? 'cancelada' : 'pausada'}, e por isso seu cadastro deixou de aparecer nas buscas públicas.</p>
           <p>Se foi engano ou você quer reativar, acesse <a href="https://guiazap.shop">guiazap.shop</a>, entre na sua conta e clique em "Pagar agora" no seu cadastro.</p>
           <p>Qualquer dúvida, fale com a gente: contato@guiazap.shop</p>`
        );

        return { statusCode: 200, body: `desativado(s) por status "${status}": ${JSON.stringify(updated)}` };
      }
    }

    return { statusCode: 200, body: `ignorado (tipo "${type}" não tratado)` };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'erro no webhook: ' + err.message };
  }
};