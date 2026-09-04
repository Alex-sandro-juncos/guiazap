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

    // 1. Confere se a conversa existe e pertence a essa empresa
    const conversaResp = await fetch(`${SUPABASE_URL}/rest/v1/conversas?id=eq.${conversaId}&select=id,profissional_id`, { headers });
    const conversaData = await conversaResp.json();
    const conversa = conversaData[0];

    if (!conversa || conversa.profissional_id !== profissionalId) {
      return { statusCode: 403, body: JSON.stringify({ error: 'conversa não pertence a essa empresa' }) };
    }

    // 2. Acha o dono da empresa (pra mandar a mensagem no chat como se fosse ela)
    const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=user_id`, { headers });
    const donoData = await donoResp.json();
    const donoUserId = donoData[0] ? donoData[0].user_id : null;

    // 3. Acha o pedido mais recente dessa conversa que está esperando pagamento
    const pedidoResp = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?conversa_id=eq.${conversaId}&profissional_id=eq.${profissionalId}&status=eq.aguardando_pagamento&select=*&order=created_at.desc&limit=1`,
      { headers }
    );
    const pedidoData = await pedidoResp.json();
    const pedido = pedidoData[0];

    if (!pedido) {
      await responderNoChat('⚠️ Não encontrei o pedido pra gerar o pagamento. Digite *menu* e tente de novo.', donoUserId);
      
      // Destrava o robô mesmo sem pedido encontrado
      await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${conversaId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ estado: 'menu_principal', carrinho: [], lista_atual: [] })
      });

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // 4. Monta os itens para a preferência do Mercado Pago
    const itensSemPreco = [];
    const itensMp = (pedido.itens || [])
      .map((item) => {
        let preco = String(item.preco || '0').replace(/[^0-9,.]/g, '');
        if (preco.includes(',')) preco = preco.replace(/\./g, '').replace(',', '.');
        const valor = parseFloat(preco) || 0;
        if (valor <= 0) itensSemPreco.push(item.nome);
        return {
          title: item.nome || 'Produto',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: valor
        };
      })
      .filter((item) => item.unit_price > 0);

    if (itensMp.length === 0) {
      await responderNoChat(
        '⚠️ Não consegui gerar o pagamento porque nenhum item do pedido tem preço válido cadastrado. Peça pra empresa conferir o preço dos produtos.',
        donoUserId
      );

      // Destrava o estado do robô
      await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${conversaId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ estado: 'menu_principal', carrinho: [], lista_atual: [] })
      });

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (pedido.taxa_entrega && parseFloat(pedido.taxa_entrega) > 0) {
      itensMp.push({
        title: 'Taxa de entrega',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: parseFloat(pedido.taxa_entrega)
      });
    }

    // 5. Verifica se a empresa tem credencial própria do Mercado Pago
    let tokenParaUsar = MP_ACCESS_TOKEN;

    const conexaoResp = await fetch(`${SUPABASE_URL}/rest/v1/mp_conexoes?profissional_id=eq.${profissionalId}&select=mp_access_token,mp_refresh_token,mp_token_expira_em,conectado`, { headers });
    const conexaoData = await conexaoResp.json();
    const conexao = conexaoData[0];

    if (conexao && conexao.conectado && conexao.mp_access_token) {
      const expirado = conexao.mp_token_expira_em && new Date(conexao.mp_token_expira_em) < new Date();

      if (!expirado) {
        tokenParaUsar = conexao.mp_access_token;
      } else {
        try {
          const respRefresh = await fetch('https://api.mercadopago.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: process.env.MP_CLIENT_ID,
              client_secret: process.env.MP_CLIENT_SECRET,
              grant_type: 'refresh_token',
              refresh_token: conexao.mp_refresh_token
            })
          });
          const dadosRefresh = await respRefresh.json();

          if (respRefresh.ok && dadosRefresh.access_token) {
            tokenParaUsar = dadosRefresh.access_token;
            const novaExpiracao = new Date(Date.now() + (dadosRefresh.expires_in || 15552000) * 1000).toISOString();
            await fetch(`${SUPABASE_URL}/rest/v1/mp_conexoes?profissional_id=eq.${profissionalId}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                mp_access_token: dadosRefresh.access_token,
                mp_refresh_token: dadosRefresh.refresh_token,
                mp_token_expira_em: novaExpiracao,
                updated_at: new Date().toISOString()
              })
            });
          }
        } catch (e) {
          console.error('Erro ao renovar token da empresa, usando conta padrão:', e);
        }
      }
    }

    // 6. Cria a preferência no Mercado Pago
    const prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenParaUsar}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: itensMp,
        external_reference: pedido.id,
        notification_url: `${SITE_URL}/.netlify/functions/mp-webhook-pedido?profissionalId=${profissionalId}`,
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
      console.error('Erro ao criar preferência no Mercado Pago:', JSON.stringify(prefData));
      const detalheErro = prefData.message || prefData.error || JSON.stringify(prefData).slice(0, 300);
      await responderNoChat('⚠️ Erro ao gerar o link de pagamento: ' + detalheErro, donoUserId);

      // Destrava o estado em caso de erro da API
      await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${conversaId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ estado: 'menu_principal', carrinho: [], lista_atual: [] })
      });

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // 7. Salva a preferência no pedido
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ mp_preference_id: prefData.id })
    });

    // 8. Envia o link gerado para o cliente no chat
    const totalFormatado = Number(pedido.total).toFixed(2).replace('.', ',');
    await responderNoChat(
      `${itensSemPreco.length > 0 ? `⚠️ Atenção: ${itensSemPreco.join(', ')} ficou(aram) de fora por não ter preço cadastrado.\n\n` : ''}💳 Prontinho! Clica no link abaixo pra pagar R$ ${totalFormatado} com segurança pelo Mercado Pago:\n\n${prefData.init_point}\n\n🔑 Seu código de confirmação: *${pedido.codigo_confirmacao}*\nAssim que o pagamento for confirmado, a empresa recebe o aviso automaticamente.`,
      donoUserId
    );

    // 9. Reseta o estado do atendimento para menu_principal
    await fetch(`${SUPABASE_URL}/rest/v1/atendimento_estado?conversa_id=eq.${conversaId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ estado: 'menu_principal', carrinho: [], lista_atual: [] })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, link: prefData.init_point }) };
  } catch (err) {
    console.error('Erro geral ao gerar link de pagamento:', err);

    // Rede de segurança: mesmo num erro totalmente inesperado (fora dos
    // casos já tratados acima), tenta avisar o cliente e destravar o
    // atendimento — sem isso, a pessoa ficava presa em silêncio até o
    // pedido cancelar sozinho em 24h.
    try {
      const bodyRecebido = JSON.parse(event.body || '{}');
      const conversaIdSeguro = bodyRecebido.conversaId;
      const profissionalIdSeguro = bodyRecebido.profissionalId;

      if (conversaIdSeguro) {
        const SUPABASE_URL_SEGURO = process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY_SEGURO = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const headersSeguro = {
          apikey: SUPABASE_SERVICE_ROLE_KEY_SEGURO,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY_SEGURO}`,
          'Content-Type': 'application/json'
        };

        let donoUserIdSeguro = null;
        if (profissionalIdSeguro) {
          const donoRespSeguro = await fetch(`${SUPABASE_URL_SEGURO}/rest/v1/profissionais?id=eq.${profissionalIdSeguro}&select=user_id`, { headers: headersSeguro });
          const donoDataSeguro = await donoRespSeguro.json();
          donoUserIdSeguro = donoDataSeguro[0] ? donoDataSeguro[0].user_id : null;
        }

        await fetch(`${SUPABASE_URL_SEGURO}/rest/v1/mensagens_chat`, {
          method: 'POST',
          headers: headersSeguro,
          body: JSON.stringify({
            conversa_id: conversaIdSeguro,
            remetente_user_id: donoUserIdSeguro,
            tipo: 'texto',
            texto: '⚠️ Tivemos um problema técnico pra gerar o link de pagamento. Digite *menu* pra tentar de novo, ou fale com a empresa.',
            lida: false,
            enviado_por_bot: true
          })
        });

        await fetch(`${SUPABASE_URL_SEGURO}/rest/v1/atendimento_estado?conversa_id=eq.${conversaIdSeguro}`, {
          method: 'PATCH',
          headers: headersSeguro,
          body: JSON.stringify({ estado: 'menu_principal', carrinho: [], lista_atual: [] })
        });
      }
    } catch (errSeguro) {
      console.error('Erro até na rede de segurança de gerar-link-pagamento:', errSeguro);
    }

    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar link de pagamento' }) };
  }
};