// Echter Browser-Durchlauf mit Chromium. Prüft das, was ein DOM-Stub nicht kann:
// dass die Seite ohne Fehler rendert, offline funktioniert und die Bedienung greift.
// Ohne installiertes Playwright werden die Tests übersprungen statt zu scheitern.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { INDEX } = require('./harness');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  // Playwright ist optional; siehe skip unten.
}

const options = { skip: chromium ? false : 'Playwright ist nicht installiert (npm i -D playwright)' };
const FILE_URL = 'file://' + path.resolve(INDEX);

/** Startet einen Browser, der jede Netzwerkanfrage nach außen als Fehler behandelt. */
async function openApp() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const externalRequests = [];
  const pageErrors = [];

  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('file://') || url.startsWith('data:') || url === 'about:blank') {
      return route.continue();
    }
    externalRequests.push(url);
    return route.abort();
  });

  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });

  await page.goto(FILE_URL);
  return { browser, page, externalRequests, pageErrors };
}

test('Seite lädt fehlerfrei und ohne Netzwerkzugriff', options, async () => {
  const { browser, page, externalRequests, pageErrors } = await openApp();
  try {
    assert.deepStrictEqual(externalRequests, [], 'Die Seite darf nichts nachladen');
    assert.deepStrictEqual(pageErrors, [], 'Keine Laufzeitfehler erwartet');

    // Ohne Tailwind-CDN muss das lokale CSS greifen: die Karte ist zentriert und begrenzt.
    const card = page.locator('.max-w-4xl').first();
    const box = await card.boundingBox();
    assert.ok(box.width <= 56 * 16 + 1, `max-w-4xl wirkt nicht, Breite ${box.width}`);

    const sliders = page.locator('#traitsContainer input[type="range"]');
    assert.strictEqual(await sliders.count(), 6, 'Sechs Dimensionen erwartet');
  } finally {
    await browser.close();
  }
});

test('Die Punkteleiste ist genau so breit wie der Regler', options, async () => {
  const { browser, page } = await openApp();
  try {
    const THUMB = 10; // halber Reglerknopf: so weit ist die Leiste eingerückt
    for (const trait of ['Mitarbeit', 'Sozialverhalten', 'Selbststaendigkeit']) {
      const slider = await page.locator(`#${trait}`).boundingBox();
      const scale = await page.locator(`#${trait}`).locator('xpath=../..')
        .locator('.ihk-scale').boundingBox();

      assert.ok(scale.x >= slider.x - 0.5,
        `${trait}: Leiste ragt links hinaus (${scale.x} < ${slider.x})`);
      assert.ok(scale.x + scale.width <= slider.x + slider.width + 0.5,
        `${trait}: Leiste ragt rechts hinaus (${scale.x + scale.width} > ${slider.x + slider.width})`);

      // Und sie soll auch nicht deutlich schmaler sein als der Reglerweg.
      assert.ok(Math.abs(scale.x - (slider.x + THUMB)) <= 1.5,
        `${trait}: linke Kante sitzt falsch (${scale.x} statt ${slider.x + THUMB})`);
      assert.ok(Math.abs((scale.x + scale.width) - (slider.x + slider.width - THUMB)) <= 1.5,
        `${trait}: rechte Kante sitzt falsch`);
    }
  } finally {
    await browser.close();
  }
});

test('Überschriften der Gruppen sind lesbar geschrieben', options, async () => {
  const { browser, page } = await openApp();
  try {
    await page.fill('#lastName', 'Müller');
    await page.selectOption('#punctuality', 'pu1');
    await page.selectOption('#office', 'ks1');
    await page.click('#generateSuggestions');
    await page.waitForSelector('#results .suggestion-text-and-button');

    const heads = (await page.locator('#results .result-box h3').allTextContents())
      .map(h => h.trim());
    assert.ok(heads.some(h => h === 'Pünktlichkeit'), `Pünktlichkeit fehlt: ${heads}`);
    assert.ok(heads.some(h => h === 'Zusatzämter'), `Zusatzämter fehlt: ${heads}`);
    for (const head of heads) {
      assert.ok(!/ae|oe|ue/.test(head), `Umschrift in der Überschrift: ${head}`);
    }
  } finally {
    await browser.close();
  }
});

test('Regler starten vorbelegt an der Grenze 3/4', options, async () => {
  const { browser, page } = await openApp();
  try {
    const boxes = page.locator('#traitsContainer .trait-enable');
    for (let i = 0; i < await boxes.count(); i++) {
      assert.strictEqual(await boxes.nth(i).isChecked(), true, `Kästchen ${i} nicht vorbelegt`);
    }
    const slider = page.locator('#Mitarbeit');
    assert.strictEqual(await slider.inputValue(), '67');
    const caption = await page.locator('#MitarbeitDescription').textContent();
    assert.match(caption, /Befriedigend \(Stufe 3\)/);
    assert.match(caption, /Grenze zu Stufe 4/);
  } finally {
    await browser.close();
  }
});

test('Vorschläge erscheinen und bieten an der Bandgrenze beide Stufen an', options, async () => {
  const { browser, page, pageErrors } = await openApp();
  try {
    await page.fill('#lastName', 'Müller');
    await page.click('#generateSuggestions');
    await page.waitForSelector('#results .suggestion-text-and-button');

    const badges = await page.locator('#results .grade-badge').allTextContents();
    const mitarbeit = badges.filter(b => /a20/.test(b));
    assert.ok(mitarbeit.some(b => /Stufe 3/.test(b)), `Stufe 3 fehlt: ${mitarbeit}`);
    assert.ok(mitarbeit.some(b => /Stufe 4/.test(b)), `Stufe 4 fehlt: ${mitarbeit}`);
    assert.deepStrictEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});

test('"+" korrigiert die Einstufung und zieht den Regler mit', options, async () => {
  const { browser, page } = await openApp();
  try {
    await page.fill('#lastName', 'Müller');
    await page.click('#generateSuggestions');
    await page.waitForSelector('#results .suggestion-text-and-button');

    const before = await page.locator('#Mitarbeit').inputValue();
    await page.locator('#results .result-box').first().locator('.quality-btn.better').first().click();

    const after = await page.locator('#Mitarbeit').inputValue();
    assert.ok(parseFloat(after) > parseFloat(before),
      `Regler muss nach oben wandern: ${before} -> ${after}`);

    const header = await page.locator('#results .result-box').first().locator('h3').textContent();
    assert.match(header, /Notenstufe 2/, `Kopfzeile nicht mitgezogen: ${header}`);
  } finally {
    await browser.close();
  }
});

test('Die Pünktlichkeitsauswahl nennt die Schwelle und ergänzt den Satz', options, async () => {
  const { browser, page } = await openApp();
  try {
    await page.fill('#lastName', 'Müller');

    const options_ = await page.locator('#punctuality option').allTextContents();
    assert.deepStrictEqual(options_, [
      'keine Bemerkung zur Pünktlichkeit',
      'ab 5 Verspätungen: Die Pünktlichkeit ließ zu wünschen übrig.',
      'ab 10 Verspätungen: Die Pünktlichkeit ließ stark zu wünschen übrig.'
    ]);

    await page.selectOption('#punctuality', 'pu1');
    await page.click('#generateSuggestions');
    await page.waitForSelector('#results .suggestion-text-and-button');
    let texts = await page.locator('#results .suggestion-text').allTextContents();
    assert.ok(texts.some(t => t === 'Die Pünktlichkeit ließ zu wünschen übrig.'),
      `Erste Eskalationsstufe fehlt: ${texts.join(' | ')}`);

    await page.selectOption('#punctuality', 'pu2');
    await page.click('#generateSuggestions');
    await page.waitForSelector('#results .suggestion-text-and-button');
    texts = await page.locator('#results .suggestion-text').allTextContents();
    assert.ok(texts.some(t => t === 'Die Pünktlichkeit ließ stark zu wünschen übrig.'),
      `Zweite Eskalationsstufe fehlt: ${texts.join(' | ')}`);
  } finally {
    await browser.close();
  }
});

test('Die getroffene Wahl ist sichtbar und lässt sich zurücknehmen', options, async () => {
  const { browser, page, pageErrors } = await openApp();
  try {
    await page.fill('#lastName', 'Müller');
    await page.click('#generateSuggestions');
    await page.waitForSelector('#results .suggestion-text-and-button');

    const box = page.locator('#results .result-box').first();
    const rows = box.locator('.suggestion-text-and-button');

    // Vor der Wahl ist nichts markiert und die Bemerkung ist leer.
    assert.strictEqual(await box.locator('.chosen').count(), 0);
    assert.strictEqual(await page.locator('#bemerkungPanel').isVisible(), false);

    const firstText = (await rows.nth(0).locator('.suggestion-text').textContent()).trim();
    await rows.nth(0).locator('.save-btn').click();

    assert.ok(await rows.nth(0).evaluate(el => el.classList.contains('chosen')),
      'Der gewählte Satz muss markiert sein');
    assert.match(await rows.nth(0).locator('.save-btn').textContent(), /Übernommen/);
    assert.strictEqual(await box.locator('.chosen').count(), 1);
    assert.strictEqual((await page.textContent('#bemerkungText')).trim(), firstText);
    assert.match(await box.locator('.category-choice').textContent(), /\u2713/);

    // Ein zweiter Satz derselben Gruppe ersetzt den ersten, statt ihn zu ergänzen.
    const secondText = (await rows.nth(1).locator('.suggestion-text').textContent()).trim();
    await rows.nth(1).locator('.save-btn').click();
    assert.strictEqual(await box.locator('.chosen').count(), 1, 'Nur einer je Unterbereich');
    assert.ok(await rows.nth(1).evaluate(el => el.classList.contains('chosen')));
    assert.strictEqual((await page.textContent('#bemerkungText')).trim(), secondText);

    // Noch einmal auf denselben Satz nimmt die Wahl zurück.
    await rows.nth(1).locator('.save-btn').click();
    assert.strictEqual(await box.locator('.chosen').count(), 0);
    assert.strictEqual(await page.locator('#bemerkungPanel').isVisible(), false);

    assert.deepStrictEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});

test('Die Bemerkung wächst in Katalogreihenfolge mit', options, async () => {
  const { browser, page } = await openApp();
  try {
    await page.fill('#lastName', 'Müller');
    await page.click('#generateSuggestions');
    await page.waitForSelector('#results .suggestion-text-and-button');

    const boxes = page.locator('#results .result-box');
    // Verhalten (a21x) zuerst anklicken, Mitarbeit (a20x) danach.
    const verhalten = (await boxes.nth(1).locator('.suggestion-text').first().textContent()).trim();
    await boxes.nth(1).locator('.save-btn').first().click();
    const mitarbeit = (await boxes.nth(0).locator('.suggestion-text').first().textContent()).trim();
    await boxes.nth(0).locator('.save-btn').first().click();

    assert.strictEqual((await page.textContent('#bemerkungText')).trim(),
      `${mitarbeit} ${verhalten}`, 'Mitarbeit muss trotz späterer Wahl vorne stehen');
    assert.match(await page.textContent('#bemerkungMeta'), /2 Sätze, \d+ Zeichen/);
  } finally {
    await browser.close();
  }
});

test('Übernommene Sätze landen in der Gesamtbemerkung', options, async () => {
  const { browser, page } = await openApp();
  try {
    await page.fill('#lastName', 'Müller');
    await page.click('#generateSuggestions');
    await page.waitForSelector('#results .suggestion-text-and-button');

    const boxes = page.locator('#results .result-box');
    for (let i = 0; i < Math.min(2, await boxes.count()); i++) {
      await boxes.nth(i).locator('.save-btn').first().click();
    }
    await page.click('#showSavedTexts');
    await page.waitForSelector('#savedTextsTableContainer table');

    const combined = await page.locator('.combined-text-display').first().textContent();
    assert.ok(combined.includes('Mitarbeit') || combined.includes('Verhalten'),
      `Gesamtbemerkung unerwartet: ${combined}`);
    // Reihenfolge des Katalogs: Mitarbeit (a20x) steht vor Verhalten (a21x).
    const mitarbeitFirst = combined.indexOf('Mitarbeit');
    const verhalten = combined.indexOf('Verhalten');
    if (mitarbeitFirst !== -1 && verhalten !== -1) {
      assert.ok(mitarbeitFirst < verhalten, `Reihenfolge falsch: ${combined}`);
    }
  } finally {
    await browser.close();
  }
});
