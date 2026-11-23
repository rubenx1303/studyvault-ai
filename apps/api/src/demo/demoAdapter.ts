import JSZip from 'jszip';
import { classifyDocument, mimeFromName } from '../sources/classify';
import type { ProgressFn, RemoteFile, SourceAdapter, SourceInventory } from '../sources/types';
import { DEMO_LECTURES } from './demoLectures';
import { DEMO_DOCS, DEMO_MESSAGES, DEMO_SUBJECTS, DEMO_TASKS, DEMO_UNITS, type DemoDoc } from './demoContent';

const DEMO_URL = 'https://campus.demo.studyvault.local';
const day = 86_400_000;

/**
 * Fuente ficticia que imita un campus Moodle. Recorre exactamente el mismo pipeline que la fuente Moodle real
 * (inventario → diff → descarga → procesamiento → índice), pero sin red ni datos reales.
 * stage 1 = estado inicial; stage 2 = "algo ha cambiado" (documento nuevo, avisos y fecha modificada).
 */
export class DemoAdapter implements SourceAdapter {
  readonly id = 'demo-campus';
  readonly kind = 'moodle-demo';
  readonly displayName = 'Campus DEMO (ficticio)';
  readonly baseUrl = DEMO_URL;
  readonly readOnly = true as const;

  constructor(private stage: 1 | 2 = 2) {}

  async isAuthenticated() {
    return true;
  }
  async accountName() {
    return 'Alumno Demo';
  }

  async inventory(onProgress: ProgressFn = () => {}): Promise<SourceInventory> {
    const stage = this.stage;
    const pause = () => new Promise((r) => setTimeout(r, 250)); // simula latencia de red para la demo
    onProgress('Conectando con el campus de demostración…');
    await pause();
    const docs = DEMO_DOCS.filter((d) => !d.stage || d.stage <= stage);
    const now = Date.now();
    const inv: SourceInventory = {
      sourceId: this.id,
      account: 'Alumno Demo',
      generatedAt: new Date().toISOString(),
      platform: { sitename: 'Campus DEMO', release: 'Moodle 5.x (simulado)' },
      subjects: DEMO_SUBJECTS.map((s) => ({
        externalId: s.id,
        name: s.name,
        shortName: s.short,
        url: `${DEMO_URL}/course/${s.id}`,
        teachers: s.teachers,
      })),
      units: DEMO_UNITS.filter((u) => u.id !== 'ad-3' || stage >= 2).map((u) => ({
        externalId: u.id,
        subjectExternalId: u.subject,
        name: u.name,
        position: u.position,
      })),
      files: docs.map((d): RemoteFile => ({
        externalId: d.id,
        subjectExternalId: d.subject,
        unitExternalId: d.unit,
        title: d.title,
        filename: d.filename,
        mime: mimeFromName(d.filename),
        url: `${DEMO_URL}/mod/resource/${d.id}`,
        downloadRef: d.id,
        version: 'v1',
        modifiedAt: new Date(now - 10 * day).toISOString(),
        size: null,
        kindHint: classifyDocument(d.title, d.filename),
        taskExternalId: DEMO_TASKS.find((t) => t.attachment === d.id)?.id ?? null,
      })),
      tasks: DEMO_TASKS.map((t) => {
        const due = stage >= 2 && t.dueInDaysStage2 ? t.dueInDaysStage2 : t.dueInDays;
        const dueAt = new Date(Math.floor((now + due * day) / day) * day + 21 * 3600_000).toISOString();
        return {
          externalId: t.id,
          subjectExternalId: t.subject,
          unitExternalId: t.unit,
          title: t.title,
          instructionsHtml: t.html,
          openedAt: new Date(now - 14 * day).toISOString(),
          dueAt,
          cutoffAt: null,
          url: `${DEMO_URL}/mod/assign/${t.id}`,
          version: `due:${due}`,
          attachmentFileIds: t.attachment ? [t.attachment] : [],
        };
      }),
      messages: DEMO_MESSAGES.filter((m) => !m.stage || m.stage <= stage).map((m) => ({
        externalId: m.id,
        subjectExternalId: m.subject,
        kind: 'announcement' as const,
        author: m.author,
        title: m.title,
        bodyHtml: m.html,
        postedAt: new Date(now - m.daysAgo * day - 3600_000).toISOString(),
        url: `${DEMO_URL}/mod/forum/discuss/${m.id}`,
        version: 'v1',
        attachments: [],
      })),
      recordings: DEMO_LECTURES.filter((l) => !l.stage || l.stage <= stage).map((l) => ({
        externalId: l.id,
        subjectExternalId: l.subject,
        unitExternalId: l.unit,
        title: l.title,
        recordedAt: new Date(now - l.daysAgo * day - 5 * 3600_000).toISOString(),
        durationSec: Math.round(l.segments.at(-1)!.end),
        teacher: DEMO_SUBJECTS.find((x) => x.id === l.subject)?.teachers[0] ?? null,
        platform: 'demo',
        url: `${DEMO_URL}/mod/bigbluebuttonbn/${l.id}`,
        version: 'v1',
        media: 'captions' as const,
        captions: l.segments,
        demoAnalysis: { ...l.analysis, relatedMaterial: [] },
      })),
      skipped: [
        { subjectExternalId: 'prog', type: 'quiz', name: 'Cuestionario UD1', reason: 'Tipo no importado' },
      ],
      warnings: ['Modo DEMO: contenido ficticio, sin conexión a ningún campus real.'],
    };
    for (const s of inv.subjects) {
      onProgress(`Analizando «${s.name}»…`);
      await pause();
    }
    onProgress(
      `Inventario: ${inv.subjects.length} asignaturas, ${inv.files.length} ficheros, ${inv.tasks.length} tareas, ${inv.messages.length} avisos.`,
    );
    this.stage = 2;
    return inv;
  }

  async download(file: RemoteFile): Promise<Buffer> {
    const doc = DEMO_DOCS.find((d) => d.id === file.downloadRef);
    if (!doc) throw new Error('Documento demo no encontrado');
    return doc.filename.endsWith('.pdf') ? buildPdf(doc) : buildDocx(doc);
  }
}

async function buildPdf(doc: DemoDoc): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setAuthor('StudyVault DEMO (contenido ficticio)');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  doc.pages.forEach((text, i) => {
    const page = pdf.addPage([595, 842]);
    let y = 790;
    page.drawText(`${doc.title} — DEMO ficticia`, {
      x: 50,
      y: 815,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    page.drawText(`Página ${i + 1}`, { x: 500, y: 30, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    for (const raw of text.split('\n')) {
      const isCode = /^\s{2,}|[;{}]\s*$|^(public|try|String|List|for|PreparedStatement|ResultSet)\b/.test(
        raw,
      );
      const isHeading = /^(\d+\.|Unidad \d)/.test(raw);
      const f = isCode ? mono : isHeading ? bold : font;
      const size = isHeading ? 12 : isCode ? 9 : 10.5;
      for (const line of wrap(toWinAnsi(raw), f, size, 495)) {
        page.drawText(line, { x: 50, y, size, font: f });
        y -= size + 5;
      }
      if (raw === '') y -= 4;
    }
  });
  return Buffer.from(await pdf.save());
}

function wrap(
  text: string,
  font: { widthOfTextAtSize(t: string, s: number): number },
  size: number,
  max: number,
): string[] {
  if (!text) return [''];
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  out.push(line);
  return out;
}

const toWinAnsi = (s: string) =>
  s
    .replace(/[→]/g, '->')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/[^\x20-\xFF\n]/g, '');

async function buildDocx(doc: DemoDoc): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = doc.pages.flatMap((section) =>
    section
      .split('\n')
      .map((line) =>
        line.startsWith('## ')
          ? `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">${esc(line.slice(3))}</w:t></w:r></w:p>`
          : `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`,
      ),
  );
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${esc(doc.title)} (DEMO ficticia)</w:t></w:r></w:p>${paras.join('')}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
