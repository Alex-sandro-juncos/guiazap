// Estorna automaticamente um pedido que já foi pago de verdade (via Mercado
// Pago) quando a empresa decide recusar. Sem isso, o dinheiro ficaria retido
// sem devolução — o que não é justo com o cliente.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { pedidoId } = JSON.parse(event.body || '{}');
    if (!pedidoId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'pedidoId é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const pedidoResp = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}&select=*`, { headers });
    const pedidoData = await pedidoResp.json();
    const pedido = pedidoData[0];

    if (!pedido) {
      return { statusCode: 404, body: JSON.stringify({ error: 'pedido não encontrado' }) };
    }

    // Se não tem mp_payment_id, é porque esse pedido nunca foi pago de
    // verdade pelo Mercado Pago (ex: pedido antigo, ou nunca chegou a pagar)
    // — não tem o que estornar, só recusa normalmente.
    if (!pedido.mp_payment_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'recusado' })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, estornado: false, motivo: 'pedido nunca foi pago via Mercado Pago' }) };
    }

    // Chama a API de estorno do Mercado Pago
    const estornoResp = await fetch(`https://api.mercadopago.com/v1/payments/${pedido.mp_payment_id}/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const estornoData = await estornoResp.json();

    if (!estornoResp.ok) {
      console.error('erro ao estornar pagamento:', JSON.stringify(estornoData));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao estornar', detalhe: estornoData }) };
    }

    // Marca como recusado (e estornado) no banco
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'recusado' })
    });

    // Avisa o cliente no Papo que o pedido foi recusado e o dinheiro devolvido
    // (a mensagem aparece como vindo da própria empresa, igual as outras
    // mensagens automáticas do sistema)
    if (pedido.conversa_id) {
      const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${pedido.profissional_id}&select=user_id`, { headers });
      const donoData = await donoResp.json();
      const donoUserId = donoData[0] ? donoData[0].user_id : null;

      await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          conversa_id: pedido.conversa_id,
          remetente_user_id: donoUserId,
          tipo: 'texto',
          texto: `❌ Seu pedido foi recusado pela empresa. O valor de R$ ${Number(pedido.total).toFixed(2).replace('.', ',')} já foi estornado automaticamente e deve aparecer no seu Mercado Pago em alguns dias úteis.`,
          lida: false,
          enviado_por_bot: true
        })
      });
      await fetch(`${SUPABASE_URL}/rest/v1/conversas?id=eq.${pedido.conversa_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ ultima_mensagem_em: new Date().toISOString() })
      });
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, estornado: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar estorno' }) };
  }
};