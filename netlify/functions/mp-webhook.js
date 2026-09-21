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
    // ANTES: sem a chave configurada, isso deixava passar QUALQUER aviso
    // como se fosse verdadeiro — alguém poderia fingir um pagamento e
    // ativar um plano de graça. Agora, sem a chave, o webhook RECUSA por
    // segurança. Configure MP_WEBHOOK_SECRET no Netlify com a chave
    // secreta que aparece no painel do Mercado Pago (Webhooks > sua
    // notificação > "Chave secreta") — sem isso, pagamentos reais também
    // vão parar de ativar o plano sozinhos.
    console.error('MP_WEBHOOK_SECRET não configurado — recusando o webhook por segurança. Configure a chave no Netlify.');
    return false;
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

  // ts muito velho (ou "do futuro") não é o Mercado Pago demorando — é
  // alguém reenviando (replay) um aviso antigo que capturou em algum lugar.
  const tsNumero = Number(ts);
  if(!tsNumero || Math.abs(Date.now() - tsNumero) > 5 * 60 * 1000){
    console.error('Webhook do MP recusado: timestamp fora da janela de 5 minutos (possível replay).');
    return false;
  }

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const hashCalculado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  // Comparação normal (===) vaza quanto tempo levou pra achar a primeira
  // letra diferente — dá pra, em teoria, adivinhar o hash certo byte a
  // byte medindo o tempo de resposta. timingSafeEqual sempre compara tudo,
  // não importa onde a diferença está. Os dois precisam ter o MESMO
  // tamanho antes de comparar, senão a função já dá erro sozinha.
  const bufA = Buffer.from(hashCalculado, 'utf8');
  const bufB = Buffer.from(v1, 'utf8');
  if(bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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

    const SUPABASE_URL_CHECK = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY_CHECK = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Trava de idempotência: tenta "reservar" esse evento com um INSERT
    // numa tabela com chave única (tipo + data_id). Se o Mercado Pago
    // reenviar o mesmo aviso (retry deles, normal), o INSERT falha aqui
    // e a gente devolve 200 sem reprocessar nada — sem risco de corrida,
    // porque o próprio banco garante que só um INSERT com essa chave passa.
    const reservaResp = await fetch(`${SUPABASE_URL_CHECK}/rest/v1/mp_webhook_processados`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY_CHECK,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY_CHECK}`,
        Prefer: 'resolution=ignore-duplicates,return=representation'
      },
      body: JSON.stringify({ tipo: type || 'desconhecido', data_id: String(dataId) })
    });
    const reservaData = await reservaResp.json();
    if (!Array.isArray(reservaData) || reservaData.length === 0) {
      // Já tinha uma linha com essa chave — evento repetido, não reprocessa
      return { statusCode: 200, body: 'evento já processado antes (repetição do Mercado Pago, ignorado)' };
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

      // O Pacote Entregador custa o MESMO valor do Pacote Completo (R$10) —
      // não dá pra diferenciar só pelo valor. Se o pagamento veio de uma
      // assinatura (preapproval), confere se é especificamente o plano do
      // Entregador antes de cair na lógica normal por valor.
      let planoPagoForcado = null;
      const idPlanoEntregador = process.env.MP_PLANO_ID_ENTREGADOR;
      if (idPlanoEntregador && payment.preapproval_id) {
        try {
          const preResp = await fetch(`https://api.mercadopago.com/preapproval/${payment.preapproval_id}`, {
            headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
          });
          const preapproval = await preResp.json();
          if (preapproval.preapproval_plan_id === idPlanoEntregador) {
            planoPagoForcado = 'entregador';
          }
        } catch (e) {
          console.error('erro ao consultar preapproval pra identificar plano Entregador', e);
        }
      }

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

      // Pacote de créditos extras do Zeca (R$7, valor fixo — 5 usos extras
      // de imagem/áudio/etc pra quem já estourou o limite diário do plano).
      const VALOR_CREDITOS_ZECA = 7;
      const QUANTIDADE_CREDITOS_ZECA = 5;
      if (proximoDe(valorPago, VALOR_CREDITOS_ZECA)) {
        try {
          const usuarioResp = await fetch(
            `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(payerEmail)}`,
            { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
          );
          const usuarioData = await usuarioResp.json();
          const usuarioEncontrado = (usuarioData && usuarioData.users && usuarioData.users[0]) || null;
          if (!usuarioEncontrado) {
            console.error('pagamento de créditos do Zeca aprovado, mas não achei usuário com esse e-mail:', payerEmail);
            return { statusCode: 200, body: 'crédito do Zeca: usuário não encontrado pelo e-mail do pagamento' };
          }

          const saldoAtualResp = await fetch(
            `${SUPABASE_URL}/rest/v1/zeca_creditos_extras?user_id=eq.${usuarioEncontrado.id}`,
            { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
          );
          const saldoAtualLista = await saldoAtualResp.json();
          const registroSaldo = saldoAtualLista && saldoAtualLista[0];

          if (registroSaldo) {
            await fetch(`${SUPABASE_URL}/rest/v1/zeca_creditos_extras?user_id=eq.${usuarioEncontrado.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ saldo: (registroSaldo.saldo || 0) + QUANTIDADE_CREDITOS_ZECA, updated_at: new Date().toISOString() })
            });
          } else {
            await fetch(`${SUPABASE_URL}/rest/v1/zeca_creditos_extras`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ user_id: usuarioEncontrado.id, saldo: QUANTIDADE_CREDITOS_ZECA, updated_at: new Date().toISOString() })
            });
          }

          await enviarEmail(
            payerEmail,
            'Créditos extras do Zeca liberados — GuiaZap',
            `<p>Olá!</p>
             <p>Recebemos seu pagamento e liberamos <b>${QUANTIDADE_CREDITOS_ZECA} créditos extras</b> pro Zeca (imagem, áudio e outras gerações), além do limite diário normal do seu plano.</p>
             <p>Já pode usar — acesse <a href="https://guiazap.shop">guiazap.shop</a>.</p>`
          );
        } catch (erroCreditos) {
          console.error('erro ao processar crédito extra do Zeca', erroCreditos);
        }
        return { statusCode: 200, body: 'créditos extras do Zeca processados' };
      }

      // Zeca PRO (R$70/mês, valor fixo — é uma ASSINATURA recorrente, mas
      // é um EXTRA que empilha em cima do pacote normal, não troca o
      // "plano" de ninguém. Por isso não entra na lógica de planoPago lá
      // embaixo — só liga a flag zeca_pro_ativo em cima do(s) cadastro(s)
      // já ATIVO(s) desse e-mail (precisa já ter um pacote pago ou o
      // Contato ativo pra ter em que empilhar).
      const VALOR_ZECA_PRO = 70;
      if (proximoDe(valorPago, VALOR_ZECA_PRO)) {
        const marcados = await atualizarSupabase(
          `user_email=eq.${encodeURIComponent(payerEmail)}&status_pagamento=eq.ativo`,
          { zeca_pro_ativo: true }
        );
        if (marcados && marcados.length > 0) {
          await enviarEmail(
            payerEmail,
            'Zeca PRO ativado — GuiaZap',
            `<p>Olá!</p>
             <p>Seu pagamento do <b>Zeca PRO</b> foi confirmado — o limite diário de uso do Zeca (conversa livre, código, edição de áudio/vídeo) e o limite semanal de geração de imagem já estão bem maiores no seu cadastro.</p>
             <p>Acesse <a href="https://guiazap.shop">guiazap.shop</a> e aproveita.</p>`
          );
        } else {
          console.error('pagamento do Zeca PRO aprovado, mas não achei cadastro ATIVO com esse e-mail pra empilhar:', payerEmail);
        }
        return { statusCode: 200, body: `Zeca PRO processado, ${marcados ? marcados.length : 0} cadastro(s) atualizado(s)` };
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

      const planoPago = planoPagoForcado || (valorPago >= VALOR_PACOTE_VENDAS ? 'vendas' : (valorPago >= VALOR_PACOTE_PREMIUM ? 'premium' : (valorPago >= VALOR_PACOTE_COMPLETO ? 'completo' : 'basico')));

      // Caso 1: existe um cadastro PENDENTE desse e-mail -> é um cadastro novo, ativa
      const emailFiltro = `user_email=eq.${encodeURIComponent(payerEmail)}`;
      const ativadoNovo = await atualizarSupabase(
        `${emailFiltro}&status_pagamento=eq.pendente`,
        { status_pagamento: 'ativo', plano: planoPago, zeca_plano_pago: true }
      );

      // Caso 2: se o valor pago foi de um plano mais alto, faz upgrade de qualquer
      // cadastro já ATIVO desse e-mail que ainda estava num plano mais baixo (migração)
      let upgradeFeito = [];
      if (planoPago === 'completo') {
        upgradeFeito = await atualizarSupabase(
          `${emailFiltro}&status_pagamento=eq.ativo&plano=eq.basico`,
          { plano: 'completo', zeca_plano_pago: true }
        );
      } else if (planoPago === 'premium') {
        upgradeFeito = await atualizarSupabase(
          `${emailFiltro}&status_pagamento=eq.ativo&plano=in.(basico,completo)`,
          { plano: 'premium', zeca_plano_pago: true }
        );
      } else if (planoPago === 'vendas') {
        upgradeFeito = await atualizarSupabase(
          `${emailFiltro}&status_pagamento=eq.ativo&plano=in.(basico,completo,premium)`,
          { plano: 'vendas', zeca_plano_pago: true }
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

      // Mesma lógica pro Pacote Entregador — precisa saber que é esse plano
      // específico, já que o valor sozinho (R$10) é igual ao do Completo
      const idPlanoEntregadorSub = process.env.MP_PLANO_ID_ENTREGADOR;
      const ehPlanoEntregador = idPlanoEntregadorSub && subscription.preapproval_plan_id === idPlanoEntregadorSub;

      // Zeca PRO (R$70/mês) é uma assinatura À PARTE do pacote normal —
      // tratada aqui ANTES da lógica genérica de baixo, porque cancelar o
      // Zeca PRO nunca pode desativar o cadastro inteiro (a lógica genérica
      // do "else" abaixo desativaria TODOS os cadastros ativos desse
      // e-mail, o que apagaria o pacote normal da empresa por engano).
      const idPlanoZecaPro = process.env.MP_PLANO_ID_ZECAPRO;
      const ehZecaPro = idPlanoZecaPro && subscription.preapproval_plan_id === idPlanoZecaPro;
      if (ehZecaPro) {
        if (status === 'authorized') {
          const updated = await atualizarSupabase(`${emailFiltro}&status_pagamento=eq.ativo`, { zeca_pro_ativo: true });
          return { statusCode: 200, body: `Zeca PRO (re)ativado: ${JSON.stringify(updated)}` };
        }
        const updated = await atualizarSupabase(`${emailFiltro}&status_pagamento=eq.ativo`, { zeca_pro_ativo: false });
        await enviarEmail(
          payerEmail,
          'Zeca PRO desativado — GuiaZap',
          `<p>Olá!</p>
           <p>Sua assinatura do <b>Zeca PRO</b> foi ${status === 'cancelled' ? 'cancelada' : 'pausada'} — o limite diário/semanal do Zeca voltou ao normal do seu pacote. O resto do seu cadastro continua ativo, normalmente.</p>
           <p>Se foi engano, acesse <a href="https://guiazap.shop/pacotes.html">guiazap.shop/pacotes.html</a> pra assinar de novo.</p>`
        );
        return { statusCode: 200, body: `Zeca PRO desativado por status "${status}": ${JSON.stringify(updated)}` };
      }

      if (status === 'authorized') {
        // Assinatura autorizada de verdade no Mercado Pago (mesmo com 1º mês
        // grátis da campanha) — conta como plano pago pro limite do Zeca.
        const camposAtivar = ehCampanha100
          ? { status_pagamento: 'ativo', plano: 'premium', zeca_plano_pago: true }
          : ehPlanoEntregador
            ? { status_pagamento: 'ativo', plano: 'entregador', zeca_plano_pago: true }
            : { status_pagamento: 'ativo', zeca_plano_pago: true };
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