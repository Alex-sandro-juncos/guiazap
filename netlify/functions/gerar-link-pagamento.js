// Gera um link de pagamento (Checkout Pro) do Mercado Pago com o valor EXATO
// de um pedido específico — diferente das assinaturas fixas, aqui cada
// pedido tem seu próprio link com o total certo (produtos + frete).
//
// ⚠️ SEGURANÇA: essa função cria cobranças de verdade — exige que quem
// chama esteja LOGADO e seja o cliente DAQUELA conversa específica, e
// confere que o pedido encontrado realmente pertence à mesma empresa e
// conversa informadas (nunca confia só nos IDs que vêm do navegador).

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
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SITE_URL = process.env.URL || 'https://guiazap.shop';

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Confere se quem está chamando está LOGADO de verdade
    const tokenUsuario = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    if (!tokenUsuario) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenUsuario}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();

    // 2. Confere se a conversa existe, é DESSA empresa, e o usuário logado
    // é de fato o cliente dessa conversa — evita que alguém gere link de
    // pagamento numa conversa/empresa que não é dele
    const conversaResp = await fetch(`${SUPABASE_URL}/rest/v1/conversas?id=eq.${conversaId}&select=id,profissional_id,visitante_user_id,usuario2_id`, { headers });
    const conversaData = await conversaResp.json();
    const conversa = conversaData[0];

    if (!conversa || conversa.profissional_id !== profissionalId) {
      return { statusCode: 403, body: JSON.stringify({ error: 'conversa não pertence a essa empresa' }) };
    }

    const clienteDaConversa = conversa.visitante_user_id || conversa.usuario2_id;
    if (clienteDaConversa !== usuario.id) {
      return { statusCode: 403, body: JSON.stringify({ error: 'essa conversa não é sua' }) };
    }

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

    // 3. Acha o dono da empresa (pra mandar a mensagem como se fosse ela)
    const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=user_id`, { headers });
    const donoData = await donoResp.json();
    const donoUserId = donoData[0] ? donoData[0].user_id : null;

    // 4. Acha o pedido mais recente dessa conversa que está esperando
    // pagamento — confere TAMBÉM que o profissional_id do pedido bate com
    // a empresa informada, não só o conversa_id
    const pedidoResp = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?conversa_id=eq.${conversaId}&profissional_id=eq.${profissionalId}&status=eq.aguardando_pagamento&select=*&order=created_at.desc&limit=1`,
      { headers }
    );
    const pedidoData = await pedidoResp.json();
    const pedido = pedidoData[0];

    if (!pedido) {
      await responderNoChat('⚠️ Não encontrei o pedido pra gerar o pagamento. Digite *menu* e tente de novo.', donoUserId);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // 5. Monta os itens pra preferência do Mercado Pago, ignorando qualquer
    // item com preço inválido/zero (o Mercado Pago rejeita unit_price <= 0)
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
        '⚠️ Não consegui gerar o pagamento porque nenhum item do pedido tem preço válido cadastrado. Peça pra empresa conferir o preço dos produtos na Vitrine.',
        donoUserId
      );
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

    // 4. Confere se a empresa tem a PRÓPRIA conta do Mercado Pago conectada
    // — se tiver, o dinheiro vai direto pra ela; senão, usa a conta padrão
    // do GuiaZap (comportamento de antes, pra quem ainda não conectou)
    let tokenParaUsar = MP_ACCESS_TOKEN;

    const conexaoResp = await fetch(`${SUPABASE_URL}/rest/v1/mp_conexoes?profissional_id=eq.${profissionalId}&select=mp_access_token,mp_refresh_token,mp_token_expira_em,conectado`, { headers });
    const conexaoData = await conexaoResp.json();
    const conexao = conexaoData[0];

    if (conexao && conexao.conectado && conexao.mp_access_token) {
      const expirado = conexao.mp_token_expira_em && new Date(conexao.mp_token_expira_em) < new Date();

      if (!expirado) {
        tokenParaUsar = conexao.mp_access_token;
      } else {
        // Token venceu — usa o refresh_token pra pegar um novo, sem precisar
        // que a empresa autorize tudo de novo
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
          console.error('erro ao renovar token da empresa, usando conta padrão', e);
        }
      }
    }

    // 5. Cria a preferência de pagamento no Mercado Pago
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
      console.error('erro ao criar preferência do Mercado Pago:', JSON.stringify(prefData));
      const detalheErro = prefData.message || prefData.error || JSON.stringify(prefData).slice(0, 300);
      await responderNoChat('⚠️ Erro de teste ao gerar o link (Mercado Pago): ' + detalheErro, donoUserId);
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
      `${itensSemPreco.length > 0 ? `⚠️ Atenção: ${itensSemPreco.join(', ')} ficou(aram) de fora do pagamento por não ter preço cadastrado.\n\n` : ''}💳 Prontinho! Clica no link abaixo pra pagar R$ ${totalFormatado} com segurança pelo Mercado Pago:\n\n${prefData.init_point}\n\n🔑 Seu código de confirmação: *${pedido.codigo_confirmacao}*\nAssim que o pagamento for confirmado, a empresa já recebe o aviso automaticamente.`,
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