// Recebe o aviso do Mercado Pago quando um pagamento de PEDIDO (não
// assinatura) muda de status. Confirma de verdade consultando a API do MP
// (nunca confia só no que chega no aviso), e se estiver aprovado, marca o
// pedido como pago e avisa a empresa automaticamente no Papo.

const crypto = require('crypto');

// Confirma que o aviso realmente veio do Mercado Pago (mesma validação já
// usada em mp-webhook.js — evita que alguém fique batendo nesse endereço à
// toa fingindo ser o Mercado Pago, mesmo que o pagamento em si já seja
// sempre reconferido direto na API deles antes de qualquer ação)
function assinaturaValida(headers, dataId){
  const secret = process.env.MP_WEBHOOK_SECRET;
  if(!secret){
    // Mesma correção feita em mp-webhook.js — sem a chave configurada, isso
    // deixava passar QUALQUER aviso como se fosse verdadeiro, permitindo
    // fingir que um pedido foi pago sem realmente pagar. Agora recusa por
    // segurança. Configure MP_WEBHOOK_SECRET no Netlify.
    console.error('MP_WEBHOOK_SECRET não configurado — recusando o webhook de pedido por segurança.');
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

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const hashCalculado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return hashCalculado === v1;
}

// Junta um pedido real do GuiaPapo (tabela "pedidos") com o módulo
// Empresa: cadastra/reaproveita o cliente, registra o pedido, lança a
// receita no caixa e baixa o estoque de cada produto vendido. Roda só
// se a empresa tiver as tabelas do módulo Empresa (sql-empresa-zeca.sql)
// — se não tiver, os inserts simplesmente falham/retornam vazio e a
// função sai quieta, sem quebrar nada do fluxo de pedido em si.
// "preco" nos itens do carrinho vem como TEXTO com vírgula decimal (ex:
// "23,00", igual é salvo em produtos.preco) — Number("23,00") vira NaN, tem
// que tratar a vírgula antes, mesmo parsing já usado em precoTextoParaNumeroV
// (js/vitrine.js), reaproveitado aqui porque esse arquivo roda no servidor.
function _precoTextoParaNumero(precoTexto) {
  if (!precoTexto) return 0;
  let limpo = String(precoTexto).replace(/[^0-9,.]/g, '');
  if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.');
  return parseFloat(limpo) || 0;
}

async function _sincronizarPedidoComEmpresa({ pedido, pedidoId, SUPABASE_URL, headers }) {
  // Idempotência: se o Mercado Pago reenviar o aviso, o índice único em
  // empresa_pedidos.pedido_guiapapo_id impede duplicar — mas confere
  // antes também, pra nem tentar de novo à toa.
  const jaSincResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?pedido_guiapapo_id=eq.${pedidoId}&select=id&limit=1`, { headers });
  const jaSinc = jaSincResp.ok ? await jaSincResp.json() : [];
  if (jaSinc.length) return;

  // 1. Acha ou cria o cliente no CRM da empresa, ligado à conta real de
  // quem comprou (cliente_user_id) — repete pedido, reaproveita o mesmo
  // cadastro em vez de duplicar.
  let clienteId = null;
  if (pedido.cliente_user_id) {
    const clienteExistenteResp = await fetch(
      `${SUPABASE_URL}/rest/v1/empresa_clientes?profissional_id=eq.${pedido.profissional_id}&cliente_user_id=eq.${pedido.cliente_user_id}&select=id&limit=1`,
      { headers }
    );
    const clienteExistente = clienteExistenteResp.ok ? await clienteExistenteResp.json() : [];
    if (clienteExistente[0]) {
      clienteId = clienteExistente[0].id;
    } else {
      const perfilResp = await fetch(`${SUPABASE_URL}/rest/v1/perfis_usuario?user_id=eq.${pedido.cliente_user_id}&select=nome_exibicao`, { headers });
      const perfilData = perfilResp.ok ? await perfilResp.json() : [];
      const nomeCliente = (perfilData[0] && perfilData[0].nome_exibicao) || 'Cliente do GuiaPapo';
      const criarClienteResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_clientes`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ profissional_id: pedido.profissional_id, cliente_user_id: pedido.cliente_user_id, nome: nomeCliente, endereco: pedido.endereco_entrega || null })
      });
      const clienteCriado = criarClienteResp.ok ? await criarClienteResp.json() : [];
      if (clienteCriado[0]) clienteId = clienteCriado[0].id;
    }
  }

  // 2. Registra o pedido no painel, já como "concluído" (o dinheiro já
  // caiu — o status de entrega em si continua controlado em pedidos.html,
  // esse aqui é só o espelho financeiro/histórico no módulo Empresa).
  const criarPedidoEmpResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      profissional_id: pedido.profissional_id,
      cliente_id: clienteId,
      status: 'concluido',
      valor_total: pedido.total,
      forma_pagamento: 'mercado_pago',
      origem: 'guiapapo',
      pedido_guiapapo_id: pedidoId
    })
  });
  const pedidoEmpCriado = criarPedidoEmpResp.ok ? await criarPedidoEmpResp.json() : [];
  const pedidoEmpId = pedidoEmpCriado[0] ? pedidoEmpCriado[0].id : null;

  // 3. Itens do pedido — agrupa por produto (o carrinho manda uma linha
  // por unidade, então junta pra virar "quantidade: 2" em vez de duas
  // linhas de quantidade 1) e cria os itens + baixa o estoque de quem
  // tem produto_id (item avulso sem produto cadastrado só não baixa).
  const itensPedido = pedido.itens || [];
  const itensAgrupados = {};
  itensPedido.forEach((item) => {
    const chave = item.id || item.nome;
    if (!itensAgrupados[chave]) itensAgrupados[chave] = { produtoId: item.id || null, nome: item.nome, preco: _precoTextoParaNumero(item.preco), quantidade: 0 };
    itensAgrupados[chave].quantidade += 1;
  });

  if (pedidoEmpId) {
    const itensParaInserir = Object.values(itensAgrupados).map((i) => ({
      pedido_id: pedidoEmpId,
      produto_id: i.produtoId,
      nome_item: i.nome,
      quantidade: i.quantidade,
      valor_unitario: i.preco,
      valor_total: i.preco * i.quantidade
    }));
    if (itensParaInserir.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedido_itens`, { method: 'POST', headers, body: JSON.stringify(itensParaInserir) });
    }
  }

  // 4. Baixa o estoque de cada produto vendido (só quem tem produto_id —
  // item avulso digitado na hora não tem estoque pra controlar).
  for (const item of Object.values(itensAgrupados)) {
    if (!item.produtoId) continue;
    const produtoResp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${item.produtoId}&select=quantidade`, { headers });
    const produtoData = produtoResp.ok ? await produtoResp.json() : [];
    if (!produtoData[0]) continue;
    const novaQtd = Math.max(0, Number(produtoData[0].quantidade || 0) - item.quantidade);
    await fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${item.produtoId}`, { method: 'PATCH', headers, body: JSON.stringify({ quantidade: novaQtd }) });
    await fetch(`${SUPABASE_URL}/rest/v1/empresa_estoque_movimentos`, {
      method: 'POST', headers,
      body: JSON.stringify({ produto_id: item.produtoId, tipo: 'saida', quantidade: item.quantidade, motivo: 'venda pelo GuiaPapo', pedido_id: pedidoEmpId })
    });
  }

  // 5. Lança a receita no caixa — número vem direto do pedido real
  // (nunca recalculado/estimado), é o mesmo total que o Mercado Pago
  // confirmou como pago.
  await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixa`, {
    method: 'POST', headers,
    body: JSON.stringify({
      profissional_id: pedido.profissional_id,
      tipo: 'receita',
      categoria: 'venda',
      descricao: `Pedido pelo GuiaPapo — ${Object.values(itensAgrupados).map((i) => i.nome).join(', ')}`.slice(0, 200),
      valor: pedido.total,
      forma_pagamento: 'pix/cartão (Mercado Pago)',
      cliente_id: clienteId,
      pedido_id: pedidoEmpId
    })
  });
}

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const paymentId = body.data && body.data.id;
    if (!paymentId) {
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (!assinaturaValida(event.headers || {}, paymentId)) {
      console.warn('assinatura inválida no webhook de pedido, ignorando');
      return { statusCode: 200, body: JSON.stringify({ ok: true, motivo: 'assinatura inválida' }) };
    }

    const { profissionalId } = event.queryStringParameters || {};
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Se a URL de notificação veio com o profissionalId (pedidos gerados
    // depois do Marketplace), confere se essa empresa tem conta própria
    // conectada — se tiver, precisa usar O TOKEN DELA pra conseguir ver
    // esse pagamento (ele pertence à conta dela, não à do GuiaZap)
    let tokenParaConsultar = MP_ACCESS_TOKEN;
    if (profissionalId) {
      const conexaoResp = await fetch(`${SUPABASE_URL}/rest/v1/mp_conexoes?profissional_id=eq.${profissionalId}&select=mp_access_token,conectado`, { headers });
      const conexaoData = await conexaoResp.json();
      if (conexaoData[0] && conexaoData[0].conectado && conexaoData[0].mp_access_token) {
        tokenParaConsultar = conexaoData[0].mp_access_token;
      }
    }

    // 1. Consulta o pagamento de verdade na API do Mercado Pago (nunca confia
    // cegamente no conteúdo do webhook — alguém poderia forjar essa chamada)
    const pagamentoResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${tokenParaConsultar}` }
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

    // 3b. Sincroniza com o Gerenciamento (módulo Empresa) — assim um
    // pedido de verdade, pago pelo GuiaPapo, já aparece sozinho no caixa,
    // no estoque e no cadastro de clientes do painel, sem a empresa ter
    // que lançar nada na mão. Nunca falha o webhook por causa disso (é
    // um "bônus" — o pedido em si já foi confirmado no passo 3 acima).
    try {
      await _sincronizarPedidoComEmpresa({ pedido, pedidoId, SUPABASE_URL, headers });
    } catch (erroSync) {
      console.error('erro ao sincronizar pedido com o módulo Empresa (não bloqueia o pedido):', erroSync);
    }

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
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_FUNCTIONS_SECRET || '' },
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