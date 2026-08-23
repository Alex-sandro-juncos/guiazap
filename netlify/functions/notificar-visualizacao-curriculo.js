// Avisa o candidato por e-mail quando uma empresa visualiza o currículo dele
// pela primeira vez (não notifica de novo se a mesma empresa olhar de novo).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { curriculoId, profissionalId } = body;
    if (!curriculoId || !profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'dados incompletos' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

    // Confere se já existe uma visualização dessa mesma empresa pra esse currículo
    const existenteResp = await fetch(
      `${SUPABASE_URL}/rest/v1/curriculo_visualizacoes?curriculo_id=eq.${curriculoId}&profissional_id=eq.${profissionalId}&select=id`,
      { headers }
    );
    const existentes = await existenteResp.json();

    if (existentes && existentes.length > 0) {
      return { statusCode: 200, body: JSON.stringify({ notificado: false, motivo: 'já visualizado antes por essa empresa' }) };
    }

    // Registra a visualização
    await fetch(`${SUPABASE_URL}/rest/v1/curriculo_visualizacoes`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ curriculo_id: curriculoId, profissional_id: profissionalId })
    });

    // Busca o e-mail do candidato e o nome da empresa, pra montar o e-mail
    const [curriculoResp, empresaResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/banco_curriculos?id=eq.${curriculoId}&select=nome,email`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/profissionais?id=eq.${profissionalId}&select=name`, { headers })
    ]);
    const curriculos = await curriculoResp.json();
    const empresas = await empresaResp.json();
    const curriculo = curriculos[0];
    const empresa = empresas[0];

    if (!curriculo || !curriculo.email || !empresa) {
      return { statusCode: 200, body: JSON.stringify({ notificado: false, motivo: 'dados incompletos pra notificar' }) };
    }

    if (RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: EMAIL_REMETENTE,
          to: [curriculo.email],
          subject: 'Uma empresa visualizou seu currículo no GuiaZap!',
          html: `<p>Olá, ${curriculo.nome}!</p><p>A empresa <b>${empresa.name}</b> acabou de visualizar seu currículo no Banco de Talentos do GuiaZap.</p><p>Fique de olho no WhatsApp — ela pode entrar em contato!</p>`
        })
      });
    }

    return { statusCode: 200, body: JSON.stringify({ notificado: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};