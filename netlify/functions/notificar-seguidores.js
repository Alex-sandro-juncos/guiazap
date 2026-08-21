// Avisa por e-mail todo mundo que segue uma empresa, quando ela publica
// uma novidade nova (Story) ou um produto novo — exclusivo do Pacote Premium.

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
    const { profissionalId, tipo, titulo, foto } = body;
    if (!profissionalId || !tipo) {
      return { statusCode: 400, body: JSON.stringify({ error: 'dados incompletos' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Confirma que a empresa é mesmo Premium (checagem no servidor, não confia só no site)
    const empresaResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=name,plano,notificar_seguidores`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const empresas = await empresaResp.json();
    const empresa = empresas[0];

    if (!empresa || empresa.plano !== 'premium') {
      return { statusCode: 200, body: JSON.stringify({ enviados: 0, motivo: 'empresa não é Premium' }) };
    }

    if (empresa.notificar_seguidores === false) {
      return { statusCode: 200, body: JSON.stringify({ enviados: 0, motivo: 'empresa desativou o envio de notificações' }) };
    }

    // Busca todo mundo que segue essa empresa
    const seguidoresResp = await fetch(
      `${SUPABASE_URL}/rest/v1/seguidores?profissional_id=eq.${profissionalId}&select=id,user_email`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    );
    const seguidores = await seguidoresResp.json();

    if (!seguidores || seguidores.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ enviados: 0, motivo: 'sem seguidores' }) };
    }

    const assunto = tipo === 'story'
      ? `${empresa.name} publicou uma novidade no GuiaZap!`
      : `${empresa.name} anunciou um produto novo no GuiaZap!`;

    let enviadosCount = 0;
    for (const s of seguidores) {
      if (!s.user_email) continue;

      const linkCancelar = `https://guiazap.shop/.netlify/functions/cancelar-notificacao?id=${s.id}`;
      const html = `
        <p>Olá!</p>
        <p><b>${empresa.name}</b>, que você segue no GuiaZap, acabou de ${tipo === 'story' ? 'publicar uma novidade' : 'anunciar um produto novo'}${titulo ? `: <b>${titulo}</b>` : ''}.</p>
        ${foto ? `<img src="${foto}" style="max-width:300px; border-radius:8px; margin:10px 0;">` : ''}
        <p><a href="https://guiazap.shop">Confira no GuiaZap</a></p>
        <p style="font-size:0.8em; color:#888;">
          Você recebeu esse e-mail porque segue ${empresa.name} no GuiaZap.<br>
          <a href="${linkCancelar}" style="color:#888;">Não quero mais receber e-mails dessa empresa</a>
        </p>
      `;

      await enviarEmail(s.user_email, assunto, html);
      enviadosCount++;
    }

    return { statusCode: 200, body: JSON.stringify({ enviados: enviadosCount }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};