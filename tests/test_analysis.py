import unittest
import json
from unittest.mock import patch
import numpy as np
import analysis as a

OPTIONS = dict(n1=475, n2=485, ELR=1, ELT=1, shot_R=6, shot_T=1, fwhm=8)


def synthetic():
    a.configure(OPTIONS)
    x = np.arange(1024)
    density, te, ti = 1e25, 30., 15.
    t = 100 + 500*a.custom_thomson_model(a.wavelengths, density, te, ti, 480, 0)
    c = a.calc_center(t)
    it, _ = a.calc_intensity_thomson(t, c)
    alpha = .8*np.sqrt(density/te*1e-22)
    z = a.get_z_avg(density, te)
    si = z*alpha**4/(1+alpha**2)/(1+alpha**2*(1+z*te/ti))
    target = 2.5e25*it*6/(132*si*density)
    r = np.exp(-.5*((x-480)/10)**2)
    integral, _ = a.calc_intensity_rayleigh(r)
    return [100+r*target/integral], [t]


class AnalysisTest(unittest.TestCase):
    def test_single_bin_recovers_synthetic_temperatures(self):
        r, t = synthetic()
        out = a.analyze(r, t, OPTIONS)
        row = out['rows'][0]
        self.assertTrue(row['converged'])
        self.assertAlmostEqual(row['Te'], 30, delta=2)
        self.assertAlmostEqual(row['Ti'], 15, delta=2)
        self.assertAlmostEqual(row['ne']/1e25, 1, delta=.15)
        self.assertAlmostEqual(row['fitted_center'], 480, delta=1)
        self.assertEqual(row['width'], 0)
        self.assertEqual(len(row['fit']), 1024)
        self.assertEqual(len(out['wavelengths']), 1024)
        self.assertTrue(np.all(np.isfinite(row['fit'])))

    def test_invalid_inputs_fail_before_fitting(self):
        with self.assertRaises(ValueError):
            a.analyze([[1]*1023], [[1]*1023], OPTIONS)
        with self.assertRaises(ValueError):
            a.configure({**OPTIONS, 'ELT':0})

    def test_notch_mask_uses_detector_pixels(self):
        a.configure(OPTIONS)
        self.assertFalse(np.any(a.Mask[475:486]))
        self.assertTrue(a.Mask[474])
        self.assertTrue(a.Mask[486])

    def test_failed_bins_keep_positions_and_later_valid_bin_runs(self):
        r, t = synthetic()
        observed = []
        out = a.analyze([r[0], r[0]], [np.full(1024,100.), t[0]], OPTIONS,
                        on_bin_error=lambda *args: observed.append(args))
        self.assertEqual([row['index'] for row in out['rows']], [0,1])
        self.assertEqual(out['summary'], dict(total=2, succeeded=1, failed=1))
        failed, valid = out['rows']
        self.assertEqual(failed['error']['stage'], 'thomson_integral')
        self.assertIsNone(failed['ne'])
        self.assertIsNone(failed['fit'])
        self.assertIn('Traceback', failed['error']['traceback'])
        self.assertEqual(observed[0][0], 0)
        self.assertTrue(valid['converged'])
        self.assertAlmostEqual(valid['Te'], 30, delta=2)
        self.assertAlmostEqual(valid['Ti'], 15, delta=2)
        self.assertTrue(valid['warnings'])
        json.dumps(out, allow_nan=False)

    def test_all_failed_bins_are_json_safe_without_zero_measurements(self):
        r, t = synthetic()
        out = a.analyze([np.full(1024,np.nan),r[0]], [t[0],np.full(1024,np.nan)], OPTIONS)
        self.assertEqual(out['summary']['failed'], 2)
        self.assertEqual([row['error']['stage'] for row in out['rows']], ['input_validation','input_validation'])
        self.assertTrue(all(row['ne'] is None and row['Te'] is None and row['iterations'] is None for row in out['rows']))
        json.dumps(out, allow_nan=False)

    def test_optimizer_exception_is_reported_per_bin_and_batch_continues(self):
        r, t = synthetic()
        observed = []
        with patch.object(a.Model, 'fit', side_effect=RuntimeError('optimizer failed, "test"')):
            out = a.analyze([r[0],r[0]], [t[0],t[0]], OPTIONS, on_bin_error=lambda *args:observed.append(args))
        self.assertEqual(out['summary']['failed'],2)
        self.assertEqual(len(observed),2)
        self.assertEqual([row['error']['stage'] for row in out['rows']], ['fitting','fitting'])
        self.assertIn('RuntimeError',out['rows'][0]['error']['traceback'])

    def test_fwhm_controls_actual_gaussian_broadening_and_resets_each_run(self):
        x = np.arange(1024)
        source = np.exp(-.5*((x-512)/2)**2)
        for fwhm in [4.8,16.,8.]:
            a.configure({**OPTIONS, 'fwhm':fwhm})
            with patch.object(a.thomson, 'spectral_density', return_value=(1.,source.copy())):
                curve = a.custom_thomson_model(a.wavelengths,1e25,30,15,480,0)
            measured = np.sqrt(np.sum((x-512)**2*curve)/np.sum(curve))
            expected = np.sqrt(2**2+(fwhm/(2*np.sqrt(2*np.log(2))))**2)
            self.assertAlmostEqual(measured,expected,delta=.005)
        for bad in [0,-1,float('nan'),float('inf')]:
            with self.assertRaisesRegex(ValueError,'FWHM'):
                a.configure({**OPTIONS,'fwhm':bad})
