// Gera um PDF simples a partir de um texto — usado pelo botão "baixar em
// PDF" que aparece embaixo de qualquer resposta do Zeca (dica de
// currículo, resposta do modo geral, etc.). Sem banco de dados envolvido,
// sem limite próprio — é só formatação, não chama nenhuma IA de novo.
//
// Devolve o PDF já pronto em base64 (isBase64Encoded: true), pro
// navegador baixar direto — nada fica salvo no servidor.

const { PDFDocument, StandardFonts, rgb, layoutMultilineText } = require('pdf-lib');

const LARGURA_PAGINA = 595; // A4 em pontos
const ALTURA_PAGINA = 842;
const MARGEM = 50;
const LARGURA_UTIL = LARGURA_PAGINA - MARGEM * 2;

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
    }

    const { texto, titulo } = JSON.parse(event.body || '{}');
    if (!texto || !texto.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'texto é obrigatório' }) };
    }
    // Texto bem grande vira PDF gigante — limita a um tamanho razoável
    const textoLimitado = texto.slice(0, 8000);

    const doc = await PDFDocument.create();
    const fonteNormal = await doc.embedFont(StandardFonts.Helvetica);
    const fonteNegrito = await doc.embedFont(StandardFonts.HelveticaBold);

    let pagina = doc.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
    let cursorY = ALTURA_PAGINA - MARGEM;

    function novaPaginaSeNecessario(alturaNecessaria) {
      if (cursorY - alturaNecessaria < MARGEM) {
        pagina = doc.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
        cursorY = ALTURA_PAGINA - MARGEM;
      }
    }

    // Cabeçalho: título + marca d'água discreta do GuiaZap
    const tituloFinal = (titulo || 'Documento gerado pelo Zeca').slice(0, 90);
    pagina.drawText(tituloFinal, { x: MARGEM, y: cursorY, size: 16, font: fonteNegrito, color: rgb(0.1, 0.1, 0.1) });
    cursorY -= 22;
    pagina.drawText('Gerado pelo Zeca — guiazap.shop', { x: MARGEM, y: cursorY, size: 9, font: fonteNormal, color: rgb(0.55, 0.55, 0.55) });
    cursorY -= 26;

    // Corpo — quebra em parágrafos (linha em branco no texto original vira
    // espaço extra entre parágrafos) e cada parágrafo quebra de linha
    // automaticamente pra caber na largura da página.
    const TAMANHO_FONTE = 11;
    const ALTURA_LINHA = 15;
    const paragrafos = textoLimitado.split(/\n+/).filter(p => p.trim());

    for (const paragrafo of paragrafos) {
      const layout = layoutMultilineText(paragrafo.trim(), {
        font: fonteNormal,
        fontSize: TAMANHO_FONTE,
        bounds: { width: LARGURA_UTIL, height: ALTURA_PAGINA }
      });

      for (const linha of layout.lines) {
        novaPaginaSeNecessario(ALTURA_LINHA);
        pagina.drawText(linha.text, { x: MARGEM, y: cursorY, size: TAMANHO_FONTE, font: fonteNormal, color: rgb(0.15, 0.15, 0.15) });
        cursorY -= ALTURA_LINHA;
      }
      cursorY -= 8; // respiro entre parágrafos
    }

    const bytesPdf = await doc.save();
    const base64Pdf = Buffer.from(bytesPdf).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="zeca.pdf"'
      },
      body: base64Pdf,
      isBase64Encoded: true
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'erro ao gerar PDF' }) };
  }
};