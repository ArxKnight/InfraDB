import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  HeadingLevel,
  BorderStyle,
} from 'docx';

export type SidIndexReportRow = {
  sidNumber: string;
  hostname: string;
  status: string;
  locationPath: string;
  primaryIp: string;
};

export type CableTraceHopReport = {
  hostname: string;
  sidNumber: string;
  manufacturer: string;
  modelName: string;
  rackUText: string;
  rackLocation: string;
  connectedPort: string;
};

export type CableTraceReportItem = {
  cableRef: string;
  hops: CableTraceHopReport[];
  error?: string;
};

export type VisualRackOccupantReport = {
  uPosition: number;
  rackUnits: number;
  sidNumber: string;
  hostname: string;
};

export type VisualRackReportRack = {
  rackLocation: string;
  rackSizeU: number;
  occupants: VisualRackOccupantReport[];
};

function p(text: string, opts?: { bold?: boolean; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; after?: number }) {
  return new Paragraph({
    ...(opts?.heading ? { heading: opts.heading } : {}),
    spacing: { after: opts?.after ?? 120 },
    children: [new TextRun({ text, ...(opts?.bold ? { bold: true } : {}) })],
  });
}

function tableBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
    left: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
    right: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
    insideVertical: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' },
  };
}

function headerCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
  });
}

function bodyCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph(String(text ?? ''))],
  });
}

export async function buildSidIndexReportDocxBuffer(params: {
  siteName: string;
  siteCode: string;
  createdAtText: string;
  rows: SidIndexReportRow[];
}): Promise<Buffer> {
  const { siteName, siteCode, createdAtText, rows } = params;

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [
      new TableRow({
        children: [
          headerCell('SID'),
          headerCell('Hostname'),
          headerCell('Status'),
          headerCell('Location'),
          headerCell('Primary IP'),
        ],
      }),
      ...rows.map((r) =>
        new TableRow({
          children: [
            bodyCell(r.sidNumber),
            bodyCell(r.hostname),
            bodyCell(r.status),
            bodyCell(r.locationPath),
            bodyCell(r.primaryIp),
          ],
        }),
      ),
    ],
  });

  const doc = new Document({
    sections: [
      {
        children: [
          p('InfraDB – SID Index Report', { heading: HeadingLevel.TITLE, bold: true, after: 180 }),
          p(`Site: ${siteName} (${siteCode})`, { after: 60 }),
          p(`Report Generated on: ${createdAtText}`, { after: 180 }),
          table,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export async function buildCableTraceReportDocxBuffer(params: {
  siteName: string;
  siteCode: string;
  createdAtText: string;
  items: CableTraceReportItem[];
}): Promise<Buffer> {
  const { siteName, siteCode, createdAtText, items } = params;

  const children: Paragraph[] = [
    p('InfraDB – Cable Trace Report', { heading: HeadingLevel.TITLE, bold: true, after: 180 }),
    p(`Site: ${siteName} (${siteCode})`, { after: 60 }),
    p(`Report Generated on: ${createdAtText}`, { after: 220 }),
  ];

  for (const item of items) {
    children.push(p(`Cable Ref ${item.cableRef}`, { heading: HeadingLevel.HEADING_1, bold: true, after: 100 }));

    if (item.error) {
      children.push(p(`Error: ${item.error}`, { after: 180 }));
      continue;
    }

    if (!item.hops.length) {
      children.push(p('No hops resolved.', { after: 180 }));
      continue;
    }

    item.hops.forEach((hop, index) => {
      if (index === 0) children.push(p('Source', { bold: true, after: 40 }));
      const indexLabel = `${index + 1}.`;
      children.push(p(`${indexLabel} ${hop.hostname} (SID: ${hop.sidNumber})`, { bold: true, after: 40 }));
      children.push(p(`${hop.manufacturer} - ${hop.modelName} | (${hop.rackUText})`, { after: 40 }));
      children.push(p(hop.rackLocation, { after: 40 }));
      children.push(p(`Connected Port: ${hop.connectedPort}`, { after: 100 }));
      if (index === item.hops.length - 1) children.push(p('Destination', { bold: true, after: 120 }));
    });
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}

export async function buildVisualRackReportDocxBuffer(params: {
  siteName: string;
  siteCode: string;
  createdAtText: string;
  racks: VisualRackReportRack[];
}): Promise<Buffer> {
  const { siteName, siteCode, createdAtText, racks } = params;

  const children: (Paragraph | Table)[] = [
    p('InfraDB – Visual Rack Report', { heading: HeadingLevel.TITLE, bold: true, after: 180 }),
    p(`Site: ${siteName} (${siteCode})`, { after: 60 }),
    p(`Report Generated on: ${createdAtText}`, { after: 220 }),
  ];

  for (const rack of racks) {
    children.push(p(`Rack - ${rack.rackLocation} (${rack.rackSizeU}U)`, { heading: HeadingLevel.HEADING_1, bold: true, after: 100 }));

    const occupantsByUnit = new Map<number, string>();
    for (const occ of rack.occupants) {
      const units = Number.isFinite(occ.rackUnits) && occ.rackUnits > 0 ? occ.rackUnits : 1;
      for (let i = 0; i < units; i += 1) {
        occupantsByUnit.set(occ.uPosition - i, `${occ.hostname} (SID: ${occ.sidNumber})`);
      }
    }

    const rows: TableRow[] = [
      new TableRow({ children: [headerCell('U Position'), headerCell('Occupant')] }),
    ];

    for (let unit = rack.rackSizeU; unit >= 1; unit -= 1) {
      rows.push(
        new TableRow({
          children: [
            bodyCell(`U${unit}`),
            bodyCell(occupantsByUnit.get(unit) ?? ''),
          ],
        }),
      );
    }

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: tableBorders(),
        rows,
      }),
    );

    children.push(new Paragraph({ spacing: { after: 180 }, children: [] }));
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
