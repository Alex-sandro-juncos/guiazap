// Recebe uma foto de cardápio (em base64) e usa o Claude (com visão) pra
// extrair os produtos automaticamente: nome, preço, descrição, categoria.
// A IA nunca grava nada direto no banco — só devolve os dados extraídos,
// e o dono confirma manualmente antes de qualquer coisa ser salva.
//
// ⚠️ SEGURANÇA: exige login, dono da empresa, e respeita limite diário de
// uso — evita que alguém automatize chamadas e gere custo alto na conta.

const { verificarAutenticacaoEUsoIA } = require('./ia-seguranca-helper');

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { imagemBase64, mediaType, profissionalId } = JSON.parse(event.body || '{}');
    if (!imagemBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'imagemBase64 é obrigatório' }) };
    }

    const seguranca = await verificarAutenticacaoEUsoIA(event, profissionalId, 'cardapio', 15);
    if (!seguranca.ok) {
      return { statusCode: seguranca.statusCode, body: JSON.stringify({ error: seguranca.error }) };
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada no Netlify' }) };
    }

    const promptSistema = `Você é um assistente que lê fotos de cardápios/listas de produtos e extrai os itens em formato estruturado.

Responda APENAS com um JSON válido (sem texto antes ou depois, sem markdown, sem crases), seguindo exatamente este formato:

{
  "produtos": [
    {
      "nome": "string",
      "preco": "string no formato brasileiro, ex: 23,00 (sem R$)",
      "descricao": "string ou null, se não tiver descrição visível",
      "categoria": "string curta, ex: Hamburgueria, Bebidas, Porções",
      "variacoes": [{"nome": "string", "preco": "string"}] ou [] se não tiver tamanhos diferentes
    }
  ]
}

Regras importantes:
- Se o item tiver dois preços por tamanho (ex: 500g/800g), coloque em "variacoes" e deixe "preco" como null.
- Se não conseguir ler algum preço com certeza, não invente — coloque null nesse campo.
- Ignore textos que não são produtos (título do cardápio, telefone, endereço, redes sociais).
- Nunca invente produtos que não estão na imagem.`;

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
        messages: [
          {
            role: 'user',
            content: [
              (mediaType === 'application/pdf'
                ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imagemBase64 } }
                : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imagemBase64 } }),
              { type: 'text', text: 'Leia esse cardápio e extraia os produtos no formato JSON pedido.' }
            ]
          }
        ]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error('erro da API da Anthropic:', JSON.stringify(data));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao consultar a IA', detalhe: data.error }) };
    }

    const textoResposta = data.content && data.content[0] ? data.content[0].text : '';

    let produtosExtraidos;
    try {
      // Remove qualquer marcação de código que a IA possa ter colocado sem querer
      const textoLimpo = textoResposta.replace(/```json|```/g, '').trim();
      produtosExtraidos = JSON.parse(textoLimpo);
    } catch (e) {
      console.error('erro ao interpretar resposta da IA:', textoResposta);
      return { statusCode: 500, body: JSON.stringify({ error: 'a IA não devolveu um formato válido, tente com uma foto mais nítida' }) };
    }

    return { statusCode: 200, body: JSON.stringify(produtosExtraidos) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao analisar o cardápio' }) };
  }
};