// Recebe o aviso do Mercado Pago quando um pagamento de PEDIDO (não
// assinatura) muda de status. Confirma de verdade consultando a API do MP
// (nunca confia só no que chega no aviso), e se estiver aprovado, marca o
// pedido como pago e avisa a empresa automaticamente no Papo.

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const paymentId = body.data && body.data.id;
    if (!paymentId) {
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Consulta o pagamento de verdade na API do Mercado Pago (nunca confia
    // cegamente no conteúdo do webhook — alguém poderia forjar essa chamada)
    const pagamentoResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const pagamento = await pagamentoResp.json();

    if (!pagamento || pagamento.status !== 'approved') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, motivo: 'pagamento não aprovado ainda' }) };
    }

    const pedidoId = pagamento.external_reference;
    if (!pedidoId) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, motivo: 'sem referência de pedido' }) };
    }

    // 2. Busca o pedido — se já estava pago, não faz nada de novo (evita
    // avisar duas vezes, caso o Mercado Pago mande o aviso repetido)
    const pedidoResp = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}&select=*`, { headers });
    const pedidoData = await pedidoResp.json();
    const pedido = pedidoData[0];
    if (!pedido || pedido.status === 'pago' || pedido.status === 'aguardando_confirmacao') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, motivo: 'pedido não encontrado ou já processado' }) };
    }

    // 3. Marca como pago
    await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'aguardando_confirmacao', pago_em: new Date().toISOString(), mp_payment_id: String(paymentId) })
    });

    // 4. Avisa a empresa automaticamente no Papo
    const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${pedido.profissional_id}&select=user_id`, { headers });
    const donoData = await donoResp.json();
    const donoUserId = donoData[0] ? donoData[0].user_id : null;

    if (pedido.conversa_id && donoUserId) {
      const itensTexto = (pedido.itens || []).map((i) => `• ${i.nome} — R$ ${i.preco}`).join('\n');
      await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          conversa_id: pedido.conversa_id,
          remetente_user_id: donoUserId,
          tipo: 'texto',
          texto: `🎉 Pagamento confirmado! Pedido pago via Mercado Pago:\n${itensTexto}\n\nTotal: R$ ${Number(pedido.total).toFixed(2).replace('.', ',')}\n🔑 Código de confirmação: ${pedido.codigo_confirmacao}`,
          lida: false,
          enviado_por_bot: true
        })
      });
      await fetch(`${SUPABASE_URL}/rest/v1/conversas?id=eq.${pedido.conversa_id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ ultima_mensagem_em: new Date().toISOString() })
      });

      // Também manda notificação push pro dono, caso ele não esteja no site
      const SITE_URL = process.env.URL || 'https://guiazap.shop';
      await fetch(`${SITE_URL}/.netlify/functions/enviar-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: '🎉 Pedido pago!',
          mensagem: `Novo pedido de R$ ${Number(pedido.total).toFixed(2).replace('.', ',')} já foi pago — pode preparar.`,
          url: '/pedidos.html',
          userIds: [donoUserId]
        })
      }).catch(() => {});
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar webhook de pedido' }) };
  }
};