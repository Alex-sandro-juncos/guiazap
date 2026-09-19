// Sugere UM produto complementar da mesma empresa, baseado no que já está
// no carrinho (ex: pediu hambúrguer, sugere batata frita ou refrigerante).
// Só sugere entre produtos que JÁ EXISTEM no cardápio dessa empresa — nunca
// inventa um produto novo.
// A frase de sugestão sai na voz do Zeca (persona compartilhada em ia-barata-helper.js).
//
// ⚠️ SEGURANÇA: o cardápio é buscado AQUI, direto no banco, a partir do
// profissionalId — nunca confia numa lista de produtos que o navegador
// mandasse (isso permitiria forjar produto/preço falso pra IA "validar").
//
// ⚠️ Limite por IP com FAIL-CLOSED: se o Supabase não responder por
// qualquer motivo, a chamada é bloqueada (em vez de liberar), porque
// esse endpoint é público (sem login) e gera custo real de IA.

const { PERSONA_ZECA } = require('./ia-barata-helper');

const LIMITE_POR_HORA = 40;
const JANELA_MINUTOS = 60;

async function podeChamar(ip) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
  const chave = 'sugerir-complemento-ia:' + ip;

  // Qualquer coisa que dê errado aqui (rede, banco fora do ar) BLOQUEIA
  // a chamada — este endpoint não tem login, então "deixar passar" em
  // caso de erro vira uma porta pra gastar IA sem controle nenhum.
  const buscaResp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, { headers });
  if (!buscaResp.ok) throw new Error('não consegui checar o limite de uso');
  const registros = await buscaResp.json();
  const agora = new Date();

  if (registros[0]) {
    const minutosPassados = (agora - new Date(registros[0].janela_inicio)) / 60000;
    if (minutosPassados >= JANELA_MINUTOS) {
      await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
        method: 'PATCH', headers, body: JSON.stringify({ contagem: 1, janela_inicio: agora.toISOString() })
      });
      return true;
    }
    if (registros[0].contagem >= LIMITE_POR_HORA) return false;
    await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chave)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ contagem: registros[0].contagem + 1 })
    });
    return true;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico`, {
    method: 'POST', headers, body: JSON.stringify({ chave, contagem: 1, janela_inicio: agora.toISOString() })
  });
  return true;
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const ip = event.headers['x-nf-client-connection-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
    let liberado;
    try {
      liberado = await podeChamar(ip);
    } catch (eLimite) {
      console.error('checagem de limite falhou, bloqueando por segurança:', eLimite);
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }
    if (!liberado) {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }

    const { profissionalId, itensNoCarrinho } = JSON.parse(event.body || '{}');
    if (!profissionalId || !Array.isArray(itensNoCarrinho) || itensNoCarrinho.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ sugestao: null }) };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Cardápio de verdade, direto do banco — nunca do navegador
    const produtosResp = await fetch(
      `${SUPABASE_URL}/rest/v1/produtos?profissional_id=eq.${profissionalId}&select=id,nome,preco`,
      { headers: headersServico }
    );
    if (!produtosResp.ok) {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }
    const produtosDaEmpresa = await produtosResp.json();

    const idsNoCarrinho = new Set(itensNoCarrinho.map(i => i.produtoId));
    const opcoes = produtosDaEmpresa.filter(p => !idsNoCarrinho.has(p.id));
    if (opcoes.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ sugestao: null }) };
    }

    const listaCarrinho = itensNoCarrinho.map(i => i.nome).join(', ');
    const listaOpcoes = opcoes.map(p => `id:${p.id} | ${p.nome}${p.preco ? ' — R$' + p.preco : ''}`).join('\n');

    const promptSistema = PERSONA_ZECA + `O cliente tem isso no carrinho de uma loja: ${listaCarrinho}. Escolha UM produto da lista abaixo (só um, o que combina melhor como sugestão de "comprou isso, talvez queira também") pra sugerir como complemento. Se nenhuma opção combinar bem (ex: carrinho já tem de tudo, ou as opções não têm nada a ver), retorne null.

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

    // Confere de novo, contra a lista real — mesmo que a IA "invente" um
    // id fora da lista de opções, isso barra aqui
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