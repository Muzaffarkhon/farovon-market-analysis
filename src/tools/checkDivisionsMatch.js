const fs = require('fs');
const path = require('path');
const baseDir = path.resolve(__dirname, '..', '..');
const seed = JSON.parse(fs.readFileSync(path.join(baseDir, 'src', 'data', 'seedBundle.json'), 'utf8'));

console.log('Total divisions array length:', seed.divisions.length);
const uniqueUnits = new Set(seed.divisions.map(d => d.unit));
console.log('Unique unit names in divisions:', uniqueUnits.size);

const compUnits = new Set(seed.competitors.map(c => c.unit));
console.log('Unique unit names in competitors:', compUnits.size);

let matched = 0;
compUnits.forEach(u => {
  if (uniqueUnits.has(u)) matched++;
  else {
    // Check if there is partial match (e.g. code prefix)
    const match = Array.from(uniqueUnits).find(du => du.includes(u) || u.includes(du));
    if (match) {
      // console.log(`Near match: "${u}" <-> "${match}"`);
    }
  }
});
console.log(`Competitor units matched with divisions: ${matched} / ${compUnits.size}`);
