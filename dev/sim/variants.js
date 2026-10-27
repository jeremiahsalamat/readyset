// Variant hooks for sim3: patch the engine's tables/tuning before a run. Loaded by sim3 via
// global applyVariant when present.
globalThis.applyVariant = function (E, st, name) {
  const B = E.BLOCKS;
  switch (name) {
    case 'baseline': break;
    case 'jt2like': // what buried him: ~double the volume, higher intensities, no caps to speak of
      for (const b of B) for (const k of ['primary', 'secondary']) b[k] = b[k].map(w => ({ ...w, sets: w.sets * 2, pct: Math.min(1.05, w.pct + 0.03) }));
      E.CAPS.squat = 30; E.CAPS.bench = 40; E.CAPS.deadlift = 24;
      st.settings.autoCalibrate = false;
      break;
    case 'nocal': st.settings.autoCalibrate = false; break;
    case 'noreadiness': E.readinessScore = () => ({ score: 80, color: 'green' }); break;
    case 'nocorrection': E.liftCorrection = () => null; break;
    case 'lowstart': // one fewer set in every scheme
      for (const b of B) for (const k of ['primary', 'secondary']) b[k] = b[k].map(w => ({ ...w, sets: Math.max(2, w.sets - 1) }));
      break;
    case 'highstart':
      for (const b of B) for (const k of ['primary', 'secondary']) b[k] = b[k].map(w => ({ ...w, sets: w.sets + 1 }));
      break;
    default:
      if (E.TUNE && typeof E.applyTune === 'function') E.applyTune(name);
  }
};
