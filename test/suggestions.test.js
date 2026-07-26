// Prüft Auswahl, Reihenfolge und Anrede der Vorschläge.
const test = require('node:test');
const assert = require('node:assert');
const { loadApp, loadCatalogue } = require('./harness');

const { items, traits } = loadCatalogue();

function app() {
  const a = loadApp({
    expose: ['rankSuggestions', 'calculateMaskedDistance', 'hasValenceMismatch',
      'categoryIsApplicable', 'impliedBand', 'computeBandCentroids', 'pointsToWeight',
      'ihkBand', 'personalizeText', 'hasUnresolvedPlaceholder', 'sortByAsvOrder',
      'findVariantText', 'findAlternativeText', 'VARIANCE_CODES', 'CATEGORY_ORDER']
  });
  a.__setCatalogue(items, traits);
  a.computeBandCentroids();
  return a;
}

/** Baut Gewichte und Notenstufen aus einer Angabe in Punkten je Dimension. */
function rate(a, points) {
  const weights = {}, bands = {};
  for (const [trait, value] of Object.entries(points)) {
    weights[trait] = a.pointsToWeight(trait, value);
    bands[trait] = a.ihkBand(value).note;
  }
  return { weights, bands };
}

test('Ohne bewertete Dimension entsteht kein Vorschlag', () => {
  const a = app();
  assert.deepStrictEqual(a.rankSuggestions({}, false, false, {}), {});
  for (const { comment } of items) {
    assert.strictEqual(a.calculateMaskedDistance({}, comment.weights), Infinity);
  }
});

test('Eine bewertete Dimension erzeugt keine Aussage über andere Unterbereiche', () => {
  const a = app();
  const { weights, bands } = rate(a, { Mitarbeit: 58 });
  const result = a.rankSuggestions(weights, false, false, bands);
  assert.deepStrictEqual(Object.keys(result), ['Mitarbeit'],
    'Nur Mitarbeit darf erscheinen, wenn nur Mitarbeit bewertet wurde');
});

test('Vorschläge bleiben in der bewerteten Notenstufe (±1)', () => {
  const a = app();
  for (const points of [95, 85, 74, 58, 40, 15]) {
    const { weights, bands } = rate(a, { Mitarbeit: points, Sozialverhalten: points });
    const result = a.rankSuggestions(weights, false, false, bands);
    for (const category of ['Mitarbeit', 'Verhalten']) {
      const expected = a.ihkBand(points).note;
      for (const item of result[category] || []) {
        const band = parseInt(item.grade, 10);
        assert.ok(Math.abs(band - expected) <= 1,
          `${category} bei ${points} Punkten: Stufe ${band}, erwartet ${expected}±1`);
      }
    }
  }
});

test('Stärken-Bausteine nur bei positiver Bewertung, Aufforderung nur auf Anforderung', () => {
  const a = app();
  const weak = rate(a, { Selbststaendigkeit: 20, Lernhaltung: 20, Sozialverhalten: 20 });
  assert.ok(!a.categoryIsApplicable('Fachliche_und_kognitive_Kompetenz', weak.weights));
  assert.ok(!a.categoryIsApplicable('Soziale_Kompetenz', weak.weights));

  const strong = rate(a, { Selbststaendigkeit: 95, Lernhaltung: 95, Sozialverhalten: 95 });
  assert.ok(a.categoryIsApplicable('Fachliche_und_kognitive_Kompetenz', strong.weights));

  const withoutRequest = a.rankSuggestions(weak.weights, false, false, weak.bands);
  assert.ok(!withoutRequest.Aufforderung_und_Hinweise,
    'Aufforderung darf ohne ausdrückliche Anforderung nicht erscheinen');
  const withRequest = a.rankSuggestions(weak.weights, true, false, weak.bands);
  assert.ok(withRequest.Aufforderung_und_Hinweise, 'Auf Anforderung muss sie erscheinen');
});

test('Widersprüchliche Bausteine werden gesperrt', () => {
  const a = app();
  const good = items.find(i => i.comment.code === 'a211').comment.weights;
  const bad = items.find(i => i.comment.code === 'a216').comment.weights;
  assert.ok(a.hasValenceMismatch({ Sozialverhalten: 0.5 }, bad));
  assert.ok(a.hasValenceMismatch({ Sozialverhalten: -0.5 }, good));
  assert.ok(!a.hasValenceMismatch({ Mitarbeit: 0.5 }, good));
});

test('Streuungsschalter ändert die Notenstufe nicht', () => {
  const a = app();
  for (const points of [95, 58, 40]) {
    const { weights, bands } = rate(a, { Mitarbeit: points });
    const off = a.rankSuggestions(weights, false, false, bands).Mitarbeit || [];
    const on = a.rankSuggestions(weights, false, true, bands).Mitarbeit || [];
    assert.deepStrictEqual(
      on.map(i => i.grade).sort(), off.map(i => i.grade).sort(),
      `Bei ${points} Punkten verschiebt der Schalter die Stufe`);
  }
});

test('Streuungsschalter zieht Schwankungstexte nach vorn, wo es sie gibt', () => {
  const a = app();
  const { weights, bands } = rate(a, { Mitarbeit: 58 }); // Stufe 4
  const on = a.rankSuggestions(weights, false, true, bands).Mitarbeit;
  assert.ok(a.VARIANCE_CODES.has(on[0].comment.code),
    `erwartet Schwankungstext vorne, erhalten ${on[0].comment.code}`);
});

test('Anrede ist für beide Geschlechter formgleich', () => {
  const a = app();
  const shape = s => s
    .replace(/Herr Müller|Frau Müller|Der Schüler|Die Schülerin/g, '#')
    .replace(/\b(er|sie|Er|Sie|sein\w*|ihr\w*|Sein\w*|Ihr\w*|ihm)\b/g, '~');
  for (const { comment } of items) {
    for (const style of ['name', 'role']) {
      const male = a.personalizeText(comment.text, true, 'Müller', style);
      const female = a.personalizeText(comment.text, false, 'Müller', style);
      assert.strictEqual(shape(male), shape(female),
        `${comment.code} [${style}]\n  m: ${male}\n  w: ${female}`);
    }
  }
});

test('Keine Platzhalter überleben die Personalisierung', () => {
  const a = app();
  for (const { comment } of items) {
    for (const male of [true, false]) {
      const text = a.personalizeText(comment.text, male, 'Müller', 'name');
      assert.ok(!a.hasUnresolvedPlaceholder(text), `${comment.code}: ${text}`);
    }
  }
});

test('Gesamtbemerkung folgt der Reihenfolge des Katalogs', () => {
  const a = app();
  const saved = ['a270', 'a230', 'a211', 'a201', 'a260'].map(c => ({ originalCode: c }));
  assert.deepStrictEqual(
    a.sortByAsvOrder(saved).map(s => s.originalCode),
    ['a201', 'a211', 'a230', 'a260', 'a270']);
});

test('Andere Formulierung bleibt auf derselben Stufe', () => {
  const a = app();
  const current = items.find(i => i.comment.code === 'a213');
  const variant = a.findVariantText(current, ['a213'], { Sozialverhalten: 0.5 });
  assert.strictEqual(variant.grade, '3');
});
