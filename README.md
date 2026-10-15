# CTS Signal Analysis

A static, English-language interface for SPE selection, four-file Rayleigh calibration, Y binning and Sn-119 Thomson fitting. Python runs locally in a Web Worker through Pyodide, using the actual PlasmaPy and lmfit model. Experimental files are not uploaded to a server. The supplied original files are preserved in `reference/`.

## Run locally

```sh
cd /workspace/CTS_Signal_Analysis
python -m http.server 8000 --bind 127.0.0.1
```

Open the site over HTTP; opening `index.html` through `file://` cannot load modules or workers. Include **all** application files when copying the site: `index.html`, `style.css`, `script.js`, `spe.js`, `preview.js`, `worker.js`, and `analysis.py`.

The included Pages workflow automatically updates the site whenever code is pushed to **main**. You can also run it manually with `workflow_dispatch`. GitHub Pages must already be enabled with Source set to **GitHub Actions**.

The first analysis downloads Pyodide 0.27.7 from `cdn.jsdelivr.net` and scientific packages from `pypi.org` / `files.pythonhosted.org`. PlasmaPy 2025.8.0, lmfit 1.3.4 and xarray 2025.1.2 are pinned in the worker. Subsequent runs can reuse browser caches, but offline use is not guaranteed. PlasmaPy may make an optional public connectivity check to `api.github.com`. Use **Cancel** to terminate a running worker.

## Inputs and frame selection

**Every numeric input starts at 0**, including contrast, Y bounds, step, notch, energies, shot counts and instrument FWHM. Loading a file does not overwrite these defaults. Enter valid experimental values before analysis: Y from < to, step >= 1, notch from < to, positive energies, positive integer shot counts and positive FWHM in detector pixels. The zero defaults are placeholders, not valid physical parameters.

1. Select four Rayleigh files: **1 = Rayleigh A, 2 = Background A, 3 = Rayleigh B, 4 = Background B**. Each file has independent frame checkboxes and a **Select all** checkbox. Partial selections show an indeterminate checkbox. **Select all loaded Rayleigh frames** selects or clears frames across the loaded Rayleigh files. The first frame is selected when a file loads.
2. Click **Apply subtraction & average**. Selected frames are averaged within each file, then the final reference is computed as **`R = (abs(1 - 2) + abs(3 - 4)) / 2`**. Absolute values are taken **per pixel, after each file's selected-frame average and subtraction, before combining the two pairs**. Both absolute differences receive equal weight, independent of their selected frame counts. All four images must have the same dimensions. This final R is used consistently for the preview, pixel readout, R.txt export and Python fitting.
3. Select the Thomson file and its frames. It also has a **Select all** checkbox. Its selected frames are averaged, while the Python model estimates its linear background.
4. Enter a Y interval: coordinates are **zero-based, from inclusive, to exclusive**. Step is the number of consecutive rows to average, not a skip interval. A final partial bin averages its remaining rows. For example `[10, 15)` with step 2 gives `[10, 12)`, `[12, 14)`, and `[14, 15)`. The entire X range `[0, 1024)` is always used. The selected Y interval must exist in both signals.
5. Set notch X bounds (both endpoints inclusive), laser energies in mJ, experimental shot counts, and **Instrument FWHM in pixels** (decimals such as 4.8 are supported; the original model used 8). FWHM must be positive. Each analysis recalculates Gaussian sigma as `FWHM / (2*sqrt(2*ln(2)))`; the value is included in results and exports. Shot counts are independent of the number of selected frames and are not changed automatically.
6. Run analysis. The results show ne, Te, Ti, Z, velocity, convergence and **every Y bin's Thomson spectrum and Rayleigh calibration**, all on the page at once. Clicking a table row scrolls to its corresponding spectrum. CSV velocity is in m/s; the table displays km/s. JSON includes parameters, source filenames, selected frames, Y bins and detailed curves.

A failed Y bin remains in its original position with blank fitted values, an error stage/message and expandable Python traceback identifying `analysis.py` and the failing line. Remaining bins continue. The status and error list identify the bin number and actual `Y [from, to)` interval. Plots break at failed bins; they do not substitute zero or interpolate across missing bins. CSV has bin number, Y bounds, FWHM, status and error columns; JSON uses `null` for failed physical values and includes the traceback.

Changing files, frame selections or analysis parameters invalidates existing results. Brightness and viewport changes affect display only.

## Preview interaction

- **Blue rectangle:** the selected Y interval across the full detector width.
- **Red rectangle inside it:** the notch X interval restricted to that same Y interval.
- **Mouse wheel:** zoom around the pointer. **Click and drag:** pan. Touch/pointer dragging is supported as well.
- **Reset view:** fit the image in its viewport. Each preview has independent zoom and pan.
- Overlays move with the image and retain a visible screen-space border. Pixel readouts convert the pointer back into original detector coordinates after zoom/pan. A window/viewport resize fits the image again.
- Contrast min = max = **0** enables automatic display contrast without rewriting either input or changing scientific values. Otherwise max must exceed min. Negative and fractional detector values are preserved.

**Save R / T** exports flattened text compatible with the original Python input layout: 1024 X values per Y bin, without rounding. Browsers may request permission for multiple downloads. Experimental analysis parameters must be valid before export.

## Supported data

- SPE **2.x**, a single rectangular ROI, **1024 X pixels**.
- Little-endian Float32, Int32, Int16, UInt16 and UInt32.
- SPE 3.x XML/multiple ROIs, unsupported types, truncated frames and non-finite pixel values are rejected explicitly.
- No clamping of negatives or values above 65535 while reading SPE data. The final Rayleigh reference explicitly uses absolute pair differences as described above; Thomson data retains its original signs.
- Large files and large numbers of bins are limited by browser memory. Full files remain in browser memory and binned inputs are copied to the worker.

## Model and scientific considerations

The original Python is the model reference; the supplied `fitting.txt` calls missing external JS functions and is not used as the fitting engine. The implementation retains the Sn-119 two-charge-state mixture, FLYCHK Z interpolation, 135° geometry, 532 nm wavelength, 2.266 pm/pixel, integration/background windows, and differential evolution optimization.

Changes from the supplied standalone Python:

- A single Y bin uses zero velocity-distribution width instead of accessing a nonexistent second bin. Multiple bins retain the original neighboring-center width estimate (not divided by the Y step).
- The notch mask uses detector pixel coordinates. The original notch wavelength conversion used a 512-pixel center while its wavelength axis used the notch midpoint, excluding inconsistent regions.
- Spectral convolution runs on the full uniform 1024-point grid before masking. Applying convolution after masking would incorrectly join both sides of the notch.
- Curves use the optimized center. Velocity retains the original symmetry-center convention; both centers are included in JSON.
- Nonpositive integrals and non-finite per-bin inputs cause that bin to be skipped rather than replacing a negative Rayleigh integral with an arbitrary value of 100. The pixelwise Rayleigh absolute difference does not guarantee its **background-corrected integral** is positive; such bins are still skipped.
- Limits: 20 temperature iterations, 200 density iterations and 12000 fit evaluations. Temperature-limit, density and optimizer failures skip only the affected bin. Invalid global settings, incompatible matrix dimensions or Python/package loading failures still stop the entire run because they cannot be assigned to one Y bin.
- Instrument FWHM is now a user input; **8 pixels** reproduces the original instrument width (its comment mentioned 4.8, but the executable code used 8). The 531–533 nm region and 200:350 / 600:750 background windows are retained.

If a Thomson bin fails before a usable center is available, a neighboring valid bin uses its other immediate neighbor for velocity broadening, or width 0 if neither immediate neighbor is available. This fallback is explicitly reported as a warning on the affected valid bins; centers are not interpolated across missing bins. Rayleigh-only failures do not remove usable Thomson centers.

Synthetic validation does **not** establish accuracy on experimental SPE data. Confirm the instrument width, calibration assumptions and any unconverged outputs before scientific use.

## Development checks

```sh
node --test tests/spe.test.mjs
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
MPLCONFIGDIR=/tmp/cts-mpl .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

For the browser integration test, install Playwright in the scientific Python environment, provide Chromium at `/usr/bin/chromium`, start the static server, and run `python tests/browser_smoke.py`. The test checks zero defaults, English UI/errors, per-file/global frame selection, colored overlays, zoom/pan/reset and coordinate mapping, four-file exports, cancellation, **actual Python fitting with a failed middle Y bin and successful bins on both sides**, display of valid spectra and the failed-bin card, FWHM validation/metadata, error CSV/JSON exports, an all-failed rerun, invalidation and mobile layout.

`CTS_TEST_URL` overrides the server URL. In cloud runners where Chromium does not inherit the system HTTPS proxy/trust setup, set `CTS_BROWSER_SYSTEM_PROXY=1` to use a test-only urllib network bridge with system TLS verification. The application itself does not use this bridge. Screenshots are written to ignored `test-results/`.

## Editing the Python model

Change **`analysis.py`** to modify the physical model or numerical fitting. `worker.js` downloads and executes this Python source using Pyodide; it does not translate the formulas into JavaScript. After updating and deploying it, reload the page to create a new worker; use a hard refresh if an old cached version persists.

Preserve the browser interface when changing the implementation:

- Entry point: `analyze(rayleigh, thomson_data, options, progress=None, on_bin_error=None)`. R/T are matching lists of Y bins, each with 1024 X values. The optional progress callback receives `(bin_index, bin_count)`. The optional error callback receives `(bin_index, stage, message)` for each skipped bin.
- Input option names: `n1`, `n2`, `ELR`, `ELT`, `shot_R`, `shot_T`, `fwhm`. Older CPython callers without `fwhm` retain a compatibility default of 8 pixels; the browser always sends its input value. `configure(options)` applies the UI values each run, overriding the initial globals near the top of the file. Changing those globals alone does not change the web input defaults; those live in `index.html`.
- Return a JSON-serializable dictionary with `rows`, `wavelengths`, `options` and a `summary` count of total/succeeded/failed bins. Each row currently provides `index`, `ne`, `Te`, `Ti`, `Z`, `velocity`, `center`, `fitted_center`, `width`, `rayleigh_integral`, `thomson_integral`, `converged`, `iterations`, `redchi`, `signal`, `fit`, `rayleigh`, and `rayleigh_background`, `status`, `error` and `warnings`. Successful rows have `status="ok"`; failed rows have `status="failed"`, null physical/curve fields and an error dictionary with `stage`, `type`, `message` and `traceback`. Keep every original row position. Successful spectral arrays and the wavelength axis have 1024 entries. Return Python numbers/lists rather than NumPy objects; JSON must contain no NaN/infinity. Units: ne in m^-3, temperatures in eV, wavelengths in nm, velocity in m/s.
- Instrument constants are also mirrored in the header/footer (`index.html`) and export metadata (`script.js`). If you change wavelength, pixel calibration or scattering angle in Python, update those labels/metadata too; otherwise exports could describe the old calibration. FWHM is now connected to its UI input and export metadata automatically.
- Keep the existing schema to change formulas only in Python. Adding inputs or changing result fields also requires updating `script.js` and usually `index.html`. If a new dependency is required, update the loading/install steps in `worker.js` and verify Pyodide support. SPE parsing, frame averaging, four-file Rayleigh averaging and Y binning are implemented in `spe.js`, before Python is called.
- The untouched standalone original is `reference/ThomsonFittingSn-kai-kai.py`. The scientific differences are listed above: in particular, detector-aligned notch masking and convolution on the full grid can change fitted values relative to the original. Differential evolution also uses a fixed seed (42) and a finite evaluation limit, unlike the unseeded original. Synthetic validation is not an original-versus-integrated numerical equivalence test.

The layout stacks Rayleigh above Thomson at all viewport sizes. UI and canvas-chart type is approximately 1.7 times the earlier size, with narrower screens allowed to wrap controls for readability.
