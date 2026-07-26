// Ende-zu-Ende im echten Browser: Klassenliste einlesen, mehrere Schüler bearbeiten,
// Datei speichern und die geschriebenen Zellen wieder auslesen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { INDEX } = require('./harness');
const { buildClassWorkbook } = require('./fixture');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* optional */ }
const options = { skip: chromium ? false : 'Playwright ist nicht installiert (npm i -D playwright)' };

/** Liest ein ZIP mit gespeicherten oder komprimierten Einträgen. */
function unzip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'Keine ZIP-Struktur in der Ausgabedatei');

  const count = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let n = 0; n < count; n++) {
    assert.strictEqual(buffer.readUInt32LE(pointer), 0x02014b50, 'Zentralverzeichnis beschädigt');
    const method = buffer.readUInt16LE(pointer + 10);
    const storedCrc = buffer.readUInt32LE(pointer + 16);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    const data = method === 0 ? raw : zlib.inflateRawSync(raw);

    const { crc32 } = require('./fixture');
    assert.strictEqual(crc32(data), storedCrc, `Prüfsumme falsch für ${name}`);

    entries.set(name, data.toString('utf8'));
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Inhalt einer Zelle aus dem Blatt-XML (nur Inline-Text und leere Zellen). */
function cellOf(sheetXml, reference) {
  const match = sheetXml.match(new RegExp(`<c r="${reference}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`));
  if (!match) return null;
  if (!match[1]) return '';
  const texts = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]);
  return texts.join('');
}

async function openWithClassList(students) {
  const { buffer, columns } = buildClassWorkbook(students);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zeugnis-'));
  const file = path.join(directory, 'klasse.xlsx');
  fs.writeFileSync(file, buffer);

  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const pageErrors = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    return url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')
      ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

  await page.goto('file://' + path.resolve(INDEX));
  await page.setInputFiles('#classFileInput', file);
  await page.waitForSelector('#classPanel .student-chip');
  return { browser, page, pageErrors, directory, columns };
}

/** Übernimmt den ersten Vorschlag aus den angegebenen Kategorien. */
async function acceptFirstSuggestions(page, count) {
  await page.waitForSelector('#results .suggestion-text-and-button');
  const boxes = page.locator('#results .result-box');
  const total = Math.min(count, await boxes.count());
  const texts = [];
  for (let i = 0; i < total; i++) {
    texts.push((await boxes.nth(i).locator('.suggestion-text').first().textContent()).trim());
    await boxes.nth(i).locator('.save-btn').first().click();
  }
  return texts;
}

test('Klassenliste wird eingelesen, Namen und Anrede übernommen', options, async () => {
  const { browser, page, pageErrors, directory } = await openWithClassList();
  try {
    const chips = await page.locator('.student-chip').allTextContents();
    assert.deepStrictEqual(chips, ['Musterfrau, Anna', 'Beispiel, Bernd', 'Probst, Clara']);

    // Erste Person ist weiblich: Nachname gesetzt, Anrede automatisch umgestellt.
    assert.strictEqual(await page.inputValue('#lastName'), 'Musterfrau');
    assert.ok(await page.locator('#genderFemale').evaluate(el => el.classList.contains('active')));

    await page.locator('.student-chip').nth(1).click();
    assert.strictEqual(await page.inputValue('#lastName'), 'Beispiel');
    assert.ok(await page.locator('#genderMale').evaluate(el => el.classList.contains('active')));

    assert.deepStrictEqual(pageErrors, []);
  } finally {
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Der Zustand bleibt beim Wechseln zwischen Schülern erhalten', options, async () => {
  const { browser, page, directory } = await openWithClassList();
  try {
    await page.fill('#Mitarbeit', '95');
    await page.locator('#Mitarbeit').dispatchEvent('input');
    await page.locator('.student-chip').nth(1).click();
    assert.strictEqual(await page.inputValue('#Mitarbeit'), '67', 'Neue Person startet neutral');

    await page.locator('.student-chip').nth(0).click();
    assert.strictEqual(await page.inputValue('#Mitarbeit'), '95', 'Einstellung ging verloren');
  } finally {
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Fortschritt zeigt, wer fertig ist', options, async () => {
  const { browser, page, directory } = await openWithClassList();
  try {
    assert.match(await page.textContent('#classProgress'), /0 von 3 fertig/);
    await acceptFirstSuggestions(page, 2); // Mitarbeit und Verhalten
    assert.match(await page.textContent('#classProgress'), /1 von 3 fertig/);
    assert.ok(await page.locator('.student-chip').nth(0).evaluate(el => el.classList.contains('done')));
    assert.ok(!await page.locator('.student-chip').nth(1).evaluate(el => el.classList.contains('done')));
  } finally {
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Export schreibt die Sätze in die richtigen Zeilen und Spalten', options, async () => {
  const { browser, page, pageErrors, directory, columns } = await openWithClassList();
  try {
    // Person 1: Mitarbeit und Verhalten übernehmen.
    const first = await acceptFirstSuggestions(page, 2);

    // Person 3: andere Einstufung, zusätzlich ein Pünktlichkeitssatz in Spalte L.
    await page.locator('.student-chip').nth(2).click();
    await page.fill('#Mitarbeit', '95');
    await page.locator('#Mitarbeit').dispatchEvent('input');
    await page.fill('#lateArrivals', '10');
    await page.click('#generateSuggestions');
    const third = await acceptFirstSuggestions(page, 3);

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportClass')
    ]).then(([d]) => d);

    assert.match(download.suggestedFilename(), /klasse_bearbeitet\.xlsx$/);
    const saved = path.join(directory, 'out.xlsx');
    await download.saveAs(saved);

    const entries = unzip(fs.readFileSync(saved));
    const sheet = entries.get('xl/worksheets/sheet1.xml');
    assert.ok(sheet, 'Blatt fehlt in der Ausgabe');

    // Zeile 2 = erste Person, Zeile 4 = dritte Person.
    assert.strictEqual(cellOf(sheet, `${columns.mitarbeit}2`), first[0]);
    assert.strictEqual(cellOf(sheet, `${columns.verhalten}2`), first[1]);
    assert.strictEqual(cellOf(sheet, `${columns.mitarbeit}4`), third[0]);
    assert.strictEqual(cellOf(sheet, `${columns.verhalten}4`), third[1]);
    assert.strictEqual(cellOf(sheet, `${columns.sonstige}4`),
      'Die Pünktlichkeit ließ stark zu wünschen übrig.');

    // Unbearbeitete Person bleibt leer, statt irgendetwas zu erfinden.
    assert.strictEqual(cellOf(sheet, `${columns.mitarbeit}3`), '');
    assert.strictEqual(cellOf(sheet, `${columns.verhalten}3`), '');

    // Die Person 1 hat keine Verspätungen: Spalte L bleibt leer.
    assert.strictEqual(cellOf(sheet, `${columns.sonstige}2`), '');

    assert.deepStrictEqual(pageErrors, []);
  } finally {
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Export erhält Struktur, Formeln und Namen der Ausgangsdatei', options, async () => {
  const { browser, page, directory } = await openWithClassList();
  try {
    await acceptFirstSuggestions(page, 2);
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportClass')
    ]).then(([d]) => d);
    const saved = path.join(directory, 'out.xlsx');
    await download.saveAs(saved);

    const original = unzip(buildClassWorkbook().buffer);
    const written = unzip(fs.readFileSync(saved));

    assert.deepStrictEqual([...written.keys()].sort(), [...original.keys()].sort(),
      'Es müssen genau dieselben Bestandteile enthalten sein');
    assert.strictEqual(written.get('xl/sharedStrings.xml'), original.get('xl/sharedStrings.xml'),
      'Die Zeichenkettentabelle darf unverändert bleiben');

    const sheet = written.get('xl/worksheets/sheet1.xml');
    assert.match(sheet, /<f>D2&amp;" "&amp;E2/, 'Formel der Bemerkungsspalte ging verloren');
    assert.match(sheet, /Musterfrau, Anna|<v>\d+<\/v>/, 'Namensspalte ging verloren');
    assert.match(written.get('xl/workbook.xml'), /fullCalcOnLoad="1"/,
      'Ohne Neuberechnung stünde in der Formelspalte noch der alte Wert');
  } finally {
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Eine Datei ohne passende Spalten wird verständlich abgelehnt', options, async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zeugnis-'));
  try {
    await page.goto('file://' + path.resolve(INDEX));
    const file = path.join(directory, 'falsch.xlsx');
    fs.writeFileSync(file, Buffer.from('das ist kein zip', 'utf8'));
    await page.setInputFiles('#classFileInput', file);

    const message = page.locator('#messageBox');
    await message.waitFor({ state: 'visible' });
    assert.match(await message.textContent(), /xlsx|ZIP/i);
    assert.strictEqual(await page.locator('#classPanel').isVisible(), false);
  } finally {
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
