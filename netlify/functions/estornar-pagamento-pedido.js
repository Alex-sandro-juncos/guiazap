// Estorna automaticamente um pedido que já foi pago de verdade (via Mercado
// Pago) quando a empresa decide recusar. Sem isso, o dinheiro ficaria retido
// sem devolução — o que não é justo com o cliente.
//
// ⚠️ SEGURANÇA: essa função mexe com dinheiro de verdade — exige que quem
// está chamando esteja LOGADO e seja DONO da empresa daquele pedido. Nunca
// confia só no pedidoId que vem do navegador.

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
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Confere se quem está chamando está LOGADO de verdade — pega o
    // token do cabeçalho Authorization e valida direto com o Supabase
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

    // 2. Busca o pedido E confere se pertence a uma empresa DESSE usuário —
    // nunca confia que o pedidoId sozinho já garante permissão
    const pedidoResp = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}&select=*,profissionais(user_id)`, { headers: headersServico });
    const pedidoData = await pedidoResp.json();
    const pedido = pedidoData[0];

    if (!pedido) {
      return { statusCode: 404, body: JSON.stringify({ error: 'pedido não encontrado' }) };
    }

    if (!pedido.profissionais || pedido.profissionais.user_id !== usuario.id) {
      return { statusCode: 403, body: JSON.stringify({ error: 'esse pedido não pertence a uma empresa sua' }) };
    }

    // Já foi estornado antes? Não deixa estornar de novo
    if (pedido.status === 'recusado' || pedido.status === 'cancelado') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, estornado: false, motivo: 'pedido já estava recusado/cancelado' }) };
    }

    // Se não tem mp_payment_id, é porque esse pedido nunca foi pago de
    // verdade pelo Mercado Pago (ex: pedido antigo, ou nunca chegou a pagar)
    // — não tem o que estornar, só recusa normalmente.
    if (!pedido.mp_payment_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
        method: 'PATCH',
        headers: headersServico,
        body: JSON.stringify({ status: 'recusado' })
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, estornado: false, motivo: 'pedido nunca foi pago via Mercado Pago' }) };
    }

    // 3. Usa o token da EMPRESA se ela tiver conta própria conectada — o
    // estorno precisa ser feito com a MESMA conta que recebeu o pagamento,
    // senão o Mercado Pago rejeita a operação
    let tokenParaEstornar = MP_ACCESS_TOKEN;
    const conexaoResp = await fetch(`${SUPABASE_URL}/rest/v1/mp_conexoes?profissional_id=eq.${pedido.profissional_id}&select=mp_access_token,conectado`, { headers: headersServico });
    const conexaoData = await conexaoResp.json();
    if (conexaoData[0] && conexaoData[0].conectado && conexaoData[0].mp_access_token) {
      tokenParaEstornar = conexaoData[0].mp_access_token;
    }

    // Chama a API de estorno do Mercado Pago
    const estornoResp = await fetch(`https://api.mercadopago.com/v1/payments/${pedido.mp_payment_id}/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenParaEstornar}`,
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
      headers: headersServico,
      body: JSON.stringify({ status: 'recusado' })
    });

    if (pedido.conversa_id) {
      const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${pedido.profissional_id}&select=user_id`, { headers: headersServico });
      const donoData = await donoResp.json();
      const donoUserId = donoData[0] ? donoData[0].user_id : null;

      await fetch(`${SUPABASE_URL}/rest/v1/mensagens_chat`, {
        method: 'POST',
        headers: headersServico,
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
        headers: headersServico,
        body: JSON.stringify({ ultima_mensagem_em: new Date().toISOString() })
      });
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, estornado: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar estorno' }) };
  }
};