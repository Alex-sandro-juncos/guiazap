// Gera um link de pagamento (Checkout Pro) do Mercado Pago com o valor EXATO
// de um pedido específico — diferente das assinaturas fixas, aqui cada
// pedido tem seu próprio link com o total certo (produtos + frete).

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { conversaId, profissionalId } = JSON.parse(event.body || '{}');
    if (!conversaId || !profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'conversaId e profissionalId são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SITE_URL = process.env.URL || 'https://guiazap.shop';

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    async function responderNoChat(texto, donoUserId) {
      await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          conversa_id: conversaId,
          remetente_user_id: donoUserId,
          tipo: 'texto',
          texto,
          lida: false,
          enviado_por_bot: true
        })
      });
      await fetch(`${SUPABASE_URL}/rest/v1/conversas?id=eq.${conversaId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ ultima_mensagem_em: new Date().toISOString() })
      });
    }

    // 1. Acha o dono da empresa (pra mandar a mensagem como se fosse ela)
    const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=user_id`, { headers });
    const donoData = await donoResp.json();
    const donoUserId = donoData[0] ? donoData[0].user_id : null;

    // 2. Acha o pedido mais recente dessa conversa que está esperando pagamento
    const pedidoResp = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?conversa_id=eq.${conversaId}&status=eq.aguardando_pagamento&select=*&order=created_at.desc&limit=1`,
      { headers }
    );
    const pedidoData = await pedidoResp.json();
    const pedido = pedidoData[0];

    if (!pedido) {
      await responderNoChat('⚠️ Não encontrei o pedido pra gerar o pagamento. Digite *menu* e tente de novo.', donoUserId);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // 3. Monta os itens pra preferência do Mercado Pago
    const itensMp = (pedido.itens || []).map((item) => {
      let preco = String(item.preco || '0').replace(/[^0-9,.]/g, '');
      if (preco.includes(',')) preco = preco.replace(/\./g, '').replace(',', '.');
      return {
        title: item.nome,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: parseFloat(preco) || 0
      };
    });

    if (pedido.taxa_entrega && parseFloat(pedido.taxa_entrega) > 0) {
      itensMp.push({
        title: 'Taxa de entrega',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: parseFloat(pedido.taxa_entrega)
      });
    }

    // 4. Cria a preferência de pagamento no Mercado Pago
    const prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: itensMp,
        external_reference: pedido.id,
        notification_url: `${SITE_URL}/.netlify/functions/mp-webhook-pedido`,
        back_urls: {
          success: `${SITE_URL}/chat.html?empresa=${profissionalId}`,
          failure: `${SITE_URL}/chat.html?empresa=${profissionalId}`,
          pending: `${SITE_URL}/chat.html?empresa=${profissionalId}`
        },
        auto_return: 'approved'
      })
    });

    const prefData = await prefResp.json();

    if (!prefData.init_point) {
      console.error('erro ao criar preferência do Mercado Pago:', JSON.stringify(prefData));
      await responderNoChat('⚠️ Não consegui gerar o link de pagamento agora. Digite *5* pra falar com um atendente.', donoUserId);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // 5. Guarda o id da preferência no pedido, pra reconhecer o pagamento depois
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ mp_preference_id: prefData.id })
    });

    // 6. Manda o link no chat
    const totalFormatado = Number(pedido.total).toFixed(2).replace('.', ',');
    await responderNoChat(
      `💳 Prontinho! Clica no link abaixo pra pagar R$ ${totalFormatado} com segurança pelo Mercado Pago:\n\n${prefData.init_point}\n\n🔑 Seu código de confirmação: *${pedido.codigo_confirmacao}*\nAssim que o pagamento for confirmado, a empresa já recebe o aviso automaticamente.`,
      donoUserId
    );

    // Reseta o estado do robô pra menu principal, liberando pra próxima interação
    await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${conversaId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ estado: 'menu_principal', carrinho: [], lista_atual: [] })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, link: prefData.init_point }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar link de pagamento' }) };
  }
};