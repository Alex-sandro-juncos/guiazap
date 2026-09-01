// Gera uma foto realista de produto usando o DALL-E (OpenAI), pra quando o
// produto não tem foto cadastrada. A imagem gerada é salva no Storage do
// Supabase (mesmo bucket "fotos" usado pro resto do site), e a URL pública
// é devolvida pra ser salva no produto.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { nomeProduto, descricaoProduto, categoria } = JSON.parse(event.body || '{}');
    if (!nomeProduto) {
      return { statusCode: 400, body: JSON.stringify({ error: 'nomeProduto é obrigatório' }) };
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY não configurada no Netlify' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Monta um prompt pensado pra foto de produto real (fundo neutro, estilo
    // catálogo/cardápio), não uma ilustração ou arte estilizada
    const prompt = `Fotografia profissional de produto para catálogo/cardápio, estilo comercial realista: "${nomeProduto}"${categoria ? `, categoria: ${categoria}` : ''}${descricaoProduto ? `. Detalhes: ${descricaoProduto}` : ''}. Fundo branco ou neutro liso, iluminação de estúdio, foco nítido no produto, sem texto, sem marca d'água, sem pessoas.`;

    // 1. Gera a imagem com o DALL-E
    const respGeracao = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard'
      })
    });

    const dadosGeracao = await respGeracao.json();

    if (!respGeracao.ok || !dadosGeracao.data || !dadosGeracao.data[0]) {
      console.error('erro ao gerar imagem no DALL-E:', JSON.stringify(dadosGeracao));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar a imagem: ' + JSON.stringify(dadosGeracao.error || dadosGeracao) }) };
    }

    const urlImagemGerada = dadosGeracao.data[0].url;

    // 2. Baixa a imagem gerada (o link da OpenAI expira depois de um tempo,
    // então precisa salvar uma cópia permanente no nosso próprio Storage)
    const respImagem = await fetch(urlImagemGerada);
    const bufferImagem = Buffer.from(await respImagem.arrayBuffer());

    // 3. Sobe pro Storage do Supabase
    const nomeArquivo = `produtos-ia/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const respUpload = await fetch(`${SUPABASE_URL}/storage/v1/object/fotos/${nomeArquivo}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'image/png'
      },
      body: bufferImagem
    });

    if (!respUpload.ok) {
      const erroUpload = await respUpload.text();
      console.error('erro ao subir imagem pro Supabase:', erroUpload);
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao salvar a imagem gerada' }) };
    }

    const urlPublica = `${SUPABASE_URL}/storage/v1/object/public/fotos/${nomeArquivo}`;

    return { statusCode: 200, body: JSON.stringify({ fotoUrl: urlPublica }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar foto do produto: ' + err.message }) };
  }
};