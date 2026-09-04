// Consulta a Receita Federal (via BrasilAPI, gratuita e sem precisar de
// chave) pra confirmar se o CNPJ REALMENTE existe e está ativo — diferente
// da validação matemática (que só confere se os dígitos batem), essa
// consulta confirma que o CNPJ está de fato registrado.

exports.handler = async function (event) {
  try {
    const { cnpj } = event.queryStringParameters || {};
    const cnpjLimpo = (cnpj || '').replace(/\D/g, '');

    if (cnpjLimpo.length !== 14) {
      return { statusCode: 400, body: JSON.stringify({ error: 'CNPJ precisa ter 14 números' }) };
    }

    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);

    if (resp.status === 404) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: false }) };
    }

    if (!resp.ok) {
      return { statusCode: 200, body: JSON.stringify({ encontrado: null, motivo: 'consulta indisponível no momento' }) };
    }

    const dados = await resp.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        encontrado: true,
        razaoSocial: dados.razao_social,
        nomeFantasia: dados.nome_fantasia,
        situacao: dados.descricao_situacao_cadastral,
        ativo: dados.descricao_situacao_cadastral === 'ATIVA',
        municipio: dados.municipio,
        uf: dados.uf
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ encontrado: null, motivo: 'erro ao consultar' }) };
  }
};