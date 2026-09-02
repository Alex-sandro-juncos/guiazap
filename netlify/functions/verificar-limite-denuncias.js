// Chamada toda vez que uma denúncia nova é enviada contra uma empresa.
// Conta quantas denúncias essa empresa já tem; se bater o limite, marca
// como "em análise" (SEM suspender sozinha) e avisa você por e-mail pra
// decidir manualmente.
//
// ⚠️ CORRIGIDO: antes, bater o limite suspendia a empresa automaticamente
// — isso permitia que alguém derrubasse uma empresa de verdade só mandando
// denúncias falsas em sequência, sem nenhuma revisão humana. Agora, a
// decisão final sempre passa por você.

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
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Conta quantas denúncias essa empresa já tem
    const countResp = await fetch(
      `${SUPABASE_URL}/rest/v1/denuncias?profissional_id=eq.${profissionalId}&select=id`,
      { headers: { ...headers, Prefer: 'count=exact' } }
    );
    const denuncias = await countResp.json();
    const total = denuncias.length;

    if (total < LIMITE_DENUNCIAS) {
      return { statusCode: 200, body: JSON.stringify({ total, emAnalise: false }) };
    }

    const cadastroResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=name,user_email,em_analise_por_denuncias`,
      { headers }
    );
    const cadastros = await cadastroResp.json();
    const cadastro = cadastros[0];

    if (!cadastro) {
      return { statusCode: 200, body: JSON.stringify({ total, emAnalise: false }) };
    }

    // Já estava marcado antes — não manda o e-mail de novo toda vez que
    // chega mais uma denúncia, só na primeira vez que bate o limite
    if (cadastro.em_analise_por_denuncias) {
      return { statusCode: 200, body: JSON.stringify({ total, emAnalise: true, jaAvisado: true }) };
    }

    // Bateu o limite: marca como "em análise" — continua funcionando
    // normalmente, NÃO suspende sozinha. Só avisa você pra decidir.
    await fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ em_analise_por_denuncias: true })
    });

    // Avisa o admin (você decide manualmente se suspende ou não)
    await enviarEmail(
      ADMIN_EMAIL,
      'Empresa atingiu limite de denúncias — decisão necessária',
      `<p>O cadastro "<b>${cadastro.name}</b>" atingiu ${total} denúncias e foi marcado como "em análise".</p>
       <p>Ele CONTINUA visível e funcionando normalmente — nada foi suspenso automaticamente.</p>
       <p>Acesse o <a href="https://guiazap.shop/admin.html">painel admin</a> pra revisar as denúncias e decidir se suspende ou não.</p>`
    );

    return { statusCode: 200, body: JSON.stringify({ total, emAnalise: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};