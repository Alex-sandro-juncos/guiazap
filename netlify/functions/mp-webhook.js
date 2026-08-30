// Recebe os avisos (webhooks) do Mercado Pago.
// - "payment" aprovado -> ativa o cadastro pendente correspondente, OU faz upgrade
//   de plano se já for um cadastro ativo que pagou o valor do Pacote Completo (migração).
// - "payment" recusado/com problema -> avisa a empresa por e-mail.
// - "subscription_preapproval" com status diferente de "authorized" (cancelada, pausada) ->
//   desativa e avisa por e-mail.

const crypto = require('crypto');

const VALOR_PACOTE_COMPLETO = 10; // R$10 -> se o pagamento for igual/maior que isso, considera Pacote Completo
const VALOR_PACOTE_PREMIUM = 25; // R$25 -> se o pagamento for igual/maior que isso, considera Pacote Premium
const VALOR_PACOTE_VENDAS = 40; // R$40 -> se o pagamento for igual/maior que isso, considera Pacote Vendas
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

// Confirma que o aviso realmente veio do Mercado Pago (evita que alguém envie
// uma mensagem falsa repetindo um pagamento antigo de outra pessoa).
// Documentação oficial: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/webhooks/notifications#editor_5
function assinaturaValida(headers, dataId){
  const secret = process.env.MP_WEBHOOK_SECRET;
  if(!secret){
    console.warn('MP_WEBHOOK_SECRET não configurado — pulando verificação de assinatura (configure pra maior segurança)');
    return true; // não trava o funcionamento enquanto a chave não é configurada
  }

  const xSignature = headers['x-signature'] || headers['X-Signature'];
  const xRequestId = headers['x-request-id'] || headers['X-Request-Id'];
  if(!xSignature || !xRequestId) return false;

  let ts, v1;
  xSignature.split(',').forEach(parte => {
    const [chave, valor] = parte.split('=');
    if(chave && chave.trim() === 'ts') ts = (valor || '').trim();
    if(chave && chave.trim() === 'v1') v1 = (valor || '').trim();
  });
  if(!ts || !v1) return false;

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const hashCalculado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return hashCalculado === v1;
}

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

    if(!assinaturaValida(event.headers, dataId)){
      console.error('assinatura do webhook inválida — possível tentativa de falsificação');
      return { statusCode: 401, body: 'assinatura inválida' };
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

      // Compara valores com uma pequena margem de tolerância (evita problema
      // de arredondamento de centavos)
      function proximoDe(valor, alvo, tolerancia){
        return Math.abs(valor - (alvo || 0)) <= (tolerancia || 1);
      }

      // Impulsionamento avulso (R$5,00 por 24h no topo — qualquer plano pode comprar)
      const VALOR_IMPULSIONAR = 5;
      if (proximoDe(valorPago, VALOR_IMPULSIONAR)) {
        const impulsionadoAte = new Date();
        impulsionadoAte.setHours(impulsionadoAte.getHours() + 24);

        const marcados = await atualizarSupabase(
          `user_email=eq.${encodeURIComponent(payerEmail)}&status_pagamento=eq.ativo`,
          { impulsionado_ate: impulsionadoAte.toISOString() }
        );
        if (marcados && marcados.length > 0) {
          await enviarEmail(
            payerEmail,
            'Impulsionamento ativado — GuiaZap',
            `<p>Olá!</p>
             <p>Seu cadastro está impulsionado no topo da busca por 24 horas!</p>
             <p>Acesse <a href="https://guiazap.shop">guiazap.shop</a> pra conferir.</p>`
          );
        }
        return { statusCode: 200, body: `impulsionamento processado, ${marcados ? marcados.length : 0} cadastro(s) atualizado(s)` };
      }

      // Pagamento do Selo Verificado (R$15, valor fixo — não é assinatura de plano)
      // CORRIGIDO: a checagem anterior (>= 15 && < 10) era matematicamente
      // impossível e nunca disparava — pagamentos do Selo caíam por engano na
      // lógica de planos, tratando R$15 como se fosse upgrade pro Completo.
      const VALOR_SELO_VERIFICADO = 15;
      if (proximoDe(valorPago, VALOR_SELO_VERIFICADO)) {
        const marcados = await atualizarSupabase(
          `user_email=eq.${encodeURIComponent(payerEmail)}&status_pagamento=eq.ativo`,
          { verificacao_pago: true, verificacao_status: 'pendente' }
        );
        if (marcados && marcados.length > 0) {
          await enviarEmail(
            payerEmail,
            'Pagamento do Selo Verificado confirmado!',
            `<p>Olá!</p>
             <p>Recebemos seu pagamento do Selo Verificado no GuiaZap.</p>
             <p>Agora é só completar as etapas de verificação no seu cadastro (documento, e-mail e WhatsApp) — acesse <a href="https://guiazap.shop">guiazap.shop</a> pra continuar.</p>`
          );
        }
        return { statusCode: 200, body: `pagamento do selo verificado processado, ${marcados ? marcados.length : 0} cadastro(s) atualizado(s)` };
      }

      const planoPago = valorPago >= VALOR_PACOTE_VENDAS ? 'vendas' : (valorPago >= VALOR_PACOTE_PREMIUM ? 'premium' : (valorPago >= VALOR_PACOTE_COMPLETO ? 'completo' : 'basico'));

      // Caso 1: existe um cadastro PENDENTE desse e-mail -> é um cadastro novo, ativa
      const emailFiltro = `user_email=eq.${encodeURIComponent(payerEmail)}`;
      const ativadoNovo = await atualizarSupabase(
        `${emailFiltro}&status_pagamento=eq.pendente`,
        { status_pagamento: 'ativo', plano: planoPago }
      );

      // Caso 2: se o valor pago foi de um plano mais alto, faz upgrade de qualquer
      // cadastro já ATIVO desse e-mail que ainda estava num plano mais baixo (migração)
      let upgradeFeito = [];
      if (planoPago === 'completo') {
        upgradeFeito = await atualizarSupabase(
          `${emailFiltro}&status_pagamento=eq.ativo&plano=eq.basico`,
          { plano: 'completo' }
        );
      } else if (planoPago === 'premium') {
        upgradeFeito = await atualizarSupabase(
          `${emailFiltro}&status_pagamento=eq.ativo&plano=in.(basico,completo)`,
          { plano: 'premium' }
        );
      } else if (planoPago === 'vendas') {
        upgradeFeito = await atualizarSupabase(
          `${emailFiltro}&status_pagamento=eq.ativo&plano=in.(basico,completo,premium)`,
          { plano: 'vendas' }
        );
      }

      if ((ativadoNovo && ativadoNovo.length > 0) || (upgradeFeito && upgradeFeito.length > 0)) {
        const nomePlano = planoPago === 'vendas' ? 'Vendas' : planoPago === 'premium' ? 'Premium' : planoPago === 'completo' ? 'Completo' : 'Básico';
        await enviarEmail(
          payerEmail,
          'Pagamento confirmado — cadastro ativo no GuiaZap!',
          `<p>Olá!</p>
           <p>Seu pagamento foi confirmado e seu cadastro no GuiaZap (Pacote ${nomePlano}) já está <b>ativo</b>, aparecendo para todos na busca.</p>
           <p>Acesse <a href="https://guiazap.shop">guiazap.shop</a> pra ver seu cadastro no ar.</p>
           <p>Qualquer dúvida, fale com a gente: contato@guiazap.shop</p>`
        );

        // Se esse cadastro veio de um link de indicação, e é a PRIMEIRA vez que
        // vira pagante (plano diferente de básico), gera automaticamente um
        // cupom de 1 mês grátis pra quem indicou.
        const cadastroNovo = ativadoNovo && ativadoNovo[0];
        if (cadastroNovo && cadastroNovo.indicado_por && planoPago !== 'basico') {
          try {
            const jaTemIndicacao = await fetch(
              `${SUPABASE_URL}/rest/v1/indicacoes?indicado_profissional_id=eq.${cadastroNovo.id}&select=id`,
              { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
            );
            const indicacoesExistentes = await jaTemIndicacao.json();

            if (!indicacoesExistentes || indicacoesExistentes.length === 0) {
              const codigoCupom = `INDICOU${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

              await fetch(`${SUPABASE_URL}/rest/v1/cupons`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
                body: JSON.stringify({ codigo: codigoCupom, descricao: 'Recompensa por indicação — 1 mês grátis', usos_maximos: 1 })
              });

              await fetch(`${SUPABASE_URL}/rest/v1/indicacoes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
                body: JSON.stringify({ indicador_user_id: cadastroNovo.indicado_por, indicado_profissional_id: cadastroNovo.id, cupom_gerado: codigoCupom })
              });

              // Busca o e-mail de quem indicou, pra avisar
              const indicadorResp = await fetch(
                `${SUPABASE_URL}/auth/v1/admin/users/${cadastroNovo.indicado_por}`,
                { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
              );
              const indicadorData = await indicadorResp.json();
              if (indicadorData && indicadorData.email) {
                await enviarEmail(
                  indicadorData.email,
                  '🎁 Você ganhou 1 mês grátis no GuiaZap!',
                  `<p>Olá!</p>
                   <p>Uma empresa se cadastrou pelo seu link de indicação e virou pagante — você ganhou um cupom de <b>1 mês grátis</b>!</p>
                   <p>Seu código: <b style="font-size:1.2em; letter-spacing:2px;">${codigoCupom}</b></p>
                   <p>Use esse código no seu próximo cadastro ou renovação, no campo de cupom.</p>`
                );
              }
            }
          } catch (erroIndicacao) {
            console.error('erro ao processar indicação', erroIndicacao);
          }
        }
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

      // Confere se essa assinatura é da campanha "primeiros 100 grátis" —
      // compara o ID do plano de assinatura com a variável de ambiente
      const idPlanoCampanha100 = process.env.MP_PLANO_ID_CAMPANHA100;
      const ehCampanha100 = idPlanoCampanha100 && subscription.preapproval_plan_id === idPlanoCampanha100;

      if (status === 'authorized') {
        const camposAtivar = ehCampanha100 ? { status_pagamento: 'ativo', plano: 'premium' } : { status_pagamento: 'ativo' };
        const updated = await atualizarSupabase(`${emailFiltro}&status_pagamento=eq.pendente`, camposAtivar);

        // Se for a campanha, registra o resgate (só se ainda não passou de 100)
        if (ehCampanha100 && updated && updated.length > 0) {
          const contagemResp = await fetch(`${SUPABASE_URL}/rest/v1/campanha_100_gratis?select=id`, {
            headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'count=exact' }
          });
          const jaResgatados = (await contagemResp.json()).length;

          if (jaResgatados < 100) {
            const dataFimTrial = new Date();
            dataFimTrial.setDate(dataFimTrial.getDate() + 30);
            await fetch(`${SUPABASE_URL}/rest/v1/campanha_100_gratis`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ profissional_id: updated[0].id, data_fim_trial: dataFimTrial.toISOString() })
            });
          }
        }

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