// Gera o "pacote do contador" em Excel (.xlsx) com 3 abas — Vendas,
// Compras e Financeiro — a partir dos mesmos dados que
// preparar-contabilidade-zeca.js organiza em texto/PDF. Mesma regra:
// NUNCA calcula imposto nem monta declaração pronta, só ORGANIZA o que
// já está cadastrado no caixa da empresa. Devolve o arquivo já pronto em
// base64 (isBase64Encoded: true), pro navegador baixar direto.

const ExcelJS = require('exceljs');

const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function _estilarCabecalho(linha) {
  linha.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  linha.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6B3B' } };
    cell.alignment = { vertical: 'middle' };
  });
}

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
    if (!mes || mes < 1 || mes > 12) mes = null;

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

    const caixaResp = await fetch(`${SUPABASE_URL}/rest/v1/empresa_caixa?profissional_id=eq.${profissionalId}&data=gte.${inicio}&data=lte.${fim}&select=tipo,categoria,valor,valor_imposto,eh_retirada_socio,status_pagamento,data_vencimento,descricao,data,forma_pagamento,documento_url&order=data.asc`, { headers });
    const lancamentos = caixaResp.ok ? await caixaResp.json() : [];

    // Lançamento "pendente" (conta a receber/a pagar) ainda não
    // aconteceu de verdade — fica fora das abas de vendas/compras e do
    // resumo financeiro, com uma aba própria mais abaixo.
    const efetivados = lancamentos.filter(l => l.status_pagamento !== 'pendente');
    const pendentes = lancamentos.filter(l => l.status_pagamento === 'pendente');

    const vendas = efetivados.filter(l => l.tipo === 'receita');
    const comprasEDespesas = efetivados.filter(l => l.tipo === 'despesa' && !l.eh_retirada_socio);
    const retiradas = efetivados.filter(l => l.tipo === 'despesa' && l.eh_retirada_socio);

    const totalVendas = vendas.reduce((s, l) => s + Number(l.valor || 0), 0);
    const totalCompras = comprasEDespesas.reduce((s, l) => s + Number(l.valor || 0), 0);
    const totalRetiradas = retiradas.reduce((s, l) => s + Number(l.valor || 0), 0);
    const totalImposto = efetivados.reduce((s, l) => s + Number(l.valor_imposto || 0), 0);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'GuiaZap / Zeca';
    wb.created = new Date();

    // ---------- ABA VENDAS ----------
    const abaVendas = wb.addWorksheet('Vendas');
    abaVendas.columns = [
      { header: 'Data', key: 'data', width: 12 },
      { header: 'Categoria', key: 'categoria', width: 20 },
      { header: 'Descrição', key: 'descricao', width: 36 },
      { header: 'Valor', key: 'valor', width: 14, style: { numFmt: 'R$ #,##0.00' } },
      { header: 'Imposto embutido', key: 'imposto', width: 16, style: { numFmt: 'R$ #,##0.00' } },
      { header: 'Forma pagamento', key: 'forma', width: 16 },
      { header: 'Com comprovante', key: 'comprovante', width: 14 }
    ];
    _estilarCabecalho(abaVendas.getRow(1));
    vendas.forEach(l => abaVendas.addRow({
      data: l.data, categoria: l.categoria || '', descricao: l.descricao || '',
      valor: Number(l.valor || 0), imposto: l.valor_imposto ? Number(l.valor_imposto) : null,
      forma: l.forma_pagamento || '', comprovante: l.documento_url ? 'Sim' : 'Não'
    }));
    abaVendas.addRow({});
    const linhaTotalVendas = abaVendas.addRow({ descricao: 'TOTAL', valor: totalVendas });
    linhaTotalVendas.font = { bold: true };

    // ---------- ABA COMPRAS (despesas operacionais, sem retirada de sócio) ----------
    const abaCompras = wb.addWorksheet('Compras');
    abaCompras.columns = [
      { header: 'Data', key: 'data', width: 12 },
      { header: 'Categoria', key: 'categoria', width: 20 },
      { header: 'Descrição', key: 'descricao', width: 36 },
      { header: 'Valor', key: 'valor', width: 14, style: { numFmt: 'R$ #,##0.00' } },
      { header: 'Imposto embutido', key: 'imposto', width: 16, style: { numFmt: 'R$ #,##0.00' } },
      { header: 'Forma pagamento', key: 'forma', width: 16 },
      { header: 'Com comprovante', key: 'comprovante', width: 14 }
    ];
    _estilarCabecalho(abaCompras.getRow(1));
    comprasEDespesas.forEach(l => abaCompras.addRow({
      data: l.data, categoria: l.categoria || '', descricao: l.descricao || '',
      valor: Number(l.valor || 0), imposto: l.valor_imposto ? Number(l.valor_imposto) : null,
      forma: l.forma_pagamento || '', comprovante: l.documento_url ? 'Sim' : 'Não'
    }));
    abaCompras.addRow({});
    const linhaTotalCompras = abaCompras.addRow({ descricao: 'TOTAL', valor: totalCompras });
    linhaTotalCompras.font = { bold: true };
    if (retiradas.length) {
      abaCompras.addRow({});
      const linhaRetiradasTitulo = abaCompras.addRow({ descricao: 'RETIRADA DE SÓCIO (pró-labore/distribuição — fora da despesa operacional acima)' });
      linhaRetiradasTitulo.font = { bold: true, italic: true };
      retiradas.forEach(l => abaCompras.addRow({
        data: l.data, categoria: l.categoria || '', descricao: l.descricao || '',
        valor: Number(l.valor || 0), forma: l.forma_pagamento || ''
      }));
      const linhaTotalRetiradas = abaCompras.addRow({ descricao: 'TOTAL RETIRADAS', valor: totalRetiradas });
      linhaTotalRetiradas.font = { bold: true };
    }

    // ---------- ABA CONTAS A RECEBER/PAGAR (pendentes, fora do resumo) ----------
    if (pendentes.length) {
      const hojeStr = new Date().toISOString().slice(0, 10);
      const abaPend = wb.addWorksheet('Contas a receber-pagar');
      abaPend.columns = [
        { header: 'Tipo', key: 'tipo', width: 14 },
        { header: 'Data lançamento', key: 'data', width: 14 },
        { header: 'Vencimento', key: 'vencimento', width: 14 },
        { header: 'Categoria', key: 'categoria', width: 20 },
        { header: 'Descrição', key: 'descricao', width: 36 },
        { header: 'Valor', key: 'valor', width: 14, style: { numFmt: 'R$ #,##0.00' } },
        { header: 'Situação', key: 'situacao', width: 14 }
      ];
      _estilarCabecalho(abaPend.getRow(1));
      pendentes.forEach(l => {
        const vencido = l.data_vencimento && l.data_vencimento < hojeStr;
        const linha = abaPend.addRow({
          tipo: l.tipo === 'receita' ? 'A receber' : 'A pagar',
          data: l.data, vencimento: l.data_vencimento || '',
          categoria: l.categoria || '', descricao: l.descricao || '',
          valor: Number(l.valor || 0), situacao: vencido ? 'VENCIDO' : 'Em dia'
        });
        if (vencido) linha.getCell('situacao').font = { bold: true, color: { argb: 'FFA4402F' } };
      });
      abaPend.addRow({});
      const totalAReceber = pendentes.filter(l => l.tipo === 'receita').reduce((s, l) => s + Number(l.valor || 0), 0);
      const totalAPagar = pendentes.filter(l => l.tipo === 'despesa').reduce((s, l) => s + Number(l.valor || 0), 0);
      abaPend.addRow({ descricao: 'TOTAL A RECEBER', valor: totalAReceber }).font = { bold: true };
      abaPend.addRow({ descricao: 'TOTAL A PAGAR', valor: totalAPagar }).font = { bold: true };
    }

    // ---------- ABA FINANCEIRO (resumo) ----------
    const abaFin = wb.addWorksheet('Financeiro');
    abaFin.columns = [{ key: 'label', width: 42 }, { key: 'valor', width: 20 }];
    abaFin.addRow(['PACOTE DO CONTADOR — ' + empresa.name]);
    abaFin.getRow(1).font = { bold: true, size: 14 };
    abaFin.addRow(['Período', rotuloPeriodo]);
    abaFin.addRow(['Gerado em', new Date().toLocaleDateString('pt-BR')]);
    abaFin.addRow([]);
    abaFin.addRow(['ATENÇÃO: organização dos lançamentos já cadastrados no GuiaZap — não é cálculo de imposto nem declaração pronta. Confira com o contador.']);
    abaFin.getRow(5).font = { italic: true, color: { argb: 'FF888888' } };
    abaFin.addRow([]);
    const linhaResumoCab = abaFin.addRow(['Resumo (operacional — sem retirada de sócio)', '']);
    linhaResumoCab.font = { bold: true };
    abaFin.addRow(['Receitas (Vendas)', totalVendas]).getCell(2).numFmt = 'R$ #,##0.00';
    abaFin.addRow(['Despesas (Compras)', totalCompras]).getCell(2).numFmt = 'R$ #,##0.00';
    const linhaLucro = abaFin.addRow(['Lucro (Receitas - Despesas)', totalVendas - totalCompras]);
    linhaLucro.getCell(2).numFmt = 'R$ #,##0.00';
    linhaLucro.font = { bold: true };
    if (totalRetiradas > 0) abaFin.addRow(['Retirada de sócio (pró-labore)', totalRetiradas]).getCell(2).numFmt = 'R$ #,##0.00';
    if (totalImposto > 0) abaFin.addRow(['Imposto embutido lançado manualmente', totalImposto]).getCell(2).numFmt = 'R$ #,##0.00';
    abaFin.addRow([]);
    const porCategoriaDespesa = {};
    comprasEDespesas.forEach(l => { const c = l.categoria || 'sem categoria'; porCategoriaDespesa[c] = (porCategoriaDespesa[c] || 0) + Number(l.valor || 0); });
    if (Object.keys(porCategoriaDespesa).length) {
      abaFin.addRow(['Despesas por categoria', '']).font = { bold: true };
      Object.entries(porCategoriaDespesa).sort((a, b) => b[1] - a[1]).forEach(([cat, v]) => {
        abaFin.addRow([cat, v]).getCell(2).numFmt = 'R$ #,##0.00';
      });
    }

    const buffer = await wb.xlsx.writeBuffer();
    const base64Xlsx = Buffer.from(buffer).toString('base64');
    const nomeArquivo = `pacote-contador-${ano}${mes ? '-' + String(mes).padStart(2, '0') : ''}.xlsx`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nomeArquivo}"`
      },
      body: base64Xlsx,
      isBase64Encoded: true
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar a planilha' }) };
  }
};