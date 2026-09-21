// Roda todo dia — dispara os lembretes pessoais que a pessoa criou pelo
// "Modo Resolver" do Zeca (ex: "me lembra de levar o carro sexta") quando
// a data marcada chega. Bem simples e determinístico: só olha
// zeca_lembretes_pessoais com data_lembrete <= hoje e enviado = false,
// manda o push, marca como enviado (nunca manda duas vezes).

module.exports.handler = async function () {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    const hojeData = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/zeca_lembretes_pessoais?enviado=eq.false&data_lembrete=lte.${hojeData}&select=id,user_id,texto`,
      { headers }
    );
    const lembretes = resp.ok ? await resp.json() : [];

    let enviados = 0;
    for (const l of lembretes) {
      try {
        await fetch(`${process.env.URL || 'https://guiazap.shop'}/.netlify/functions/enviar-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_FUNCTIONS_SECRET || '' },
          body: JSON.stringify({
            titulo: '⏰ O Zeca te lembra',
            mensagem: l.texto,
            url: '/zeca.html',
            userIds: [l.user_id],
            tipo: 'zeca_lembrete'
          })
        });
        await fetch(`${SUPABASE_URL}/rest/v1/zeca_lembretes_pessoais?id=eq.${l.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ enviado: true })
        });
        enviados++;
      } catch (eItem) {
        console.error('erro ao mandar lembrete pessoal', l.id, eItem);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ enviados }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};