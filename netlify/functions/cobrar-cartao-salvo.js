// Cobra o CARTÃO SALVO do usuário (pra pedidos feitos pelo modo voz, sem
// precisar abrir a tela do Mercado Pago). Recebe o CVV falado (nunca guarda
// isso, só usa na hora pra gerar um token novo de cobrança) + os dados do
// pedido, cria o pedido no banco, e cobra de verdade.
//
// ⚠️ Por enquanto, cobranças por voz sempre passam pela conta do GuiaZap
// (não pela conta da empresa conectada via marketplace) — evita a
// complexidade de reusar cartão salvo entre contas diferentes do Mercado
// Pago. Pedidos feitos pela tela normal continuam indo direto pra empresa.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { cvv, profissionalId, itens, subtotal, taxaEntrega, enderecoEntrega, latitudeEntrega, longitudeEntrega } = JSON.parse(event.body || '{}');
    if (!cvv || !profissionalId || !itens || !Array.isArray(itens) || itens.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'dados incompletos' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

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

    // 1. Acha o cartão salvo dessa pessoa
    const cartaoResp = await fetch(`${SUPABASE_URL}/rest/v1/cartoes_salvos_usuario?user_id=eq.${usuario.id}&select=mp_customer_id,mp_card_id`, { headers });
    const cartaoData = await cartaoResp.json();
    const cartao = cartaoData[0];

    if (!cartao) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Nenhum cartão salvo — cadastre um cartão primeiro.', semCartao: true }) };
    }

    // 2. Gera um token novo de cobrança a partir do cartão salvo + CVV
    // falado (isso é exigido pelo Mercado Pago por segurança — evita que o
    // cartão salvo seja usado sem a pessoa confirmar que é ela mesma)
    const tokenResp = await fetch(`https://api.mercadopago.com/v1/card_tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: cartao.mp_card_id, security_code: cvv })
    });
    const tokenData = await tokenResp.json();

    if (!tokenResp.ok || !tokenData.id) {
      console.error('erro ao gerar token do cartão salvo:', JSON.stringify(tokenData));
      return { statusCode: 400, body: JSON.stringify({ error: 'CVV incorreto ou cartão recusado. Confere e tenta de novo.' }) };
    }

    // 3. Monta e cria o pedido (mesma estrutura usada no checkout normal)
    const total = (subtotal || 0) + (taxaEntrega || 0);
    const codigoConfirmacao = String(Math.floor(1000 + Math.random() * 9000));

    const conversaResp = await fetch(`${SUPABASE_URL}/rest/v1/conversas?profissional_id=eq.${profissionalId}&visitante_user_id=eq.${usuario.id}&select=id`, { headers });
    const conversaData = await conversaResp.json();
    let conversaId = conversaData[0] ? conversaData[0].id : null;

    if (!conversaId) {
      const novaConversaResp = await fetch(`${SUPABASE_URL}/rest/v1/conversas`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ profissional_id: profissionalId, visitante_user_id: usuario.id })
      });
      const novaConversaData = await novaConversaResp.json();
      conversaId = novaConversaData[0] ? novaConversaData[0].id : null;
    }

    const pedidoResp = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        conversa_id: conversaId,
        profissional_id: profissionalId,
        cliente_user_id: usuario.id,
        itens,
        subtotal,
        taxa_entrega: taxaEntrega || 0,
        total,
        status: 'aguardando_pagamento',
        codigo_confirmacao: codigoConfirmacao,
        endereco_entrega: enderecoEntrega || null,
        latitude_entrega: latitudeEntrega || null,
        longitude_entrega: longitudeEntrega || null
      })
    });
    const pedidoData = await pedidoResp.json();
    const pedido = pedidoData[0];

    if (!pedido) {
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao criar o pedido' }) };
    }

    // 4. Cobra de verdade, usando o token gerado
    const pagamentoResp = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction_amount: total,
        token: tokenData.id,
        installments: 1,
        payer: { email: usuario.email },
        external_reference: pedido.id,
        description: `Pedido GuiaZap #${pedido.id.slice(0, 8)}`
      })
    });
    const pagamentoData = await pagamentoResp.json();

    if (!pagamentoResp.ok || (pagamentoData.status !== 'approved' && pagamentoData.status !== 'in_process')) {
      console.error('pagamento recusado:', JSON.stringify(pagamentoData));
      await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'recusado' }) });
      return { statusCode: 400, body: JSON.stringify({ error: 'Pagamento recusado pelo cartão. Tenta outro cartão ou forma de pagamento.' }) };
    }

    // 5. Pagamento aprovado — confirma o pedido de verdade
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'aguardando_confirmacao', mp_payment_id: String(pagamentoData.id) })
    });

    await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversa_id: conversaId,
        remetente_user_id: usuario.id,
        tipo: 'texto',
        texto: `✅ Pedido pago por voz! Código de confirmação: ${codigoConfirmacao}`,
        lida: false
      })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, pedidoId: pedido.id, codigoConfirmacao }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar pagamento' }) };
  }
};