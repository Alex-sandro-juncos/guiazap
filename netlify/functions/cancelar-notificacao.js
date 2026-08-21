// Trata o clique no link "Não quero mais receber e-mails dessa empresa",
// presente no rodapé dos e-mails de notificação. O "id" da URL é o próprio
// ID da linha na tabela "seguidores" — só quem clicou no link de verdade
// (recebido no e-mail) sabe esse ID, então funciona como uma chave de acesso.

exports.handler = async function (event) {
  const paginaHtml = (mensagem, corFundo) => `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>GuiaZap</title>
      <style>
        body { font-family: 'Segoe UI', sans-serif; background: #F0F2F5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
        .caixa { background: white; border-radius: 14px; padding: 30px 24px; text-align: center; max-width: 380px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
        .icone { font-size: 2.5rem; margin-bottom: 10px; }
        h1 { font-size: 1.3rem; color: #1c1c1c; margin-bottom: 8px; }
        p { color: #555; font-size: 0.9rem; line-height: 1.4; }
        a { display: inline-block; margin-top: 16px; background: ${corFundo}; color: white; padding: 10px 20px; border-radius: 50px; text-decoration: none; font-weight: 700; font-size: 0.85rem; }
      </style>
    </head>
    <body>
      <div class="caixa">
        <div class="icone">${corFundo === '#25D366' ? '✅' : '⚠️'}</div>
        <h1>GuiaZap</h1>
        <p>${mensagem}</p>
        <a href="https://guiazap.shop">Voltar ao GuiaZap</a>
      </div>
    </body>
    </html>
  `;

  try {
    const seguidorId = event.queryStringParameters && event.queryStringParameters.id;
    if (!seguidorId) {
      return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: paginaHtml('Link inválido.', '#a4402f') };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    await fetch(`${SUPABASE_URL}/rest/v1/seguidores?id=eq.${seguidorId}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: paginaHtml('Pronto! Você não vai mais receber e-mails dessa empresa. Você pode voltar a seguir ela a qualquer momento pelo site.', '#25D366')
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: paginaHtml('Erro ao processar seu pedido. Tente novamente mais tarde.', '#a4402f') };
  }
};