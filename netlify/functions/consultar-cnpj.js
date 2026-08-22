// Consulta a Receita Federal (via BrasilAPI, gratuita e pública) pra confirmar
// que um CNPJ existe de verdade, e trazer a razão social / nome fantasia
// oficiais — usado pra conferir se bate com o nome que a empresa digitou.

exports.handler = async function (event) {
  try {
    const cnpj = event.queryStringParameters && event.queryStringParameters.cnpj;
    const somenteDigitos = (cnpj || '').replace(/\D/g, '');

    if (somenteDigitos.length !== 14) {
      return { statusCode: 400, body: JSON.stringify({ error: 'CNPJ precisa ter 14 números' }) };
    }

    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${somenteDigitos}`);

    if (!resp.ok) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false, motivo: 'CNPJ não encontrado na Receita Federal' }) };
    }

    const data = await resp.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        encontrado: true,
        razao_social: data.razao_social || null,
        nome_fantasia: data.nome_fantasia || null,
        situacao: data.descricao_situacao_cadastral || null
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ encontrado: false, motivo: 'erro ao consultar a Receita Federal' }) };
  }
};