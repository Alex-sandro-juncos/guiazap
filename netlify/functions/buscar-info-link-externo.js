// Tenta preencher automaticamente nome, foto, descrição e preço de um produto,
// lendo as tags "Open Graph" da página do link externo (as mesmas informações
// que aparecem quando alguém compartilha esse link no WhatsApp/Facebook).
// Nem toda loja tem essas tags, ou permite que a gente leia a página — nesse
// caso, retornamos só o que conseguimos achar (o resto continua manual).

function extrairMeta(html, propriedades) {
  for (const propriedade of propriedades) {
    let regex = new RegExp(`<meta[^>]+property=["']${propriedade}["'][^>]+content=["']([^"']+)["']`, 'i');
    let match = html.match(regex);
    if (match) return match[1];

    regex = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${propriedade}["']`, 'i');
    match = html.match(regex);
    if (match) return match[1];

    regex = new RegExp(`<meta[^>]+name=["']${propriedade}["'][^>]+content=["']([^"']+)["']`, 'i');
    match = html.match(regex);
    if (match) return match[1];
  }
  return null;
}

function decodificarHtml(texto) {
  if (!texto) return texto;
  return texto
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

exports.handler = async function (event) {
  try {
    const url = event.queryStringParameters && event.queryStringParameters.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'link inválido' }) };
    }

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      }
    });

    if (!resp.ok) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false, motivo: 'não foi possível acessar essa página' }) };
    }

    const html = await resp.text();

    const nome = extrairMeta(html, ['og:title', 'twitter:title']);
    const foto = extrairMeta(html, ['og:image', 'twitter:image']);
    const descricao = extrairMeta(html, ['og:description', 'twitter:description', 'description']);
    const precoTexto = extrairMeta(html, ['product:price:amount', 'og:price:amount']);

    return {
      statusCode: 200,
      body: JSON.stringify({
        encontrado: !!(nome || foto),
        nome: decodificarHtml(nome),
        foto: foto || null,
        descricao: decodificarHtml(descricao),
        preco: precoTexto || null
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ encontrado: false, motivo: 'erro ao ler essa página' }) };
  }
};