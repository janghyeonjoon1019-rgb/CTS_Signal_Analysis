"""
https://janghyeonjoon1019-rgb.github.io/fitting/
上記のリンクからレイリー信号とトムソン信号を .txtファイルで保存すること。
ファイルの名前は Rayleigh.txt, Thomson.txt
上記のリンクで X座標は 0-1024, Y座標は必要に応じて両方同じ範囲に。
2つのファイルはこの実行ファイルと同じフォルダに入れること。

波長 532 nm
ターゲット Sn
後方 135°
2.266 pm / 1 pixel
装置関数 4.8 pixel
"""

import numpy as np
import math
import matplotlib.pyplot as plt
import astropy.units as u
import scipy.ndimage as ndimage

from scipy.interpolate import RectBivariateSpline
from plasmapy.particles import Particle
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

SN_MASS = Particle("Sn-119").mass.value
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
        net_signal = 100
        print("error, Rayleigh small")
        print(i)
    
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

# Reading File
raw_data_R = np.loadtxt('R.txt')
y_matrix_R = raw_data_R.reshape(-1, 1024)
Rrows, Rcols = y_matrix_R.shape

raw_data_T = np.loadtxt('T.txt')
y_matrix_T = raw_data_T.reshape(-1, 1024)
Trows, Tcols = y_matrix_T.shape

# Data location
net_signal_R = np.zeros(Rrows)
background_R = np.zeros((Rrows, 1024))

net_signal_T = np.zeros(Trows)
background_T = np.zeros((Trows, 1024))

net_data = np.zeros((Trows, 1024))
center_T = np.zeros(Trows)

width = np.zeros(Trows)

# Plasma Parameters
ne = np.zeros(Trows)
Te = np.full(Trows, 30)
Ti = np.full(Trows, 30)
Z = np.zeros(Trows)
c = np.zeros(Trows, dtype=int)
v = np.zeros(Trows)

# Best Center Calculation
for i in range(Trows):
    c[i] = calc_center(y_matrix_T[i])
    v[i] = (centerpixel - c[i]) * pixel / 532 * 3e8 / np.sin(np.deg2rad(135/2)) / 2

# Rayleigh Signal Calculation
for i in range(Rrows):
    net_signal_R[i], background_R[i] = calc_intensity_rayleigh(y_matrix_R[i])

# Thomson Signal Calculation
for i in range(Trows):
    net_signal_T[i], background_T[i] = calc_intensity_thomson(y_matrix_T[i], c[i])

# ne, Te Calculation
for i in range(Trows):
    Te_init = 0 # eV
    Ti_init = 0 # eV
    print(i)
    while(abs(Te[i] - Te_init) > 2 or abs(Ti[i] - Ti_init) > 5):
        Te_init = Te[i]
        Ti_init = Ti[i]
        Si_init = 0.9
        Si = 1.0
        # ne Calculation, until Si converges
        while(abs(Si_init - Si) > 0.005):
            Si_init = Si
            ne[i] = 2.5e25 * net_signal_T[i] / net_signal_R[i] * ELR / ELT / cross_section_ratio / Si_init * shot_R / shot_T
            alpha = 0.8 * (ne[i] / Te_init * 1e-22) ** 0.5
            Z[i] = get_z_avg(ne[i], Te_init)
            Si = Z[i] * alpha**4 / (1 + alpha**2) / (1 + alpha**2 * (1 + Z[i] * Te_init / Ti_init))
            #print(Si, Z[i])
        #print(ne[i], Te_init)
        if ne[i] < 0:
            print("error, ne minus")
            ne[i] *= -1
        #Te, Ti Calculation, by Non-linear Least Squares Method
        net_data[i] = y_matrix_T[i] - background_T[i]
        net_data[i] /= np.max(net_data[i])
        
        if i < Trows - 1 and i > 0: width[i] = abs(round((c[i+1] - c[i-1]) / 2))
        elif i == 0: width[i] = abs(c[1] - c[0])
        elif i == Trows - 1: width[i] = abs(c[Trows - 1] - c[Trows - 2])
        
        
        gmodel = Model(custom_thomson_model, independent_vars=['wavelengths'])
        
        params = Parameters()
        params.add('ne', value=ne[i], vary=False)
        params.add('Te', value=Te_init, min=1, max=70)
        params.add('Ti', value=Ti_init, min=1, max=70)
        params.add('center', value=c[i], min=c[i]-10, max=c[i]+10)
        params.add('width', value=width[i], vary=False)
        
        result = gmodel.fit(net_data[i][Mask], params, wavelengths=wavelengths[Mask], method='differential_evolution')
        Te[i] = result.params['Te'].value
        Ti[i] = result.params['Ti'].value
        Z[i] = get_z_avg(ne[i], Te[i])

for i in range(Trows):
    print(i, round(ne[i], -24), Te[i], round(Z[i], 1), round(v[i] / 1000, 2))
    print(net_signal_R[i], net_signal_T[i])

plt.figure(figsize=(10, 6))
plt.plot(ne, color='green', label='ne', alpha=0.7)
plt.yscale('log')
plt.ylim(1e24,1e26)
plt.legend()
plt.title("electron density")
plt.xlabel("Pixel Index")
plt.ylabel("ne [m^-3]")
plt.show()

plt.figure(figsize=(10, 6))
plt.plot(Te, color='Blue', label='Te', alpha=0.7)
plt.plot(Ti, color='Red', label='Ti', alpha=0.7)
plt.legend()
plt.title("electron/ion temperature")
plt.xlabel("Pixel Index")
plt.ylabel("Te [eV] Ti [eV]")
plt.show()

for i in range(Trows):
    plt.figure(figsize=(10, 6))
    plt.plot(wavelengths, net_data[i], color='gray', alpha=1.0, label='Raw Signal')
    plt.axvspan(wavelengths[n1], wavelengths[n2], color='gray', alpha=0.3, label='Notch(Masked)')
    c_val = int(c[i])
    plt.axvline(wavelengths[c_val], color='magenta', linestyle=':', label=f'Velocity: {v[i]}')
    if (n1 + n2) / 2 > c_val:
        fill_mask = (wavelengths >= wavelengths[max(0, c_val-100)]) & (wavelengths <= wavelengths[c_val])
    else:
        fill_mask = (wavelengths >= wavelengths[c_val]) & (wavelengths <= wavelengths[min(1023, c_val+100)])
    #plt.fill_between(wavelengths[fill_mask], net_data[i][fill_mask], color='yellow', alpha=0.4)
    plt.plot(wavelengths, custom_thomson_model(wavelengths, ne[i], Te[i], Ti[i], c[i], width[i]), color='red', alpha=0.5, label='Best Fit Line')
    plt.xlabel('Wavelength [nm]')
    plt.ylabel('Normalized Signal Intensity')
    plt.xlim(531.64, 532.34)
    plt.ylim(0, 1.1)
    plt.title(f'Thomson Scattering Fitting{i}')
    plt.legend()
    plt.show()
# Rayleigh --- plot ---
for i in range(Trows):
    plt.figure(figsize=(10, 5))
    plt.plot(wavelengths, y_matrix_R[i], color='green', label='Raw Signal', alpha=0.7) 
    plt.plot(wavelengths, background_R[i], 'r--', label='Background') 
    
    # 信号領域を黄色で塗る
    plt.fill_between(wavelengths[400:650], background_R[i, 400:650], y_matrix_R[i, 400:650], 
                     color='yellow', alpha=0.5)
    
    plt.legend()
    plt.title("Rayleigh Signal Intensity")
    plt.xlabel("Pixel Index")
    plt.ylabel("Intensity")
    plt.show()