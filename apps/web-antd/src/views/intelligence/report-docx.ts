import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type { ResearchEvidence, ResearchReport } from './research-reports';
import { reportDocument, reportFilename } from './report-document';

export async function reportDocx(
  report: ResearchReport,
  evidence: ResearchEvidence[],
) {
  const children = reportDocument(report, evidence).flatMap((block) => {
    if (block.kind === 'link')
      return [
        new Paragraph({
          children: [
            new ExternalHyperlink({
              link: block.url!,
              children: [
                new TextRun({
                  text: `${block.text}：${block.url}`,
                  style: 'Hyperlink',
                }),
              ],
            }),
          ],
        }),
      ];
    return block.text.split(/\r?\n/).map(
      (text, i) =>
        new Paragraph({
          ...(block.kind === 'title' && i === 0
            ? { heading: HeadingLevel.TITLE }
            : block.kind === 'heading'
              ? { heading: HeadingLevel.HEADING_1 }
              : block.kind === 'subheading'
                ? { heading: HeadingLevel.HEADING_2 }
                : {}),
          children: [
            new TextRun({
              text,
              color: '000000',
              ...(block.appendix && block.kind === 'text' ? { size: 20 } : {}),
            }),
          ],
          spacing: {
            after: block.kind === 'heading' ? 140 : block.appendix ? 70 : 100,
            line: block.appendix ? 260 : 300,
          },
          ...(block.kind === 'heading' || block.kind === 'subheading'
            ? { keepNext: true }
            : {}),
        }),
    );
  });
  const doc = new Document({
    title: report.title,
    creator: 'Luckdate 情报系统',
    styles: {
      default: {
        document: {
          run: { font: 'Microsoft YaHei', size: 22, color: '000000' },
        },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          run: { size: 36, bold: true, color: '000000' },
          paragraph: { spacing: { after: 240 } },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          run: { size: 28, bold: true, color: '000000' },
          paragraph: { spacing: { before: 220, after: 140 }, keepNext: true },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          run: { size: 24, bold: true, color: '000000' },
          paragraph: { spacing: { before: 140, after: 100 }, keepNext: true },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}
export async function downloadReport(
  report: ResearchReport,
  evidence: ResearchEvidence[],
) {
  const blob = await reportDocx(report, evidence),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = reportFilename(report, 'docx');
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
