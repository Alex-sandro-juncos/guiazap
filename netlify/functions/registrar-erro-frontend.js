// Recebe erros de JavaScript capturados no navegador das pessoas usando o
// site, guarda no banco, e avisa por e-mail quando o MESMO erro aparecer
// muitas vezes em pouco tempo (sinal de bug real afetando gente de verdade
// — não manda e-mail a cada erro isolado, pra não lotar sua caixa).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = 'contato@guiazap.shop';
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';
const LIMITE_PARA_AVISAR = 3; // a partir de quantas ocorrências do mesmo erro em 1h avisa por e-mail

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
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { pagina, mensagem, stack, userId } = JSON.parse(event.body || '{}');
    if (!mensagem) {
      return { statusCode: 400, body: JSON.stringify({ error: 'mensagem é obrigatória' }) };
    }

    // userId vem cru do navegador, sem login exigido aqui de propósito
    // (erro pode acontecer com a pessoa nem logada ainda) — então nunca é
    // usado pra ler/gravar dado de ninguém, só fica de "etiqueta" pra saber
    // quem reportou, pra você debugar. Mesmo assim, só aceita se tiver
    // formato de UUID de verdade — qualquer string solta vira null, pra
    // não guardar lixo/spoofing na coluna.
    const userIdValido = typeof userId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
      ? userId
      : null;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const userAgent = event.headers['user-agent'] || null;

    await fetch(`${SUPABASE_URL}/rest/v1/erros_frontend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pagina: pagina || null,
        mensagem: String(mensagem).slice(0, 2000),
        stack: stack ? String(stack).slice(0, 4000) : null,
        user_agent: userAgent,
        user_id: userIdValido
      })
    });

    // Conta quantas vezes essa MESMA mensagem de erro apareceu na última hora
    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const contagemResp = await fetch(
      `${SUPABASE_URL}/rest/v1/erros_frontend?mensagem=eq.${encodeURIComponent(String(mensagem).slice(0, 2000))}&created_at=gte.${umaHoraAtras}&select=id`,
      { headers: { ...headers, Prefer: 'count=exact' } }
    );
    const ocorrencias = await contagemResp.json();
    const total = ocorrencias.length;

    // Só avisa exatamente na hora que bate o limite — não manda de novo a
    // cada ocorrência nova depois disso (senão vira spam de e-mail)
    if (total === LIMITE_PARA_AVISAR) {
      await enviarEmail(
        ADMIN_EMAIL,
        `⚠️ Erro repetido no site (${total}x na última hora)`,
        `<p>Esse erro apareceu ${total} vezes na última hora, em <b>${pagina || 'página desconhecida'}</b>:</p>
         <pre style="background:#f4f4f4; padding:10px; border-radius:6px; white-space:pre-wrap;">${(mensagem || '').replace(/</g, '&lt;')}</pre>
         ${stack ? `<p style="font-size:0.85em; color:#666;">Stack: ${String(stack).slice(0, 500).replace(/</g, '&lt;')}</p>` : ''}`
      );
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, total }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: JSON.stringify({ ok: false }) };
  }
};