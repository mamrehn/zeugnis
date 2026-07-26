// Der Hausstil muss exakt die Formulierungen der Zeugnistabelle ergeben.
// Die Tabelle selbst enthält echte Schülerdaten und liegt deshalb nicht im Repository;
// hier stehen nur die daraus abgeleiteten Textpaare (Code -> Wortlaut je Geschlecht).
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, loadCatalogue } = require('./harness');

const { items, traits } = loadCatalogue();

// Stichproben aus der Zeugnistabelle: die vier Muster, in denen sich der Hausstil
// überhaupt von der ASV-Fassung unterscheidet, plus zwei unveränderte Gegenproben.
const HOUSE_STYLE = [
  { code: 'a201', male: 'Die Mitarbeit des Schülers war hervorragend.', female: 'Die Mitarbeit der Schülerin war hervorragend.' },
  { code: 'a206', male: 'Die Mitarbeit des Schülers war zu gering.', female: 'Die Mitarbeit der Schülerin war zu gering.' },
  { code: 'a211', male: 'Sein Verhalten war vorbildlich.', female: 'Ihr Verhalten war vorbildlich.' },
  { code: 'a213c', male: 'Sein Verhalten gab keinen Anlass zu Beanstandungen.', female: 'Ihr Verhalten gab keinen Anlass zu Beanstandungen.' },
  { code: 'a201a', male: 'Der Schüler arbeitete stets interessiert und fleißig mit.', female: 'Die Schülerin arbeitete stets interessiert und fleißig mit.' },
  { code: 'a215c', male: 'Er war sehr unruhig und musste des Öfteren ermahnt werden.', female: 'Sie war sehr unruhig und musste des Öfteren ermahnt werden.' }
];

function app() {
  const a = loadApp({ expose: ['personalizeText', 'hasUnresolvedPlaceholder'] });
  a.__setCatalogue(items, traits);
  return a;
}

test('Hausstil trifft den Wortlaut der Zeugnistabelle', () => {
  const a = app();
  for (const expected of HOUSE_STYLE) {
    const source = items.find(i => i.comment.code === expected.code);
    assert.ok(source, `Baustein ${expected.code} fehlt im Katalog`);
    assert.strictEqual(
      a.personalizeText(source.comment.text, true, 'Müller', 'house'), expected.male,
      `${expected.code} männlich`);
    assert.strictEqual(
      a.personalizeText(source.comment.text, false, 'Müller', 'house'), expected.female,
      `${expected.code} weiblich`);
  }
});

test('Hausstil lässt keinen Platzhalter und keinen unpersönlichen Satz stehen', () => {
  const a = app();
  for (const { category, comment } of items) {
    for (const male of [true, false]) {
      const text = a.personalizeText(comment.text, male, 'Müller', 'house');
      assert.ok(!a.hasUnresolvedPlaceholder(text), `${comment.code}: ${text}`);
      if (category === 'Mitarbeit' || category === 'Verhalten') {
        assert.ok(!/^Die Mitarbeit war|^Das Verhalten/.test(text),
          `${comment.code} blieb unpersönlich: ${text}`);
      }
    }
  }
});
