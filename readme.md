LAPTOP 2 (anmol):




- In /frontend/src/workers/trigger.worker.ts, build an acoustic trigger matcher for low-vocal users:
1. Extract and store 128-bin FFT spectral fingerprints from user hums, grunts, or pitch rises.
2. Compare live mic FFT peaks against saved IndexedDB acoustic triggers using Euclidean vector distance.
3. Emit trigger match events (<15ms execution) when spectral similarity exceeds configurable thresholds.

- In /frontend/src/workers/biomarker.worker.ts, build an acoustic voice quality worker:
1. Calculate Jitter percentage (pitch period instability) and Shimmer in dB (amplitude variation across glottal cycles).
2. Calculate Harmonics-to-Noise Ratio (HNR) to measure breathiness and glottal leakage.
3. Output a composite Vocal Strain Index (0-100) that flags vocal fatigue warnings on the HUD before injury occurs.