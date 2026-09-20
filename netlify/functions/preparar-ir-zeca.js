// "Preparação/organização de dados pro IR" — Meu Lar e Meu Agro.
//
// IMPORTANTE: isso NUNCA declara o Imposto de Renda sozinho, nem gera uma
// declaração pronta pra enviar. Só ORGANIZA o que a pessoa já cadastrou
// (lançamentos, bens com valor ano a ano, documentos guardados) num texto
// corrido, separado por categoria, pra facilitar a hora de preencher a
// declaração de verdade (sozinho ou com um contador). Toda a soma é feita
// aqui em JS puro (nunca pedindo pra uma IA somar nada).
//
// Devolve {texto, titulo} — quem chama (meular.html / meuagro.html) usa
// esse texto pra gerar o PDF através da function gerar-pdf-zeca.js já
// existente, exatamente como o botão "baixar em PDF" do Zeca já faz.

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

function _blocoLancamentos(porTipo) {
  let texto = '';
  ['receita', 'despesa'].forEach(tipo => {
    const categorias = Object.keys(porTipo[tipo]);
    const total = categorias.reduce((s, c) => s + porTipo[tipo][c], 0);
    texto += `\n${tipo === 'receita' ? 'RECEITAS' : 'DESPESAS'} — total ${_fmtMoeda(total)}\n`;
    if (!categorias.length) {
      texto += '(nenhum lançamento nessa categoria no ano)\n';
      return;
    }
    categorias
      .sort((a, b) => porTipo[tipo][b] - porTipo[tipo][a])
      .forEach(c => { texto += `- ${c}: ${_fmtMoeda(porTipo[tipo][c])}\n`; });
  });
  return texto;
}

const LAR_TIPO_LABEL = { imovel: 'Imóvel', veiculo: 'Veículo', investimento: 'Investimento', outro: 'Outro' };
const AGRO_TIPO_LABEL = { maquina: 'Máquina', animal: 'Animal', benfeitoria: 'Benfeitoria', outro: 'Outro' };

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
    const headersServico = {
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
    const modulo = body.modulo === 'agro' ? 'agro' : 'lar'; // um dos dois por vez
    const anoAtual = new Date().getFullYear();
    let ano = parseInt(body.ano, 10);
    if (!ano || ano < 2000 || ano > anoAtual + 1) ano = anoAtual;

    const inicio = `${ano}-01-01`;
    const fim = `${ano}-12-31`;

    let texto = `PREPARAÇÃO DE DADOS PRO IMPOSTO DE RENDA — ANO-BASE ${ano}\n`;
    texto += `Gerado a partir do que você cadastrou no ${modulo === 'agro' ? 'Meu Agro' : 'Meu Lar'} do GuiaZap.\n\n`;
    texto += 'ATENÇÃO: isso é só uma ORGANIZAÇÃO dos seus dados, não é uma declaração pronta nem substitui um contador. Confira tudo com calma antes de usar pra declarar de verdade.\n';

    if (modulo === 'lar') {
      const [lancResp, patResp, docResp] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/lar_lancamentos?user_id=eq.${usuario.id}&data=gte.${inicio}&data=lte.${fim}&select=tipo,categoria,valor`, { headers: headersServico }),
        fetch(`${SUPABASE_URL}/rest/v1/lar_patrimonio?user_id=eq.${usuario.id}&select=id,tipo,descricao,valor_aquisicao,data_aquisicao,ativo`, { headers: headersServico }),
        fetch(`${SUPABASE_URL}/rest/v1/lar_documentos?user_id=eq.${usuario.id}&ano_referencia=eq.${ano}&select=nome,categoria`, { headers: headersServico })
      ]);
      const lancamentos = lancResp.ok ? await lancResp.json() : [];
      const bens = patResp.ok ? await patResp.json() : [];
      const documentos = docResp.ok ? await docResp.json() : [];

      texto += '\n=== LANÇAMENTOS (FICHA DE RENDIMENTOS/PAGAMENTOS) ===\n';
      texto += _blocoLancamentos(_somarPorCategoria(lancamentos));

      texto += '\n=== BENS E DIREITOS ===\n';
      if (!bens.length) {
        texto += 'Nenhum bem cadastrado.\n';
      } else {
        const bensIds = bens.map(b => b.id);
        let valoresPorBem = {};
        if (bensIds.length) {
          const filtroIds = bensIds.map(id => `"${id}"`).join(',');
          const valResp = await fetch(`${SUPABASE_URL}/rest/v1/lar_patrimonio_valores_anuais?patrimonio_id=in.(${filtroIds})&ano=in.(${ano},${ano - 1})&select=patrimonio_id,ano,valor`, { headers: headersServico });
          const valores = valResp.ok ? await valResp.json() : [];
          valores.forEach(v => {
            if (!valoresPorBem[v.patrimonio_id]) valoresPorBem[v.patrimonio_id] = {};
            valoresPorBem[v.patrimonio_id][v.ano] = v.valor;
          });
        }
        bens.forEach(b => {
          const vAtual = valoresPorBem[b.id]?.[ano];
          const vAnterior = valoresPorBem[b.id]?.[ano - 1];
          const valorAquisicao = b.valor_aquisicao ? _fmtMoeda(b.valor_aquisicao) : 'não informado';
          texto += `- [${LAR_TIPO_LABEL[b.tipo] || b.tipo}] ${b.descricao}${b.ativo ? '' : ' (baixado/vendido)'}\n`;
          texto += `  Valor de aquisição: ${valorAquisicao}${b.data_aquisicao ? ' em ' + b.data_aquisicao : ''}\n`;
          texto += `  Valor em 31/12/${ano - 1}: ${vAnterior != null ? _fmtMoeda(vAnterior) : 'não informado'}\n`;
          texto += `  Valor em 31/12/${ano}: ${vAtual != null ? _fmtMoeda(vAtual) : 'não informado'}\n`;
        });
      }

      texto += '\n=== DOCUMENTOS GUARDADOS PRA ESSE ANO ===\n';
      texto += documentos.length
        ? documentos.map(d => `- ${d.nome}${d.categoria ? ' (' + d.categoria + ')' : ''}`).join('\n') + '\n'
        : 'Nenhum documento guardado com esse ano de referência.\n';
    } else {
      const propResp = await fetch(`${SUPABASE_URL}/rest/v1/agro_propriedades?user_id=eq.${usuario.id}&select=id,nome,area_hectares`, { headers: headersServico });
      const propriedades = propResp.ok ? await propResp.json() : [];

      if (!propriedades.length) {
        texto += '\nNenhuma propriedade cadastrada no Meu Agro ainda.\n';
      }

      for (const prop of propriedades) {
        texto += `\n\n########## PROPRIEDADE: ${prop.nome}${prop.area_hectares ? ' (' + prop.area_hectares + ' ha)' : ''} ##########\n`;

        const [lancResp, patResp, docResp] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/agro_lancamentos?propriedade_id=eq.${prop.id}&data=gte.${inicio}&data=lte.${fim}&select=tipo,categoria,valor`, { headers: headersServico }),
          fetch(`${SUPABASE_URL}/rest/v1/agro_patrimonio?propriedade_id=eq.${prop.id}&select=id,tipo,descricao,valor_aquisicao,data_aquisicao,ativo`, { headers: headersServico }),
          fetch(`${SUPABASE_URL}/rest/v1/agro_documentos?propriedade_id=eq.${prop.id}&ano_referencia=eq.${ano}&select=nome,categoria`, { headers: headersServico })
        ]);
        const lancamentos = lancResp.ok ? await lancResp.json() : [];
        const bens = patResp.ok ? await patResp.json() : [];
        const documentos = docResp.ok ? await docResp.json() : [];

        texto += '\n=== LANÇAMENTOS (ATIVIDADE RURAL) ===\n';
        texto += _blocoLancamentos(_somarPorCategoria(lancamentos));

        texto += '\n=== BENS DA PROPRIEDADE (MÁQUINAS, ANIMAIS, BENFEITORIAS) ===\n';
        texto += bens.length
          ? bens.map(b => `- [${AGRO_TIPO_LABEL[b.tipo] || b.tipo}] ${b.descricao}${b.ativo ? '' : ' (baixado/vendido)'} — aquisição: ${b.valor_aquisicao ? _fmtMoeda(b.valor_aquisicao) : 'não informado'}${b.data_aquisicao ? ' em ' + b.data_aquisicao : ''}`).join('\n') + '\n'
          : 'Nenhum bem cadastrado.\n';

        texto += '\n=== DOCUMENTOS GUARDADOS PRA ESSE ANO ===\n';
        texto += documentos.length
          ? documentos.map(d => `- ${d.nome}${d.categoria ? ' (' + d.categoria + ')' : ''}`).join('\n') + '\n'
          : 'Nenhum documento guardado com esse ano de referência.\n';
      }
    }

    texto += '\n\nLembrete: essa organização foi feita pelo Zeca a partir dos seus próprios lançamentos — revise os valores e, se tiver dúvida, consulte um contador antes de declarar.';

    return {
      statusCode: 200,
      body: JSON.stringify({
        texto,
        titulo: `Preparação IR ${ano} — ${modulo === 'agro' ? 'Meu Agro' : 'Meu Lar'}`
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro preparando os dados pro IR' }) };
  }
};