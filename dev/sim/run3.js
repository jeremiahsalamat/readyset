// node run3.js <profile> <variant> [weeks] [seed] [verbose]
const path = require('path');
const SP = __dirname;
const engine = 'C:/Users/Jerm/Documents/PowerliftingApp/src/engine.js';
require(path.join(SP, 'variants.js'));
const [, , profile = 'normal', variant = 'baseline', weeks = '36', seed = '7', verbose = ''] = process.argv;
process.argv = ['node', 'sim3', engine, profile, variant, weeks, seed, verbose];
require(path.join(SP, 'sim3.js'));
