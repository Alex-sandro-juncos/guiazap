// Manda o "pacote do contador" (PDF + Excel) direto por e-mail pro
// contador da empresa, sem o dono precisar baixar e reencaminhar na mão —
// pedido de sempre do Alex: "o contador deve só precisar assinar".
//
// Reaproveita as functions que já existem e já são usadas pelo botão
// "gerar PDF"/"gerar planilha" em empresa.html — chama o `handler` delas
// diretamente aqui dentro (sem HTTP de function pra function, não precisa
// saber a URL de deploy), então qualquer trava de autenticação/posse que
// elas já têm continua valendo:
//   preparar-contabilidade-zeca.js  → {texto, titulo}
//   gerar-pdf-zeca.js               → PDF em base64
//   gerar-excel-contabilidade-zeca.js → planilha .xlsx em base64

const { handler: prepararContabilidade } = require('./preparar-contabilidade-zeca.js');
const { handler: gerarPdf } = require('./gerar-pdf-zeca.js');
const { handler: gerarExcel } = require('./gerar-excel-contabilidade-zeca.js');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_REMETENTE = 'GuiaZap <contato@guiazap.shop>';

function escaparHtmlEmail(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Validação simples de formato — não confirma que o e-mail existe de
// verdade, só barra coisa claramente inválida antes de gastar chamada no
// Resend.
function eEmailValido(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, body: JSON.stringify({ error: 'precisa estar logado' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { profissionalId, ano, mes, emailContador } = body;
    if (!profissionalId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'profissionalId é obrigatório' }) };
    }
    if (!eEmailValido(emailContador)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'e-mail do contador inválido' }) };
    }

    // A própria preparar-contabilidade-zeca.js confere login + que a
    // empresa é do usuário que chamou (via o mesmo token aqui embaixo) —
    // não duplica essa checagem, só repassa o token adiante.
    const respPreparo = await prepararContabilidade({
      httpMethod: 'POST',
      headers: { authorization: authHeader },
      body: JSON.stringify({ profissionalId, ano, mes })
    });
    if (respPreparo.statusCode !== 200) {
      return respPreparo;
    }
    const { texto, titulo } = JSON.parse(respPreparo.body);

    const [respPdf, respExcel] = await Promise.all([
      gerarPdf({ httpMethod: 'POST', body: JSON.stringify({ texto, titulo }) }),
      gerarExcel({
        httpMethod: 'POST',
        headers: { authorization: authHeader },
        body: JSON.stringify({ profissionalId, ano, mes })
      })
    ]);

    const anexos = [];
    if (respPdf.statusCode === 200 && respPdf.isBase64Encoded) {
      anexos.push({ filename: `${(titulo || 'contabilidade').slice(0, 60)}.pdf`, content: respPdf.body });
    }
    if (respExcel.statusCode === 200 && respExcel.isBase64Encoded) {
      anexos.push({ filename: `pacote-contador-${profissionalId}.xlsx`, content: respExcel.body });
    }
    if (!anexos.length) {
      return { statusCode: 500, body: JSON.stringify({ error: 'não consegui gerar os arquivos pra anexar' }) };
    }

    if (!RESEND_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'envio de e-mail não configurado' }) };
    }

    const tituloSeguro = escaparHtmlEmail(titulo || 'Preparação contábil');
    const html = `
      <p>Olá!</p>
      <p>Segue em anexo a organização dos dados financeiros gerada pelo GuiaZap: <b>${tituloSeguro}</b>.</p>
      <p style="font-size:0.9em; color:#555;">Isso é uma ORGANIZAÇÃO dos lançamentos e documentos já cadastrados pela empresa no GuiaZap — não é cálculo de imposto nem declaração pronta. Confira e complemente com o que for necessário antes de usar.</p>
      <p style="font-size:0.8em; color:#888;">Enviado pelo Zeca a pedido do dono da empresa cadastrada no GuiaZap.</p>
    `;

    const respostaResend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: EMAIL_REMETENTE,
        to: [emailContador.trim()],
        subject: `Pacote do contador — ${titulo || 'GuiaZap'}`,
        html,
        attachments: anexos
      })
    });

    if (!respostaResend.ok) {
      const erroTxt = await respostaResend.text().catch(() => '');
      console.error('erro Resend', respostaResend.status, erroTxt);
      return { statusCode: 502, body: JSON.stringify({ error: 'não consegui enviar o e-mail' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ enviado: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro enviando o pacote pro contador' }) };
  }
};