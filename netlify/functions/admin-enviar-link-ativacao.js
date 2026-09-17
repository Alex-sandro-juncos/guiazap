// Botão do admin.html "Enviar link p/ empresa ativar": gera um token único
// em `links_ativacao` e manda um e-mail pra dona do cadastro, com um link
// que ELA MESMA clica pra ativar o cadastro de graça (sem precisar pagar) —
// versão "self-serve" do botão "Ativar agora" que o admin usa direto.
//
// Só o e-mail admin pode chamar isso, mesma trava do admin-acao.js.

const ADMIN_EMAIL = 'contato@guiazap.shop';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const { profissionalId } = JSON.parse(event.body || '{}');
    if (!profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId é obrigatório' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SITE_URL = process.env.URL || 'https://guiazap.shop';

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Só o e-mail admin pode gerar esse link
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const userData = await userResp.json();
    if (!userData.email || userData.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return { statusCode: 403, body: JSON.stringify({ error: 'acesso negado' }) };
    }

    const empresaResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=name,user_email`,
      { headers }
    );
    const empresas = await empresaResp.json();
    const empresa = empresas[0];

    if (!empresa) {
      return { statusCode: 404, body: JSON.stringify({ error: 'cadastro não encontrado' }) };
    }
    if (!empresa.user_email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'esse cadastro não tem e-mail salvo' }) };
    }
    if (!RESEND_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'envio de e-mail não configurado (RESEND_API_KEY)' }) };
    }

    // Gera o token de ativação (a tabela já cuida do default do UUID)
    const tokenResp = await fetch(`${SUPABASE_URL}/rest/v1/links_ativacao`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ profissional_id: profissionalId })
    });
    const tokenData = await tokenResp.json();
    const linkToken = tokenData[0] && tokenData[0].token;

    if (!linkToken) {
      console.error('erro ao gerar token de ativação:', JSON.stringify(tokenData));
      return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar link de ativação' }) };
    }

    const linkAtivacao = `${SITE_URL}/ativar-cadastro.html?token=${linkToken}`;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: EMAIL_REMETENTE,
        to: [empresa.user_email],
        subject: 'Ative seu cadastro no GuiaZap',
        html: `
          <p>Olá!</p>
          <p>O cadastro de <b>${empresa.name}</b> no GuiaZap está pronto pra ser ativado.</p>
          <p>Clique no botão abaixo pra ativar agora:</p>
          <p><a href="${linkAtivacao}" style="display:inline-block;background:#25D366;color:white;padding:12px 22px;border-radius:50px;font-weight:700;text-decoration:none;">Ativar meu cadastro</a></p>
          <p style="font-size:0.85rem;color:#888;">Esse link é pessoal e só pode ser usado uma vez. Se você não pediu isso, pode ignorar este e-mail.</p>
        `
      })
    });

    if (!resp.ok) {
      const erro = await resp.text();
      console.error('erro ao mandar e-mail via Resend', erro);
      return { statusCode: 500, body: JSON.stringify({ error: 'falha ao enviar e-mail' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ enviado: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao enviar link de ativação' }) };
  }
};