// Gera um código de 6 dígitos, salva no cadastro da empresa e manda por e-mail —
// parte do processo do Selo Verificado pago (uma das 4 camadas de confirmação).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { profissionalId, userToken } = body;
    if (!profissionalId || !userToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'dados incompletos' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Confirma quem está pedindo (usando o token da sessão de quem clicou)
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${userToken}` }
    });
    const userData = await userResp.json();
    if (!userData || !userData.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida' }) };
    }

    // Confirma que esse cadastro é mesmo dessa pessoa, e pega o e-mail dela
    const empresaResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${userData.id}&select=name,user_email`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const empresas = await empresaResp.json();
    const empresa = empresas[0];
    if (!empresa) {
      return { statusCode: 403, body: JSON.stringify({ error: 'cadastro não encontrado ou não é seu' }) };
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000));

    await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ verificacao_codigo_email: codigo })
    });

    if (RESEND_API_KEY && userData.email) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: EMAIL_REMETENTE,
          to: [userData.email],
          subject: 'Seu código de verificação do GuiaZap',
          html: `<p>Olá!</p><p>Seu código de verificação pro Selo Verificado de <b>${empresa.name}</b> é:</p><h2 style="letter-spacing:4px;">${codigo}</h2><p>Cole esse código no site pra continuar.</p>`
        })
      });
    }

    return { statusCode: 200, body: JSON.stringify({ enviado: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};