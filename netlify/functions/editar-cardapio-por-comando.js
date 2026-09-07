// Recebe um comando em texto (que pode ter vindo de voz-pra-texto no
// navegador) junto com o cardápio atual da empresa, e usa o Claude pra
// interpretar o que a pessoa quer fazer: adicionar, editar ou remover
// produtos. A IA NUNCA aplica nada direto — só propõe, e o dono confirma.
//
// ⚠️ SEGURANÇA: exige login, dono da empresa, e respeita limite diário de
// uso — evita que alguém automatize chamadas e gere custo alto na conta.

const { verificarAutenticacaoEUsoIA } = require('./ia-seguranca-helper');

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { comando, produtosAtuais, profissionalId } = JSON.parse(event.body || '{}');
    if (!comando) {
      return { statusCode: 400, body: JSON.stringify({ error: 'comando é obrigatório' }) };
    }

    const seguranca = await verificarAutenticacaoEUsoIA(event, profissionalId, 'comando', 40);
    if (!seguranca.ok) {
      return { statusCode: seguranca.statusCode, body: JSON.stringify({ error: seguranca.error }) };
    }

    const { chamarIABarata } = require('./ia-barata-helper');

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

    const ia = await chamarIABarata(promptSistema, comando, 2048);
    if (!ia.ok || !ia.json) {
      return { statusCode: 500, body: JSON.stringify({ error: 'a IA não devolveu um formato válido, tenta reformular o comando.' }) };
    }
    const resultado = ia.json;

    return { statusCode: 200, body: JSON.stringify(resultado) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao processar o comando: ' + err.message }) };
  }
};