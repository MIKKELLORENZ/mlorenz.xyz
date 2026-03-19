#!/usr/bin/env python3
"""
phase3_verify.py — High-Resolution BKM Verification at 1024³
==============================================================
Takes the optimized vorticity field from Phase 2 and runs a massive,
single-node simulation at 1024³ using all 120 threads.

Key features:
  • Spectral interpolation 256³ → 1024³ (zero-padding in Fourier space)
  • Carpenter-Kennedy 2N-storage RK4(5) for halved memory footprint
  • CFL-adaptive time stepping
  • Tracks ||ω||_∞(t), enstrophy E(t), kinetic energy, ∇·u at every step
  • Running BKM integral ∫₀ᵗ ||ω||_∞ ds (trapezoidal rule)
  • Blow-up detection: fits ||ω||_∞(t) ≈ A/(T*−t)^α
  • Full diagnostics saved to HDF5

Memory budget: ~130 GB for 1024³. Requires OMP_NUM_THREADS=120.

Usage:
    source env.sh && source .venv/bin/activate
    python phase3_verify.py [--omega-file results/optimized_omega0.npy]
                            [--N-high 1024] [--N-low 256]

Always monitor memory with `htop` or `free -h` during the run.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

# Set threading BEFORE any numerical imports
os.environ["JAX_PLATFORM_NAME"] = "cpu"
os.environ["JAX_ENABLE_X64"] = "True"
os.environ["OMP_NUM_THREADS"] = "120"
os.environ["MKL_NUM_THREADS"] = "120"
os.environ["OPENBLAS_NUM_THREADS"] = "120"
os.environ["XLA_FLAGS"] = "--xla_cpu_multi_thread_eigen=true intra_op_parallelism_threads=120"

import jax
import jax.numpy as jnp
import numpy as np
from jax.numpy.fft import irfftn, rfftn
from scipy.optimize import curve_fit

from jax_spectral_solver import (
    cfl_dt,
    divergence_max,
    enstrophy_fourier,
    kinetic_energy,
    max_vorticity,
    rk4_lowstorage_step,
    setup_grid,
    spectral_interpolate,
    velocity_from_vorticity,
)


# ============================================================================
# Configuration
# ============================================================================
DEFAULT_N_HIGH = 1024        # Verification grid resolution
DEFAULT_N_LOW = 256          # Source grid resolution (Phase 2 output)
DEFAULT_NU = 0.0005
DEFAULT_T = 0.5
DEFAULT_CFL = 0.5
DEFAULT_DT_MAX = 0.001       # Conservative max dt at 1024³
DIAG_INTERVAL = 1            # Diagnostics every step (critical for BKM)


# ============================================================================
# Memory Estimation
# ============================================================================
def estimate_memory_gb(N: int) -> dict:
    """Estimate memory requirements for a 1024³ simulation."""
    Nz = N // 2 + 1
    complex_bytes = 16  # complex128
    real_bytes = 8      # float64

    omega_hat = 3 * N * N * Nz * complex_bytes      # ω̂
    register = 3 * N * N * Nz * complex_bytes        # 2N-storage register
    u_hat = 3 * N * N * Nz * complex_bytes           # û (temporary in RHS)
    scratch = 9 * N * N * N * real_bytes              # Physical-space temps (9 = 3 stretch + 3 advect + 3 omega)
    velocity_grad = 9 * N * N * N * real_bytes        # ∂u_i/∂x_j temporary

    total = omega_hat + register + u_hat + scratch + velocity_grad
    return {
        "omega_hat_GB": omega_hat / 1e9,
        "register_GB": register / 1e9,
        "u_hat_GB": u_hat / 1e9,
        "scratch_GB": scratch / 1e9,
        "velocity_grad_GB": velocity_grad / 1e9,
        "total_GB": total / 1e9,
    }


# ============================================================================
# Blow-Up Curve Fitting
# ============================================================================
def fit_blowup_curve(
    times: np.ndarray,
    omega_inf: np.ndarray,
    min_points: int = 20,
) -> dict | None:
    """
    Fit ||ω||_∞(t) ≈ A / (T* − t)^α to estimate the blow-up time T*.

    Only uses the last portion of the trajectory where ||ω||_∞ is increasing.

    Returns
    -------
    dict with keys: T_star, alpha, A, residual, or None if fit fails.
    """
    if len(times) < min_points:
        return None

    # Use only the rising portion (last 50% of data where it's mostly increasing)
    n = len(times)
    start_idx = max(0, n - n // 2)
    t_fit = times[start_idx:]
    w_fit = omega_inf[start_idx:]

    # Filter out non-increasing parts
    mask = np.ones(len(t_fit), dtype=bool)
    for i in range(1, len(t_fit)):
        if w_fit[i] < w_fit[i - 1] * 0.95:
            mask[i] = False
    t_fit = t_fit[mask]
    w_fit = w_fit[mask]

    if len(t_fit) < min_points:
        return None

    # Model: f(t) = A / (T* - t)^alpha
    def model(t, A, T_star, alpha):
        dt = T_star - t
        dt = np.maximum(dt, 1e-10)  # Prevent division by zero
        return A / dt**alpha

    try:
        # Initial guess: T* slightly beyond the last time, alpha=1 (Beale-Kato-Majda)
        T_guess = t_fit[-1] * 1.1
        A_guess = w_fit[-1] * (T_guess - t_fit[-1])
        p0 = [A_guess, T_guess, 1.0]
        bounds = ([0.0, t_fit[-1] + 1e-6, 0.1], [1e20, 10.0, 10.0])

        popt, pcov = curve_fit(model, t_fit, w_fit, p0=p0, bounds=bounds, maxfev=5000)
        residual = float(np.sqrt(np.mean((model(t_fit, *popt) - w_fit) ** 2)))

        return {
            "A": float(popt[0]),
            "T_star": float(popt[1]),
            "alpha": float(popt[2]),
            "residual": residual,
            "n_points_used": len(t_fit),
        }
    except (RuntimeError, ValueError):
        return None


# ============================================================================
# HDF5 Diagnostics Writer
# ============================================================================
class HDF5Logger:
    """Append diagnostic data to an HDF5 file incrementally."""

    def __init__(self, path: str, N: int, nu: float, T: float):
        import h5py
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.f = h5py.File(path, "w")
        # Metadata
        self.f.attrs["N"] = N
        self.f.attrs["nu"] = nu
        self.f.attrs["T"] = T
        self.f.attrs["created"] = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
        # Resizable datasets
        self.f.create_dataset("time", shape=(0,), maxshape=(None,), dtype="f8")
        self.f.create_dataset("dt", shape=(0,), maxshape=(None,), dtype="f8")
        self.f.create_dataset("omega_inf", shape=(0,), maxshape=(None,), dtype="f8")
        self.f.create_dataset("enstrophy", shape=(0,), maxshape=(None,), dtype="f8")
        self.f.create_dataset("kinetic_energy", shape=(0,), maxshape=(None,), dtype="f8")
        self.f.create_dataset("div_max", shape=(0,), maxshape=(None,), dtype="f8")
        self.f.create_dataset("bkm_integral", shape=(0,), maxshape=(None,), dtype="f8")
        self.f.create_dataset("wall_time_step", shape=(0,), maxshape=(None,), dtype="f8")
        self._n = 0

    def append(self, **kwargs):
        """Append one row of diagnostics."""
        for key, val in kwargs.items():
            if key in self.f:
                ds = self.f[key]
                ds.resize(self._n + 1, axis=0)
                ds[self._n] = val
        self._n += 1
        # Flush every 10 steps
        if self._n % 10 == 0:
            self.f.flush()

    def close(self):
        self.f.flush()
        self.f.close()


# ============================================================================
# Main Verification Loop
# ============================================================================
def run_verification(
    omega_file: str,
    N_high: int = DEFAULT_N_HIGH,
    N_low: int = DEFAULT_N_LOW,
    nu: float = DEFAULT_NU,
    T: float = DEFAULT_T,
    cfl: float = DEFAULT_CFL,
    dt_max: float = DEFAULT_DT_MAX,
    output_dir: str = "results",
) -> dict:
    """
    High-resolution BKM verification simulation.

    1. Load optimized vorticity from Phase 2 (N_low³)
    2. Spectrally interpolate to N_high³
    3. Run with Carpenter-Kennedy low-storage RK4(5)
    4. Track BKM diagnostics at every time step
    5. Fit blow-up curve and estimate T*
    6. Save everything to HDF5
    """
    L = 2.0 * jnp.pi

    # --- Memory check ---
    mem = estimate_memory_gb(N_high)
    print(f"\n{'='*70}")
    print(f" Phase 3 — High-Resolution BKM Verification")
    print(f"{'='*70}")
    print(f"  Resolution:     {N_high}³ ({N_high**3:,d} grid points)")
    print(f"  Viscosity:      ν = {nu}")
    print(f"  Time window:    T = {T}")
    print(f"  Threads:        {os.environ.get('OMP_NUM_THREADS', '?')}")
    print(f"  Memory estimate:")
    for k, v in mem.items():
        print(f"    {k:20s}: {v:8.1f} GB")
    print()

    if mem["total_GB"] > 400:
        print("  *** WARNING: Estimated memory exceeds 400 GB! Risk of OOM. ***")
        print("  Consider reducing N_high or using a machine with more RAM.")

    # --- Load source vorticity ---
    print(f"  Loading: {omega_file}")
    omega0_low = jnp.array(np.load(omega_file))
    assert omega0_low.shape == (3, N_low, N_low, N_low), (
        f"Expected shape (3, {N_low}, {N_low}, {N_low}), got {omega0_low.shape}"
    )
    print(f"  Source shape: {omega0_low.shape}")

    # --- Spectral interpolation ---
    print(f"  Interpolating {N_low}³ → {N_high}³...")
    t_interp = time.time()
    omega_hat_low = jnp.stack([rfftn(omega0_low[i]) for i in range(3)])
    omega_hat = spectral_interpolate(omega_hat_low, N_low, N_high)
    print(f"  Interpolation done in {time.time() - t_interp:.1f}s")
    print(f"  High-res Fourier shape: {omega_hat.shape}")

    # Free the low-res array
    del omega0_low, omega_hat_low

    # --- Setup high-res grid ---
    grid = setup_grid(N_high, L)

    # --- Project to divergence-free ---
    k_dot_omega = (
        grid.Kx * omega_hat[0] + grid.Ky * omega_hat[1] + grid.Kz * omega_hat[2]
    )
    omega_hat = omega_hat - jnp.stack([
        grid.Kx * k_dot_omega / grid.K2,
        grid.Ky * k_dot_omega / grid.K2,
        grid.Kz * k_dot_omega / grid.K2,
    ])
    omega_hat = omega_hat.at[:, 0, 0, 0].set(0.0 + 0.0j)

    # --- Initial diagnostics ---
    E0 = float(enstrophy_fourier(omega_hat, N_high, L))
    w_inf_0 = float(max_vorticity(omega_hat, N_high))
    ke0 = float(kinetic_energy(omega_hat, grid))
    div0 = float(divergence_max(omega_hat, grid))

    print(f"\n  Initial conditions:")
    print(f"    Enstrophy:     {E0:,.2f}")
    print(f"    ||ω||_∞:       {w_inf_0:,.2f}")
    print(f"    Kinetic energy: {ke0:,.6f}")
    print(f"    max|∇·u|:      {div0:.2e}")
    print()

    # --- HDF5 logger ---
    h5_path = os.path.join(output_dir, "bkm_verification.h5")
    logger = HDF5Logger(h5_path, N_high, nu, T)

    # Log initial state
    logger.append(
        time=0.0, dt=0.0,
        omega_inf=w_inf_0, enstrophy=E0,
        kinetic_energy=ke0, div_max=div0,
        bkm_integral=0.0, wall_time_step=0.0,
    )

    # --- Time-stepping loop ---
    t = 0.0
    step = 0
    bkm_integral = 0.0
    prev_omega_inf = w_inf_0
    prev_t = 0.0

    # Arrays for blow-up curve fitting
    time_series = [0.0]
    omega_inf_series = [w_inf_0]
    enstrophy_series = [E0]

    print(f"  {'Step':>6s} | {'t':>8s} | {'dt':>10s} | {'||ω||_∞':>14s} | "
          f"{'Enstrophy':>14s} | {'KE':>12s} | {'BKM ∫':>10s} | {'∇·u':>10s} | {'t/step':>8s}")
    print(f"  {'-'*6}-+-{'-'*8}-+-{'-'*10}-+-{'-'*14}-+-"
          f"{'-'*14}-+-{'-'*12}-+-{'-'*10}-+-{'-'*10}-+-{'-'*8}")

    wall_start = time.time()

    while t < T:
        step_start = time.time()

        # Adaptive CFL time step
        dt_val = float(cfl_dt(omega_hat, grid, cfl))
        dt_val = min(dt_val, dt_max, T - t)
        if dt_val < 1e-14:
            print(f"\n  TIME STEP COLLAPSED at t={t:.6f}. Possible singularity!")
            break

        # Carpenter-Kennedy 2N-storage RK4(5) step
        omega_hat = rk4_lowstorage_step(omega_hat, dt_val, nu, grid)

        t += dt_val
        step += 1

        # --- Diagnostics (every step for BKM tracking) ---
        w_inf = float(max_vorticity(omega_hat, N_high))
        E = float(enstrophy_fourier(omega_hat, N_high, L))
        ke = float(kinetic_energy(omega_hat, grid))
        div = float(divergence_max(omega_hat, grid))

        # BKM integral: ∫₀ᵗ ||ω||_∞ ds via trapezoidal rule
        bkm_integral += 0.5 * (prev_omega_inf + w_inf) * (t - prev_t)

        step_time = time.time() - step_start
        wall_elapsed = time.time() - wall_start
        estimated_total_steps = step / max(t, 1e-10) * T
        eta_seconds = (estimated_total_steps - step) * step_time

        # Log to HDF5
        logger.append(
            time=t, dt=dt_val,
            omega_inf=w_inf, enstrophy=E,
            kinetic_energy=ke, div_max=div,
            bkm_integral=bkm_integral, wall_time_step=step_time,
        )

        # Terminal output
        eta_str = f"{eta_seconds / 3600:.1f}h" if eta_seconds > 3600 else f"{eta_seconds / 60:.0f}m"
        print(
            f"  {step:6d} | {t:8.5f} | {dt_val:10.2e} | {w_inf:14,.2f} | "
            f"{E:14,.2f} | {ke:12.6f} | {bkm_integral:10.4f} | {div:10.2e} | "
            f"{step_time:7.1f}s  ETA {eta_str}"
        )
        sys.stdout.flush()

        # Track series for post-analysis
        time_series.append(t)
        omega_inf_series.append(w_inf)
        enstrophy_series.append(E)

        prev_omega_inf = w_inf
        prev_t = t

        # --- Blow-up early warning ---
        if w_inf > 10 * w_inf_0:
            print(f"\n  *** ||ω||_∞ has grown 10× from initial value! Possible explosive growth. ***")
        if div > 1e-6:
            print(f"\n  *** WARNING: ∇·u = {div:.2e} exceeds 1e-6. Possible numerical breakdown. ***")

    # --- Finalize ---
    logger.close()
    wall_total = time.time() - wall_start

    print(f"\n{'='*70}")
    print(f" Simulation Complete")
    print(f"{'='*70}")
    print(f"  Total steps:     {step}")
    print(f"  Wall-clock time: {wall_total / 3600:.2f} hours")
    print(f"  Peak enstrophy:  {max(enstrophy_series):,.2f}")
    print(f"  Peak ||ω||_∞:    {max(omega_inf_series):,.2f}")
    print(f"  Final BKM ∫:     {bkm_integral:,.4f}")
    print(f"  Final KE:        {ke:,.6f} (initial: {ke0:,.6f})")
    print(f"  Final ∇·u:       {div:.2e}")

    # --- Blow-up curve fitting ---
    print(f"\n  Blow-Up Analysis:")
    times_arr = np.array(time_series)
    omega_inf_arr = np.array(omega_inf_series)

    fit_result = fit_blowup_curve(times_arr, omega_inf_arr)
    if fit_result is not None:
        print(f"    Fitted:  ||ω||_∞ ≈ {fit_result['A']:.4f} / (T* − t)^{fit_result['alpha']:.4f}")
        print(f"    T* =     {fit_result['T_star']:.6f}")
        print(f"    α =      {fit_result['alpha']:.4f}")
        print(f"    Residual:{fit_result['residual']:.4f}")
        print(f"    Points:  {fit_result['n_points_used']}")

        if fit_result["T_star"] < T * 1.5 and fit_result["alpha"] >= 0.8:
            print(f"\n    ╔═══════════════════════════════════════════════════════╗")
            print(f"    ║  STRONG SINGULARITY CANDIDATE DETECTED!               ║")
            print(f"    ║  T* = {fit_result['T_star']:.6f} with α = {fit_result['alpha']:.2f}               ║")
            print(f"    ║  BKM criterion: ∫||ω||_∞ dt → ∞ as t → T*            ║")
            print(f"    ╚═══════════════════════════════════════════════════════╝")
        elif fit_result["alpha"] >= 0.5:
            print(f"\n    MODERATE CANDIDATE: α ≥ 0.5 suggests possible blow-up trend.")
        else:
            print(f"\n    WEAK CANDIDATE: α < 0.5 suggests dissipative damping dominates.")
    else:
        print(f"    Could not fit blow-up curve (insufficient data or no growth trend).")
        if bkm_integral > 100:
            print(f"    However, BKM integral = {bkm_integral:.2f} is large — inspect manually.")

    # Save summary
    summary_path = os.path.join(output_dir, "bkm_summary.json")
    import json
    summary = {
        "N": N_high,
        "nu": nu,
        "T": T,
        "total_steps": step,
        "wall_time_hours": wall_total / 3600,
        "peak_enstrophy": float(max(enstrophy_series)),
        "peak_omega_inf": float(max(omega_inf_series)),
        "final_bkm_integral": bkm_integral,
        "initial_kinetic_energy": ke0,
        "final_kinetic_energy": float(ke),
        "final_divergence": float(div),
        "blowup_fit": fit_result,
    }
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\n  Summary saved: {summary_path}")
    print(f"  HDF5 data:    {h5_path}")

    print(f"\n{'='*70}")
    return summary


# ============================================================================
# CLI Entry Point
# ============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Phase 3: High-resolution BKM verification at 1024³."
    )
    parser.add_argument("--omega-file", type=str, default="results/optimized_omega0.npy",
                        help="Path to optimized omega0 .npy file from Phase 2")
    parser.add_argument("--N-high", type=int, default=DEFAULT_N_HIGH,
                        help=f"Verification grid resolution (default: {DEFAULT_N_HIGH})")
    parser.add_argument("--N-low", type=int, default=DEFAULT_N_LOW,
                        help=f"Source grid resolution (default: {DEFAULT_N_LOW})")
    parser.add_argument("--nu", type=float, default=DEFAULT_NU,
                        help=f"Viscosity (default: {DEFAULT_NU})")
    parser.add_argument("--T", type=float, default=DEFAULT_T,
                        help=f"Simulation time (default: {DEFAULT_T})")
    parser.add_argument("--cfl", type=float, default=DEFAULT_CFL,
                        help=f"CFL number (default: {DEFAULT_CFL})")
    parser.add_argument("--dt-max", type=float, default=DEFAULT_DT_MAX,
                        help=f"Max time step (default: {DEFAULT_DT_MAX})")
    parser.add_argument("--output-dir", type=str, default="results",
                        help="Output directory")
    parser.add_argument("--dry-run", action="store_true",
                        help="Only estimate memory and print config, do not run")
    args = parser.parse_args()

    if args.dry_run:
        mem = estimate_memory_gb(args.N_high)
        print(f"Memory estimate for {args.N_high}³:")
        for k, v in mem.items():
            print(f"  {k:20s}: {v:8.1f} GB")
        return

    if not os.path.exists(args.omega_file):
        print(f"ERROR: Omega file not found: {args.omega_file}")
        print("Run Phase 2 first, or specify --omega-file.")
        sys.exit(1)

    run_verification(
        omega_file=args.omega_file,
        N_high=args.N_high,
        N_low=args.N_low,
        nu=args.nu,
        T=args.T,
        cfl=args.cfl,
        dt_max=args.dt_max,
        output_dir=args.output_dir,
    )


if __name__ == "__main__":
    main()
