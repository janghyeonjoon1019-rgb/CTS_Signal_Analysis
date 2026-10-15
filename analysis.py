"""Browser/CPython fitting engine adapted from the supplied Sn-119 model."""
import numpy as np
import math

import astropy.units as u
import scipy.ndimage as ndimage

from scipy.interpolate import RectBivariateSpline

from plasmapy.diagnostics import thomson
from lmfit import Model, Parameters

probe_wavelength = 532 # nm
pixel = 2.266 / 1000 # nm

"""
人の触って良いところ
"""
# Notch Filter
n1, n2 = 475, 485 # pixel
N1, N2 = 532-(512-n1)*pixel, 532-(512-n2)*pixel # nm

# Laser Energy of Rayleigh and Thomson
ELR, ELT = 1, 1 # mJ

# Number of Shots of Rayleigh and Thomson
shot_R, shot_T = 6, 1

"""
ここまで
"""

# Laboratory Setting
num_pixel = 512
centerpixel = int((n1 + n2)/2)
wavelengths = np.arange(probe_wavelength - (centerpixel - 1) * pixel, probe_wavelength + (1024-centerpixel) * pixel, pixel) # nm

# Region of Interest
Low, High = 531, 533 # nm

Mask = (wavelengths > Low) & (wavelengths < High)
Mask &= ~((wavelengths > N1) & (wavelengths < N2))

probe_vec = np.array([1, 0, 0])
scattering_angle = np.deg2rad(135)
scatter_vec = np.array([np.cos(scattering_angle), np.sin(scattering_angle), 0])

vel = np.array([0, 0, 0])
electron_vel = vel.reshape(1, 3) * u.km / u.s
ion_vel = np.vstack([vel, vel]) * u.km / u.s


cross_section_ratio = 132

# Instrument Function
fwhm =8 # pixel, sqrt(4^2-(20/13)^2) 4.8 pixel 程度 20umの入口スリットが4 pixelに見えるから
sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))

# Rayleigh Signal calculation
def calc_intensity_rayleigh(data):
    # Setting Background
    b1, b2, b3, b4 = 200, 350, 600, 750

    avg1 = np.mean(data[b1:b2])
    avg2 = np.mean(data[b3:b4])
    x1, x2 = (b1 + b2) / 2, (b3 + b4) / 2
    x_axis = np.arange(1024)
    background = avg1 + (avg2 - avg1) / (x2 - x1) * (x_axis - x1)

    # Get Rayleigh Signal from 450 to 650 pixel
    s1, s2 = 400, 650
    net_signal = np.sum(data[s1:s2]) - np.sum(background[s1:s2])
    if net_signal < 0:
        raise ValueError("Rayleigh integral is negative. Check the background and selected range.")

    # return net_signal:int, background:array(1024)
    return net_signal, background

# Finding Center
def calc_center(data):
    best_center = 512
    min_diff = float('inf')

    for c in range(400, 650):
        width1 = 350
        left = data[c-width1 : c]
        right = data[c : c+width1][::-1] # 右側ひっくり返し

        # ピクセル領域配列
        idx_l = np.arange(c-width1, c)
        idx_r = np.arange(c, c+width1)[::-1]

        # ノッチじゃない部分だけ使う
        mask_l = (idx_l < n1) | (idx_l > n2)
        mask_r = (idx_r < n1) | (idx_r > n2)

        final_mask = mask_l & mask_r

        # ノッチじゃない部分（final_mask)のみ使って対称軸探し
        if np.any(final_mask): # 計算するデータが残っているとき
            diff = np.mean((left[final_mask] - right[final_mask])**2)

            if diff < min_diff:
                min_diff = diff
                best_center = c

    # return best_center:int
    return best_center

# Thomson Signal calculation
def calc_intensity_thomson(data, best_center):
    # Setting Background
    b1, b2, b3, b4 = 200, 350, 600, 750

    avg1 = np.mean(data[b1:b2])
    avg2 = np.mean(data[b3:b4])
    x1, x2 = (b1 + b2) / 2, (b3 + b4) / 2
    x_axis = np.arange(1024)
    background = avg1 + (avg2 - avg1) / (x2 - x1) * (x_axis - x1)
    net_data = data - background

    # ノッチのないきれいな方で面積積分、その後2倍
    if (n1 + n2) / 2 > best_center:
        half_area = np.sum(net_data[best_center-100 : best_center])
    else:
        half_area = np.sum(net_data[best_center : best_center+100])

    # return half_area*2:float, background:array(1024)
    return half_area * 2, background

# Interpolation of Z from FLYCHK data
Te_axis = np.array([1, 5, 10, 15, 23, 32, 52, 74, 100]) # eV
ne_axis = np.array([1e22, 1e23, 1e24, 1e25, 1e26, 1e27]) # m^-3
ne_log_axis = np.log10(ne_axis) # 密度はログ値で比較

z_data = np.array([
    [1.408, 3.992, 4.915, 5.811, 6.890, 7.890, 9.680, 11.320, 12.980],
    [0.448, 3.994, 5.501, 6.675, 7.822, 8.659, 10.594, 11.968, 13.109],
    [0.064, 3.916, 5.816, 7.561, 9.151, 10.250, 11.900, 13.068, 13.244],
    [0.009, 3.921, 5.480, 7.645, 10.043, 11.815, 13.740, 14.489, 16.071],
    [0.002, 2.198, 4.349, 6.540, 9.477, 12.104, 14.251, 15.856, 17.576],
    [0.001, 1.016, 3.010, 4.875, 7.649, 10.346, 13.814, 16.811, 19.081]
    ])

z_spline = RectBivariateSpline(ne_log_axis, Te_axis, z_data, kx=3, ky=3) #2D Bivariate Spline Interpolation

def get_z_avg(ne, Te):
    ne_clamped = np.clip(ne, 1e22, 1e27)
    te_clamped = np.clip(Te, 1, 100)

    # return average Z as float
    return float(z_spline(np.log10(ne_clamped), te_clamped)[0,0])

# Modeling Thomson Spectrum
def custom_thomson_model(wavelengths, ne, Te, Ti, center, width):
    z_avg = get_z_avg(ne, Te)
    if z_avg < 1:
        z_avg = 1
    z1 = math.floor(z_avg)
    z2 = z1 + 1
    ion_species = [f"Sn-119 {z1}+", f"Sn-119 {z2}+"]
    ifract = np.array([(z2 - z_avg), (z_avg - z1)])

    wavelengths = wavelengths - (center-centerpixel) * pixel

    alpha, Skw = thomson.spectral_density(
        wavelengths * u.nm,
        probe_wavelength * u.nm,
        ne * u.m**-3,
        T_e = Te * u.eV,
        T_i = [Ti, Ti] * u.eV,
        ions = ion_species,
        ifract = ifract,
        electron_vel = electron_vel,
        ion_vel = ion_vel,
        probe_vec = probe_vec,
        scatter_vec = scatter_vec,
    )

    # Broadening by Instrument Function
    Skw = ndimage.gaussian_filter1d(Skw, sigma)

    # Broadening by Plasma Velocity
    width = int(round(width))
    if width > 1:
        kernel = np.ones(width) / width
        Skw = np.convolve(Skw, kernel, mode='same')

    Skw /= np.max(Skw)

    return np.nan_to_num(Skw)



def configure(options):
    global n1, n2, N1, N2, centerpixel, wavelengths, Mask, ELR, ELT, shot_R, shot_T
    n1, n2 = int(options['n1']), int(options['n2'])
    if not 0 <= n1 < n2 < 1024:
        raise ValueError('Notch must satisfy 0 <= from < to < 1024.')
    ELR, ELT = float(options['ELR']), float(options['ELT'])
    shot_R, shot_T = int(options['shot_R']), int(options['shot_T'])
    if min(ELR, ELT, shot_R, shot_T) <= 0:
        raise ValueError('Laser energies and accumulated shot counts must be positive.')
    centerpixel = (n1 + n2) // 2
    wavelengths = probe_wavelength + (np.arange(1024) - centerpixel + 1) * pixel
    # Mask and shaded notch use the same detector pixel coordinates.
    Mask = (wavelengths > Low) & (wavelengths < High)
    Mask &= ~((np.arange(1024) >= n1) & (np.arange(1024) <= n2))


def analyze(rayleigh, thomson_data, options, progress=None):
    configure(options)
    R, T = np.asarray(rayleigh, dtype=float), np.asarray(thomson_data, dtype=float)
    if R.ndim != 2 or R.shape != T.shape or R.shape[1] != 1024 or len(R) == 0:
        raise ValueError('R and T must have matching Y bins and 1024 columns.')
    if not np.all(np.isfinite(R)) or not np.all(np.isfinite(T)):
        raise ValueError('Input contains NaN or infinite values.')
    centers = np.array([calc_center(row) for row in T])
    widths = np.abs(np.gradient(centers)) if len(T) > 1 else np.zeros(1)
    rows = []
    for i, (r, t) in enumerate(zip(R, T)):
        if progress:
            progress(i, len(T))
        ir, br = calc_intensity_rayleigh(r)
        it, bt = calc_intensity_thomson(t, int(centers[i]))
        if ir <= 0 or it <= 0:
            raise ValueError(f'Y bin {i + 1}: integrated signal is not positive (R={ir:.4g}, T={it:.4g}).')
        net = t - bt
        if np.max(net) <= 0:
            raise ValueError(f'Y bin {i + 1}: no positive signal available for normalization.')
        net = net / np.max(net)
        te, ti = 30., 30.
        converged = False
        fitted_center = float(centers[i])
        for iteration in range(20):
            old_te, old_ti = te, ti
            si = 1.
            for density_iteration in range(200):
                density = 2.5e25 * it / ir * ELR / ELT / cross_section_ratio / si * shot_R / shot_T
                alpha = .8 * np.sqrt(density / old_te * 1e-22)
                z = get_z_avg(density, old_te)
                next_si = z * alpha**4 / (1 + alpha**2) / (1 + alpha**2 * (1 + z * old_te / old_ti))
                if not np.isfinite(next_si) or next_si <= 0:
                    raise ValueError(f'Y bin {i + 1}: invalid density iteration value.')
                if abs(si - next_si) <= .005:
                    break
                si = next_si
            else:
                raise ValueError(f'Y bin {i + 1}: density did not converge within 200 iterations.')
            # Evaluate convolution on the full, uniformly spaced detector grid;
            # masking before convolution would join the two sides of the notch.
            def fit_model(wavelengths, Te, Ti, center):
                return custom_thomson_model(globals()['wavelengths'], density, Te, Ti, center, widths[i])[Mask]
            model = Model(fit_model, independent_vars=['wavelengths'])
            params = model.make_params(Te=old_te, Ti=old_ti, center=centers[i])
            params['Te'].set(min=1, max=70)
            params['Ti'].set(min=1, max=70)
            params['center'].set(min=centers[i]-10, max=centers[i]+10)
            result = model.fit(net[Mask], params, wavelengths=wavelengths[Mask],
                               method='differential_evolution', fit_kws={'seed': 42}, max_nfev=12000)
            if not result.success:
                raise ValueError(f'Y bin {i + 1}: fitting failed: {result.message}')
            te, ti = result.params['Te'].value, result.params['Ti'].value
            fitted_center = result.params['center'].value
            if abs(te-old_te) <= 2 and abs(ti-old_ti) <= 5:
                converged = True
                break
        velocity = (centerpixel-centers[i]) * pixel / 532 * 3e8 / np.sin(np.deg2rad(135/2)) / 2
        rows.append(dict(index=i, ne=float(density), Te=float(te), Ti=float(ti),
                         Z=get_z_avg(density, te), velocity=float(velocity),
                         center=int(centers[i]), fitted_center=float(fitted_center), width=float(widths[i]),
                         rayleigh_integral=float(ir), thomson_integral=float(it),
                         converged=converged, iterations=iteration+1, redchi=float(result.redchi),
                         signal=net.tolist(), fit=custom_thomson_model(wavelengths, density, te, ti, fitted_center, widths[i]).tolist(),
                         rayleigh=r.tolist(), rayleigh_background=br.tolist()))
    return dict(rows=rows, wavelengths=wavelengths.tolist(), options=options)
