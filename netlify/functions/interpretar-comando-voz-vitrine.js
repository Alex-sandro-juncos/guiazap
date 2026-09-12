// Interpreta o que o cliente falou na Vitrine (modo voz, mãos livres) e
// devolve uma ação estruturada — o FRONTEND é quem de fato executa a ação,
// chamando as funções reais do carrinho/busca (essa function nunca mexe
// direto no carrinho ou faz pedido sozinha, só interpreta a intenção).
//
// ⚠️ SEGURANÇA/CUSTO: exige login (é o CLIENTE comprando falando, não a
// empresa — por isso não usa o helper de IA das outras funções, que é
// específico pra dono de empresa com Pacote Vendas).

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { texto, produtosVisiveis, carrinhoAtual } = JSON.parse(event.body || '{}');
    if (!texto) {
      return { statusCode: 400, body: JSON.stringify({ error: 'texto é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Confere se está logado
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

    // 2. Limite diário por USUÁRIO (não por empresa, já que é o cliente
    // comprando) — reaproveita a mesma tabela de controle de uso de IA
    const LIMITE_DIARIO = 200; // comandos de voz são curtos e frequentes, limite bem mais alto
    const hoje = new Date().toISOString().slice(0, 10);
    const usoResp = await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario_usuario?user_id=eq.${usuario.id}&tipo=eq.comando_voz_vitrine&data=eq.${hoje}&select=contador`, { headers: headersServico });
    const usoData = await usoResp.json();
    const contadorAtual = usoData[0] ? usoData[0].contador : 0;

    if (contadorAtual >= LIMITE_DIARIO) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Limite diário de comandos de voz atingido. Tenta de novo amanhã.' }) };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/uso_ia_diario_usuario`, {
      method: 'POST',
      headers: { ...headersServico, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: usuario.id, tipo: 'comando_voz_vitrine', data: hoje, contador: contadorAtual + 1 })
    });

    const { chamarIABarata } = require('./ia-barata-helper');
    const { normalizarTexto, buscarCache, salvarPending, salvarAprovado } = require('./comandos-voz-cache');

    const textoNorm = normalizarTexto(texto);
    const cache = await buscarCache('vitrine', textoNorm);
    if (cache) {
      return { statusCode: 200, body: JSON.stringify(cache) };
    }
    await salvarPending('vitrine', textoNorm, texto);

    const listaProdutos = (produtosVisiveis || []).map(p => `- id:${p.id} | ${p.nome} | marca:${p.marca || '-'} | R$${p.preco || '?'} | ${p.temOpcoes ? 'TEM variação/adicional' : 'sem opções'}`).join('\n');
    const resumoCarrinho = (carrinhoAtual || []).length === 0
      ? 'vazio'
      : carrinhoAtual.map(i => `${i.quantidade}x ${i.nome} (R$${i.precoUnitario}, empresa: ${i.empresaNome || '-'})`).join(', ');
    const empresasNoCarrinho = [...new Set((carrinhoAtual || []).map(i => i.empresaNome).filter(Boolean))];

    const promptSistema = `Você interpreta comandos de VOZ de um cliente comprando numa loja online (GuiaZap Vitrine), no modo "mãos livres". Responda APENAS com um JSON válido, sem texto antes/depois, sem markdown, no formato:
{
  "voice_response": "resposta curta e natural, em português, pra ser lida em voz alta",
  "action": "BUSCAR" | "ADICIONAR_CARRINHO" | "VER_CARRINHO" | "REMOVER_ITEM" | "REMOVER_EMPRESA_CARRINHO" | "ESVAZIAR_CARRINHO" | "FINALIZAR_PEDIDO" | "NENHUMA",
  "params": { ... }
}

Regras:
- BUSCAR: params = { "termo": "o que buscar" }
- ADICIONAR_CARRINHO: params = { "produto_id": "id do produto da lista abaixo que mais combina com o pedido", "quantidade": numero }. Se o produto tiver "TEM variação/adicional", NÃO adicione direto — responda pedindo pra especificar, e action = "NENHUMA".
- VER_CARRINHO: só lê o carrinho, sem params.
- REMOVER_ITEM: quando quiser remover um produto específico (não uma empresa inteira). params = { "nome_aproximado": "nome do item a remover" }
- REMOVER_EMPRESA_CARRINHO: quando quiser descartar/excluir/tirar os itens de UMA empresa específica do carrinho (ex: "exclui o pedido da tal empresa", "tira os itens de X", "não quero mais o de Y"). params = { "empresaNome": "nome da empresa, EXATAMENTE como aparece na lista de empresas no carrinho abaixo" }. Preste atenção a erros de transcrição de voz em nomes de empresa (ex: "Bocosal"/"Macosal"/"Bocozão" provavelmente é "Bocosão") e escolha a empresa mais parecida da lista.
- ESVAZIAR_CARRINHO: quando quiser descartar TUDO do carrinho, sem especificar uma empresa (ex: "descarta tudo", "esvazia o carrinho", "cancela o pedido inteiro").
- FINALIZAR_PEDIDO: só quando o cliente claramente disser que quer finalizar/fechar o pedido.
- Se não entender ou for só conversa, action = "NENHUMA" e responda naturalmente.
- Nunca invente produto_id que não esteja na lista, nem empresaNome que não esteja na lista de empresas no carrinho.

Produtos visíveis agora na tela:
${listaProdutos || '(nenhum produto na tela no momento)'}

Carrinho atual: ${resumoCarrinho}
Empresas no carrinho: ${empresasNoCarrinho.join(', ') || '(nenhuma)'}`;

    const ia = await chamarIABarata(promptSistema, texto, 500);
    const resultado = ia.ok
      ? ia.json
      : { voice_response: 'Desculpa, não entendi direito. Pode repetir?', action: 'NENHUMA', params: {} };

    if (ia.ok) await salvarAprovado('vitrine', textoNorm, resultado);

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar comando de voz' }) };
  }
};