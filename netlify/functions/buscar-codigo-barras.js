// Busca informações de um produto pelo código de barras.
// 1. Tenta primeiro o Bluesoft Cosmos (base brasileira, mais completa pra produtos daqui).
// 2. Se não achar, cai pro Open Food Facts (base internacional, gratuita, sem precisar de chave).

const COSMOS_TOKEN = process.env.COSMOS_TOKEN;
const COSMOS_USER_AGENT = process.env.COSMOS_USER_AGENT;

exports.handler = async function (event) {
  try {
    const codigo = event.queryStringParameters && event.queryStringParameters.codigo;
    if (!codigo) {
      return { statusCode: 400, body: JSON.stringify({ error: 'código não informado' }) };
    }

    // 1. Tenta o Bluesoft Cosmos primeiro (se tivermos token configurado)
    if (COSMOS_TOKEN && COSMOS_USER_AGENT) {
      try {
        const respCosmos = await fetch(`https://cosmos.bluesoft.com.br/api/gtins/${codigo}.json`, {
          headers: {
            'X-Cosmos-Token': COSMOS_TOKEN,
            'User-Agent': COSMOS_USER_AGENT,
            'Content-Type': 'application/json'
          }
        });

        if (respCosmos.ok) {
          const prod = await respCosmos.json();
          if (prod && prod.description) {
            return {
              statusCode: 200,
              body: JSON.stringify({
                encontrado: true,
                fonte: 'cosmos',
                nome: prod.description || '',
                marca: prod.brand ? prod.brand.name : '',
                foto: prod.thumbnail || '',
                descricao: prod.net_weight ? `Peso: ${prod.net_weight}g` : ''
              })
            };
          }
        }
      } catch (e) {
        console.error('erro ao consultar Cosmos, tentando fallback', e);
      }
    }

    // 2. Não achou no Cosmos (ou não temos token configurado) — tenta Open Food Facts
    try {
      const respOFF = await fetch(`https://world.openfoodfacts.org/api/v0/product/${codigo}.json`);
      const dataOFF = await respOFF.json();

      if (dataOFF.status === 1 && dataOFF.product) {
        const prod = dataOFF.product;
        return {
          statusCode: 200,
          body: JSON.stringify({
            encontrado: true,
            fonte: 'openfoodfacts',
            nome: prod.product_name || '',
            marca: prod.brands || '',
            foto: prod.image_url || '',
            descricao: prod.quantity ? `Quantidade da embalagem: ${prod.quantity}` : ''
          })
        };
      }
    } catch (e) {
      console.error('erro ao consultar Open Food Facts', e);
    }

    // 3. Não achou em nenhuma das duas bases
    return { statusCode: 200, body: JSON.stringify({ encontrado: false }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};