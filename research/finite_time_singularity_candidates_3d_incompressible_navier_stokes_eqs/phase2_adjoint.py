#!/usr/bin/env python3
"""
phase2_adjoint.py — Adjoint Gradient Ascent for Enstrophy Maximization
========================================================================
Two-stage optimization refining the best GA candidate from Phase 1:

  Stage 1 — DNA Parameter Optimization (24D):
    Uses jax.grad through the full simulation to compute exact gradients
    of peak enstrophy w.r.t. the 24 DNA parameters. Adam optimizer
    with cosine learning rate decay.

  Stage 2 — Full Vorticity Field Optimization (~50M DOFs):
    Unlocks the full 256³×3 initial vorticity field as optimization
    variables. Uses jax.grad with:
      • Sobolev H¹ gradient smoothing: ĝ_smooth = ĝ / (1 + α|k|²)
      • Divergence-free projection: ĝ ← ĝ − k(k·ĝ)/|k|²
    to prevent high-frequency noise injection and maintain ∇·ω = 0.

Usage:
    source env.sh && source .venv/bin/activate
    python phase2_adjoint.py [--checkpoint-dir checkpoints]
                             [--stage 1|2|both]
                             [--max-iters 200]

Memory: ~15-20 GB at 256³ with checkpointed autodiff.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

os.environ["JAX_PLATFORM_NAME"] = "cpu"
os.environ["JAX_ENABLE_X64"] = "True"

import jax
import jax.numpy as jnp
import numpy as np
from jax.numpy.fft import irfftn, rfftn

from dna_config import (
    DNA_LENGTH,
    L_DOMAIN,
    N_VORTICES,
    PARAMS_PER_VORTEX,
    clip_to_bounds,
    dna_to_dict,
    dna_to_vorticity,
    get_bounds,
    load_best_dna,
    print_dna_summary,
)
from jax_spectral_solver import (
    enstrophy_fourier,
    max_vorticity,
    setup_grid,
    simulate_for_grad,
    simulate_for_grad_from_dna,
)

# ============================================================================
# Configuration
# ============================================================================
STAGE1_N = 256               # Grid resolution for Stage 1
STAGE1_DT = 0.0005           # Fixed dt (must satisfy CFL at 256³)
STAGE1_NU = 0.0005
STAGE1_T = 0.5
STAGE1_LR = 0.01             # Initial learning rate (Adam)
STAGE1_MAX_ITERS = 200
STAGE1_GRAD_CLIP = 10.0      # Max gradient norm

STAGE2_N = 256
STAGE2_DT = 0.0005
STAGE2_NU = 0.0005
STAGE2_T = 0.5
STAGE2_LR = 1e-4             # Smaller LR for full-field
STAGE2_MAX_ITERS = 100
STAGE2_SOBOLEV_ALPHA = 4.0   # Sobolev smoothing parameter (in units of (2π/N)²)


# ============================================================================
# Adam Optimizer (with cosine LR decay and gradient clipping)
# ============================================================================
class AdamState:
    """Minimal Adam optimizer state."""

    def __init__(self, params: jnp.ndarray, lr: float, beta1: float = 0.9,
                 beta2: float = 0.999, eps: float = 1e-8):
        self.m = jnp.zeros_like(params)  # First moment
        self.v = jnp.zeros_like(params)  # Second moment
        self.lr = lr
        self.beta1 = beta1
        self.beta2 = beta2
        self.eps = eps
        self.step = 0

    def update(self, params: jnp.ndarray, grad: jnp.ndarray,
               lr_override: float | None = None) -> jnp.ndarray:
        """One Adam step. Returns updated parameters (gradient ASCENT)."""
        self.step += 1
        lr = lr_override if lr_override is not None else self.lr

        self.m = self.beta1 * self.m + (1.0 - self.beta1) * grad
        self.v = self.beta2 * self.v + (1.0 - self.beta2) * grad**2

        m_hat = self.m / (1.0 - self.beta1**self.step)
        v_hat = self.v / (1.0 - self.beta2**self.step)

        # Gradient ASCENT (maximizing enstrophy)
        params = params + lr * m_hat / (jnp.sqrt(v_hat) + self.eps)
        return params


def cosine_lr(step: int, max_steps: int, lr_init: float, lr_min: float = 1e-6) -> float:
    """Cosine annealing learning rate schedule."""
    progress = min(step / max(max_steps, 1), 1.0)
    return lr_min + 0.5 * (lr_init - lr_min) * (1.0 + np.cos(np.pi * progress))


# ============================================================================
# Stage 1: DNA Parameter Optimization
# ============================================================================
def stage1_dna_optimization(
    dna_init: np.ndarray,
    max_iters: int = STAGE1_MAX_ITERS,
    output_dir: str = "results",
) -> jnp.ndarray:
    """
    Optimize the 24D DNA parameters using adjoint gradients.

    Takes the best GA candidate and performs gradient ascent on the smooth,
    differentiable pipeline: DNA → vorticity(256³) → simulate → E_max.
    """
    print(f"\n{'='*60}")
    print(f" Phase 2 — Stage 1: DNA Parameter Optimization")
    print(f"{'='*60}")
    print(f"  Grid: {STAGE1_N}³ | ν = {STAGE1_NU} | T = {STAGE1_T}")
    print(f"  DNA dimensions: {dna_init.shape[0]}")
    print(f"  Optimizer: Adam (lr={STAGE1_LR}, cosine decay)")
    print(f"  Max iterations: {max_iters}")
    print()

    dna = jnp.array(dna_init, dtype=jnp.float64)
    bounds = get_bounds()

    # Define the objective: DNA → peak enstrophy
    def objective(dna_params):
        return simulate_for_grad_from_dna(
            dna_params, STAGE1_N, L_DOMAIN, STAGE1_NU, STAGE1_T, STAGE1_DT, N_VORTICES
        )

    # JIT-compile the gradient function
    grad_fn = jax.jit(jax.grad(objective))

    adam = AdamState(dna, STAGE1_LR)
    best_dna = dna
    best_E = -jnp.inf
    log_entries = []

    print(f"  {'Iter':>5s} | {'Enstrophy':>14s} | {'Grad Norm':>12s} | {'LR':>10s} | {'Time':>8s}")
    print(f"  {'-'*5}-+-{'-'*14}-+-{'-'*12}-+-{'-'*10}-+-{'-'*8}")

    for it in range(max_iters):
        t0 = time.time()

        # Forward pass (enstrophy value)
        E = objective(dna)

        # Backward pass (gradient)
        grad = grad_fn(dna)

        # Gradient clipping
        grad_norm = float(jnp.linalg.norm(grad))
        if grad_norm > STAGE1_GRAD_CLIP:
            grad = grad * (STAGE1_GRAD_CLIP / grad_norm)
            grad_norm = STAGE1_GRAD_CLIP

        # Learning rate schedule
        lr = cosine_lr(it, max_iters, STAGE1_LR)

        # Adam step (gradient ASCENT)
        dna = adam.update(dna, grad, lr_override=lr)

        # Project to bounds
        dna = jnp.clip(dna, jnp.array(bounds[0]), jnp.array(bounds[1]))

        E_val = float(E)
        elapsed = time.time() - t0

        if E_val > float(best_E):
            best_E = E
            best_dna = dna

        log_entries.append({
            "iteration": it,
            "enstrophy": E_val,
            "grad_norm": grad_norm,
            "lr": lr,
            "time_s": elapsed,
        })

        print(f"  {it:5d} | {E_val:14,.2f} | {grad_norm:12.4f} | {lr:10.6f} | {elapsed:7.1f}s")
        sys.stdout.flush()

        # Early stopping: gradient too small
        if grad_norm < 1e-8:
            print(f"\n  Converged: gradient norm {grad_norm:.2e} < 1e-8")
            break

    # Save results
    os.makedirs(output_dir, exist_ok=True)
    result_path = os.path.join(output_dir, "stage1_result.json")
    with open(result_path, "w") as f:
        json.dump({
            "best_enstrophy": float(best_E),
            "best_dna": best_dna.tolist(),
            "best_dna_dict": dna_to_dict(np.array(best_dna)),
            "log": log_entries,
            "config": {
                "N": STAGE1_N, "nu": STAGE1_NU, "T": STAGE1_T,
                "dt": STAGE1_DT, "lr": STAGE1_LR, "max_iters": max_iters,
            }
        }, f, indent=2)
    print(f"\n  Result saved: {result_path}")
    print(f"  Best enstrophy: {float(best_E):,.2f}")

    print("\n  Optimized DNA:")
    print_dna_summary(np.array(best_dna))

    return best_dna


# ============================================================================
# Stage 2: Full Vorticity Field Optimization
# ============================================================================
def stage2_fullfield_optimization(
    omega0: jnp.ndarray | None = None,
    dna: jnp.ndarray | None = None,
    max_iters: int = STAGE2_MAX_ITERS,
    output_dir: str = "results",
) -> jnp.ndarray:
    """
    Optimize the full 3D vorticity field using adjoint gradients with
    Sobolev H¹ smoothing and divergence-free projection.

    Either provide omega0 directly or a DNA array (from which omega0 is
    constructed at 256³).

    Returns optimized omega0 in physical space.
    """
    N = STAGE2_N
    L = L_DOMAIN

    print(f"\n{'='*60}")
    print(f" Phase 2 — Stage 2: Full Vorticity Field Optimization")
    print(f"{'='*60}")
    print(f"  Grid: {N}³ | DOFs: {3 * N**3:,d}")
    print(f"  Sobolev α = {STAGE2_SOBOLEV_ALPHA}")
    print(f"  Max iterations: {max_iters}")
    print()

    # Construct initial field
    if omega0 is None:
        if dna is None:
            raise ValueError("Must provide either omega0 or dna")
        omega0 = dna_to_vorticity(dna, N, L)

    grid = setup_grid(N, L)

    # Sobolev smoothing operator in Fourier space: 1 / (1 + α|k|²)
    # α is in physical units; scale by (2π/N)² for grid-relative smoothing
    alpha_phys = STAGE2_SOBOLEV_ALPHA * (2.0 * jnp.pi / N) ** 2
    sobolev_filter = 1.0 / (1.0 + alpha_phys * grid.K2_raw)

    def objective(omega0_field):
        """Peak enstrophy from initial vorticity field."""
        return simulate_for_grad(omega0_field, N, L, STAGE2_NU, STAGE2_T, STAGE2_DT)

    grad_fn = jax.jit(jax.grad(objective))

    # Use simple gradient ascent with momentum (not Adam, since gradient is
    # smoothed and already regularized by Sobolev filter)
    omega_current = omega0
    best_omega = omega0
    best_E = -jnp.inf
    velocity = jnp.zeros_like(omega0)  # Momentum buffer
    momentum = 0.9
    log_entries = []

    print(f"  {'Iter':>5s} | {'Enstrophy':>14s} | {'Grad Norm':>12s} | {'||ω||_∞':>12s} | {'Time':>8s}")
    print(f"  {'-'*5}-+-{'-'*14}-+-{'-'*12}-+-{'-'*12}-+-{'-'*8}")

    for it in range(max_iters):
        t0 = time.time()

        # Forward pass
        E = objective(omega_current)

        # Backward pass: gradient of E_max w.r.t. omega0
        raw_grad = grad_fn(omega_current)

        # --- Sobolev H¹ smoothing in Fourier space ---
        grad_hat = jnp.stack([rfftn(raw_grad[i]) for i in range(3)])
        grad_hat = grad_hat * sobolev_filter[jnp.newaxis, :, :, :]

        # --- Divergence-free projection ---
        # Remove the compressible component: ĝ ← ĝ − k̂(k̂·ĝ)
        k_dot_g = (
            grid.Kx * grad_hat[0] +
            grid.Ky * grad_hat[1] +
            grid.Kz * grad_hat[2]
        )
        grad_hat = grad_hat - jnp.stack([
            grid.Kx * k_dot_g / grid.K2,
            grid.Ky * k_dot_g / grid.K2,
            grid.Kz * k_dot_g / grid.K2,
        ])
        grad_hat = grad_hat.at[:, 0, 0, 0].set(0.0 + 0.0j)

        # Transform back to physical space
        smoothed_grad = jnp.stack([
            irfftn(grad_hat[i], s=(N, N, N)) for i in range(3)
        ])

        # Normalize gradient to prevent explosions
        grad_norm = float(jnp.linalg.norm(smoothed_grad))
        if grad_norm > 1e-14:
            smoothed_grad = smoothed_grad / grad_norm

        # Learning rate schedule
        lr = cosine_lr(it, max_iters, STAGE2_LR, lr_min=1e-6)

        # Momentum update (gradient ASCENT)
        velocity = momentum * velocity + smoothed_grad
        omega_current = omega_current + lr * velocity

        # Compute ||ω||_∞ diagnostic
        omega_hat_diag = jnp.stack([rfftn(omega_current[i]) for i in range(3)])
        w_inf = float(max_vorticity(omega_hat_diag, N))

        E_val = float(E)
        elapsed = time.time() - t0

        if E_val > float(best_E):
            best_E = E
            best_omega = omega_current

        log_entries.append({
            "iteration": it,
            "enstrophy": E_val,
            "grad_norm": grad_norm,
            "omega_inf": w_inf,
            "lr": lr,
            "time_s": elapsed,
        })

        print(f"  {it:5d} | {E_val:14,.2f} | {grad_norm:12.6f} | {w_inf:12.2f} | {elapsed:7.1f}s")
        sys.stdout.flush()

    # Save results
    os.makedirs(output_dir, exist_ok=True)

    # Save log as JSON
    log_path = os.path.join(output_dir, "stage2_log.json")
    with open(log_path, "w") as f:
        json.dump({
            "best_enstrophy": float(best_E),
            "log": log_entries,
            "config": {
                "N": N, "nu": STAGE2_NU, "T": STAGE2_T, "dt": STAGE2_DT,
                "lr": STAGE2_LR, "sobolev_alpha": STAGE2_SOBOLEV_ALPHA,
                "max_iters": max_iters,
            }
        }, f, indent=2)

    # Save optimized vorticity field as raw binary (for Phase 3 loading)
    omega_path = os.path.join(output_dir, "optimized_omega0.npy")
    np.save(omega_path, np.array(best_omega))

    print(f"\n  Results saved:")
    print(f"    Log:        {log_path}")
    print(f"    Vorticity:  {omega_path} ({os.path.getsize(omega_path) / 1e9:.2f} GB)")
    print(f"    Best enstrophy: {float(best_E):,.2f}")

    return best_omega


# ============================================================================
# CLI Entry Point
# ============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Phase 2: Adjoint gradient optimization of singularity candidates."
    )
    parser.add_argument("--stage", type=str, default="both", choices=["1", "2", "both"],
                        help="Which stage to run (1=DNA, 2=full-field, both=sequential)")
    parser.add_argument("--checkpoint-dir", type=str, default="checkpoints",
                        help="Phase 1 checkpoint directory (for loading best DNA)")
    parser.add_argument("--output-dir", type=str, default="results",
                        help="Output directory for optimized results")
    parser.add_argument("--max-iters-1", type=int, default=STAGE1_MAX_ITERS,
                        help=f"Max iterations for Stage 1 (default: {STAGE1_MAX_ITERS})")
    parser.add_argument("--max-iters-2", type=int, default=STAGE2_MAX_ITERS,
                        help=f"Max iterations for Stage 2 (default: {STAGE2_MAX_ITERS})")
    parser.add_argument("--dna-file", type=str, default=None,
                        help="Path to a specific JSON checkpoint to load DNA from")
    parser.add_argument("--omega-file", type=str, default=None,
                        help="Path to .npy file with initial omega0 (skip Stage 1)")
    args = parser.parse_args()

    # --- Load initial DNA ---
    dna_init = None
    if args.dna_file:
        with open(args.dna_file, "r") as f:
            data = json.load(f)
        if "best_dna" in data:
            dna_init = np.array(data["best_dna"])
        else:
            # Full checkpoint: extract best DNA
            pop = np.array(data["population"])
            fit = np.array(data["fitness"])
            dna_init = pop[np.argmax(fit)]
    else:
        dna_init = load_best_dna(args.checkpoint_dir)

    if dna_init is None and args.omega_file is None:
        print("ERROR: No DNA found. Run Phase 1 first, or specify --dna-file / --omega-file.")
        sys.exit(1)

    if dna_init is not None:
        print("Loaded initial DNA:")
        print_dna_summary(dna_init)

    # --- Execute Stages ---
    optimized_dna = None
    optimized_omega = None

    if args.stage in ("1", "both") and dna_init is not None:
        optimized_dna = stage1_dna_optimization(
            dna_init, max_iters=args.max_iters_1, output_dir=args.output_dir
        )

    if args.stage in ("2", "both"):
        # Load omega0 from file or construct from DNA
        if args.omega_file:
            omega0 = jnp.array(np.load(args.omega_file))
            print(f"Loaded omega0 from {args.omega_file}: shape {omega0.shape}")
        else:
            # Use optimized DNA from Stage 1 (or initial DNA)
            dna_for_stage2 = optimized_dna if optimized_dna is not None else jnp.array(dna_init)
            omega0 = dna_to_vorticity(dna_for_stage2, STAGE2_N, L_DOMAIN)

        optimized_omega = stage2_fullfield_optimization(
            omega0=omega0, max_iters=args.max_iters_2, output_dir=args.output_dir
        )

    print(f"\n{'='*60}")
    print(f" Phase 2 Complete.")
    print(f" Run `python phase3_verify.py` for high-resolution BKM verification.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
