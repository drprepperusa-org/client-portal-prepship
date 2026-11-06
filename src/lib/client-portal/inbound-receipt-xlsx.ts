import JSZip from 'jszip';
import { inboundReceiptExportHeaders } from './inbound-receipt-csv';

export const INBOUND_RECEIPT_XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const widths = [14, 26, 34, 76, 22, 32];
const xml = (value: string) => value.replace(/_x[0-9a-f]{4}_/gi, match => '_x005F_' + match.slice(1))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, c => `_x${c.charCodeAt(0).toString(16).padStart(4, '0')}_`)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Formatting only: values already come from the scoped receipt export owner.
 * Explicit inline strings prevent SKU/product text from being executed as formulas.
 * UTC timestamps retain the canonical ISO text, including milliseconds.
 */
export async function renderInboundReceiptXlsx(rows: Array<Array<string | number | null>>) {
  const data = [inboundReceiptExportHeaders, ...rows];
  const sheetRows = data.map((row, index) => {
    const lines = Math.max(1, ...row.map((value, column) => String(value ?? '').split(/\r?\n/)
      .reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / (widths[column]! * 0.7))), 0)));
    const height = index === 0 ? 30 : Math.min(409, Math.max(28, lines * 16 + 8));
    const cells = row.map((value, column) => {
      const address = `${String.fromCharCode(65 + column)}${index + 1}`;
      if (typeof value === 'number') return `<c r="${address}" s="0"><v>${value}</v></c>`;
      return `<c r="${address}" s="${index === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value ?? '')}</t></is></c>`;
    }).join('');
    return `<row r="${index + 1}" ht="${height}" customHeight="1">${cells}</row>`;
  }).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Inbound receipts" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<styleSheet xmlns="${ns}">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${ns}"><dimension ref="A1:F${data.length}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
<sheetData>${sheetRows}</sheetData><autoFilter ref="A1:F${data.length}"/></worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
