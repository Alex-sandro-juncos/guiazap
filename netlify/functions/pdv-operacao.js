// Todas as operações do PDV (balcão/caixa) passam por aqui, autenticadas
// por um CÓDIGO DE ACESSO — nunca pelo login de verdade da empresa.
// Assim o operador de caixa nunca precisa (e nunca consegue) entrar no
// painel de Gerenciamento — ele só tem o código de UM caixa específico,
// que só abre essa tela aqui, já identificado como aquele caixa/terminal.
//
// Cada CAIXA/TERMINAL (empresa_caixas_pdv) tem código próprio — pensado
// pra empresa tipo supermercado com vários caixas físicos: dá pra saber
// depois qual caixa vendeu quanto, e fechar/conferir cada um separado
// (sem misturar tudo numa "venda da empresa" só). O código é gerado pelo
// DONO (autenticado de verdade) em empresa.html → Estoque → "Caixas/PDV".
//
// Cancelar/devolver venda e fechar caixa continuam exigindo a senha
// GERENCIAL por cima (verificada aqui dentro, mesma lógica de
// pdv-senha-gerencial.js) — o código de acesso abre o PDV pra vender, mas
// não autoriza sozinho desfazer uma venda ou fechar a conferência.

const crypto = require('crypto');
const { exigirPepper } = require('./pepper-seguranca-helper');

function hashCodigoAcesso(codigo, profissionalId, caixaPdvId){
  const pepper = exigirPepper();
  return crypto.createHash('sha256').update(pepper + ':pdvcodigo:' + codigo + ':' + profissionalId + ':' + caixaPdvId).digest('hex');
}
function hashSenhaGerencial(senha, profissionalId){
  const pepper = exigirPepper();
  return crypto.createHash('sha256').update(pepper + ':pdv:' + senha + ':' + profissionalId).digest('hex');
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
    // PDV é exclusivo do pacote Vendas.
    if (empresa.plano !== 'vendas') {
      return { statusCode: 403, body: JSON.stringify({ error: 'O PDV é exclusivo do pacote Vendas — peça pro dono da empresa fazer upgrade em pacotes.html.' }) };
    }

    // Acha QUAL caixa/terminal esse código pertence — testa o código
    // contra cada caixa ativo dessa empresa (normalmente são poucos).
    const caixasResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixas_pdv?profissional_id=eq.${profissionalId}&ativo=eq.true&select=id,nome,codigo_acesso_hash`, { headers });
    const caixasAtivos = caixasResp.ok ? await caixasResp.json() : [];
    const caixaAtual = caixasAtivos.find(c => c.codigo_acesso_hash && hashCodigoAcesso(codigoAcesso, profissionalId, c.id) === c.codigo_acesso_hash);

    if (!caixaAtual) {
      return { statusCode: 401, body: JSON.stringify({ error: caixasAtivos.length ? 'Código de acesso incorreto.' : 'Nenhum caixa configurado pra essa empresa ainda — peça pro dono criar um em Estoque > Caixas/PDV.' }) };
    }
    const caixaPdvId = caixaAtual.id;

    // ---------- BOOTSTRAP (empresa, caixa, filiais, clientes) ----------
    if (action === 'bootstrap') {
      const [filiaisResp, clientesResp] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/empresa_filiais?profissional_id=eq.${profissionalId}&ativo=eq.true&select=id,nome&order=created_at`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/empresa_clientes?profissional_id=eq.${profissionalId}&ativo=eq.true&select=id,nome&order=nome`, { headers })
      ]);
      const filiais = filiaisResp.ok ? await filiaisResp.json() : [];
      const clientes = clientesResp.ok ? await clientesResp.json() : [];
      return { statusCode: 200, body: JSON.stringify({ empresaNome: empresa.name, caixaPdvId, caixaNome: caixaAtual.nome, filiais, clientes }) };
    }

    // ---------- BUSCA DE PRODUTO ----------
    if (action === 'produtoPorCodigo') {
      const codigo = (body.codigo || '').replace(/[^a-zA-Z0-9-]/g, '');
      if (!codigo) return { statusCode: 400, body: JSON.stringify({ error: 'código inválido' }) };
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?profissional_id=eq.${profissionalId}&or=(codigo_barras.eq.${codigo},codigo_interno.eq.${codigo})&select=id,nome,preco,quantidade,unidade_medida,codigo_barras,codigo_interno,filial_id&limit=1`, { headers });
      const data = resp.ok ? await resp.json() : [];
      return { statusCode: 200, body: JSON.stringify({ produto: data[0] || null }) };
    }

    if (action === 'produtosPorNome') {
      const termo = (body.termo || '').trim();
      if (!termo) return { statusCode: 200, body: JSON.stringify({ produtos: [] }) };
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?profissional_id=eq.${profissionalId}&nome=ilike.*${encodeURIComponent(termo)}*&select=id,nome,preco,quantidade,unidade_medida,codigo_barras,codigo_interno,filial_id&limit=8`, { headers });
      const data = resp.ok ? await resp.json() : [];
      return { statusCode: 200, body: JSON.stringify({ produtos: data }) };
    }

    // ---------- VENDAS DE HOJE (só desse caixa/terminal) ----------
    if (action === 'vendasHoje') {
      const hoje = new Date().toISOString().slice(0, 10);
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?profissional_id=eq.${profissionalId}&caixa_pdv_id=eq.${caixaPdvId}&data=eq.${hoje}&select=id,valor_total,forma_pagamento,status,created_at,origem,nf_status,nf_erro,nf_url_danfe&order=created_at.desc&limit=50`, { headers });
      const data = resp.ok ? await resp.json() : [];
      return { statusCode: 200, body: JSON.stringify({ pedidos: data }) };
    }

    if (action === 'dadosParaImprimir') {
      // ⚠️ SEGURANÇA: sem o "profissional_id=eq." aqui, qualquer caixa de
      // QUALQUER empresa (basta ter um código de acesso válido pra alguma
      // empresa, nem precisa ser a mesma) conseguia imprimir o cupom de
      // uma venda de OUTRA empresa só sabendo/adivinhando o pedidoId —
      // vazando total, forma de pagamento e itens de outra empresa.
      const [pedidoResp, itensResp] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${body.pedidoId}&profissional_id=eq.${profissionalId}&select=valor_total,forma_pagamento,created_at`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/empresa_pedido_itens?pedido_id=eq.${body.pedidoId}&select=nome_item,quantidade,valor_unitario,valor_total`, { headers })
      ]);
      const pedidoData = pedidoResp.ok ? await pedidoResp.json() : [];
      const itens = itensResp.ok ? await itensResp.json() : [];
      if (!pedidoData[0]) return { statusCode: 404, body: JSON.stringify({ error: 'venda não encontrada' }) };
      return { statusCode: 200, body: JSON.stringify({ pedido: pedidoData[0], itens }) };
    }

    // ---------- FINALIZAR VENDA ----------
    if (action === 'finalizarVenda') {
      const itens = Array.isArray(body.itens) ? body.itens : [];
      if (!itens.length) return { statusCode: 400, body: JSON.stringify({ error: 'carrinho vazio' }) };
      const filialId = body.filialId || null;
      const clienteId = body.clienteId || null;
      const formaPagamento = body.formaPagamento || null;
      const parcelas = formaPagamento === 'cartao_credito_parcelado' ? (parseInt(body.parcelas, 10) || null) : null;
      const cpfCnpjCliente = (body.cpfCnpjCliente || '').replace(/\D/g, '') || null;
      const valorTotal = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.valorUnitario), 0);

      // Fiado/promissória ("na conta do cliente", "na notinha") não é
      // dinheiro na mão — vira uma conta a RECEBER, reaproveitando a
      // mesma estrutura de status_pagamento pendente que o resto do
      // caixa já usa. Sem cliente vinculado não dá pra cobrar depois.
      if (formaPagamento === 'fiado' && !clienteId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Fiado/promissória precisa de um cliente vinculado.' }) };
      }
      const statusPagamento = formaPagamento === 'fiado' ? 'pendente' : 'pago';

      const rotuloPagamento = {
        dinheiro: 'dinheiro', pix: 'Pix', cartao_debito: 'cartão débito',
        cartao_credito_avista: 'cartão crédito à vista', cartao_credito_parcelado: `cartão crédito ${parcelas || '?'}x`,
        fiado: 'fiado/promissória'
      }[formaPagamento] || formaPagamento || '';

      const pedidoResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ profissional_id: profissionalId, filial_id: filialId, caixa_pdv_id: caixaPdvId, cliente_id: clienteId, status: 'concluido', valor_total: valorTotal, forma_pagamento: formaPagamento, parcelas, cliente_cpf_cnpj: cpfCnpjCliente, origem: 'pdv' })
      });
      const pedidoData = pedidoResp.ok ? await pedidoResp.json() : null;
      if (!pedidoResp.ok || !pedidoData || !pedidoData[0]) {
        return { statusCode: 500, body: JSON.stringify({ error: 'erro ao salvar a venda' }) };
      }
      const pedidoId = pedidoData[0].id;

      await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedido_itens`, {
        method: 'POST', headers,
        body: JSON.stringify(itens.map(i => ({
          pedido_id: pedidoId, produto_id: i.produtoId || null, nome_item: i.nome,
          quantidade: i.quantidade, valor_unitario: i.valorUnitario, valor_total: i.quantidade * i.valorUnitario
        })))
      });

      await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixa`, {
        method: 'POST', headers,
        body: JSON.stringify({
          profissional_id: profissionalId, filial_id: filialId, caixa_pdv_id: caixaPdvId, tipo: 'receita', categoria: 'venda pdv',
          descricao: `Venda PDV (${caixaAtual.nome}, ${rotuloPagamento}) — ${itens.map(i => i.nome).join(', ')}`.slice(0, 200),
          valor: valorTotal, forma_pagamento: formaPagamento, parcelas, status_pagamento: statusPagamento, cliente_id: clienteId, pedido_id: pedidoId
        })
      });

      for (const item of itens) {
        if (!item.produtoId) continue;
        // ⚠️ SEGURANÇA: sempre filtra por "profissional_id=eq." também —
        // sem isso, um operador de PDV de uma empresa pequena conseguia
        // mandar o produtoId de OUTRA empresa (ex: um concorrente maior) e
        // essa function baixava o estoque de verdade da empresa errada,
        // registrando o movimento no nome dela. Se o produto não pertence
        // a essa empresa, a busca não acha nada e o item é ignorado (sem
        // mexer em estoque de ninguém).
        // eslint-disable-next-line no-await-in-loop
        const prodResp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${item.produtoId}&profissional_id=eq.${profissionalId}&select=quantidade`, { headers });
        // eslint-disable-next-line no-await-in-loop
        const prodData = prodResp.ok ? await prodResp.json() : [];
        if (!prodData[0]) continue;
        const novaQtd = Math.max(0, Number(prodData[0].quantidade || 0) - Number(item.quantidade));
        // eslint-disable-next-line no-await-in-loop
        await fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${item.produtoId}&profissional_id=eq.${profissionalId}`, { method: 'PATCH', headers, body: JSON.stringify({ quantidade: novaQtd }) });
        // eslint-disable-next-line no-await-in-loop
        await fetch(`${SUPABASE_URL}/rest/v1/empresa_estoque_movimentos`, {
          method: 'POST', headers,
          body: JSON.stringify({ produto_id: item.produtoId, filial_id: filialId, tipo: 'saida', quantidade: item.quantidade, motivo: `venda pdv (${caixaAtual.nome})`, pedido_id: pedidoId })
        });
      }

      // Dispara a emissão do cupom/nota fiscal — espera a resposta (uma
      // function serverless pode "morrer" antes de terminar uma chamada
      // disparada sem esperar), mas nunca deixa uma falha do provedor
      // derrubar a venda em si, que já está salva de qualquer jeito. Só
      // dispara mesmo se a empresa tiver ativado isso — a própria
      // function checa e sai de mansinho se não tiver.
      let notaFiscal = null;
      const baseUrlInterno = process.env.URL || process.env.DEPLOY_URL;
      if (baseUrlInterno) {
        try {
          const respNota = await fetch(`${baseUrlInterno}/.netlify/functions/emitir-nota-fiscal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_FUNCTIONS_SECRET || '' },
            body: JSON.stringify({ action: 'emitir', profissionalId, pedidoId })
          });
          notaFiscal = await respNota.json();
        } catch (erroNota) {
          notaFiscal = { ok: false, motivo: 'falha_ao_chamar' };
        }
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true, pedidoId, valorTotal, notaFiscal }) };
    }

    // ---------- REEMITIR NOTA (tentar de novo uma nota que deu erro, ou consultar uma que ficou "emitindo") ----------
    if (action === 'reemitirNota') {
      const { pedidoId } = body;
      if (!pedidoId) return { statusCode: 400, body: JSON.stringify({ error: 'pedidoId é obrigatório' }) };

      const pedidoResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}&profissional_id=eq.${profissionalId}&caixa_pdv_id=eq.${caixaPdvId}&select=id,nf_status`, { headers });
      const pedidoData = pedidoResp.ok ? await pedidoResp.json() : [];
      const pedido = pedidoData[0];
      if (!pedido) return { statusCode: 404, body: JSON.stringify({ error: 'venda não encontrada nesse caixa' }) };

      const baseUrlInterno = process.env.URL || process.env.DEPLOY_URL;
      if (!baseUrlInterno) return { statusCode: 500, body: JSON.stringify({ error: 'não deu pra falar com a emissão de nota agora' }) };

      // Se ainda está "emitindo" (processando assíncrono no provedor), só
      // consulta o status de novo. Se deu erro (ou nunca foi emitida),
      // tenta emitir de novo do zero.
      const acaoFocus = pedido.nf_status === 'emitindo' ? 'consultar' : 'emitir';
      let notaFiscal;
      try {
        const respNota = await fetch(`${baseUrlInterno}/.netlify/functions/emitir-nota-fiscal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_FUNCTIONS_SECRET || '' },
          body: JSON.stringify({ action: acaoFocus, profissionalId, pedidoId })
        });
        notaFiscal = await respNota.json();
      } catch (erroNota) {
        return { statusCode: 502, body: JSON.stringify({ error: 'não deu pra falar com o provedor de emissão' }) };
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true, notaFiscal }) };
    }

    // ---------- CANCELAR / DEVOLVER (exige senha gerencial) ----------
    if (action === 'cancelarVenda') {
      const { pedidoId, senha } = body;
      if (!pedidoId || !senha) return { statusCode: 400, body: JSON.stringify({ error: 'pedidoId e senha são obrigatórios' }) };

      const empSenhaResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=pdv_senha_gerencial_hash,pdv_senha_tentativas_erradas,pdv_senha_bloqueada_ate`, { headers });
      const empSenhaData = empSenhaResp.ok ? await empSenhaResp.json() : [];
      const empSenha = empSenhaData[0];
      if (!empSenha || !empSenha.pdv_senha_gerencial_hash) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Senha gerencial ainda não configurada — peça pro dono configurar em Estoque.' }) };
      }
      if (empSenha.pdv_senha_bloqueada_ate && new Date(empSenha.pdv_senha_bloqueada_ate) > new Date()) {
        const minutosRestantes = Math.ceil((new Date(empSenha.pdv_senha_bloqueada_ate) - new Date()) / 60000);
        return { statusCode: 429, body: JSON.stringify({ error: `Muitas tentativas erradas. Tenta de novo em ${minutosRestantes} minuto(s).` }) };
      }
      if (hashSenhaGerencial(senha, profissionalId) !== empSenha.pdv_senha_gerencial_hash) {
        const novasTentativas = (empSenha.pdv_senha_tentativas_erradas || 0) + 1;
        const bloquear = novasTentativas >= 5;
        await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ pdv_senha_tentativas_erradas: novasTentativas, pdv_senha_bloqueada_ate: bloquear ? new Date(Date.now() + 15 * 60000).toISOString() : null })
        });
        return { statusCode: 401, body: JSON.stringify({ error: bloquear ? 'Senha errada muitas vezes. Bloqueado por 15 minutos.' : 'Senha gerencial incorreta.' }) };
      }
      await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ pdv_senha_tentativas_erradas: 0, pdv_senha_bloqueada_ate: null })
      });

      // ⚠️ SEGURANÇA: sempre filtra também por "profissional_id=eq." — sem
      // isso, quem soubesse (ou adivinhasse) o pedidoId de uma venda de
      // OUTRA empresa conseguia cancelar/estornar essa venda usando só a
      // senha gerencial da PRÓPRIA empresa (a senha é validada acima, mas
      // contra o profissionalId de quem chamou — nunca contra o dono real
      // do pedido). Isso mexia em caixa e estoque de outra empresa.
      const pedidoResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}&profissional_id=eq.${profissionalId}&select=id,valor_total,cliente_id,filial_id,caixa_pdv_id`, { headers });
      const pedidoData = pedidoResp.ok ? await pedidoResp.json() : [];
      const pedido = pedidoData[0];
      if (!pedido) return { statusCode: 404, body: JSON.stringify({ error: 'venda não encontrada' }) };

      await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelado' }) });

      await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixa`, {
        method: 'POST', headers,
        body: JSON.stringify({
          profissional_id: profissionalId, filial_id: pedido.filial_id || null, caixa_pdv_id: pedido.caixa_pdv_id || null, tipo: 'despesa', categoria: 'cancelamento/devolução pdv',
          descricao: 'Estorno da venda PDV cancelada/devolvida', valor: pedido.valor_total, cliente_id: pedido.cliente_id, pedido_id: pedido.id
        })
      });

      const itensResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedido_itens?pedido_id=eq.${pedidoId}&select=produto_id,quantidade`, { headers });
      const itens = itensResp.ok ? await itensResp.json() : [];
      for (const item of itens) {
        if (!item.produto_id) continue;
        // Mesma trava de dono aplicada em finalizarVenda — o pedido já foi
        // confirmado acima como sendo dessa empresa, mas reforça aqui
        // também (defesa em profundidade, mesmo padrão do resto do PDV).
        // eslint-disable-next-line no-await-in-loop
        const prodResp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${item.produto_id}&profissional_id=eq.${profissionalId}&select=quantidade`, { headers });
        // eslint-disable-next-line no-await-in-loop
        const prodData = prodResp.ok ? await prodResp.json() : [];
        if (!prodData[0]) continue;
        const novaQtd = Number(prodData[0].quantidade || 0) + Number(item.quantidade);
        // eslint-disable-next-line no-await-in-loop
        await fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${item.produto_id}&profissional_id=eq.${profissionalId}`, { method: 'PATCH', headers, body: JSON.stringify({ quantidade: novaQtd }) });
        // eslint-disable-next-line no-await-in-loop
        await fetch(`${SUPABASE_URL}/rest/v1/empresa_estoque_movimentos`, {
          method: 'POST', headers,
          body: JSON.stringify({ produto_id: item.produto_id, filial_id: pedido.filial_id || null, tipo: 'entrada', quantidade: item.quantidade, motivo: 'cancelamento/devolução pdv', pedido_id: pedido.id })
        });
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // ---------- FECHAR CAIXA (conferência — furo/sobra, exige senha gerencial) ----------
    if (action === 'fecharCaixa') {
      const { senha, valorContado } = body;
      if (!senha || valorContado === undefined || valorContado === null) {
        return { statusCode: 400, body: JSON.stringify({ error: 'senha e valorContado são obrigatórios' }) };
      }

      const empSenhaResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=pdv_senha_gerencial_hash,pdv_senha_tentativas_erradas,pdv_senha_bloqueada_ate`, { headers });
      const empSenhaData = empSenhaResp.ok ? await empSenhaResp.json() : [];
      const empSenha = empSenhaData[0];
      if (!empSenha || !empSenha.pdv_senha_gerencial_hash) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Senha gerencial ainda não configurada — peça pro dono configurar em Estoque.' }) };
      }
      if (empSenha.pdv_senha_bloqueada_ate && new Date(empSenha.pdv_senha_bloqueada_ate) > new Date()) {
        const minutosRestantes = Math.ceil((new Date(empSenha.pdv_senha_bloqueada_ate) - new Date()) / 60000);
        return { statusCode: 429, body: JSON.stringify({ error: `Muitas tentativas erradas. Tenta de novo em ${minutosRestantes} minuto(s).` }) };
      }
      if (hashSenhaGerencial(senha, profissionalId) !== empSenha.pdv_senha_gerencial_hash) {
        const novasTentativas = (empSenha.pdv_senha_tentativas_erradas || 0) + 1;
        const bloquear = novasTentativas >= 5;
        await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ pdv_senha_tentativas_erradas: novasTentativas, pdv_senha_bloqueada_ate: bloquear ? new Date(Date.now() + 15 * 60000).toISOString() : null })
        });
        return { statusCode: 401, body: JSON.stringify({ error: bloquear ? 'Senha errada muitas vezes. Bloqueado por 15 minutos.' : 'Senha gerencial incorreta.' }) };
      }
      await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ pdv_senha_tentativas_erradas: 0, pdv_senha_bloqueada_ate: null })
      });

      // Período conferido: desde o último fechamento desse caixa (ou,
      // se nunca fechou, desde a primeira venda dele) até agora.
      const ultimoResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_fechamentos_caixa?caixa_pdv_id=eq.${caixaPdvId}&select=periodo_fim&order=periodo_fim.desc&limit=1`, { headers });
      const ultimoData = ultimoResp.ok ? await ultimoResp.json() : [];
      const inicio = ultimoData[0] ? ultimoData[0].periodo_fim : '1970-01-01T00:00:00Z';
      const fim = new Date().toISOString();

      // Esperado em dinheiro = soma das vendas em dinheiro desse caixa no
      // período, menos estornos em dinheiro (cancelamento/devolução).
      const vendasDinheiroResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixa?profissional_id=eq.${profissionalId}&caixa_pdv_id=eq.${caixaPdvId}&forma_pagamento=eq.dinheiro&created_at=gte.${inicio}&created_at=lte.${fim}&select=tipo,valor`, { headers });
      const vendasDinheiro = vendasDinheiroResp.ok ? await vendasDinheiroResp.json() : [];
      const valorEsperado = vendasDinheiro.reduce((s, l) => s + (l.tipo === 'receita' ? Number(l.valor) : -Number(l.valor)), 0);
      const diferenca = Number(valorContado) - valorEsperado;

      await fetch(`${SUPABASE_URL}/rest/v1/empresa_fechamentos_caixa`, {
        method: 'POST', headers,
        body: JSON.stringify({
          profissional_id: profissionalId, caixa_pdv_id: caixaPdvId,
          periodo_inicio: inicio, periodo_fim: fim,
          valor_esperado: valorEsperado, valor_contado: valorContado, diferenca
        })
      });

      return { statusCode: 200, body: JSON.stringify({ ok: true, valorEsperado, valorContado: Number(valorContado), diferenca }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action inválida' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar operação do PDV' }) };
  }
};