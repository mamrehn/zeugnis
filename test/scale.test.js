// Prüft die IHK-Punkteskala, die Zuordnung auf ASV-Notenstufen und die Pünktlichkeitssätze.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, loadCatalogue } = require('./harness');

const { items, traits } = loadCatalogue();

function app() {
  const a = loadApp({
    expose: ['IHK_BANDS', 'DEFAULT_POINTS', 'POINT_STEP', 'ihkBand', 'bandMidPoints',
      'pointsToWeight', 'impliedBand', 'computeBandCentroids', 'nextBandWithTexts',
      'punctualityLabel', 'PUNCTUALITY_PHRASES', 'rankSuggestions', 'LEAD_DIMENSION']
  });
  a.__setCatalogue(items, traits);
  a.computeBandCentroids();
  return a;
}

test('IHK-Tabelle deckt 0–100 lückenlos und überschneidungsfrei ab', () => {
  const a = app();
  const bands = a.IHK_BANDS.slice().sort((x, y) => x.min - y.min);
  assert.strictEqual(bands[0].min, 0);
  assert.strictEqual(bands[bands.length - 1].max, 100);
  for (let i = 1; i < bands.length; i++) {
    const gap = bands[i].min - bands[i - 1].max;
    assert.strictEqual(gap, 1, `Lücke zwischen ${bands[i - 1].label} und ${bands[i].label}`);
  }
});

test('Bandgrenzen der IHK-Tabelle werden exakt getroffen', () => {
  const a = app();
  const cases = [
    [100, 1], [92, 1], [91, 2], [81, 2], [80, 3],
    [67, 3], [66, 4], [50, 4], [49, 5], [30, 5], [29, 6], [0, 6]
  ];
  for (const [points, note] of cases) {
    assert.strictEqual(a.ihkBand(points).note, note, `${points} Punkte -> Stufe ${note}`);
  }
});

test('Startwert ist die Grenze zwischen Stufe 3 und Stufe 4', () => {
  const a = app();
  assert.strictEqual(a.DEFAULT_POINTS, 67);
  assert.strictEqual(a.ihkBand(a.DEFAULT_POINTS).note, 3);
  assert.strictEqual(a.ihkBand(a.DEFAULT_POINTS - a.POINT_STEP).note, 4,
    'Ein Schritt nach unten muss in Stufe 4 führen');
});

test('Am Startwert stehen Stufe 3 und Stufe 4 nebeneinander zur Wahl', () => {
  const a = app();
  const weights = { Mitarbeit: a.pointsToWeight('Mitarbeit', a.DEFAULT_POINTS) };
  const bands = { Mitarbeit: a.ihkBand(a.DEFAULT_POINTS).note };
  const borders = { Mitarbeit: 4 };
  const ranked = a.rankSuggestions(weights, false, false, bands, borders).Mitarbeit || [];
  const offered = new Set(ranked.map(i => parseInt(i.grade, 10)));
  assert.ok(offered.has(3), 'Stufe-3-Baustein erwartet');
  assert.ok(offered.has(4), 'Stufe-4-Baustein erwartet');
});

test('Punktwert und daraus abgeleitetes Gewicht bleiben in derselben Notenstufe', () => {
  const a = app();
  for (const trait of ['Mitarbeit', 'Sozialverhalten']) {
    const category = trait === 'Mitarbeit' ? 'Mitarbeit' : 'Verhalten';
    for (let points = 0; points <= 100; points += 1) {
      const expected = a.ihkBand(points).note;
      const weight = a.pointsToWeight(trait, points);
      const viaWeight = a.impliedBand(category, { [trait]: weight });
      assert.strictEqual(viaWeight, expected,
        `${trait} bei ${points} Punkten: Gewicht ${weight} ergibt Stufe ${viaWeight}, erwartet ${expected}`);
    }
  }
});

test('Gewichte fallen monoton mit sinkender Punktzahl', () => {
  const a = app();
  for (const trait of ['Mitarbeit', 'Sozialverhalten', 'Lernhaltung']) {
    let previous = Infinity;
    for (let points = 100; points >= 0; points -= 1) {
      const weight = a.pointsToWeight(trait, points);
      assert.ok(weight <= previous + 1e-9,
        `${trait}: Gewicht steigt bei fallenden Punkten (${points})`);
      previous = weight;
    }
  }
});

test('bandMidPoints trifft die gemeinte Stufe', () => {
  const a = app();
  for (let note = 1; note <= 6; note++) {
    assert.strictEqual(a.ihkBand(a.bandMidPoints(note)).note, note);
  }
});

test('+/- läuft die Notenstufen ohne Richtungsfehler entlang', () => {
  const a = app();
  for (const category of Object.keys(a.LEAD_DIMENSION)) {
    for (let band = 1; band <= 6; band++) {
      const better = a.nextBandWithTexts(category, band, 1);
      const worse = a.nextBandWithTexts(category, band, -1);
      if (better !== null) assert.ok(better < band, `${category} ${band} "+" -> ${better}`);
      if (worse !== null) assert.ok(worse > band, `${category} ${band} "-" -> ${worse}`);
    }
    assert.strictEqual(a.nextBandWithTexts(category, 1, 1), null, 'Stufe 1 ist die beste');
    assert.strictEqual(a.nextBandWithTexts(category, 6, -1), null, 'Stufe 6 ist die schlechteste');
  }
});

test('Pünktlichkeitssätze tragen ihre Schwelle in der Beschriftung', () => {
  const a = app();
  const [harsh, mild] = a.PUNCTUALITY_PHRASES;

  assert.strictEqual(mild.min, 5);
  assert.strictEqual(harsh.min, 10);
  assert.strictEqual(mild.text, 'Die Pünktlichkeit ließ zu wünschen übrig.');
  assert.strictEqual(harsh.text, 'Die Pünktlichkeit ließ stark zu wünschen übrig.');

  // Die Schwelle steht im Eintrag, damit niemand Verspätungen abtippen muss.
  assert.strictEqual(a.punctualityLabel(mild),
    'ab 5 Verspätungen: Die Pünktlichkeit ließ zu wünschen übrig.');
  assert.strictEqual(a.punctualityLabel(harsh),
    'ab 10 Verspätungen: Die Pünktlichkeit ließ stark zu wünschen übrig.');

  // Eskalation: der schärfere Satz gehört an die höhere Schwelle.
  assert.ok(harsh.min > mild.min);
  assert.ok(harsh.text.includes('stark') && !mild.text.includes('stark'));
});

test('Pünktlichkeitssätze brauchen keine Anrede', () => {
  const a = loadApp({ expose: ['PUNCTUALITY_PHRASES', 'hasUnresolvedPlaceholder'] });
  for (const phrase of a.PUNCTUALITY_PHRASES) {
    assert.ok(!a.hasUnresolvedPlaceholder(phrase.text),
      `${phrase.code} enthält einen Platzhalter: ${phrase.text}`);
  }
});
