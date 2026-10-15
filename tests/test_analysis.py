import unittest
import numpy as np
import analysis as a

OPTIONS = dict(n1=475, n2=485, ELR=1, ELT=1, shot_R=6, shot_T=1)


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
            a.analyze([[float('nan')]*1024], [[1]*1024], OPTIONS)
        with self.assertRaises(ValueError):
            a.analyze([[1]*1024], [[1]*1024], OPTIONS)
        with self.assertRaises(ValueError):
            a.configure({**OPTIONS, 'ELT':0})

    def test_notch_mask_uses_detector_pixels(self):
        a.configure(OPTIONS)
        self.assertFalse(np.any(a.Mask[475:486]))
        self.assertTrue(a.Mask[474])
        self.assertTrue(a.Mask[486])
