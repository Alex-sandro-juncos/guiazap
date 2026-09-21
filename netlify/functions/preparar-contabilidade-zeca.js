// "Preparação de dados pra contabilidade" do módulo Empresa — pedido
// forte do Alex desde o início do módulo: "o contador deve só precisar
// assinar, recebendo os dados já prontos (categorizados, com comprovante,
// por período)". Isso NUNCA faz nenhum cálculo de imposto (ISS, Simples
// Nacional, etc — isso é trabalho do contador de verdade), só ORGANIZA o
// que já está cadastrado no caixa da empresa, com todo mundo somado por
// categoria e a lista de documentos/comprovantes guardados no período —
// tudo em JS puro, nunca pedindo pra uma IA somar nada.
//
// Devolve {texto, titulo} — quem chama (empresa.html) usa esse texto pra
// gerar o PDF através da function gerar-pdf-zeca.js já existente, igual
// a preparação de IR do Lar/Agro já faz.

function _fmtMoeda(v) {
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
}

function _somarPorCategoria(lista) {
  const porTipo = { receita: {}, despesa: {} };
  lista.forEach(l => {
    const tipo = l.tipo === 'receita' ? 'receita' : 'despesa';
    const cat = l.categoria || 'sem categoria';
    porTipo[tipo][cat] = (porTipo[tipo][cat] || 0) + Number(l.valor || 0);
  });
  return porTipo;
}

const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'precisa estar logado' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const token = authHeader.replace('Bearer ', '');
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();

    const body = JSON.parse(event.body || '{}');
    const { profissionalId } = body;
    if (!profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId é obrigatório' }) };
    }

    // Confere que a empresa é mesmo dessa pessoa antes de devolver
    // qualquer dado — mesma trava usada em toda function do módulo
    // Empresa.
    const empResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${usuario.id}&select=id,name`, { headers });
    const empData = empResp.ok ? await empResp.json() : [];
    if (!empData[0]) {
      return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
    }
    const empresa = empData[0];

    const anoAtual = new Date().getFullYear();
    let ano = parseInt(body.ano, 10);
    if (!ano || ano < 2000 || ano > anoAtual + 1) ano = anoAtual;
    let mes = parseInt(body.mes, 10);
    if (!mes || mes < 1 || mes > 12) mes = null; // sem mês = ano inteiro

    let inicio, fim, rotuloPeriodo;
    if (mes) {
      inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
      const ultimoDia = new Date(ano, mes, 0).getDate();
      fim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
      rotuloPeriodo = `${MESES_NOME[mes - 1]}/${ano}`;
    } else {
      inicio = `${ano}-01-01`;
      fim = `${ano}-12-31`;
      rotuloPeriodo = `ano ${ano}`;
    }

    const [caixaResp, docsResp, colabResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/empresa_caixa?profissional_id=eq.${profissionalId}&data=gte.${inicio}&data=lte.${fim}&select=tipo,categoria,valor,valor_imposto,eh_retirada_socio,status_pagamento,data_vencimento,descricao,data,documento_url&order=data.asc`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/empresa_documentos?profissional_id=eq.${profissionalId}&ano_referencia=eq.${ano}&select=nome,categoria`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/empresa_colaboradores?profissional_id=eq.${profissionalId}&ativo=eq.true&select=nome,cargo,setor,salario`, { headers })
    ]);
    const lancamentos = caixaResp.ok ? await caixaResp.json() : [];
    const documentos = docsResp.ok ? await docsResp.json() : [];
    const colaboradores = colabResp.ok ? await colabResp.json() : [];

    // Lançamento "pendente" (conta a receber/a pagar) ainda não
    // aconteceu de verdade — fica fora do resumo/totais principais,
    // só entra numa seção separada, pra não inflar receita/despesa com
    // algo que só está combinado.
    const lancamentosEfetivados = lancamentos.filter(l => l.status_pagamento !== 'pendente');
    const lancamentosPendentes = lancamentos.filter(l => l.status_pagamento === 'pendente');

    // Retirada de sócio (pró-labore/distribuição de lucro) fica FORA da
    // despesa operacional — contador precisa dela separada, tributação
    // é diferente de despesa normal do negócio.
    const lancamentosOperacionais = lancamentosEfetivados.filter(l => !l.eh_retirada_socio);
    const retiradasSocios = lancamentosEfetivados.filter(l => l.eh_retirada_socio);
    const totalRetiradas = retiradasSocios.reduce((s, l) => s + Number(l.valor || 0), 0);

    const porTipo = _somarPorCategoria(lancamentosOperacionais);
    const totalReceita = Object.values(porTipo.receita).reduce((s, v) => s + v, 0);
    const totalDespesa = Object.values(porTipo.despesa).reduce((s, v) => s + v, 0);
    const comComprovante = lancamentos.filter(l => l.documento_url).length;
    const semComprovante = lancamentos.length - comComprovante;
    // Soma só o que a pessoa digitou manualmente em cada lançamento
    // (campo opcional "imposto embutido") — nunca um cálculo de alíquota
    // feito pelo sistema, isso continua sendo trabalho do contador.
    const totalImpostoLancado = lancamentos.reduce((s, l) => s + Number(l.valor_imposto || 0), 0);

    let texto = `PREPARAÇÃO DE DADOS PRA CONTABILIDADE — ${empresa.name}\n`;
    texto += `Período: ${rotuloPeriodo}\n\n`;
    texto += 'ATENÇÃO: isso é uma ORGANIZAÇÃO dos lançamentos e documentos já cadastrados no GuiaZap — não é cálculo de imposto nem declaração pronta. Confira com o contador antes de usar.\n';

    texto += '\n=== RESUMO DO CAIXA (operacional — sem retirada de sócio) ===\n';
    texto += `Receitas: ${_fmtMoeda(totalReceita)}\n`;
    texto += `Despesas: ${_fmtMoeda(totalDespesa)}\n`;
    texto += `Saldo: ${_fmtMoeda(totalReceita - totalDespesa - totalRetiradas)}\n`;
    texto += `Lançamentos com comprovante anexado: ${comComprovante} · sem comprovante: ${semComprovante}\n`;
    if (totalImpostoLancado > 0) {
      texto += `Imposto embutido lançado manualmente (soma do que foi informado item a item, não é cálculo automático): ${_fmtMoeda(totalImpostoLancado)}\n`;
    }
    if (totalRetiradas > 0) {
      texto += `Retirada de sócio (pró-labore/distribuição de lucro) no período: ${_fmtMoeda(totalRetiradas)} — separada da despesa operacional acima\n`;
    }

    if (lancamentosPendentes.length) {
      const hojeStr = new Date().toISOString().slice(0, 10);
      const aReceber = lancamentosPendentes.filter(l => l.tipo === 'receita');
      const aPagar = lancamentosPendentes.filter(l => l.tipo === 'despesa');
      const totalAReceber = aReceber.reduce((s, l) => s + Number(l.valor || 0), 0);
      const totalAPagar = aPagar.reduce((s, l) => s + Number(l.valor || 0), 0);
      texto += '\n=== CONTAS A RECEBER / A PAGAR (ainda não aconteceram de verdade — fora dos totais acima) ===\n';
      texto += `A receber: ${_fmtMoeda(totalAReceber)} (${aReceber.length} lançamento(s))\n`;
      texto += `A pagar: ${_fmtMoeda(totalAPagar)} (${aPagar.length} lançamento(s))\n`;
      lancamentosPendentes.forEach(l => {
        const vencido = l.data_vencimento && l.data_vencimento < hojeStr;
        texto += `- ${l.tipo === 'receita' ? 'A RECEBER' : 'A PAGAR'} · ${_fmtMoeda(l.valor)} · ${l.categoria || 'sem categoria'} · ${l.descricao}${l.data_vencimento ? ` · vencimento: ${l.data_vencimento}` : ''}${vencido ? ' · ⚠️ VENCIDO' : ''}\n`;
      });
    }

    texto += '\n=== RECEITAS POR CATEGORIA ===\n';
    const catsReceita = Object.entries(porTipo.receita).sort((a, b) => b[1] - a[1]);
    texto += catsReceita.length
      ? catsReceita.map(([c, v]) => `- ${c}: ${_fmtMoeda(v)}`).join('\n') + '\n'
      : 'Nenhuma receita lançada nesse período.\n';

    texto += '\n=== DESPESAS POR CATEGORIA ===\n';
    const catsDespesa = Object.entries(porTipo.despesa).sort((a, b) => b[1] - a[1]);
    texto += catsDespesa.length
      ? catsDespesa.map(([c, v]) => `- ${c}: ${_fmtMoeda(v)}`).join('\n') + '\n'
      : 'Nenhuma despesa lançada nesse período.\n';

    // Cap na lista detalhada pra não estourar o limite de caracteres do
    // PDF (gerar-pdf-zeca.js corta em 8000) — os totais por categoria
    // acima já cobrem o período inteiro mesmo se a lista aqui for cortada.
    const LIMITE_LANCAMENTOS_DETALHE = 150;
    texto += '\n=== LANÇAMENTOS DO PERÍODO (detalhado) ===\n';
    if (lancamentos.length) {
      texto += lancamentos.slice(0, LIMITE_LANCAMENTOS_DETALHE).map(l => `${l.data} · ${l.tipo === 'receita' ? '+' : '-'}${_fmtMoeda(l.valor)} · ${l.categoria || 'sem categoria'} · ${l.descricao}${Number(l.valor_imposto || 0) > 0 ? ` · imposto: ${_fmtMoeda(l.valor_imposto)}` : ''}${l.eh_retirada_socio ? ' · RETIRADA DE SÓCIO' : ''}${l.status_pagamento === 'pendente' ? ' · PENDENTE (não efetivado)' : ''}${l.documento_url ? ' · 📎 com comprovante' : ''}`).join('\n') + '\n';
      if (lancamentos.length > LIMITE_LANCAMENTOS_DETALHE) {
        texto += `(+ ${lancamentos.length - LIMITE_LANCAMENTOS_DETALHE} lançamento(s) a mais nesse período — já contados nos totais por categoria acima, só não listados um a um aqui)\n`;
      }
    } else {
      texto += 'Nenhum lançamento nesse período.\n';
    }

    texto += '\n=== FOLHA DE PAGAMENTO ATUAL (colaboradores ativos) ===\n';
    if (colaboradores.length) {
      const folhaTotal = colaboradores.reduce((s, c) => s + Number(c.salario || 0), 0);
      texto += colaboradores.map(c => `- ${c.nome}${c.cargo ? ' (' + c.cargo + ')' : ''}${c.setor ? ' — setor ' + c.setor : ''}: ${c.salario ? _fmtMoeda(c.salario) : 'salário não informado'}`).join('\n') + '\n';
      texto += `Total da folha: ${_fmtMoeda(folhaTotal)}\n`;
    } else {
      texto += 'Nenhum colaborador ativo cadastrado.\n';
    }

    texto += `\n=== DOCUMENTOS/COMPROVANTES GUARDADOS EM ${ano} ===\n`;
    texto += documentos.length
      ? documentos.map(d => `- ${d.nome}${d.categoria ? ' (' + d.categoria + ')' : ''}`).join('\n') + '\n'
      : 'Nenhum documento avulso guardado com esse ano de referência.\n';

    texto += '\n\nLembrete: essa organização foi feita pelo Zeca a partir dos lançamentos e documentos cadastrados por vocês — revise antes de repassar pro contador.';

    return {
      statusCode: 200,
      body: JSON.stringify({
        texto,
        titulo: `Preparação contábil — ${empresa.name} — ${rotuloPeriodo}`
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro preparando os dados pra contabilidade' }) };
  }
};