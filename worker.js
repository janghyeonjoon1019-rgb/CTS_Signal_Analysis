/* Python stays in this worker so a fit never blocks the interface. */
let runtime;
async function initialize() {
  postMessage({type: 'status', message: 'Loading Python and scientific packages… (the first run may take several minutes)'});
  importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');
  const py = await loadPyodide({indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'});
  await py.loadPackage(['numpy', 'scipy', 'astropy', 'matplotlib', 'pandas', 'h5py', 'wrapt', 'micropip']);
  await py.runPythonAsync(`import micropip
await micropip.install(['xarray==2025.1.2', 'plasmapy==2025.8.0', 'lmfit==1.3.4'])`);
  const response = await fetch('analysis.py');
  if (!response.ok) throw new Error(`analysis.py: HTTP ${response.status}`);
  py.FS.writeFile('analysis.py', await response.text());
  await py.runPythonAsync("exec(compile(open('analysis.py').read(), 'analysis.py', 'exec'), globals())");
  py.globals.set('report_progress', (index, total) => postMessage({type: 'progress', index, total}));
  py.globals.set('report_bin_error', (index, stage, message) => postMessage({type: 'bin_error', index, stage, message}));
  return py;
}
onmessage = async ({data}) => {
  try {
    runtime ||= initialize();
    const py = await runtime;
    py.globals.set('payload_json', JSON.stringify(data));
    const result = await py.runPythonAsync(`import json
payload = json.loads(payload_json)
json.dumps(analyze(payload['R'], payload['T'], payload['options'], report_progress, report_bin_error), allow_nan=False)`);
    postMessage({type: 'result', result: JSON.parse(result)});
  } catch (error) {
    runtime = null;
    postMessage({type: 'error', message: String(error)});
  }
};
