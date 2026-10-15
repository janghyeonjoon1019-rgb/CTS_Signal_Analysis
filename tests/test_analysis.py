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
        self.assertEqual(out['options']['model_oversample'],16)
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
        dense_x = np.arange(1023*a.MODEL_OVERSAMPLE+1)/a.MODEL_OVERSAMPLE
        source = np.exp(-.5*((dense_x-512)/2)**2)
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

    def test_narrow_peaks_are_resolved_before_broadening(self):
        a.configure(OPTIONS)
        # Subpixel placement must not create an artificial imbalance.
        def narrow_lines(wavelengths, *args, **kwargs):
            x = (wavelengths.to_value('nm') - a.wavelengths[0])/a.pixel
            return 1., (np.exp(-.5*((x-460.17)/.08)**2)
                        + np.exp(-.5*((x-498.63)/.08)**2))
        with patch.object(a.thomson, 'spectral_density', side_effect=narrow_lines):
            curve = a.custom_thomson_model(a.wavelengths,1e25,30,15,480,2)
        self.assertEqual(len(curve),1024)
        self.assertAlmostEqual(curve[:480].max()/curve[480:].max(),1.,delta=.01)
        self.assertTrue(np.all(np.isfinite(curve)))

    def test_velocity_box_retains_pixel_width_and_center(self):
        a.configure(OPTIONS)
        x = np.arange(1024)
        dense_x = np.arange(1023*a.MODEL_OVERSAMPLE+1)/a.MODEL_OVERSAMPLE
        source = np.exp(-.5*((dense_x-512)/2)**2)
        for width in [2, 5, 8]:
            with patch.object(a.thomson,'spectral_density',return_value=(1.,source.copy())):
                curve = a.custom_thomson_model(a.wavelengths,1e25,30,15,480,width)
            self.assertAlmostEqual(np.sum(x*curve)/np.sum(curve),512.,places=8)
            variance = np.sum((x-512)**2*curve)/np.sum(curve)
            self.assertAlmostEqual(variance,4+a.sigma**2+width**2/12,delta=.02)

    def test_uploaded_last_bin_parameters_converge_with_grid_refinement(self):
        a.configure(dict(OPTIONS,n1=476,n2=486))
        args=(a.wavelengths,5.656487049122667e25,11.167949969241352,
              6.318223636210738,476.0867696192872,2)
        coarse = a.custom_thomson_model(*args)
        with patch.object(a,'MODEL_OVERSAMPLE',128):
            fine = a.custom_thomson_model(*args)
        self.assertLess(np.max(np.abs(coarse-fine)),.002)
        self.assertAlmostEqual(coarse[:475].max()/coarse[475:].max(),1.,delta=.01)

    def test_sampling_option_controls_grid_and_resets_between_runs(self):
        for factor in [3, 16, 32, 64]:
            a.configure(dict(OPTIONS, model_oversample=factor))
            def source(wavelengths, *args, **kwargs):
                self.assertEqual(len(wavelengths),1023*factor+1)
                x = np.arange(len(wavelengths))/factor
                return 1.,np.exp(-.5*((x-512)/2)**2)
            with patch.object(a.thomson,'spectral_density',side_effect=source):
                curve=a.custom_thomson_model(a.wavelengths,1e25,30,15,480,3)
            self.assertEqual(len(curve),1024)
            self.assertAlmostEqual(np.sum(np.arange(1024)*curve)/curve.sum(),512.,places=8)
            out=a.analyze([[100.]*1024],[[100.]*1024],dict(OPTIONS,model_oversample=factor))
            self.assertEqual(out['options']['model_oversample'],factor)
        a.configure(OPTIONS)
        self.assertEqual(a.MODEL_OVERSAMPLE,16)
        for bad in [0,-1,1.5,float('nan'),float('inf')]:
            with self.assertRaisesRegex(ValueError,'oversampling'):
                a.configure(dict(OPTIONS,model_oversample=bad))
