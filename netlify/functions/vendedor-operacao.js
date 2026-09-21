// Operações do vendedor externo (representante que visita cliente e tira
// pedido na rua) — autenticado por um CÓDIGO DE ACESSO próprio, igual ao
// PDV (pdv-operacao.js), nunca pelo login de verdade da empresa. Assim o
// vendedor nunca consegue entrar no Gerenciamento nem no caixa — só tira
// pedido.
//
// DIFERENÇA IMPORTANTE em relação ao PDV: o pedido tirado aqui NUNCA
// mexe em caixa nem em estoque na hora — fica com status "aberto"
// (rascunho/orçamento) até o DONO aprovar no painel (empresa.html →
// Pedidos). Um vendedor externo sozinho nunca consegue lançar receita de
// verdade nem baixar estoque.

const crypto = require('crypto');
const { exigirPepper } = require('./pepper-seguranca-helper');

function hashCodigoAcesso(codigo, profissionalId, vendedorId) {
  const pepper = exigirPepper();
  return crypto.createHash('sha256').update(pepper + ':vendedorcodigo:' + codigo + ':' + profissionalId + ':' + vendedorId).digest('hex');
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { action, profissionalId, codigoAcesso } = body;
    if (!action || !profissionalId || !codigoAcesso) {
      return { statusCode: 400, body: JSON.stringify({ error: 'action, profissionalId e codigoAcesso são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const empResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=id,name,plano&status_pagamento=eq.ativo`, { headers });
    const empData = empResp.ok ? await empResp.json() : [];
    const empresa = empData[0];
    if (!empresa) {
      return { statusCode: 403, body: JSON.stringify({ error: 'empresa não encontrada ou inativa' }) };
    }
    // Vendedor externo é parte do Gerenciamento de Empresa — exclusivo do
    // pacote Vendas, mesma trava do PDV.
    if (empresa.plano !== 'vendas') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Esse recurso é exclusivo do pacote Vendas — peça pro dono da empresa fazer upgrade em pacotes.html.' }) };
    }

    const vendedoresResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_vendedores_externos?profissional_id=eq.${profissionalId}&ativo=eq.true&select=id,nome,codigo_acesso_hash`, { headers });
    const vendedoresAtivos = vendedoresResp.ok ? await vendedoresResp.json() : [];
    const vendedorAtual = vendedoresAtivos.find(v => v.codigo_acesso_hash && hashCodigoAcesso(codigoAcesso, profissionalId, v.id) === v.codigo_acesso_hash);

    if (!vendedorAtual) {
      return { statusCode: 401, body: JSON.stringify({ error: vendedoresAtivos.length ? 'Código de acesso incorreto.' : 'Nenhum vendedor externo configurado pra essa empresa ainda — peça pro dono criar um em Equipe > Vendedores externos.' }) };
    }
    const vendedorId = vendedorAtual.id;

    // ---------- BOOTSTRAP (empresa, vendedor, clientes) ----------
    if (action === 'bootstrap') {
      const clientesResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_clientes?profissional_id=eq.${profissionalId}&ativo=eq.true&select=id,nome&order=nome`, { headers });
      const clientes = clientesResp.ok ? await clientesResp.json() : [];
      return { statusCode: 200, body: JSON.stringify({ empresaNome: empresa.name, vendedorId, vendedorNome: vendedorAtual.nome, clientes }) };
    }

    // ---------- BUSCA DE PRODUTO ----------
    if (action === 'produtoPorCodigo') {
      const codigo = (body.codigo || '').replace(/[^a-zA-Z0-9-]/g, '');
      if (!codigo) return { statusCode: 400, body: JSON.stringify({ error: 'código inválido' }) };
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?profissional_id=eq.${profissionalId}&or=(codigo_barras.eq.${codigo},codigo_interno.eq.${codigo})&select=id,nome,preco,quantidade,unidade_medida,codigo_barras,codigo_interno&limit=1`, { headers });
      const data = resp.ok ? await resp.json() : [];
      return { statusCode: 200, body: JSON.stringify({ produto: data[0] || null }) };
    }

    if (action === 'produtosPorNome') {
      const termo = (body.termo || '').trim();
      if (!termo) return { statusCode: 200, body: JSON.stringify({ produtos: [] }) };
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?profissional_id=eq.${profissionalId}&nome=ilike.*${encodeURIComponent(termo)}*&select=id,nome,preco,quantidade,unidade_medida,codigo_barras,codigo_interno&limit=8`, { headers });
      const data = resp.ok ? await resp.json() : [];
      return { statusCode: 200, body: JSON.stringify({ produtos: data }) };
    }

    // ---------- CRIAR PEDIDO (fica "aberto" — só o dono aprova) ----------
    if (action === 'criarPedido') {
      const itens = Array.isArray(body.itens) ? body.itens : [];
      if (!itens.length) return { statusCode: 400, body: JSON.stringify({ error: 'carrinho vazio' }) };
      const clienteId = body.clienteId || null;
      if (!clienteId) return { statusCode: 400, body: JSON.stringify({ error: 'Escolhe pra qual cliente é esse pedido.' }) };
      const observacao = (body.observacao || '').slice(0, 500) || null;
      const valorTotal = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.valorUnitario), 0);

      // ⚠️ SEGURANÇA: confere que o cliente é mesmo dessa empresa antes de
      // vincular o pedido a ele — sem isso, um vendedor externo com
      // código válido de UMA empresa conseguia vincular um pedido a um
      // cliente de OUTRA empresa só sabendo/adivinhando o id.
      const clienteResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_clientes?id=eq.${clienteId}&profissional_id=eq.${profissionalId}&select=id`, { headers });
      const clienteData = clienteResp.ok ? await clienteResp.json() : [];
      if (!clienteData[0]) return { statusCode: 400, body: JSON.stringify({ error: 'Cliente não encontrado pra essa empresa.' }) };

      const pedidoResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          profissional_id: profissionalId, cliente_id: clienteId, vendedor_externo_id: vendedorId,
          status: 'aberto', valor_total: valorTotal, observacoes: observacao, origem: 'vendedor_externo'
        })
      });
      const pedidoData = pedidoResp.ok ? await pedidoResp.json() : null;
      if (!pedidoResp.ok || !pedidoData || !pedidoData[0]) {
        return { statusCode: 500, body: JSON.stringify({ error: 'erro ao salvar o pedido' }) };
      }
      const pedidoId = pedidoData[0].id;

      // Mesma trava de posse do PDV: só vincula produto_id que é de
      // verdade dessa empresa — item sem produto correspondente ainda
      // assim entra no pedido pelo nome (ex: promoção combinada digitada
      // na mão), só não fica rastreado no relatório de mais vendidos.
      const itensParaSalvar = [];
      for (const item of itens) {
        let produtoIdValido = null;
        if (item.produtoId) {
          // eslint-disable-next-line no-await-in-loop
          const prodResp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${item.produtoId}&profissional_id=eq.${profissionalId}&select=id`, { headers });
          // eslint-disable-next-line no-await-in-loop
          const prodData = prodResp.ok ? await prodResp.json() : [];
          if (prodData[0]) produtoIdValido = item.produtoId;
        }
        itensParaSalvar.push({
          pedido_id: pedidoId, produto_id: produtoIdValido, nome_item: item.nome,
          quantidade: item.quantidade, valor_unitario: item.valorUnitario, valor_total: item.quantidade * item.valorUnitario
        });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedido_itens`, { method: 'POST', headers, body: JSON.stringify(itensParaSalvar) });

      return { statusCode: 200, body: JSON.stringify({ ok: true, pedidoId, valorTotal }) };
    }

    // ---------- MEUS PEDIDOS RECENTES (só desse vendedor) ----------
    if (action === 'meusPedidosRecentes') {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?profissional_id=eq.${profissionalId}&vendedor_externo_id=eq.${vendedorId}&select=id,cliente_id,valor_total,status,created_at&order=created_at.desc&limit=30`, { headers });
      const pedidos = resp.ok ? await resp.json() : [];

      // Busca o nome dos clientes numa segunda consulta (em vez de tentar
      // embutir a relação no fetch cru) — mesmo padrão do resto das
      // functions do PDV/Empresa, que sempre fazem o join na mão em JS.
      const idsClientes = [...new Set(pedidos.map(p => p.cliente_id).filter(Boolean))];
      let nomePorCliente = {};
      if (idsClientes.length) {
        const clientesResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_clientes?id=in.(${idsClientes.join(',')})&select=id,nome`, { headers });
        const clientesData = clientesResp.ok ? await clientesResp.json() : [];
        nomePorCliente = Object.fromEntries(clientesData.map(c => [c.id, c.nome]));
      }
      const pedidosComCliente = pedidos.map(p => ({ ...p, empresa_clientes: p.cliente_id ? { nome: nomePorCliente[p.cliente_id] || null } : null }));

      return { statusCode: 200, body: JSON.stringify({ pedidos: pedidosComCliente }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action inválida' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar operação do vendedor' }) };
  }
};