// Roda sozinha uma vez por semana (configurado no netlify.toml) — o Zeca
// "se importando" de verdade fora do chat, não só quando alguém fala com
// ele. Duas checagens, cada uma bem simples e determinística (SEM
// nenhuma chamada de IA — não tem por que gastar/arriscar inventar nada
// pra decidir "faz tempo que não mexe nisso", é conta direta no banco):
//
// 1. Empresa que já usou o Financeiro alguma vez, mas não lançou nada
//    nos últimos 7 dias — lembrete pra manter em dia.
// 2. Pessoa com a memória do Zeca ativada que já teve conversa salva,
//    mas não fala com ele há 7+ dias — convite pra voltar.
// 3. Empresa (módulo Empresa) com produto em estoque baixo (quantidade
//    <= estoque_minimo, com estoque_minimo configurado) — alerta de
//    reposição.
// 4. Empresa com pedido de compra pro fornecedor parado há 5+ dias sem
//    ser marcado como recebido — lembrete pra cobrar o fornecedor.
// 5. Resumo semanal automático de quem usa o caixa completo da Empresa
//    (módulo empresa_caixa) — receita/despesa/saldo da semana e o item
//    mais vendido, só pra quem teve MOVIMENTO na semana (não manda pra
//    quem já usou uma vez e parou, isso já é o alerta 1). De propósito
//    SEM nenhuma chamada de IA — é só soma direta do banco, igual o
//    resto desse arquivo; o "conselho" com opinião da IA continua só
//    sob demanda, no chat (zeca-chat.js), pra não gerar custo de API
//    toda semana pra empresa nenhuma pedir.
// 6. Conta a receber/a pagar (empresa_caixa.status_pagamento = 'pendente')
//    já vencida (data_vencimento no passado) — lembrete pra cobrar o
//    cliente ou pagar o fornecedor antes que acumule. Roda toda semana
//    junto com o resto, não é um cron separado.
//
// Só manda push pra quem JÁ usou o recurso antes (nunca pra quem nunca
// usou) — isso é lembrete de continuidade, não propaganda/onboarding.
//
// Quem desligou os avisos proativos (zeca_preferencias_usuario.
// lembretes_ativados = false, opt-out ativável no app — ver
// "ativar_lembretes"/"desativar_lembretes" em zeca-memoria.js) nunca
// recebe nenhum dos 5 tipos acima — checado uma vez só no início e
// aplicado em todos os envios.

module.exports.handler = async function () {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const seteDiasAtrasData = seteDiasAtras.toISOString().slice(0, 10); // AAAA-MM-DD, pro filtro de "data" (date, não timestamp)
    const seteDiasAtrasISO = seteDiasAtras.toISOString();

    const resultado = { financeiro: 0, zeca: 0, estoqueBaixo: 0, compraParada: 0, resumoSemanal: 0, contaVencida: 0 };

    // Quem desligou os avisos proativos (lembretes_ativados = false) —
    // busca uma vez só aqui no início e usa pra filtrar TODOS os 5 envios
    // abaixo, nunca manda push pra quem pediu pra não receber.
    const optOutResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_preferencias_usuario?lembretes_ativados=eq.false&select=user_id`, { headers });
    const idsOptOut = new Set((optOutResp.ok ? await optOutResp.json() : []).map(p => p.user_id));
    const _semOptOut = userIds => userIds.filter(id => !idsOptOut.has(id));

    // ---------- 1. Financeiro parado ----------
    // Empresas ativas com pelo menos 1 lançamento (já usaram) — e, dessas,
    // quais tiveram algum lançamento nos últimos 7 dias (seguem em dia).
    const [empresasComLancResp, lancRecentesResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/financeiro_lancamentos?select=profissional_id`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/financeiro_lancamentos?data=gte.${seteDiasAtrasData}&select=profissional_id`, { headers })
    ]);
    const todosComLanc = empresasComLancResp.ok ? await empresasComLancResp.json() : [];
    const recentesComLanc = lancRecentesResp.ok ? await lancRecentesResp.json() : [];

    const idsJaUsaram = [...new Set(todosComLanc.map(l => l.profissional_id))];
    const idsEmDia = new Set(recentesComLanc.map(l => l.profissional_id));
    const idsParados = idsJaUsaram.filter(id => !idsEmDia.has(id));

    if (idsParados.length > 0) {
      const profResp = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?id=in.(${idsParados.join(',')})&status_pagamento=eq.ativo&select=user_id`,
        { headers }
      );
      const profs = profResp.ok ? await profResp.json() : [];
      const userIdsFinanceiro = _semOptOut([...new Set(profs.map(p => p.user_id).filter(Boolean))]);

      if (userIdsFinanceiro.length > 0) {
        await fetch(`${process.env.URL || 'https://guiazap.shop'}/.netlify/functions/enviar-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titulo: '📊 O Zeca lembrou do teu Financeiro',
            mensagem: 'Faz uns dias que não tem lançamento novo. Bora colocar em dia? É só falar com o Zeca.',
            url: '/zeca.html',
            userIds: userIdsFinanceiro,
            tipo: 'zeca_lembrete'
          })
        });
        resultado.financeiro = userIdsFinanceiro.length;
      }
    }

    // ---------- 2. Zeca sem conversa há um tempo ----------
    // Só quem tem a memória ativada (senão não dá pra saber quando foi a
    // última conversa) e já teve pelo menos uma conversa salva antes.
    const prefResp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_preferencias_usuario?memoria_ativada=eq.true&select=user_id`, { headers });
    const prefs = prefResp.ok ? await prefResp.json() : [];
    const userIdsComMemoria = prefs.map(p => p.user_id);

    let userIdsZecaSumido = [];
    if (userIdsComMemoria.length > 0) {
      const convResp = await fetch(
        `${SUPABASE_URL}/rest/v1/zeca_conversas?user_id=in.(${userIdsComMemoria.join(',')})&select=user_id,updated_at&order=updated_at.desc`,
        { headers }
      );
      const conversas = convResp.ok ? await convResp.json() : [];

      // Pega só a conversa MAIS RECENTE de cada pessoa (a lista já vem
      // ordenada por updated_at desc, então o primeiro que aparece pra
      // cada user_id é o mais recente).
      const ultimaPorUsuario = new Map();
      for (const c of conversas) {
        if (!ultimaPorUsuario.has(c.user_id)) ultimaPorUsuario.set(c.user_id, c.updated_at);
      }
      userIdsZecaSumido = _semOptOut([...ultimaPorUsuario.entries()]
        .filter(([, updatedAt]) => updatedAt < seteDiasAtrasISO)
        .map(([userId]) => userId));
    }

    if (userIdsZecaSumido.length > 0) {
      await fetch(`${process.env.URL || 'https://guiazap.shop'}/.netlify/functions/enviar-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: '👋 O Zeca sentiu sua falta',
          mensagem: 'Faz um tempinho que a gente não conversa. Se rolou alguma novidade, me conta!',
          url: '/zeca.html',
          userIds: userIdsZecaSumido,
          tipo: 'zeca_lembrete'
        })
      });
      resultado.zeca = userIdsZecaSumido.length;
    }

    // ---------- 3. Estoque baixo (módulo Empresa) ----------
    const produtosResp = await fetch(
      `${SUPABASE_URL}/rest/v1/produtos?estoque_minimo=gt.0&select=id,quantidade,estoque_minimo,profissional_id`,
      { headers }
    );
    const produtos = produtosResp.ok ? await produtosResp.json() : [];
    const idsEmpresaEstoqueBaixo = [...new Set(
      produtos.filter(p => Number(p.quantidade) <= Number(p.estoque_minimo)).map(p => p.profissional_id)
    )].filter(Boolean);

    if (idsEmpresaEstoqueBaixo.length > 0) {
      const profRespEstoque = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?id=in.(${idsEmpresaEstoqueBaixo.join(',')})&status_pagamento=eq.ativo&select=user_id`,
        { headers }
      );
      const profsEstoque = profRespEstoque.ok ? await profRespEstoque.json() : [];
      const userIdsEstoque = _semOptOut([...new Set(profsEstoque.map(p => p.user_id).filter(Boolean))]);

      if (userIdsEstoque.length > 0) {
        await fetch(`${process.env.URL || 'https://guiazap.shop'}/.netlify/functions/enviar-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titulo: '📦 Estoque baixo',
            mensagem: 'Tem produto batendo no mínimo do estoque. Dá uma olhada na aba Estoque da Empresa.',
            url: '/empresa.html',
            userIds: userIdsEstoque,
            tipo: 'zeca_lembrete'
          })
        });
        resultado.estoqueBaixo = userIdsEstoque.length;
      }
    }

    // ---------- 4. Compra pro fornecedor parada há 5+ dias ----------
    const cincoDiasAtrasData = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const comprasResp = await fetch(
      `${SUPABASE_URL}/rest/v1/empresa_compras?status=eq.pendente&data=lte.${cincoDiasAtrasData}&select=profissional_id`,
      { headers }
    );
    const comprasPendentes = comprasResp.ok ? await comprasResp.json() : [];
    const idsEmpresaCompraParada = [...new Set(comprasPendentes.map(c => c.profissional_id))].filter(Boolean);

    if (idsEmpresaCompraParada.length > 0) {
      const profRespCompra = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?id=in.(${idsEmpresaCompraParada.join(',')})&status_pagamento=eq.ativo&select=user_id`,
        { headers }
      );
      const profsCompra = profRespCompra.ok ? await profRespCompra.json() : [];
      const userIdsCompra = _semOptOut([...new Set(profsCompra.map(p => p.user_id).filter(Boolean))]);

      if (userIdsCompra.length > 0) {
        await fetch(`${process.env.URL || 'https://guiazap.shop'}/.netlify/functions/enviar-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titulo: '🛒 Pedido de compra parado',
            mensagem: 'Tem pedido pro fornecedor há mais de 5 dias sem ser marcado como recebido. Vale a pena cobrar.',
            url: '/empresa.html',
            userIds: userIdsCompra,
            tipo: 'zeca_lembrete'
          })
        });
        resultado.compraParada = userIdsCompra.length;
      }
    }

    // ---------- 5. Resumo semanal automático (caixa completo da Empresa) ----------
    const [caixaSemanaResp, itensSemanaResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empresa_caixa?data=gte.${seteDiasAtrasData}&select=profissional_id,tipo,valor`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/empresa_pedido_itens?select=nome_item,quantidade,empresa_pedidos!inner(profissional_id,data)&empresa_pedidos.data=gte.${seteDiasAtrasData}`, { headers })
    ]);
    const caixaSemana = caixaSemanaResp.ok ? await caixaSemanaResp.json() : [];
    const itensSemana = itensSemanaResp.ok ? await itensSemanaResp.json() : [];

    const porEmpresa = {}; // profissional_id -> { receita, despesa }
    caixaSemana.forEach(l => {
      if (!porEmpresa[l.profissional_id]) porEmpresa[l.profissional_id] = { receita: 0, despesa: 0 };
      porEmpresa[l.profissional_id][l.tipo === 'receita' ? 'receita' : 'despesa'] += Number(l.valor || 0);
    });

    const maisVendidoPorEmpresa = {}; // profissional_id -> { nome_item -> quantidade }
    itensSemana.forEach(i => {
      const profId = i.empresa_pedidos?.profissional_id;
      if (!profId) return;
      if (!maisVendidoPorEmpresa[profId]) maisVendidoPorEmpresa[profId] = {};
      maisVendidoPorEmpresa[profId][i.nome_item] = (maisVendidoPorEmpresa[profId][i.nome_item] || 0) + Number(i.quantidade || 0);
    });

    const idsComMovimento = Object.keys(porEmpresa);
    if (idsComMovimento.length > 0) {
      const profRespResumo = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?id=in.(${idsComMovimento.join(',')})&status_pagamento=eq.ativo&select=id,user_id`,
        { headers }
      );
      const profsResumo = profRespResumo.ok ? await profRespResumo.json() : [];
      const fmtResumo = v => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;

      let enviados = 0;
      for (const prof of profsResumo) {
        if (!prof.user_id || idsOptOut.has(prof.user_id)) continue;
        const dados = porEmpresa[prof.id];
        const saldo = dados.receita - dados.despesa;
        const ranking = Object.entries(maisVendidoPorEmpresa[prof.id] || {}).sort((a, b) => b[1] - a[1]);
        let mensagemResumo = `Receita ${fmtResumo(dados.receita)} · Despesa ${fmtResumo(dados.despesa)} · Saldo ${fmtResumo(saldo)}`;
        if (ranking.length) mensagemResumo += ` · Mais vendido: ${ranking[0][0]}`;

        // eslint-disable-next-line no-await-in-loop
        await fetch(`${process.env.URL || 'https://guiazap.shop'}/.netlify/functions/enviar-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titulo: '📈 Resumo da tua semana',
            mensagem: mensagemResumo,
            url: '/empresa.html',
            userIds: [prof.user_id],
            tipo: 'zeca_lembrete'
          })
        });
        enviados++;
      }
      resultado.resumoSemanal = enviados;
    }

    // ---------- 6. Conta a receber/a pagar vencida (módulo Empresa) ----------
    const hojeData = new Date().toISOString().slice(0, 10);
    const vencidasResp = await fetch(
      `${SUPABASE_URL}/rest/v1/empresa_caixa?status_pagamento=eq.pendente&data_vencimento=lt.${hojeData}&select=profissional_id,tipo`,
      { headers }
    );
    const vencidas = vencidasResp.ok ? await vencidasResp.json() : [];
    const porEmpresaVencida = {}; // profissional_id -> { aReceber, aPagar }
    vencidas.forEach(l => {
      if (!porEmpresaVencida[l.profissional_id]) porEmpresaVencida[l.profissional_id] = { aReceber: 0, aPagar: 0 };
      porEmpresaVencida[l.profissional_id][l.tipo === 'receita' ? 'aReceber' : 'aPagar']++;
    });
    const idsEmpresaVencida = Object.keys(porEmpresaVencida);

    if (idsEmpresaVencida.length > 0) {
      const profRespVencida = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?id=in.(${idsEmpresaVencida.join(',')})&status_pagamento=eq.ativo&select=id,user_id`,
        { headers }
      );
      const profsVencida = profRespVencida.ok ? await profRespVencida.json() : [];

      let enviadosVencida = 0;
      for (const prof of profsVencida) {
        if (!prof.user_id || idsOptOut.has(prof.user_id)) continue;
        const { aReceber, aPagar } = porEmpresaVencida[prof.id];
        const partes = [];
        if (aReceber > 0) partes.push(`${aReceber} a receber`);
        if (aPagar > 0) partes.push(`${aPagar} a pagar`);
        if (!partes.length) continue;

        // eslint-disable-next-line no-await-in-loop
        await fetch(`${process.env.URL || 'https://guiazap.shop'}/.netlify/functions/enviar-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titulo: '⚠️ Conta vencida no caixa',
            mensagem: `Tem ${partes.join(' e ')} vencida(s) no caixa da empresa. Dá uma olhada e marca como pago o que já resolveu.`,
            url: '/empresa.html',
            userIds: [prof.user_id],
            tipo: 'zeca_lembrete'
          })
        });
        enviadosVencida++;
      }
      resultado.contaVencida = enviadosVencida;
    }

    // ---------- 7. Produto perecível perto de vencer (módulo Empresa) ----------
    const emTresDias = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const vencendoResp = await fetch(
      `${SUPABASE_URL}/rest/v1/produtos?data_validade=not.is.null&data_validade=lte.${emTresDias}&select=profissional_id,nome,data_validade`,
      { headers }
    );
    const vencendo = vencendoResp.ok ? await vencendoResp.json() : [];
    const porEmpresaVencendo = {}; // profissional_id -> [nome, ...]
    vencendo.forEach(p => {
      if (!porEmpresaVencendo[p.profissional_id]) porEmpresaVencendo[p.profissional_id] = [];
      porEmpresaVencendo[p.profissional_id].push(p.nome);
    });
    const idsEmpresaVencendo = Object.keys(porEmpresaVencendo);

    resultado.produtoVencendo = 0;
    if (idsEmpresaVencendo.length > 0) {
      const profRespVencendo = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?id=in.(${idsEmpresaVencendo.join(',')})&status_pagamento=eq.ativo&select=id,user_id`,
        { headers }
      );
      const profsVencendo = profRespVencendo.ok ? await profRespVencendo.json() : [];

      let enviadosVencendo = 0;
      for (const prof of profsVencendo) {
        if (!prof.user_id || idsOptOut.has(prof.user_id)) continue;
        const nomes = porEmpresaVencendo[prof.id];
        const listaTexto = nomes.slice(0, 3).join(', ') + (nomes.length > 3 ? ` e mais ${nomes.length - 3}` : '');

        // eslint-disable-next-line no-await-in-loop
        await fetch(`${process.env.URL || 'https://guiazap.shop'}/.netlify/functions/enviar-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titulo: '⏰ Produto perto de vencer',
            mensagem: `${listaTexto} — vencendo em até 3 dias. Dá uma olhada no Estoque antes de virar perda.`,
            url: '/empresa.html',
            userIds: [prof.user_id],
            tipo: 'zeca_lembrete'
          })
        });
        enviadosVencendo++;
      }
      resultado.produtoVencendo = enviadosVencendo;
    }

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};