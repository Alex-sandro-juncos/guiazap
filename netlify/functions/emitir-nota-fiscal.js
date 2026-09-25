// Emissão de cupom fiscal (NFC-e) ou nota fiscal (NF-e) de uma venda do
// PDV — só funciona se a empresa já tiver ATIVADO isso e colado o token
// da própria conta dela num provedor (por enquanto só Focus NFe é
// suportado). O GuiaZap NUNCA paga, revende ou intermedia essa cobrança
// — é a empresa que contrata e paga o provedor direto, e configura lá
// (site do provedor) o certificado digital, endereço fiscal e inscrição
// estadual. Aqui só chamamos a API deles em nome da empresa.
//
// ⚠️ IMPORTANTE: os campos de imposto (CFOP, CST/CSOSN) usam um padrão
// GENÉRICO quando o produto não tem um valor próprio cadastrado — isso
// pode estar ERRADO pro regime tributário ou produto específico da
// empresa. Por isso o campo nf_ambiente começa em "homologação" (nota de
// teste, sem validade fiscal) — só muda pra "produção" depois que o
// contador da empresa conferir que as notas de teste saíram certas.
//
// Chamado de dois jeitos:
// 1) Servidor-a-servidor, pelo pdv-operacao.js, logo depois de uma venda
//    (autoriza com o header x-internal-secret, que só outra function do
//    próprio GuiaZap conhece).
// 2) Pelo painel (empresa.html), quando o dono clica em "emitir"/"tentar
//    de novo" numa venda — autoriza com o login normal do dono.

const CSOSN_PADRAO_SIMPLES = '102'; // "tributada pelo Simples Nacional sem permissão de crédito" — padrão comum de varejo, mas o contador pode ajustar por produto
const CST_PADRAO_NORMAL = '00'; // "tributada integralmente" — idem, padrão genérico

// A Focus NFe devolve caminho_danfe/caminho_xml_nota_fiscal como caminho
// RELATIVO (ex: "/arquivos/.../nota.pdf"), não como link pronto pra abrir
// — precisa colar na frente o domínio de homologação/produção. Sem isso o
// botão "Ver DANFE" salva um link quebrado (era exatamente o que
// acontecia antes: guardava focusData.caminho_danfe puro).
function _montarUrlFocus(baseUrl, caminho) {
  if (!caminho) return null;
  if (/^https?:\/\//i.test(caminho)) return caminho; // já veio como URL completa (não é o padrão documentado, mas por segurança)
  return baseUrl + (caminho.startsWith('/') ? caminho : '/' + caminho);
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { action, profissionalId, pedidoId } = JSON.parse(event.body || '{}');
    if (!action || !profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'action e profissionalId são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Autoriza por segredo interno (chamada vinda do pdv-operacao.js) OU
    // por login normal do dono da empresa (chamada vinda do painel).
    const segredoInterno = event.headers['x-internal-secret'] || event.headers['X-Internal-Secret'];
    const ehChamadaInterna = segredoInterno && process.env.INTERNAL_FUNCTIONS_SECRET && segredoInterno === process.env.INTERNAL_FUNCTIONS_SECRET;

    if (!ehChamadaInterna) {
      const authHeader = event.headers.authorization || event.headers.Authorization;
      if (!authHeader) return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
      const token = authHeader.replace('Bearer ', '');
      const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
      if (!usuarioResp.ok) return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
      const usuario = await usuarioResp.json();
      const donoResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${usuario.id}&select=id`, { headers });
      const donoData = donoResp.ok ? await donoResp.json() : [];
      if (!donoData[0]) return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
    }

    // O token fica numa tabela separada (profissionais_fiscal_config), não
    // em "profissionais" — essa tabela tem leitura PÚBLICA (é o que
    // sustenta o diretório do GuiaZap), então uma credencial de API de
    // verdade nunca pode morar lá. Aqui usamos service_role, que ignora
    // RLS e enxerga as duas tabelas igual.
    const [empResp, tokenResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=id,name,documento,regime_tributario,nf_ativa,nf_modelo,nf_provedor,nf_ambiente`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/profissionais_fiscal_config?profissional_id=eq.${profissionalId}&select=nf_token`, { headers })
    ]);
    const empData = empResp.ok ? await empResp.json() : [];
    const empresa = empData[0];
    if (!empresa) return { statusCode: 404, body: JSON.stringify({ error: 'empresa não encontrada' }) };
    const tokenData = tokenResp.ok ? await tokenResp.json() : [];
    empresa.nf_token = tokenData[0] && tokenData[0].nf_token;

    if (!empresa.nf_ativa || !empresa.nf_token) {
      // Não é erro — só não tem emissão fiscal configurada. Quem chamou
      // (pdv-operacao.js) trata isso como "pula, sem problema".
      return { statusCode: 200, body: JSON.stringify({ ok: false, motivo: 'emissao_nao_ativada' }) };
    }
    if (!empresa.documento) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A empresa não tem CNPJ cadastrado (campo "documento" em profissionais) — obrigatório pra emitir.' }) };
    }
    if (empresa.nf_provedor !== 'focusnfe') {
      return { statusCode: 400, body: JSON.stringify({ error: `Provedor "${empresa.nf_provedor}" ainda não é suportado — só Focus NFe por enquanto.` }) };
    }

    const baseUrl = empresa.nf_ambiente === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
    const authFocus = 'Basic ' + Buffer.from(`${empresa.nf_token}:`).toString('base64');
    const caminho = empresa.nf_modelo === 'nfe' ? 'nfe' : 'nfce';

    if (action === 'emitir') {
      if (!pedidoId) return { statusCode: 400, body: JSON.stringify({ error: 'pedidoId é obrigatório' }) };

      const [pedidoResp, itensResp] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}&select=id,valor_total,forma_pagamento,parcelas,cliente_cpf_cnpj,created_at`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/empresa_pedido_itens?pedido_id=eq.${pedidoId}&select=nome_item,quantidade,valor_unitario,valor_total,produto_id`, { headers })
      ]);
      const pedidoData = pedidoResp.ok ? await pedidoResp.json() : [];
      const pedido = pedidoData[0];
      const itens = itensResp.ok ? await itensResp.json() : [];
      if (!pedido) return { statusCode: 404, body: JSON.stringify({ error: 'venda não encontrada' }) };
      if (!itens.length) return { statusCode: 400, body: JSON.stringify({ error: 'venda sem itens — não dá pra emitir' }) };

      // Busca o código fiscal (NCM/CFOP/CST-CSOSN) de cada produto que
      // tiver — item avulso (sem produto_id) usa só o padrão genérico.
      const idsProduto = itens.map(i => i.produto_id).filter(Boolean);
      let produtosFiscais = {};
      if (idsProduto.length) {
        const prodResp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?id=in.(${idsProduto.join(',')})&select=id,codigo_fiscal,cfop,csosn_cst`, { headers });
        const prodData = prodResp.ok ? await prodResp.json() : [];
        prodData.forEach(p => { produtosFiscais[p.id] = p; });
      }

      const ehSimples = empresa.regime_tributario === 'simples_nacional' || empresa.regime_tributario === 'simples_nacional_excesso' || empresa.regime_tributario === 'mei';

      const itensPayload = itens.map((item, i) => {
        const fiscal = produtosFiscais[item.produto_id] || {};
        return {
          numero_item: i + 1,
          codigo_produto: item.produto_id || `AVULSO-${i + 1}`,
          descricao: item.nome_item,
          codigo_ncm: fiscal.codigo_fiscal || '00000000',
          cfop: fiscal.cfop || '5102', // "venda de mercadoria adquirida/produzida" — padrão genérico de varejo
          unidade_comercial: 'UN',
          quantidade_comercial: item.quantidade,
          valor_unitario_comercial: item.valor_unitario,
          valor_bruto: item.valor_total,
          unidade_tributavel: 'UN',
          quantidade_tributavel: item.quantidade,
          valor_unitario_tributavel: item.valor_unitario,
          icms_origem: '0',
          icms_situacao_tributaria: fiscal.csosn_cst || (ehSimples ? CSOSN_PADRAO_SIMPLES : CST_PADRAO_NORMAL)
        };
      });

      const rotuloFormaFocus = {
        dinheiro: '01', cartao_debito: '04', cartao_credito_avista: '03', cartao_credito_parcelado: '03',
        pix: '17', fiado: '99'
      };

      const payload = {
        natureza_operacao: 'Venda',
        data_emissao: new Date(pedido.created_at).toISOString(),
        presenca_comprador: '1', // "operação presencial"
        cnpj_emitente: (empresa.documento || '').replace(/\D/g, ''),
        cpf_cnpj_destinatario: (pedido.cliente_cpf_cnpj || '').replace(/\D/g, '') || undefined,
        valor_total: pedido.valor_total,
        modalidade_frete: '9', // "sem frete"
        itens: itensPayload,
        formas_pagamento: [{
          forma_pagamento: rotuloFormaFocus[pedido.forma_pagamento] || '99',
          valor_pagamento: pedido.valor_total
        }]
      };

      await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}`, { method: 'PATCH', headers, body: JSON.stringify({ nf_status: 'emitindo', nf_erro: null }) });

      let focusResp, focusData;
      try {
        focusResp = await fetch(`${baseUrl}/v2/${caminho}?ref=${pedidoId}`, {
          method: 'POST',
          headers: { Authorization: authFocus, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        focusData = await focusResp.json();
      } catch (erroFocus) {
        await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}`, { method: 'PATCH', headers, body: JSON.stringify({ nf_status: 'erro', nf_erro: 'Não deu pra falar com o provedor de emissão.' }) });
        return { statusCode: 502, body: JSON.stringify({ error: 'erro ao contatar o provedor de emissão' }) };
      }

      if (focusData.status === 'autorizado') {
        const urlDanfeAbsoluta = _montarUrlFocus(baseUrl, focusData.caminho_danfe) || focusData.url || null;
        const urlXmlAbsoluta = _montarUrlFocus(baseUrl, focusData.caminho_xml_nota_fiscal);
        await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ nf_status: 'emitida', nf_numero: focusData.numero || null, nf_chave: focusData.chave_nfe || null, nf_url_danfe: urlDanfeAbsoluta, nf_caminho_xml: urlXmlAbsoluta, nf_erro: null })
        });
        return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'emitida', numero: focusData.numero, urlDanfe: urlDanfeAbsoluta }) };
      }

      if (focusData.status === 'processando_autorizacao') {
        // Focus NFe processa assíncrono — fica "emitindo" até alguém
        // (o botão "verificar status" no painel) consultar de novo.
        return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'emitindo' }) };
      }

      const mensagemErro = focusData.mensagem_sefaz || focusData.erros?.map(e => e.mensagem).join('; ') || focusData.mensagem || 'Erro desconhecido na emissão.';
      await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}`, { method: 'PATCH', headers, body: JSON.stringify({ nf_status: 'erro', nf_erro: String(mensagemErro).slice(0, 500) }) });
      return { statusCode: 200, body: JSON.stringify({ ok: false, status: 'erro', erro: mensagemErro }) };
    }

    if (action === 'consultar') {
      if (!pedidoId) return { statusCode: 400, body: JSON.stringify({ error: 'pedidoId é obrigatório' }) };

      let focusResp, focusData;
      try {
        focusResp = await fetch(`${baseUrl}/v2/${caminho}/${pedidoId}`, { headers: { Authorization: authFocus } });
        focusData = await focusResp.json();
      } catch (erroFocus) {
        return { statusCode: 502, body: JSON.stringify({ error: 'erro ao contatar o provedor de emissão' }) };
      }

      let urlDanfeAbsolutaConsulta = null;
      if (focusData.status === 'autorizado') {
        urlDanfeAbsolutaConsulta = _montarUrlFocus(baseUrl, focusData.caminho_danfe) || focusData.url || null;
        const urlXmlAbsolutaConsulta = _montarUrlFocus(baseUrl, focusData.caminho_xml_nota_fiscal);
        await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ nf_status: 'emitida', nf_numero: focusData.numero || null, nf_chave: focusData.chave_nfe || null, nf_url_danfe: urlDanfeAbsolutaConsulta, nf_caminho_xml: urlXmlAbsolutaConsulta, nf_erro: null })
        });
      } else if (focusData.status && focusData.status !== 'processando_autorizacao') {
        const mensagemErro = focusData.mensagem_sefaz || focusData.mensagem || 'Erro desconhecido na emissão.';
        await fetch(`${SUPABASE_URL}/rest/v1/empresa_pedidos?id=eq.${pedidoId}`, { method: 'PATCH', headers, body: JSON.stringify({ nf_status: 'erro', nf_erro: String(mensagemErro).slice(0, 500) }) });
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true, status: focusData.status, numero: focusData.numero, urlDanfe: urlDanfeAbsolutaConsulta }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'action inválida' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar emissão fiscal' }) };
  }
};