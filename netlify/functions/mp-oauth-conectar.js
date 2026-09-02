// Gera o link que leva a empresa pra tela do Mercado Pago, onde ela loga na
// PRÓPRIA conta e autoriza o GuiaZap a criar pagamentos em nome dela. Depois
// de autorizar, o MP redireciona de volta pro mp-oauth-callback.js.

exports.handler = async function (event) {
  try {
    const { profissionalId } = event.queryStringParameters || {};
    if (!profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId é obrigatório' }) };
    }

    const MP_CLIENT_ID = process.env.MP_CLIENT_ID;
    const REDIRECT_URI = 'https://guiazap.shop/.netlify/functions/mp-oauth-callback';

    // Manda o profissionalId dentro do "state" — o Mercado Pago devolve
    // esse valor de volta no callback, sem alterar, então é assim que a
    // gente sabe pra qual empresa aquela autorização pertence
    const urlAutorizacao = `https://auth.mercadopago.com.br/authorization?client_id=${MP_CLIENT_ID}&response_type=code&platform_id=mp&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${profissionalId}`;

    return {
      statusCode: 302,
      headers: { Location: urlAutorizacao }
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar link de autorização' }) };
  }
};