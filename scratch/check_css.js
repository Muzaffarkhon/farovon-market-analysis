const fs = require('fs');
const css = fs.readFileSync('public/style.css', 'utf8');
const lines = css.split('\n');
lines.forEach((l, i) => {
  if (l.includes('org-') || l.includes('wrap') || l.includes('app-main') || l.includes('adminContent')) {
    console.log(i + 1, l);
  }
});
