const syncZ = () => {
      const autoZ = document.getElementById("autoZ").checked
      if (autoZ) {
        val = document.getElementById("Te").value
        const interpolated = Math.round((linearInterp(val)) * 1000) / 1000
        document.getElementById("Z").value = interpolated
      }
    }

    const sync = (val) => {
      const ti = document.getElementById("Ti")
      const te = document.getElementById("Te")
      checked = document.getElementById("sync-te-ti").checked
      if (checked) {
        ti.value = te.value
      }
    }

    const changeSync = (checked) => {
      const ti = document.getElementById("Ti")
      const te = document.getElementById("Te")
      ti.disabled = checked ? true : false
      if (checked) {
        ti.value = te.value
      }
    }

    const changeAutoZ = (val) => {
      const z = document.getElementById("Z")
      if (val) {
        z.disabled = true
        syncZ()
      } else {
        z.disabled = false
      }
    }

    const ctx = document.getElementById("myChart");
    const status = document.getElementById("status-text")

    const statusDone = () => {
      document.getElementById("status-text").innerText = "done"
      document.getElementById("fit").disabled = false
      document.getElementById("print").disabled = false
      document.getElementById("copy").disabled = false
    }

    const statusCalculating = () => {
      document.getElementById("status-text").innerText = "calculating..."
      document.getElementById("fit").disabled = true
      document.getElementById("print").disabled = true
      document.getElementById("copy").disabled = true
    }

    const go = (willReturnVal = false) => {
      if (!myChart) {
        alert("select txt file first");
        statusDone()
        return;
      }
      statusCalculating()
      const precision = 3
      const ne = document.getElementById("ne").value
      const ne_after = document.getElementById("ne_after").value
      const Z = document.getElementById("Z").value
      const atomicMass = document.getElementById("atomic-mass").value
      const Te = document.getElementById("Te").value
      const Ti = document.getElementById("Ti").value
      const iccd_center = document.getElementById("ICCD_CENTER").value
      const dopplerShift = document.getElementById("DS").value
      const gyakusenBunsan = document.getElementById("D").value
      const ppICCD = document.getElementById("ppICCD").value
      const RSFWHM = document.getElementById("RSFWHM").value
      const NT = document.getElementById("NT").value
      const ANGLE_KI_KS = document.getElementById("ANGLE_KI_KS").value
      const IR = document.getElementById("IR").value
      const ELR = document.getElementById("ELR").value
      const ELT = document.getElementById("ELT").value
      const airDensity = document.getElementById("n0").value
      const accumulationShots = document.getElementById("NR").value
      const w_fit_coeff = document.getElementById("w_fit_coeff").value
      // deal with performance
      const dlmin = -0.2, dlmax = 0.2, step = 0.0003 // when range(-0.2, 0.2, 0.0003)
      let props_true = new Float64Array;
      let props_false = new Float64Array;
      // props = [precision, ne, Z, atomic_mass, Te, Ti, center, shiftWaveLength, 逆線分散D, ppmm-ICCD, FHWM, NT, akiks, integratedIntensity, ELR, ELT, airDensity, shots]
      props_false = Float64Array.from([precision, ne * 1e24, Z, atomicMass, Te, Ti, iccd_center, dopplerShift, gyakusenBunsan, ppICCD, RSFWHM, NT, ANGLE_KI_KS, IR, ELR, ELT, airDensity * 1e25, accumulationShots, w_fit_coeff * 1e5, false, ne_after * 1e24])
      props_true = Float64Array.from([precision, ne * 1e24, Z, atomicMass, Te, Ti, iccd_center, dopplerShift, gyakusenBunsan, ppICCD, RSFWHM, NT, ANGLE_KI_KS, IR, ELR, ELT, airDensity * 1e25, accumulationShots, w_fit_coeff * 1e5, true, ne_after * 1e24])
      const baseline = document.getElementById("baseline").value
      drawData(ctx, helloData, true)
      if (willReturnVal) {
        const lamda = 532; // レーザー波長 nm
        const C = 3e8; // 光速m/s
        const RADIAN_KI_KS = (ANGLE_KI_KS * 2 * Math.PI) / 360; // radian
        const ki = 2 * Math.PI / (lamda * 1e-9)
        const vska = 90 - (180 - ANGLE_KI_KS) / 2  // angle between Vs and KO
        const KO = 2 * ki * Math.sin(RADIAN_KI_KS / 2);
        const Vs = (2 * Math.PI * C / Math.cos(vska * 2 * Math.PI / 360) / KO) * (1 / lamda - (1 / (lamda + dopplerShift / 1000))) * 1e9  // ion velocity
        // ne, ne_real, ne_real_before, Te, Vs, Z
        const a = calcYAxis(props_true)
        const ne_real = a[10]
        const ne_real_after = a[11]
        return [ne, ne_real, ne_real_after, Te, Vs, Z]
      }
      setTimeout(() => {
        let calcXAxisProps = new Float64Array;
        calcXAxisProps = Float64Array.from([dopplerShift])
        const a = calcXAxis(calcXAxisProps);
        let b = calcYAxis(props_false);
        const data = [Array.from(a), Array.from(b)]
        fittingData = data[0].map((x, i) => ([x, data[1][i]]))
        addData(myChart, data[0], data[1]);
        statusDone()
      }, 70)
    };

    const _print = (shouldPrint = true) => {
      if (!myChart) {
        go();
        statusDone()
        return
      }
      statusCalculating()
      const vals = go(true)
      const fVals = vals.map((x) => (x - 0).toPrecision(5))
      const canvas = document.getElementById("myChart");
      const ctx = canvas.getContext("2d");
      const x = canvas.clientWidth - 270
      const y = 110
      const step = 35
      if (shouldPrint) {
        setTimeout(() => {
          ctx.font = "22px Arial";
          // ctx.fillText(`ne　　　　 : ${fVals[0] * 1e24}`, x, y + step * 0)
          ctx.fillText(`ne(real)　　: ${fVals[1]}`, x, y + step * 0)
          // ctx.fillText(`ne(real) after:  ${fVals[2]}`, x, y + step * 2)
          ctx.fillText(`Te　　　　 : ${fVals[3]}`, x, y + step * 1)
          ctx.fillText(`Vs　　　　 : ${fVals[4]}`, x, y + step * 2)
          ctx.fillText(`Z　　　　　: ${fVals[5]}`, x, y + step * 3)
          statusDone()

        }, 400)
      }
      _ne = fVals[0];
      _neReal = fVals[1];
      _Te = fVals[3];
      _Vs = fVals[4];
      _Z = fVals[5]
    }

    const showClipboardCopied = () => {
      const ele = document.getElementById("clipboardStatus")
      ele.innerText = "copied!"
      setTimeout(() => { ele.innerText = "" }, 3000)
    }

    const _copy = () => {
      if (!_ne) {
        _print(false)
      }
      // TODO: stop using magic number for ne
      // ${_ne * 1e24}
      const target = `
${_neReal}
${_Te}
${_Vs}
${_Z}`
      if (myChart) {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(target).then(() => {
            showClipboardCopied()
          })
        } else {
          execCopy(target)
        }
      }
      statusDone()
    }

    const _copyAll = () => {
      if (!_ne) {
        _print(false)
      }

      const precision = 3
      const ne = document.getElementById("ne").value
      const ne_after = document.getElementById("ne_after").value
      const Z = document.getElementById("Z").value
      const atomicMass = document.getElementById("atomic-mass").value
      const Te = document.getElementById("Te").value
      const Ti = document.getElementById("Ti").value
      const iccd_center = document.getElementById("ICCD_CENTER").value
      const dopplerShift = document.getElementById("DS").value
      const gyakusenBunsan = document.getElementById("D").value
      const ppICCD = document.getElementById("ppICCD").value
      const RSFWHM = document.getElementById("RSFWHM").value
      const NT = document.getElementById("NT").value
      const ANGLE_KI_KS = document.getElementById("ANGLE_KI_KS").value
      const IR = document.getElementById("IR").value
      const ELR = document.getElementById("ELR").value
      const ELT = document.getElementById("ELT").value
      const airDensity = document.getElementById("n0").value
      const accumulationShots = document.getElementById("NR").value
      const w_fit_coeff = document.getElementById("w_fit_coeff").value
      // TODO: stop using magic number for ne
      // ${_ne * 1e24}
      const target = [_neReal, _Te, _Vs, _Z, ne, ne_after, Z, atomicMass, Te, Ti, iccd_center, dopplerShift, gyakusenBunsan, ppICCD, RSFWHM, NT, ANGLE_KI_KS, IR, ELR, ELT, airDensity, accumulationShots, w_fit_coeff].join(",")
      if (myChart) {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(target).then(() => {
            showClipboardCopied()
          })
        } else {
          execCopy(target)
        }
      }
      statusDone()
    }

    const submit = (e) => {
      console.log('submit!')
      e.preventDefault()
      fit()
    }

    const showButtons = () => {
      document.getElementById("reset-zoom-button").style.display = "inline-block";
      document.getElementById("save-as-png").style.display = "inline-block";
    }

    const saveAsPNG = () => {
      const a = document.createElement('a');
      a.href = myChart.toBase64Image();
      a.download = `${fileName.slice(0, -4)}.png`;
      a.click();
    }

    const inputFileAndDraw = (input) => {
      if (!input.files[0].name) {
        return
      }
      const filenamechunk = input.files[0].name.split(".")
      if (filenamechunk[filenamechunk.length - 1] !== "txt") {
        input.value = ""
        return alert("this was not .txt file")
      }
      readData(input).then((d) => {
        const [data, name] = d;
        fileName = name;
        helloData = data;
        document.getElementById("fileName").innerHTML = `${fileName} : ${data.length} rows ${data.length !== (1024 + 1) ? "<br/><b style='color:tomato'><big>1024 行ではないけど、OK?</big></b>" : ""}`
        showButtons()
        const D = document.getElementById("D").value; //# 逆線分散 (nm/mm)
        const ICCD_PIXEL = document.getElementById("ppICCD").value; //# pixel per mm on ICCD (mm/pixel)
        const dlICCD = D * ICCD_PIXEL; //# wavelength per pixel on ICCD (nm/pixel)
        const ICCD_CENTER = document.getElementById("ICCD_CENTER").value; //# (pixel) rayleigh center on ICCD
        const xAxis = [...Array(helloData.length).keys()].map((x) => (x - ICCD_CENTER) * dlICCD);
        const allData = xAxis.map((item, i) => [item, data[i][2]])
        experimentData = allData
        const baseline = document.getElementById("baseline").value
        myChart = drawData(ctx, data); // passing raw data here
        myChart.options.plugins.title.text = `${fileName.slice(0, -4)}`;
        myChart.update();
        document.getElementById("status-text").innerText = "done"
      }).catch((e) => { alert("something went wrong, sorry"); console.error(e) });
    };

    const dropZone = document.getElementById("dropZone")
    const fileInput = document.getElementById("fileInput")


    dropZone.addEventListener('dragover', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.style.background = '#a1a7f0';
    }, false);

    dropZone.addEventListener('dragleave', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.style.background = 'lightyellow';
    }, false);

    dropZone.addEventListener('drop', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.style.background = 'lightyellow'; //背景色を白に戻す
      var files = e.dataTransfer.files; //ドロップしたファイルを取得
      if (files.length !== 1) { return alert('アップロードできるファイルは1つだけです。'); }
      fileInput.files = files; //inputのvalueをドラッグしたファイルに置き換える。
      inputFileAndDraw(fileInput)
    }, false);

    window.onload = () => {
      const center = getLocalStorage("RAYLEIGH_CENTER")
      const rsIntensity = getLocalStorage("RS_INTENSITY")
      console.log(center, rsIntensity)
      if (center && rsIntensity) {
        document.getElementById("ICCD_CENTER").value = center
        document.getElementById("IR").value = rsIntensity
      }
    }
