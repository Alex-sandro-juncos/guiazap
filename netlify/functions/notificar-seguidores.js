// Avisa por e-mail todo mundo que segue uma empresa, quando ela publica
// uma novidade nova (Story) ou um produto novo — exclusivo do Pacote Premium.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

// Escapa pra colocar num e-mail HTML — mesmo padrão dos escapadores do
// front, só que sem `document` (não existe no Node).
function escaparHtmlEmail(str){
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headersServico = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

    // ⚠️ SEGURANÇA: sem login nenhum, essa function antes aceitava
    // profissionalId (informação pública) + titulo/foto inventados por
    // QUALQUER pessoa, e mandava e-mail de verdade pros seguidores da
    // empresa, usando o remetente oficial do GuiaZap. Agora exige estar
    // logado como o DONO daquela empresa antes de disparar qualquer coisa.
    const tokenChamador = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    if (!tokenChamador) {
      return { statusCode: 401, body: JSON.stringify({ error: 'não autenticado' }) };
    }
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenChamador}` }
    });
    if (!usuarioResp.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'sessão inválida ou expirada' }) };
    }
    const usuarioChamador = await usuarioResp.json();

    // Confirma que a empresa é mesmo Premium E que quem chamou é o dono dela
    const empresaResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&user_id=eq.${usuarioChamador.id}&select=name,plano,notificar_seguidores`,
      { headers: headersServico }
    );
    const empresas = await empresaResp.json();
    const empresa = empresas[0];

    if (!empresa) {
      return { statusCode: 403, body: JSON.stringify({ error: 'essa empresa não é sua' }) };
    }
    if (empresa.plano !== 'premium') {
      return { statusCode: 200, body: JSON.stringify({ enviados: 0, motivo: 'empresa não é Premium' }) };
    }

    if (empresa.notificar_seguidores === false) {
      return { statusCode: 200, body: JSON.stringify({ enviados: 0, motivo: 'empresa desativou o envio de notificações' }) };
    }

    // Busca todo mundo que segue essa empresa
    const seguidoresResp = await fetch(
      `${SUPABASE_URL}/rest/v1/seguidores?profissional_id=eq.${profissionalId}&select=id,user_email`,
      { headers: headersServico }
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
      // Título vem do dono (já verificado acima), mas escapa de qualquer
      // jeito — defesa em profundidade contra HTML/script solto no e-mail.
      // A foto só entra se for de fato uma URL http(s) — nunca um
      // "javascript:" ou outro esquema esquisito dentro de um <img src>.
      const tituloSeguro = titulo ? escaparHtmlEmail(titulo) : '';
      const fotoSegura = (typeof foto === 'string' && /^https?:\/\//i.test(foto)) ? escaparHtmlEmail(foto) : '';
      const html = `
        <p>Olá!</p>
        <p><b>${escaparHtmlEmail(empresa.name)}</b>, que você segue no GuiaZap, acabou de ${tipo === 'story' ? 'publicar uma novidade' : 'anunciar um produto novo'}${tituloSeguro ? `: <b>${tituloSeguro}</b>` : ''}.</p>
        ${fotoSegura ? `<img src="${fotoSegura}" style="max-width:300px; border-radius:8px; margin:10px 0;">` : ''}
        <p><a href="https://guiazap.shop">Confira no GuiaZap</a></p>
        <p style="font-size:0.8em; color:#888;">
          Você recebeu esse e-mail porque segue ${escaparHtmlEmail(empresa.name)} no GuiaZap.<br>
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