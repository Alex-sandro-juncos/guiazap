// Ativa gratuitamente um cadastro (Pacote 1) — sem precisar de pagamento nem cupom.
// Funciona tanto pra quem está criando o cadastro pela primeira vez no plano grátis,
// quanto pra quem cancelou o Pacote Pago e quer voltar pro grátis em vez de pagar de novo.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

async function enviarEmail(destinatario, assunto, html){
  if(!RESEND_API_KEY || !destinatario) return;
  try{
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: EMAIL_REMETENTE, to: [destinatario], subject: assunto, html })
    });
  } catch(e){
    console.error('erro ao enviar e-mail', e);
  }
}

exports.handler = async function (event) {
  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const body = JSON.parse(event.body || '{}');
    const { profissionalId } = body;
    if (!profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cadastro não informado' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }
    });
    const userData = await userResp.json();
    if (!userData.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida' }) };
    }

    // Confirma que o cadastro é do usuário (qualquer plano — serve tanto pra ativar
    // o Pacote Grátis pela primeira vez, quanto pra "baixar de nível" quem cancelou o pago)
    const cadastroResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${userData.id}&select=id,name`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const cadastros = await cadastroResp.json();
    if (!cadastros[0]) {
      return { statusCode: 403, body: JSON.stringify({ error: 'cadastro não encontrado' }) };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ status_pagamento: 'ativo', plano: 'basico' })
    });

    await enviarEmail(
      userData.email,
      'Cadastro ativado — GuiaZap',
      `<p>Olá!</p>
       <p>Seu cadastro "<b>${cadastros[0].name}</b>" no GuiaZap (Pacote Grátis) está <b>ativo</b>, aparecendo para todos na busca.</p>
       <p>Acesse <a href="https://guiazap.shop">guiazap.shop</a> pra conferir.</p>
       <p>Qualquer dúvida, fale com a gente: contato@guiazap.shop</p>`
    );

    return { statusCode: 200, body: JSON.stringify({ sucesso: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};