// Sugere UM produto complementar da mesma empresa, baseado no que já está
// no carrinho (ex: pediu hambúrguer, sugere batata frita ou refrigerante).
// Só sugere entre produtos que JÁ EXISTEM no cardápio dessa empresa — nunca
// inventa um produto novo.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { itensNoCarrinho, produtosDaEmpresa } = JSON.parse(event.body || '{}');
    if (!Array.isArray(itensNoCarrinho) || itensNoCarrinho.length === 0 || !Array.isArray(produtosDaEmpresa) || produtosDaEmpresa.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ sugestao: null }) };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }

    const idsNoCarrinho = new Set(itensNoCarrinho.map(i => i.produtoId));
    const opcoes = produtosDaEmpresa.filter(p => !idsNoCarrinho.has(p.id));
    if (opcoes.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }

    const listaCarrinho = itensNoCarrinho.map(i => i.nome).join(', ');
    const listaOpcoes = opcoes.map(p => `id:${p.id} | ${p.nome}${p.preco ? ' — R$' + p.preco : ''}`).join('\n');

    const promptSistema = `O cliente tem isso no carrinho de uma loja: ${listaCarrinho}. Escolha UM produto da lista abaixo (só um, o que combina melhor como sugestão de "comprou isso, talvez queira também") pra sugerir como complemento. Se nenhuma opção combinar bem (ex: carrinho já tem de tudo, ou as opções não têm nada a ver), retorne null.

Produtos disponíveis:
${listaOpcoes}

Responda APENAS com um JSON válido: { "produto_id": "id escolhido ou null", "frase": "frase curta e natural sugerindo, tipo 'Que tal um refrigerante geladinho pra acompanhar?' — null se produto_id for null" }`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 200,
        system: promptSistema,
        messages: [{ role: 'user', content: 'Sugira um complemento.' }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }

    const textoResposta = data.content && data.content[0] ? data.content[0].text : '';
    let resultado;
    try {
      let textoLimpo = textoResposta.replace(/```json|```/g, '').trim();
      const inicioJson = textoLimpo.indexOf('{');
      const fimJson = textoLimpo.lastIndexOf('}');
      if (inicioJson !== -1 && fimJson !== -1) textoLimpo = textoLimpo.slice(inicioJson, fimJson + 1);
      resultado = JSON.parse(textoLimpo);
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }

    if (!resultado.produto_id || resultado.produto_id === 'null') {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }

    const produtoEscolhido = opcoes.find(p => p.id === resultado.produto_id);
    if (!produtoEscolhido) {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }

    return { statusCode: 200, body: JSON.stringify({ sugestao: { id: produtoEscolhido.id, nome: produtoEscolhido.nome, frase: resultado.frase } }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
  }
};