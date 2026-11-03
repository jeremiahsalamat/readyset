// node run3.js <profile> [lens: legacy|A|B|F] [weeks] [seed]   (the old "baseline" is the legacy lens)
const path = require('path');
const { execFileSync } = require('child_process');
const [, , profile = 'normal', ln = 'A', weeks = '36', seed = '7'] = process.argv;
const engine = path.join(__dirname, '..', '..', 'src', 'engine.js');
execFileSync(process.execPath, [path.join(__dirname, 'sim3.js'), engine, profile, ln === 'baseline' ? 'legacy' : ln, weeks, seed], { stdio: 'inherit' });
