// Recebe um comando em texto (que pode ter vindo de voz-pra-texto no
// navegador) junto com o cardápio atual da empresa, e usa o Claude pra
// interpretar o que a pessoa quer fazer: adicionar, editar ou remover
// produtos. A IA NUNCA aplica nada direto — só propõe, e o dono confirma.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { comando, produtosAtuais } = JSON.parse(event.body || '{}');
    if (!comando) {
      return { statusCode: 400, body: JSON.stringify({ error: 'comando é obrigatório' }) };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada no Netlify' }) };
    }

    const listaProdutos = (produtosAtuais || [])
      .map(p => `- id: ${p.id} | nome: ${p.nome} | preço: ${p.preco || 'sem preço'} | categoria: ${p.categoria || 'sem categoria'}`)
      .join('\n');

    const promptSistema = `Você é um assistente que ajuda donos de empresa a alterar o cardápio de produtos deles através de comandos em linguagem natural (falados ou digitados).

Cardápio atual da empresa:
${listaProdutos || '(nenhum produto cadastrado ainda)'}

Interprete o comando do usuário e responda APENAS com um JSON válido (sem texto antes ou depois, sem markdown, sem crases), no formato:

{
  "acoes": [
    {
      "tipo": "adicionar" | "editar" | "remover",
      "produto_id": "id do produto (obrigatório pra editar/remover, use o id exato da lista acima)",
      "nome": "string (obrigatório pra adicionar, opcional pra editar se não mudar)",
      "preco": "string no formato brasileiro, ex: 23,00 (sem R$), ou null se não for alterar",
      "categoria": "string ou null se não for alterar",
      "descricao": "string ou null"
    }
  ],
  "resumo": "uma frase curta em português explicando o que vai ser feito, pra mostrar pro usuário confirmar"
}

Regras importantes:
- Se o comando mencionar um produto que existe na lista (mesmo com nome parecido/abreviado), use o "produto_id" exato dele.
- Se pedir pra "remover todos de tal categoria" ou algo em massa, inclua uma ação "remover" pra CADA produto daquela categoria na lista.
- Se não conseguir entender o comando com confiança, devolva "acoes": [] e explique o motivo no "resumo".
- Nunca invente um produto_id que não esteja na lista acima.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        system: promptSistema,
        messages: [{ role: 'user', content: comando }]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error('erro da API da Anthropic:', JSON.stringify(data));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao consultar a IA' }) };
    }

    const textoResposta = data.content && data.content[0] ? data.content[0].text : '';

    let resultado;
    try {
      const textoLimpo = textoResposta.replace(/```json|```/g, '').trim();
      resultado = JSON.parse(textoLimpo);
    } catch (e) {
      console.error('erro ao interpretar resposta da IA:', textoResposta);
      return { statusCode: 500, body: JSON.stringify({ error: 'a IA não devolveu um formato válido, tenta reformular o comando' }) };
    }

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar o comando' }) };
  }
};