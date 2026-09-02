// Recebe uma lista de produtos vinda do sistema PRÓPRIO da empresa (PDV,
// ERP, etc) e sincroniza no GuiaZap. Produtos com "codigo_externo" que já
// existe são ATUALIZADOS; os que não existem ainda são CRIADOS. Autentica
// pela chave de integração única de cada empresa (não usa login/senha).

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { chave, produtos } = JSON.parse(event.body || '{}');
    if (!chave || !Array.isArray(produtos) || produtos.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: '"chave" e "produtos" (lista não vazia) são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Confere se a chave é válida e acha a empresa dona dela
    const integracaoResp = await fetch(`${SUPABASE_URL}/rest/v1/integracoes_produtos?chave=eq.${encodeURIComponent(chave)}&select=profissional_id`, { headers });
    const integracaoData = await integracaoResp.json();

    if (!integracaoData || integracaoData.length === 0) {
      return { statusCode: 401, body: JSON.stringify({ error: 'chave de integração inválida' }) };
    }

    const profissionalId = integracaoData[0].profissional_id;

    let criados = 0;
    let atualizados = 0;
    const erros = [];

    for (const produto of produtos) {
      if (!produto.nome) {
        erros.push({ produto, motivo: 'nome é obrigatório' });
        continue;
      }

      const payload = {
        profissional_id: profissionalId,
        nome: produto.nome,
        preco: produto.preco != null ? String(produto.preco) : null,
        categoria: produto.categoria || null,
        descricao: produto.descricao || null,
        codigo_externo: produto.codigo_externo || null,
        foto: produto.foto || null,
        disponivel_venda: produto.disponivel_venda !== false,
        no_cardapio_bot: produto.no_cardapio_bot !== false
      };

      if (produto.codigo_externo) {
        // Confere se já existe um produto com esse código externo pra essa empresa
        const existenteResp = await fetch(`${SUPABASE_URL}/rest/v1/produtos?profissional_id=eq.${profissionalId}&codigo_externo=eq.${encodeURIComponent(produto.codigo_externo)}&select=id`, { headers });
        const existenteData = await existenteResp.json();

        if (existenteData && existenteData.length > 0) {
          // Já existe — ATUALIZA
          await fetch(`${SUPABASE_URL}/rest/v1/produtos?id=eq.${existenteData[0].id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(payload)
          });
          atualizados++;
          continue;
        }
      }

      // Não existe ainda (ou não tem código externo) — CRIA
      const criarResp = await fetch(`${SUPABASE_URL}/rest/v1/produtos`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (criarResp.ok) {
        criados++;
      } else {
        erros.push({ produto: produto.nome, motivo: 'erro ao criar' });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, criados, atualizados, erros })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao sincronizar produtos' }) };
  }
};