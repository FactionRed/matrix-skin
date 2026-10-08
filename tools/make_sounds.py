"""Synthesize matrix-skin's sound effects into sounds/*.wav.

Every sound is generated here from oscillators and noise, so the plugin ships
no recorded or copyrighted audio. Run: python tools/make_sounds.py
"""

import os
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 22050  # samples a second: plenty for these sounds, and small files
RNG = np.random.default_rng(1999)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sounds')


def t_of(seconds):
    return np.arange(int(seconds * SR)) / SR


def fade(x, ms=5):
    """Short fades at both ends, so no segment starts or stops with a click."""
    n = min(len(x) // 2, int(SR * ms / 1000))
    if n:
        ramp = np.linspace(0, 1, n)
        x[:n] *= ramp
        x[-n:] *= ramp[::-1]
    return x


def lowpass(x, hz, order=2):
    return sosfilt(butter(order, hz, 'low', fs=SR, output='sos'), x)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def saw(freq_hz, t):
    """A sawtooth whose frequency may change over time (an array)."""
    phase = np.cumsum(np.broadcast_to(freq_hz, t.shape) / SR)
    return 2 * (phase % 1) - 1


def sine(freq_hz, t):
    phase = np.cumsum(np.broadcast_to(freq_hz, t.shape) / SR)
    return np.sin(2 * np.pi * phase)


def place(track, clip, at_seconds, gain=1.0):
    start = int(at_seconds * SR)
    end = min(len(track), start + len(clip))
    track[start:end] += gain * clip[: end - start]


def write(name, x, peak=0.85, drive=1.0):
    """Normalize, saturating first by `drive` so quiet sections carry next to loud ones."""
    x = x / max(1e-9, np.max(np.abs(x)))
    if drive > 1:
        x = np.tanh(drive * x) / np.tanh(drive)
    x = x * peak
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    print(f'{path}: {len(x) / SR:.2f}s')


def boot():
    """The jack-in: a phone line dials, a modem screeches, the signal rises, impact."""
    track = np.zeros(int(3.6 * SR))

    # 0.00-0.70s: a number dialled on a touch-tone line.
    dtmf = {'3': (697, 1477), '1': (697, 1209), '4': (770, 1209), '5': (770, 1336), '9': (852, 1477)}
    for k, digit in enumerate('314159'):
        lo, hi = dtmf[digit]
        t = t_of(0.07)
        place(track, fade(0.5 * np.sin(2 * np.pi * lo * t) + 0.5 * np.sin(2 * np.pi * hi * t)), 0.02 + k * 0.11, 0.35)

    # 0.70-1.10s: the answer tone, its phase flipping every 0.15s.
    t = t_of(0.4)
    flips = np.where((t // 0.15) % 2 == 0, 1.0, -1.0)
    place(track, fade(np.sin(2 * np.pi * 2100 * t) * flips), 0.70, 0.22)

    # 1.10-2.30s: the handshake screech: FSK warble, FM chirps and bursts of noise.
    t = t_of(1.2)
    fsk = np.sin(2 * np.pi * np.cumsum(np.where((t * 25).astype(int) % 2 == 0, 980, 1180)) / SR)
    chirp = sine(1800 + 600 * np.sin(2 * np.pi * 7 * t) + 400 * np.sin(2 * np.pi * 300 * t), t)
    noise = bandpass(RNG.standard_normal(len(t)), 1500, 3500)
    gate = ((t * 10).astype(int) % 2).astype(float)
    screech = 0.35 * fsk * (1 - gate) + 0.3 * chirp * gate + 0.25 * noise / np.max(np.abs(noise)) * gate
    place(track, fade(screech * (0.8 + 0.2 * np.sin(2 * np.pi * 13 * t)), 20), 1.10, 0.9)

    # 2.30-3.25s: the signal rises, a saw sweeping up through an opening filter.
    t = t_of(0.95)
    freq = 60 * (900 / 60) ** (t / t[-1])
    rise = lowpass(saw(freq, t) * (t / t[-1]) ** 1.5, 2500)
    for k in range(6):  # digital blips along the way
        b = t_of(0.02)
        place(rise, np.sign(np.sin(2 * np.pi * (1200 + 300 * k) * b)) * 0.5, 0.15 + k * 0.13)
    place(track, fade(rise, 15), 2.30, 0.5)

    # 3.25-3.60s: impact, a dropping thump with a click: jacked in.
    t = t_of(0.35)
    thump = sine(90 * (0.5 ** (t / 0.12)) + 45, t) * np.exp(-t / 0.09)
    click = np.zeros_like(t)
    click[: int(0.005 * SR)] = RNG.standard_normal(int(0.005 * SR)) * 0.6
    place(track, fade(thump + click, 2), 3.25, 1.0)

    write('boot.wav', track, drive=3.0)


def smith():
    """An Agent Smith deploys: a low dissonant stab, then copies of him multiplying."""
    track = np.zeros(int(1.6 * SR))

    # A low stab: two saws a near-semitone apart, filtered dark, slowly dying.
    t = t_of(1.5)
    env = np.minimum(1, t / 0.02) * np.exp(-t / 0.55)
    stab = lowpass(saw(55, t) + saw(58.3, t) + 0.5 * saw(110.2, t), 420) * env
    place(track, fade(stab, 10), 0.0, 0.8)

    # Metallic shimmer: two ringing partials, multiplied together.
    ring = np.sin(2 * np.pi * 220 * t) * np.sin(2 * np.pi * 311 * t) * np.exp(-t / 0.35)
    place(track, fade(ring, 10), 0.05, 0.25)

    # Replication: square blips coming faster and higher, copy after copy.
    at = 0.25
    for k in range(10):
        b = t_of(0.025)
        blip = np.sign(np.sin(2 * np.pi * (900 + 140 * k) * b)) * np.exp(-b / 0.012)
        place(track, fade(blip, 1), at, 0.18 + 0.02 * k)
        at += 0.12 * (0.82 ** k)

    write('smith.wav', track, peak=0.8)


if __name__ == '__main__':
    boot()
    smith()
