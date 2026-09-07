// Gera foto de produto por IA. Antes de gastar API, procura no banco
// fotos_ia_cache. Se outro já gerou o mesmo produto (mesmo nome + categoria),
// devolve a URL pronta e NÃO chama OpenAI nem conta no limite diário.

const { verificarAutenticacaoEUsoIA } = require('./ia-seguranca-helper');

function normalizarChaveFoto(nomeProduto, categoria, descricaoProduto) {
  const limpar = (t) => String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpar(nomeProduto) + '|' + limpar(categoria) + '|' + limpar(descricaoProduto);
}

function headersServico() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}

async function buscarFotoCache(chave) {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY || !chave) return null;
  try {
    const resp = await fetch(
      `${url}/rest/v1/fotos_ia_cache?chave_normalizada=eq.${encodeURIComponent(chave)}&select=id,foto_url,hit_count`,
      { headers: headersServico() }
    );
    const rows = await resp.json();
    const row = rows && rows[0];
    if (!row || !row.foto_url) return null;

    fetch(`${url}/rest/v1/fotos_ia_cache?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: headersServico(),
      body: JSON.stringify({
        hit_count: (row.hit_count || 0) + 1,
        updated_at: new Date().toISOString()
      })
    }).catch(() => {});

    return row.foto_url;
  } catch (e) {
    console.warn('cache foto busca falhou', e);
    return null;
  }
}

async function salvarFotoCache(chave, nomeProduto, categoria, descricaoProduto, fotoUrl) {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY || !chave || !fotoUrl) return;
  try {
    await fetch(`${url}/rest/v1/fotos_ia_cache?on_conflict=chave_normalizada`, {
      method: 'POST',
      headers: { ...headersServico(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        chave_normalizada: chave,
        nome_produto: nomeProduto,
        categoria: categoria || null,
        descricao_produto: descricaoProduto || null,
        foto_url: fotoUrl,
        updated_at: new Date().toISOString()
      })
    });
  } catch (e) {
    console.warn('cache foto save falhou', e);
  }
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { nomeProduto, descricaoProduto, categoria, profissionalId } = JSON.parse(event.body || '{}');
    if (!nomeProduto) {
      return { statusCode: 400, body: JSON.stringify({ error: 'nomeProduto é obrigatório' }) };
    }

    const chave = normalizarChaveFoto(nomeProduto, categoria, descricaoProduto);
    const urlCache = await buscarFotoCache(chave);
    if (urlCache) {
      // Reaproveitou foto pronta: não gasta OpenAI.
      // Ainda exige dono + plano Vendas, mas NÃO conta no limite diário.
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
      const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const tokenUsuario = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
      if (!tokenUsuario) {
        return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
      }
      const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenUsuario}` }
      });
      if (!usuarioResp.ok) {
        return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
      }
      const usuario = await usuarioResp.json();
      const empresaResp = await fetch(
        `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=user_id,plano`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );
      const empresaData = await empresaResp.json();
      if (!empresaData[0] || empresaData[0].user_id !== usuario.id) {
        return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
      }
      if (empresaData[0].plano !== 'vendas') {
        return { statusCode: 403, body: JSON.stringify({ error: 'esse recurso de IA é exclusivo do Pacote Vendas' }) };
      }

      return { statusCode: 200, body: JSON.stringify({ fotoUrl: urlCache, reaproveitada: true }) };
    }

    const seguranca = await verificarAutenticacaoEUsoIA(event, profissionalId, 'foto', 15);
    if (!seguranca.ok) {
      return { statusCode: seguranca.statusCode, body: JSON.stringify({ error: seguranca.error }) };
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'OPENAI_API_KEY não configurada no Netlify' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const prompt = `Fotografia profissional de produto para catálogo/cardápio, estilo comercial realista: "${nomeProduto}"${categoria ? `, categoria: ${categoria}` : ''}${descricaoProduto ? `. Detalhes: ${descricaoProduto}` : ''}. Fundo branco ou neutro liso, iluminação de estúdio, foco nítido no produto, sem texto, sem marca d'água, sem pessoas.`;

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

    const nomeArquivo = `produtos-ia/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const respUpload = await fetch(`${SUPABASE_URL}/storage/v1/object/fotos/${nomeArquivo}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'image/png'
      },
      body: bufferImagem
    });

    if (!respUpload.ok) {
      const erroUpload = await respUpload.text();
      console.error('erro ao subir imagem pro Supabase:', erroUpload);
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao salvar a imagem gerada: ' + erroUpload }) };
    }

    const urlPublica = `${SUPABASE_URL}/storage/v1/object/public/fotos/${nomeArquivo}`;
    await salvarFotoCache(chave, nomeProduto, categoria, descricaoProduto, urlPublica);

    return { statusCode: 200, body: JSON.stringify({ fotoUrl: urlPublica, reaproveitada: false }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar foto do produto: ' + err.message }) };
  }
};
