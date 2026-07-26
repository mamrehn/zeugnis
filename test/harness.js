// Lädt das Inline-Skript aus index.html hinter einem minimalen DOM-Stub und gibt die
// Funktionen zum Testen frei. Bewusst ohne Abhängigkeiten, damit `node --test` in der CI
// ohne npm install läuft.
const fs = require('node:fs');
const path = require('node:path');

const INDEX = path.join(__dirname, '..', 'index.html');

function readIndex() {
  return fs.readFileSync(INDEX, 'utf8');
}

/** Minimales Element-Stub; unbekannte Zugriffe geben wieder ein Stub zurück. */
function stubElement(extra = {}) {
  return Object.assign({
    classList: { contains: () => true, add() {}, remove() {}, toggle() {} },
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    checked: false, disabled: false,
    addEventListener() {}, appendChild() {}, setAttribute() {}, remove() {},
    querySelector: () => stubElement(), querySelectorAll: () => []
  }, extra);
}

/**
 * Führt das Skript aus index.html aus und liefert die angeforderten Bezeichner.
 * @param {Object} options
 * @param {string[]} options.expose - Namen, die zurückgegeben werden sollen
 * @param {Object} [options.dom] - Überschreibungen für document
 */
function loadApp({ expose, dom = {} } = {}) {
  const src = readIndex();
  const match = src.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('Kein <script>-Block in index.html gefunden');

  const document = Object.assign({
    addEventListener() {},
    getElementById: () => stubElement(),
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
    createElement: () => stubElement()
  }, dom);

  const body = match[1] + `\n;return { ${expose.join(', ')},
    __setCatalogue: (items, traits) => { originalCommentData = items; sortedTraitNames = traits; } };`;

  return new Function('document', 'window', 'localStorage', 'console', body)(
    document,
    { addEventListener() {} },
    { getItem: () => null, setItem() {} },
    { log() {}, error() {}, warn() {} }
  );
}

/** Liest den ASV-Katalog direkt aus index.html, so wie die App ihn beim Start aufbaut. */
function loadCatalogue() {
  const src = readIndex();
  const start = src.indexOf('studentAssessmentData = {');
  const end = src.indexOf("\n      };\n      console.log('Daten erfolgreich geladen", start);
  if (start < 0 || end < 0) throw new Error('Datenblock nicht gefunden');
  const json = src.slice(start, end + 9)
    .replace(/^\s*studentAssessmentData\s*=\s*/, '')
    .replace(/;\s*$/, '');
  const data = JSON.parse(json);

  const items = [];
  const traits = new Set();
  for (const category in data) {
    for (const band in data[category]) {
      if (band === 'datum') continue;
      for (const comment of data[category][band].comments) {
        items.push({ category, grade: band, comment });
        Object.keys(comment.weights).forEach(t => traits.add(t));
      }
    }
  }
  return { data, items, traits: Array.from(traits).sort() };
}

module.exports = { loadApp, loadCatalogue, readIndex, stubElement, INDEX };
