// Baut eine kleine, gültige .xlsx-Klassenliste im Speicher — dieselbe Struktur wie die
// echte Zeugnistabelle (gemeinsame Zeichenketten, Formelspalte), aber mit erfundenen Namen.
// Echte Klassenlisten enthalten personenbezogene Daten und liegen nicht im Repository.
const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Schreibt ein ZIP mit deflate-komprimierten Einträgen. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const sum = crc32(data);

    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(local, 30);
    locals.push(local, deflated);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuffer.copy(central, 46);
    centrals.push(central);

    offset += local.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuffer, end]);
}

const HEADERS = [
  'Klasse', 'Name mit Rufname', 'Geschlecht (männlich/weiblich)',
  'Mitarbeit', 'Verhalten', 'Amt', 'sonstige Anmerkungen (schlechte Noten/fehlende Noten)'
];

const DEFAULT_STUDENTS = [
  { name: 'Musterfrau, Anna', gender: 'weiblich' },
  { name: 'Beispiel, Bernd', gender: 'männlich' },
  { name: 'Probst, Clara', gender: 'weiblich' }
];

/**
 * @param {Array<{name: string, gender: string}>} [studentList]
 * @returns {{buffer: Buffer, students: Array, columns: Object}}
 */
function buildClassWorkbook(studentList = DEFAULT_STUDENTS) {
  const strings = [];
  const indexOf = value => {
    let index = strings.indexOf(value);
    if (index < 0) { strings.push(value); index = strings.length - 1; }
    return index;
  };

  const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const rows = [];

  rows.push('<row r="1">' + HEADERS
    .map((header, i) => `<c r="${columns[i]}1" t="s"><v>${indexOf(header)}</v></c>`)
    .join('') + '</row>');

  studentList.forEach((student, i) => {
    const rowNumber = i + 2;
    const cells = [
      `<c r="A${rowNumber}" t="s"><v>${indexOf('IF10H')}</v></c>`,
      `<c r="B${rowNumber}" t="s"><v>${indexOf(student.name)}</v></c>`,
      `<c r="C${rowNumber}" t="s"><v>${indexOf(student.gender)}</v></c>`,
      // Mitarbeit (D), Verhalten (E) und sonstige Anmerkungen (G) sind noch leer;
      // D existiert als leere Zelle, E und G fehlen ganz — beide Fälle müssen tragen.
      `<c r="D${rowNumber}"/>`,
      `<c r="F${rowNumber}" t="s"><v>${indexOf('')}</v></c>`,
      // Formelspalte wie in der echten Tabelle, mit zwischengespeichertem alten Wert.
      `<c r="H${rowNumber}"><f>D${rowNumber}&amp;" "&amp;E${rowNumber}&amp;CHAR(10)&amp;G${rowNumber}</f><v>alt</v></c>`
    ];
    rows.push(`<row r="${rowNumber}">${cells.join('')}</row>`);
  });

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:H${studentList.length + 1}"/><sheetData>${rows.join('')}</sheetData></worksheet>`;

  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${
    strings.map(value => `<si><t xml:space="preserve">${value
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</t></si>`).join('')
  }</sst>`;

  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="IF10H" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/sharedStrings.xml', sharedStrings]
  ];

  return {
    buffer: zip(files),
    students: studentList,
    columns: { mitarbeit: 'D', verhalten: 'E', sonstige: 'G' }
  };
}

module.exports = { buildClassWorkbook, crc32 };
