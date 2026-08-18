// Chamada toda vez que uma denúncia nova é enviada contra uma empresa.
// Conta quantas denúncias essa empresa já tem; se bater o limite, suspende
// automaticamente (sem esperar o admin agir manualmente) e avisa por e-mail
// tanto a empresa quanto o admin, pra dar chance de contestar.

const LIMITE_DENUNCIAS = 5; // ajuste esse número se quiser um limite diferente
const ADMIN_EMAIL = 'contato@guiazap.shop';
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
    const body = JSON.parse(event.body || '{}');
    const { profissionalId } = body;
    if (!profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'cadastro não informado' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Conta quantas denúncias essa empresa já tem
    const countResp = await fetch(
      `${SUPABASE_URL}/rest/v1/denuncias?profissional_id=eq.${profissionalId}&select=id`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'count=exact'
        }
      }
    );
    const denuncias = await countResp.json();
    const total = denuncias.length;

    if (total < LIMITE_DENUNCIAS) {
      return { statusCode: 200, body: JSON.stringify({ total, suspenso: false }) };
    }

    // Bateu o limite: suspende automaticamente
    const cadastroResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&status_pagamento=eq.ativo&select=name,user_email`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const cadastros = await cadastroResp.json();
    const cadastro = cadastros[0];

    if (!cadastro) {
      // já estava suspenso ou não existe mais, nada a fazer
      return { statusCode: 200, body: JSON.stringify({ total, suspenso: false }) };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ status_pagamento: 'pendente' })
    });

    // Avisa a empresa
    if (cadastro.user_email) {
      await enviarEmail(
        cadastro.user_email,
        'Seu cadastro no GuiaZap foi suspenso temporariamente',
        `<p>Olá!</p>
         <p>Seu cadastro "<b>${cadastro.name}</b>" recebeu várias denúncias de visitantes e foi suspenso automaticamente, como medida de proteção da comunidade.</p>
         <p>Se você acredita que isso foi um engano, responda este e-mail (contato@guiazap.shop) explicando a situação — vamos analisar manualmente.</p>`
      );
    }

    // Avisa o admin
    await enviarEmail(
      ADMIN_EMAIL,
      'Empresa suspensa automaticamente por denúncias — GuiaZap',
      `<p>O cadastro "<b>${cadastro.name}</b>" atingiu ${total} denúncias e foi suspenso automaticamente.</p>
       <p>Acesse o <a href="https://guiazap.shop/admin.html">painel admin</a> pra revisar as denúncias e decidir se reativa ou não.</p>`
    );

    return { statusCode: 200, body: JSON.stringify({ total, suspenso: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};