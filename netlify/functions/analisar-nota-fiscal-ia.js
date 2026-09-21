// Recebe uma foto (ou PDF) de nota fiscal/comprovante/recibo e usa o
// Claude (com visão) pra extrair os dados do lançamento automaticamente:
// valor, categoria sugerida, descrição, data, imposto destacado (se
// tiver) e fornecedor. Mesmo espírito do "cadastrar por foto do
// cardápio" (analisar-cardapio-ia.js) — a IA NUNCA lança nada direto no
// caixa/lançamentos, só devolve os dados extraídos pra pessoa CONFERIR e
// confirmar no formulário antes de qualquer coisa ser salva.
//
// Compartilhado pelos 3 módulos (empresa/lar/agro) — "modulo" no corpo
// da requisição diz qual dono conferir:
//   - "empresa": profissionalId, dono é profissionais.user_id
//   - "agro": propriedadeId, dono é agro_propriedades.user_id
//   - "lar": nenhum id extra, dono é o próprio usuário logado
//
// Não usa o mesmo verificarAutenticacaoEUsoIA do cardápio porque aquele
// exige Pacote Vendas — nenhum desses 3 módulos é travado por plano
// hoje, então esse recurso segue a mesma regra: só precisa estar
// logado e ser dono do que está tentando lançar. Rate limit diário
// próprio: por profissional (tabela uso_ia_diario) pra empresa, por
// usuário (tabela uso_ia_diario_usuario) pra lar/agro — evita que
// ninguém automatize chamada e gere custo alto sem controle.

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { imagemBase64, mediaType, imagens, profissionalId, propriedadeId, modulo } = JSON.parse(event.body || '{}');
    // Aceita uma lista de fotos da MESMA nota (ex: uma foto geral + uma
    // foto mais de perto dos itens/totais, quando a letra fica pequena
    // demais numa foto só) — "imagens" é o formato novo, mas continua
    // aceitando o formato antigo de uma imagem só (imagemBase64/mediaType)
    // pra não quebrar chamada de versão antiga do app.
    const listaImagens = Array.isArray(imagens) && imagens.length
      ? imagens
      : (imagemBase64 ? [{ imagemBase64, mediaType }] : []);
    if (!listaImagens.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'imagemBase64 (ou imagens) é obrigatório' }) };
    }
    const LIMITE_FOTOS_POR_NOTA = 4;
    if (listaImagens.length > LIMITE_FOTOS_POR_NOTA) {
      return { statusCode: 400, body: JSON.stringify({ error: `Máximo de ${LIMITE_FOTOS_POR_NOTA} fotos por nota.` }) };
    }
    const moduloFinal = modulo === 'agro' || modulo === 'lar' ? modulo : 'empresa';
    if (moduloFinal === 'empresa' && !profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId é obrigatório' }) };
    }
    if (moduloFinal === 'agro' && !propriedadeId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'propriedadeId é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuario = await usuarioResp.json();

    if (moduloFinal === 'empresa') {
      const empResp = await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${usuario.id}&select=id`, { headers: headersServico });
      const empData = empResp.ok ? await empResp.json() : [];
      if (!empData[0]) {
        return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
      }
    } else if (moduloFinal === 'agro') {
      const propResp = await fetch(`${SUPABASE_URL}/rest/v1/agro_propriedades?id=eq.${propriedadeId}&user_id=eq.${usuario.id}&select=id`, { headers: headersServico });
      const propData = propResp.ok ? await propResp.json() : [];
      if (!propData[0]) {
        return { statusCode: 403, body: JSON.stringify({ error: 'essa propriedade não é sua' }) };
      }
    }
    // "lar" não tem dono extra pra conferir além do próprio usuário logado.

    // Rate limit diário — 30/dia é generoso pra uso normal (ninguém lança
    // dezenas de notas por dia na mão) e barato o suficiente pra não
    // preocupar com custo de API.
    const LIMITE_DIARIO = 30;
    const hoje = new Date().toISOString().slice(0, 10);
    if (moduloFinal === 'empresa') {
      const usoResp = await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario?profissional_id=eq.${profissionalId}&tipo=eq.nota_fiscal&data=eq.${hoje}&select=contador`, { headers: headersServico });
      const usoData = usoResp.ok ? await usoResp.json() : [];
      const contadorAtual = usoData[0] ? usoData[0].contador : 0;
      if (contadorAtual >= LIMITE_DIARIO) {
        return { statusCode: 429, body: JSON.stringify({ error: `Você atingiu o limite diário de leitura de nota por foto (${LIMITE_DIARIO}/dia). Lança essa manualmente ou tenta de novo amanhã.` }) };
      }
      await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario`, {
        method: 'POST',
        headers: { ...headersServico, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ profissional_id: profissionalId, tipo: 'nota_fiscal', data: hoje, contador: contadorAtual + 1 })
      });
    } else {
      const usoResp = await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario_usuario?user_id=eq.${usuario.id}&tipo=eq.nota_fiscal_${moduloFinal}&data=eq.${hoje}&select=contador`, { headers: headersServico });
      const usoData = usoResp.ok ? await usoResp.json() : [];
      const contadorAtual = usoData[0] ? usoData[0].contador : 0;
      if (contadorAtual >= LIMITE_DIARIO) {
        return { statusCode: 429, body: JSON.stringify({ error: `Você atingiu o limite diário de leitura de nota por foto (${LIMITE_DIARIO}/dia). Lança essa manualmente ou tenta de novo amanhã.` }) };
      }
      await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario_usuario`, {
        method: 'POST',
        headers: { ...headersServico, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: usuario.id, tipo: `nota_fiscal_${moduloFinal}`, data: hoje, contador: contadorAtual + 1 })
      });
    }

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY não configurada no Netlify' }) };
    }

    const promptSistema = `Você é um assistente que lê fotos de notas fiscais (DANFE, NFC-e, cupom fiscal), recibos e comprovantes de compra/venda, e extrai os dados pra lançar num sistema financeiro.

Responda APENAS com um JSON válido (sem texto antes ou depois, sem markdown, sem crases), seguindo exatamente este formato:

{
  "tipo": "receita" ou "despesa" (quase sempre "despesa", já que é nota de compra — só "receita" se for claramente uma nota de venda EMITIDA pela própria empresa),
  "valor": "string no formato brasileiro, ex: 245,90 (o valor TOTAL da nota, sem R$)",
  "valor_imposto": "string no formato brasileiro, ex: 12,30, ou null se não tiver imposto destacado visível na nota (ICMS, ISS etc)",
  "descricao": "descrição curta do que foi comprado/vendido, ex: 'Farinha de trigo e açúcar' ou o nome do estabelecimento se não der pra identificar os itens",
  "categoria": "categoria sugerida em uma palavra ou expressão curta, com base na classificação abaixo quando der pra identificar (ex: 'revenda', 'uso e consumo', 'combustível', 'insumo agrícola', 'manutenção', 'aluguel', 'material de escritório')",
  "classificacao": "'revenda' (mercadoria comprada pra revender), 'uso_consumo' (material/insumo que a empresa usa, não revende), 'combustivel', 'insumo_agro' (defensivo, semente, fertilizante — nota de propriedade rural), ou 'outro' quando não der pra classificar com confiança",
  "fornecedor": "nome do estabelecimento/emitente da nota, ou null se não conseguir ler",
  "cnpj_emitente": "CNPJ de quem emitiu a nota, no formato como aparece (ex: 11.222.333/0001-44), ou null se não conseguir ler",
  "numero_nota": "número da nota fiscal/cupom, ou null se não conseguir ler",
  "data": "data da nota no formato YYYY-MM-DD, ou null se não conseguir ler com certeza"
}

Regras importantes:
- Nunca invente um valor que você não consegue ler com certeza — nesse caso, use null nesse campo específico.
- "valor" é o valor TOTAL pago/recebido, não um item avulso.
- Se receber MAIS DE UMA foto, elas podem ser: (a) partes DIFERENTES da mesma nota — ex: uma foto do topo com CNPJ/data/cabeçalho, outra do meio com a lista de itens, outra do rodapé com o valor total — porque a nota inteira não coube legível numa foto só; ou (b) a mesma parte vista mais de perto, pra letra pequena ficar legível. Em qualquer um dos casos, é a MESMA nota: junte o que aparecer em CADA foto (um campo pode estar visível só numa delas) e devolva um único JSON combinado com tudo que conseguir ler somando as fotos — nunca devolva mais de um resultado nem ignore uma foto por ela não ter o valor total, por exemplo.
- Se a imagem não for claramente uma nota fiscal/recibo/comprovante de compra ou venda, devolva {"erro": "não parece ser uma nota fiscal ou comprovante"} no lugar do JSON acima.`;

    const blocosImagem = listaImagens.map(img =>
      img.mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: img.imagemBase64 } }
        : { type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.imagemBase64 } }
    );
    const textoInstrucao = listaImagens.length > 1
      ? `Essas ${listaImagens.length} fotos são da MESMA nota/comprovante — podem ser partes diferentes dela (cada foto pegou um pedaço, porque não coube inteira e legível numa foto só) ou a mesma parte mais de perto. Leia todas, junte o que aparecer em cada uma e extraia os dados no formato JSON pedido, combinando tudo num resultado só.`
      : 'Leia essa nota/comprovante e extraia os dados no formato JSON pedido.';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        system: promptSistema,
        messages: [
          {
            role: 'user',
            content: [...blocosImagem, { type: 'text', text: textoInstrucao }]
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
    let extraido;
    try {
      const textoLimpo = textoResposta.replace(/```json|```/g, '').trim();
      extraido = JSON.parse(textoLimpo);
    } catch (e) {
      console.error('erro ao interpretar resposta da IA:', textoResposta);
      return { statusCode: 500, body: JSON.stringify({ error: 'a IA não devolveu um formato válido, tenta com uma foto mais nítida' }) };
    }

    if (extraido.erro) {
      return { statusCode: 200, body: JSON.stringify({ error: extraido.erro }) };
    }

    return { statusCode: 200, body: JSON.stringify(extraido) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao analisar a nota' }) };
  }
};