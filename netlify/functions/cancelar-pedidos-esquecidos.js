// Roda de hora em hora (agendada no netlify.toml). Cancela automaticamente
// pedidos que ficaram "aguardando_pagamento" por mais de 24h sem ninguém
// pagar — evita pedidos fantasmas acumulando pra sempre no painel da empresa.

exports.handler = async function () {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Busca os pedidos esquecidos
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/pedidos?status=eq.aguardando_pagamento&created_at=lt.${limite}&select=id,conversa_id,profissional_id`,
      { headers }
    );
    const pedidosEsquecidos = await resp.json();

    if (!pedidosEsquecidos || pedidosEsquecidos.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, cancelados: 0 }) };
    }

    let contador = 0;
    for (const pedido of pedidosEsquecidos) {
      // Marca como cancelado
      await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'cancelado' })
      });

      // Avisa o cliente no Papo, caso ele volte a olhar a conversa depois
      if (pedido.conversa_id) {
        const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${pedido.profissional_id}&select=user_id`, { headers });
        const donoData = await donoResp.json();
        const donoUserId = donoData[0] ? donoData[0].user_id : null;

        if (donoUserId) {
          await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              conversa_id: pedido.conversa_id,
              remetente_user_id: donoUserId,
              tipo: 'texto',
              texto: '⏰ Seu pedido foi cancelado automaticamente por falta de pagamento em 24h. Digite *menu* pra fazer um novo pedido, se quiser.',
              lida: false,
              enviado_por_bot: true
            })
          });
        }
      }

      contador++;
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, cancelados: contador }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao limpar pedidos esquecidos' }) };
  }
};