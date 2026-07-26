// Prüft den Textbestand selbst: Wortlaut, Vollständigkeit und die Notenstufen-Leiter.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, loadCatalogue, readIndex } = require('./harness');

const { items, traits } = loadCatalogue();

function app(expose) {
  const a = loadApp({ expose: expose.concat(['computeBandCentroids']) });
  a.__setCatalogue(items, traits);
  a.computeBandCentroids();
  return a;
}

test('Katalog ist vollständig geladen', () => {
  assert.strictEqual(items.length, 69, '69 Bausteine aus ASV-Bereich 2');
  assert.deepStrictEqual(traits, [
    'Aktivitaetsniveau', 'Aufmerksamkeit', 'Lernhaltung',
    'Mitarbeit', 'Selbststaendigkeit', 'Sozialverhalten'
  ]);
});

test('Jeder Baustein hat Code, Text und Gewichte', () => {
  const codes = new Set();
  for (const { comment } of items) {
    assert.match(comment.code, /^a\d{3}[a-d]?$/, `Code unplausibel: ${comment.code}`);
    assert.ok(comment.text.trim().length > 0, `${comment.code} ohne Text`);
    assert.ok(comment.weights, `${comment.code} ohne Gewichte`);
    assert.ok(!codes.has(comment.code), `Code doppelt: ${comment.code}`);
    codes.add(comment.code);
    for (const trait of traits) {
      const value = comment.weights[trait];
      assert.ok(value === null || (typeof value === 'number' && value >= -1 && value <= 1),
        `${comment.code}.${trait} außerhalb [-1,1]: ${value}`);
    }
  }
});

test('Notenstufen-Leiter ist streng monoton', () => {
  const a = app(['LEAD_DIMENSION']);
  const centroids = loadApp({ expose: ['computeBandCentroids', 'getBands: () => bandCentroids'] });
  centroids.__setCatalogue(items, traits);
  centroids.computeBandCentroids();
  const bands = centroids.getBands();

  for (const category of Object.keys(a.LEAD_DIMENSION)) {
    const ladder = bands[category];
    const notes = Object.keys(ladder).map(Number).sort((x, y) => x - y);
    assert.deepStrictEqual(notes, [1, 2, 3, 4, 5, 6], `${category}: Stufen 1–6 erwartet`);
    for (let i = 1; i < notes.length; i++) {
      assert.ok(ladder[notes[i - 1]] > ladder[notes[i]],
        `${category}: Stufe ${notes[i - 1]} (${ladder[notes[i - 1]]}) muss über Stufe ${notes[i]} (${ladder[notes[i]]}) liegen`);
    }
  }
});

test('Stärken-Bereiche sind rein positiv, Aufforderungen rein negativ', () => {
  const polarity = {
    Fachliche_und_kognitive_Kompetenz: 1,
    Soziale_Kompetenz: 1,
    Lernverhalten_Lernkompetenz: 1,
    Aufforderung_und_Hinweise: -1
  };
  for (const [category, sign] of Object.entries(polarity)) {
    const values = items.filter(i => i.category === category)
      .flatMap(i => Object.values(i.comment.weights).filter(v => v !== null));
    assert.ok(values.length > 0, `${category} ist leer`);
    assert.ok(values.every(v => Math.sign(v) === sign),
      `${category} enthält Gewichte mit falschem Vorzeichen`);
  }
});

test('index.html lädt nichts aus dem Netz', () => {
  const src = readIndex();
  const remote = src.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
  assert.deepStrictEqual(remote, [], `Externe Ressourcen gefunden: ${remote.join(', ')}`);
  assert.ok(!/fetch\s*\(|XMLHttpRequest/.test(src), 'Kein Netzwerkzugriff zur Laufzeit erwartet');
});
