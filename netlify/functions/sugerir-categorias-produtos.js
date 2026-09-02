// Sugere uma categoria pra cada produto sem categoria, em LOTE numa única
// chamada (bem mais barato e rápido que gerar imagem) — útil pra catálogos
// grandes importados de planilha/sistema externo.
//
// ⚠️ SEGURANÇA: exige login, dono da empresa, e respeita limite diário de
// uso — evita que alguém automatize chamadas e gere custo alto na conta.

const { verificarAutenticacaoEUsoIA } = require('./ia-seguranca-helper');

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { produtos, profissionalId } = JSON.parse(event.body || '{}');
    if (!Array.isArray(produtos) || produtos.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'produtos (lista) é obrigatório' }) };
    }

    const seguranca = await verificarAutenticacaoEUsoIA(event, profissionalId, 'categorias', 20);
    if (!seguranca.ok) {
      return { statusCode: seguranca.statusCode, body: JSON.stringify({ error: seguranca.error }) };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada no Netlify' }) };
    }

    // Processa em lotes de 200 pra não estourar o limite de uma única
    // chamada, caso o catálogo seja gigante (ex: 10 mil produtos)
    const TAMANHO_LOTE = 200;
    const categoriasFinais = [];

    for (let inicio = 0; inicio < produtos.length; inicio += TAMANHO_LOTE) {
      const lote = produtos.slice(inicio, inicio + TAMANHO_LOTE);

      const listaProdutos = lote.map((p, i) => `${i + 1}. ${p.nome}${p.descricao ? ' — ' + p.descricao : ''}`).join('\n');

      const promptSistema = `Você recebe uma lista numerada de produtos e devolve uma categoria curta (1-3 palavras) pra cada um, na MESMA ordem, mesma quantidade. Responda APENAS com um JSON válido (sem texto antes ou depois, sem markdown), no formato: {"categorias": ["categoria do item 1", "categoria do item 2", ...]}. Use categorias parecidas quando os produtos forem do mesmo tipo (ex: "Bebidas", "Lanches", "Limpeza", "Higiene", "Eletrônicos" — mantenha consistência entre produtos parecidos da mesma lista).`;

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 4096,
          system: promptSistema,
          messages: [{ role: 'user', content: listaProdutos }]
        })
      });

      const data = await resp.json();
      if (!resp.ok) {
        console.error('erro da API da Anthropic:', JSON.stringify(data));
        // Se um lote falhar, preenche com null pra não travar os outros
        categoriasFinais.push(...lote.map(() => null));
        continue;
      }

      const textoResposta = data.content && data.content[0] ? data.content[0].text : '';
      try {
        let textoLimpo = textoResposta.replace(/```json|```/g, '').trim();
        const inicioJson = textoLimpo.indexOf('{');
        const fimJson = textoLimpo.lastIndexOf('}');
        if (inicioJson !== -1 && fimJson !== -1) textoLimpo = textoLimpo.slice(inicioJson, fimJson + 1);
        const resultado = JSON.parse(textoLimpo);
        categoriasFinais.push(...(resultado.categorias || lote.map(() => null)));
      } catch (e) {
        console.error('erro ao interpretar resposta:', textoResposta);
        categoriasFinais.push(...lote.map(() => null));
      }
    }

    return { statusCode: 200, body: JSON.stringify({ categorias: categoriasFinais }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao sugerir categorias' }) };
  }
};