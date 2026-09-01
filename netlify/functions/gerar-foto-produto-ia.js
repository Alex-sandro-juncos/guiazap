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
        model: 'gpt-image-2',
        prompt,
        n: 1,
        size: '1024x1024'
      })
    });

    const dadosGeracao = await respGeracao.json();

    if (!respGeracao.ok || !dadosGeracao.data || !dadosGeracao.data[0]) {
      console.error('erro ao gerar imagem:', JSON.stringify(dadosGeracao));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar a imagem: ' + JSON.stringify(dadosGeracao.error || dadosGeracao) }) };
    }

    // Modelos mais novos costumam devolver a imagem já em base64 (b64_json)
    // em vez de um link temporário — trata os dois formatos possíveis
    let bufferImagem;
    if (dadosGeracao.data[0].b64_json) {
      bufferImagem = Buffer.from(dadosGeracao.data[0].b64_json, 'base64');
    } else if (dadosGeracao.data[0].url) {
      const respImagem = await fetch(dadosGeracao.data[0].url);
      bufferImagem = Buffer.from(await respImagem.arrayBuffer());
    } else {
      console.error('resposta sem imagem reconhecível:', JSON.stringify(dadosGeracao));
      return { statusCode: 500, body: JSON.stringify({ error: 'a API não devolveu uma imagem reconhecível' }) };
    }

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