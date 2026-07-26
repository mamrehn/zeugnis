// Unterbereich 2.19 „Zusatzämter“: Wortlaut, Paarform und die Reihenfolge der Würdigung.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, loadCatalogue } = require('./harness');

const { items, traits } = loadCatalogue();

function app() {
  const a = loadApp({ expose: ['OFFICE_TEXTS', 'OFFICES', 'KLASSENSPRECHER_CODES', 'personalizeText'] });
  a.__setCatalogue(items, traits);
  return a;
}

// Wortlaut aus den ASV-Textvorschlägen, Stand 10.06.2026, Unterbereich 2.19.
const ASV_2_19 = {
  a219: 'Der Einsatz als Klassensprecher/in verdiente Anerkennung.',
  a219a: 'Als Klassensprecher/in setzte [er/sie] sich aktiv für die Klassengemeinschaft ein.',
  a219b: 'Als Klassensprecher/in bewies [er/sie] Engagement und Geschick.',
  a219c: '[Er/Sie] war Klassensprecher/in.',
  a219d: '[Er/Sie] war Klassen- und Tagessprecher/in.',
  a220: 'Der Einsatz als Schülersprecher/in verdient Anerkennung.',
  a220a: 'Besonders zu würdigen ist [sein/ihr] großes Engagement in der SMV.',
  a220b: 'Als Mitglied der SMV zeigte [er/sie] Engagement.',
  a221: 'Der Einsatz als Blocksprecher/in verdient Anerkennung.',
  a229: 'Besondere Anerkennung verdiente [seine/ihre] Bereitschaft, gemeinschaftsbezogene Aufgaben zu übernehmen.'
};

test('Wortlaut stimmt mit dem Katalog überein', () => {
  const a = app();
  assert.deepStrictEqual(a.OFFICE_TEXTS, ASV_2_19);
});

test('1. und 2. Klassensprecher/in teilen sich die Wortlaute', () => {
  const a = app();
  const first = a.OFFICES.find(o => o.id === 'ks1');
  const second = a.OFFICES.find(o => o.id === 'ks2');
  assert.deepStrictEqual(first.codes, second.codes,
    'Der Katalog kennt keine Ordnungszahl, also gibt es keinen zweiten Satz Wortlaute');
  assert.ok(second.note && /nicht zwischen 1\. und 2\./.test(second.note),
    'Der Unterschied muss in der Oberfläche erklärt sein');
  assert.deepStrictEqual(first.codes, ['a219a', 'a219b', 'a219', 'a219c'],
    'Reihenfolge von der stärksten Würdigung zur bloßen Feststellung');
});

test('Jedes Amt verweist nur auf vorhandene Bausteine', () => {
  const a = app();
  for (const office of a.OFFICES) {
    for (const code of office.codes) {
      assert.ok(a.OFFICE_TEXTS[code], `${office.id} verweist auf unbekannten Code ${code}`);
    }
  }
  assert.deepStrictEqual(a.OFFICES.find(o => o.id === 'none').codes, []);
});

test('Paarform wird nach Geschlecht aufgelöst', () => {
  const a = app();
  const cases = [
    ['a219c', 'Er war Klassensprecher.', 'Sie war Klassensprecherin.'],
    ['a219d', 'Er war Klassen- und Tagessprecher.', 'Sie war Klassen- und Tagessprecherin.'],
    ['a219a', 'Als Klassensprecher setzte er sich aktiv für die Klassengemeinschaft ein.',
      'Als Klassensprecherin setzte sie sich aktiv für die Klassengemeinschaft ein.'],
    ['a219b', 'Als Klassensprecher bewies er Engagement und Geschick.',
      'Als Klassensprecherin bewies sie Engagement und Geschick.'],
    ['a219', 'Der Einsatz als Klassensprecher verdiente Anerkennung.',
      'Der Einsatz als Klassensprecherin verdiente Anerkennung.'],
    ['a220', 'Der Einsatz als Schülersprecher verdient Anerkennung.',
      'Der Einsatz als Schülersprecherin verdient Anerkennung.'],
    ['a221', 'Der Einsatz als Blocksprecher verdient Anerkennung.',
      'Der Einsatz als Blocksprecherin verdient Anerkennung.']
  ];
  for (const [code, male, female] of cases) {
    assert.strictEqual(a.personalizeText(ASV_2_19[code], true, 'Müller', 'house'), male, code);
    assert.strictEqual(a.personalizeText(ASV_2_19[code], false, 'Müller', 'house'), female, code);
  }
});

test('Keine Platzhalter und keine Paarform bleiben stehen', () => {
  const a = app();
  for (const [code, text] of Object.entries(a.OFFICE_TEXTS)) {
    for (const male of [true, false]) {
      for (const style of ['house', 'name', 'role']) {
        const result = a.personalizeText(text, male, 'Müller', style);
        assert.ok(!/\[[^\]]+\]/.test(result), `${code} [${style}]: ${result}`);
        assert.ok(!/\/in\b/.test(result), `${code} [${style}] behielt die Paarform: ${result}`);
      }
    }
  }
});

test('Die fehlerhaften Zeilen der Zeugnistabelle werden nicht nachgebaut', () => {
  const a = app();
  // In der Tabelle steht in der weiblichen Spalte zweimal ein männlicher Wortlaut.
  const wrong = ['Als Klassensprecher bewies er Engagement und Geschick.', 'Sie war Klassensprecher.'];
  for (const code of a.KLASSENSPRECHER_CODES) {
    const female = a.personalizeText(a.OFFICE_TEXTS[code], false, 'Müller', 'house');
    assert.ok(!wrong.includes(female), `${code} übernimmt den Fehler der Tabelle: ${female}`);
  }
});
