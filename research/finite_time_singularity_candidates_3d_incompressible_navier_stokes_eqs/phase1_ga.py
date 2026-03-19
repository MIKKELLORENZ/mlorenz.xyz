#!/usr/bin/env python3
"""
phase1_ga.py — 120-Thread Genetic Algorithm for Enstrophy Maximization
========================================================================
Evolves a population of 120 vortex-ring DNA candidates to find initial
conditions that maximize peak enstrophy E_max over [0, T].

Architecture:
  • multiprocessing.Pool(120), each worker runs a 128³ simulation (~100 MB)
  • Tournament selection (size 3) → SBX crossover (η_c=15) → Polynomial
    mutation (η_m=20, p_m=1/24) → 10% elitism
  • Checkpoints every generation to checkpoints/gen_{NNNN}.json
  • Resume from latest checkpoint if found

Usage:
    source env.sh && source .venv/bin/activate
    python phase1_ga.py [--pop-size 120] [--n-generations 500]
                        [--resume] [--checkpoint-dir checkpoints]

Run inside tmux for long headless sessions.
"""

from __future__ import annotations

import argparse
import csv
import multiprocessing as mp
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np

# ---------------------------------------------------------------------------
# Worker process environment — MUST be set before JAX import
# Each of the 120 workers gets exactly 1 thread to avoid oversubscription.
# ---------------------------------------------------------------------------
os.environ["JAX_PLATFORM_NAME"] = "cpu"
os.environ["JAX_ENABLE_X64"] = "True"
os.environ["XLA_FLAGS"] = "--xla_cpu_multi_thread_eigen=false"
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"


# ============================================================================
# Default Hyperparameters
# ============================================================================
DEFAULT_POP_SIZE = 120
DEFAULT_N_GENERATIONS = 500
DEFAULT_N_GRID = 128         # Phase 1 low-resolution grid
DEFAULT_L = 2.0 * np.pi
DEFAULT_NU = 0.0005          # Viscosity (Re ≈ 2000)
DEFAULT_T = 0.5              # Simulation time window
DEFAULT_CFL = 0.5
DEFAULT_DT_MAX = 0.005

# GA operators
TOURNAMENT_SIZE = 3
ELITISM_FRACTION = 0.10      # Top 10% pass unchanged
SBX_ETA = 15.0               # SBX crossover distribution index
PM_ETA = 20.0                # Polynomial mutation distribution index

# Convergence monitoring
PLATEAU_WINDOW = 50           # Generations to check for improvement
PLATEAU_THRESHOLD = 0.01      # 1% relative improvement threshold


# ============================================================================
# Worker: Evaluate a Single DNA Candidate
# ============================================================================
def _init_worker():
    """Per-worker initialization: set thread counts and suppress JAX logs."""
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    os.environ["OPENBLAS_NUM_THREADS"] = "1"
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"


def evaluate_dna(args: tuple) -> dict:
    """
    Evaluate a single DNA candidate by running a 128³ NS simulation.

    Called in a worker process. Imports JAX lazily to ensure each process
    gets its own JAX runtime with 1 thread.

    Parameters
    ----------
    args : (dna_array, index, config_dict)

    Returns
    -------
    result : dict with enstrophy_max, omega_inf_max, t_omega_inf_max, index
    """
    dna_array, idx, config = args

    import jax
    import jax.numpy as jnp
    from dna_config import dna_to_vorticity
    from jax_spectral_solver import simulate

    N = config["N"]
    L = config["L"]
    nu = config["nu"]
    T = config["T"]

    try:
        dna_jnp = jnp.array(dna_array, dtype=jnp.float64)
        omega0 = dna_to_vorticity(dna_jnp, N, L, config["n_vortices"])
        result = simulate(
            omega0, N, L, nu, T,
            cfl=config.get("cfl", DEFAULT_CFL),
            dt_max=config.get("dt_max", DEFAULT_DT_MAX),
            diag_interval=20,
        )
        return {
            "index": idx,
            "enstrophy_max": float(result["enstrophy_max"]),
            "omega_inf_max": float(result["omega_inf_max"]),
            "t_omega_inf_max": float(result["t_omega_inf_max"]),
            "num_steps": result["num_steps"],
            "success": True,
        }
    except Exception as e:
        # If a simulation crashes (NaN, etc.), return zero fitness
        return {
            "index": idx,
            "enstrophy_max": 0.0,
            "omega_inf_max": 0.0,
            "t_omega_inf_max": 0.0,
            "num_steps": 0,
            "success": False,
            "error": str(e),
        }


# ============================================================================
# Genetic Operators
# ============================================================================
def tournament_selection(
    population: np.ndarray,
    fitness: np.ndarray,
    n_parents: int,
    tournament_size: int = TOURNAMENT_SIZE,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Select parents via tournament selection (maximizing fitness)."""
    if rng is None:
        rng = np.random.default_rng()
    pop_size = population.shape[0]
    parents = np.empty((n_parents, population.shape[1]))
    for i in range(n_parents):
        candidates = rng.integers(0, pop_size, size=tournament_size)
        winner = candidates[np.argmax(fitness[candidates])]
        parents[i] = population[winner]
    return parents


def sbx_crossover(
    parent1: np.ndarray,
    parent2: np.ndarray,
    eta: float = SBX_ETA,
    rng: np.random.Generator | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Simulated Binary Crossover (SBX) for real-valued chromosomes.
    Produces two children from two parents.
    """
    if rng is None:
        rng = np.random.default_rng()
    u = rng.random(size=parent1.shape)

    beta = np.where(
        u <= 0.5,
        (2.0 * u) ** (1.0 / (eta + 1.0)),
        (1.0 / (2.0 * (1.0 - u))) ** (1.0 / (eta + 1.0)),
    )
    child1 = 0.5 * ((1.0 + beta) * parent1 + (1.0 - beta) * parent2)
    child2 = 0.5 * ((1.0 - beta) * parent1 + (1.0 + beta) * parent2)
    return child1, child2


def polynomial_mutation(
    individual: np.ndarray,
    bounds: np.ndarray,
    eta: float = PM_ETA,
    p_mut: float | None = None,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """
    Polynomial mutation for real-valued chromosomes.

    Parameters
    ----------
    individual : (D,) ndarray
    bounds : (2, D) ndarray — [lower, upper]
    eta : float — distribution index (higher = less disruptive)
    p_mut : float — per-gene mutation probability (default 1/D)
    rng : Generator
    """
    if rng is None:
        rng = np.random.default_rng()
    D = individual.shape[0]
    if p_mut is None:
        p_mut = 1.0 / D

    mutated = individual.copy()
    for i in range(D):
        if rng.random() < p_mut:
            u = rng.random()
            lb, ub = bounds[0, i], bounds[1, i]
            delta_max = ub - lb
            if delta_max < 1e-14:
                continue
            if u < 0.5:
                delta = (2.0 * u) ** (1.0 / (eta + 1.0)) - 1.0
            else:
                delta = 1.0 - (2.0 * (1.0 - u)) ** (1.0 / (eta + 1.0))
            mutated[i] = individual[i] + delta * delta_max
            mutated[i] = np.clip(mutated[i], lb, ub)
    return mutated


# ============================================================================
# Logging & Telemetry
# ============================================================================
def format_telemetry(
    gen: int,
    pop_size: int,
    fitness: np.ndarray,
    omega_inf_all: np.ndarray,
    t_peak_all: np.ndarray,
    population: np.ndarray,
    wall_time: float,
    prev_best: float,
) -> str:
    """Format a generation's results for terminal output."""
    best_idx = int(np.argmax(fitness))
    best_E = fitness[best_idx]
    median_E = float(np.median(fitness))
    best_omega_inf = omega_inf_all[best_idx]
    best_t_peak = t_peak_all[best_idx]

    # Trajectory determination
    if prev_best <= 0:
        trajectory = "INITIAL"
    elif best_E > prev_best * 1.01:
        trajectory = "UPWARD"
    elif best_E < prev_best * 0.99:
        trajectory = "DECLINING"
    else:
        trajectory = "PLATEAU"

    # Genetic diversity: std of fitness + mean std of DNA parameters
    fitness_std = float(np.std(fitness))
    param_std = float(np.mean(np.std(population, axis=0)))

    lines = [
        f"\n{'='*60}",
        f" Generation {gen:4d} | {pop_size} DNA Candidates | {wall_time:.1f}s",
        f"{'='*60}",
        f"  Top Enstrophy:    {best_E:>14,.1f}  (DNA ID: #{gen:04d}-{best_idx:03d})",
        f"  Median Enstrophy: {median_E:>14,.1f}",
        f"  BKM Max Vorticity:{best_omega_inf:>14,.1f}  at t={best_t_peak:.4f}",
        f"  Trajectory:       {trajectory}",
        f"  Genetic Diversity:{fitness_std:>14,.1f}  (param spread: {param_std:.4f})",
    ]
    return "\n".join(lines)


def init_csv_log(log_path: str) -> None:
    """Initialize the CSV log file with headers."""
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "generation", "timestamp", "wall_time_s",
            "best_enstrophy", "median_enstrophy", "mean_enstrophy",
            "best_omega_inf", "best_t_peak", "best_dna_idx",
            "fitness_std", "param_std",
            "num_failed",
        ])


def append_csv_log(
    log_path: str,
    gen: int,
    fitness: np.ndarray,
    omega_inf_all: np.ndarray,
    t_peak_all: np.ndarray,
    population: np.ndarray,
    wall_time: float,
    n_failed: int,
) -> None:
    """Append one row to the CSV log."""
    best_idx = int(np.argmax(fitness))
    with open(log_path, "a", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            gen,
            datetime.now(timezone.utc).isoformat(),
            f"{wall_time:.2f}",
            f"{fitness[best_idx]:.6f}",
            f"{np.median(fitness):.6f}",
            f"{np.mean(fitness):.6f}",
            f"{omega_inf_all[best_idx]:.6f}",
            f"{t_peak_all[best_idx]:.6f}",
            best_idx,
            f"{np.std(fitness):.6f}",
            f"{np.mean(np.std(population, axis=0)):.6f}",
            n_failed,
        ])


# ============================================================================
# Main GA Loop
# ============================================================================
def run_ga(
    pop_size: int = DEFAULT_POP_SIZE,
    n_generations: int = DEFAULT_N_GENERATIONS,
    checkpoint_dir: str = "checkpoints",
    log_dir: str = "logs",
    resume: bool = True,
    n_vortices: int = 2,
    seed: int = 42,
) -> None:
    """
    Execute the genetic algorithm search loop.

    Spawns `pop_size` worker processes (default 120), each evaluating one
    DNA candidate on a 128³ grid. Runs for `n_generations` or until stopped.
    Saves checkpoints every generation for crash recovery.
    """
    from dna_config import (
        N_VORTICES,
        PARAMS_PER_VORTEX,
        clip_to_bounds,
        find_latest_checkpoint,
        get_bounds,
        load_population,
        random_population,
        save_population,
    )

    import jax
    import jax.numpy as jnp

    ppv = PARAMS_PER_VORTEX
    dna_length = n_vortices * ppv
    bounds = get_bounds(n_vortices)
    rng = np.random.default_rng(seed)

    # Simulation config passed to workers
    sim_config = {
        "N": DEFAULT_N_GRID,
        "L": DEFAULT_L,
        "nu": DEFAULT_NU,
        "T": DEFAULT_T,
        "cfl": DEFAULT_CFL,
        "dt_max": DEFAULT_DT_MAX,
        "n_vortices": n_vortices,
    }

    # --- Initialize or Resume ---
    start_gen = 0
    if resume:
        ckpt_path = find_latest_checkpoint(checkpoint_dir)
        if ckpt_path is not None:
            population, fitness, start_gen = load_population(ckpt_path)
            start_gen += 1  # Resume from next generation
            print(f"Resumed from {ckpt_path} (generation {start_gen - 1})")
            print(f"  Population: {population.shape}, Best fitness: {np.max(fitness):.2f}")
        else:
            population = None
    else:
        population = None

    if population is None:
        print(f"Initializing random population: {pop_size} × {dna_length}D")
        key = jax.random.PRNGKey(seed)
        population = np.array(random_population(key, pop_size, n_vortices))
        fitness = np.zeros(pop_size)

    assert population.shape == (pop_size, dna_length), (
        f"Population shape mismatch: {population.shape} vs ({pop_size}, {dna_length})"
    )

    # --- Logging setup ---
    csv_log_path = os.path.join(log_dir, "ga_log.csv")
    if start_gen == 0 or not os.path.exists(csv_log_path):
        init_csv_log(csv_log_path)

    print(f"\n{'='*60}")
    print(f" Navier-Stokes Singularity Hunter — Phase 1: Genetic Algorithm")
    print(f"{'='*60}")
    print(f"  Population size:  {pop_size}")
    print(f"  DNA dimensions:   {dna_length} ({n_vortices} vortices × {ppv} params)")
    print(f"  Grid resolution:  {DEFAULT_N_GRID}³")
    print(f"  Viscosity ν:      {DEFAULT_NU}")
    print(f"  Time window T:    {DEFAULT_T}")
    print(f"  Worker processes: {pop_size}")
    print(f"  Starting gen:     {start_gen}")
    print(f"  Target gens:      {n_generations}")
    print(f"{'='*60}\n")

    # --- GA Evolution Loop ---
    prev_best = float(np.max(fitness)) if start_gen > 0 else 0.0
    best_history = []  # Track best fitness per generation for plateau detection

    n_elite = max(1, int(pop_size * ELITISM_FRACTION))
    n_offspring = pop_size - n_elite

    # Create the multiprocessing pool
    ctx = mp.get_context("spawn")  # "spawn" is safest for JAX
    with ctx.Pool(processes=pop_size, initializer=_init_worker) as pool:

        for gen in range(start_gen, start_gen + n_generations):
            t_start = time.time()

            # --- Evaluate all candidates in parallel ---
            work_items = [
                (population[i], i, sim_config) for i in range(pop_size)
            ]
            results = pool.map(evaluate_dna, work_items)

            # Unpack results
            fitness = np.zeros(pop_size)
            omega_inf_all = np.zeros(pop_size)
            t_peak_all = np.zeros(pop_size)
            n_failed = 0

            for r in results:
                i = r["index"]
                fitness[i] = r["enstrophy_max"]
                omega_inf_all[i] = r["omega_inf_max"]
                t_peak_all[i] = r["t_omega_inf_max"]
                if not r["success"]:
                    n_failed += 1

            wall_time = time.time() - t_start

            # --- Telemetry ---
            telemetry = format_telemetry(
                gen, pop_size, fitness, omega_inf_all, t_peak_all,
                population, wall_time, prev_best,
            )
            print(telemetry)
            if n_failed > 0:
                print(f"  WARNING: {n_failed}/{pop_size} simulations failed!")

            sys.stdout.flush()

            # CSV log
            append_csv_log(
                csv_log_path, gen, fitness, omega_inf_all, t_peak_all,
                population, wall_time, n_failed,
            )

            # --- Checkpoint ---
            ckpt_path = os.path.join(checkpoint_dir, f"gen_{gen:04d}.json")
            save_population(population, fitness, gen, ckpt_path, metadata={
                "sim_config": sim_config,
                "ga_params": {
                    "tournament_size": TOURNAMENT_SIZE,
                    "sbx_eta": SBX_ETA,
                    "pm_eta": PM_ETA,
                    "elitism_fraction": ELITISM_FRACTION,
                    "seed": seed,
                },
                "wall_time_s": wall_time,
                "n_failed": n_failed,
            })
            print(f"  Checkpoint saved: {ckpt_path}")

            # --- Plateau Detection ---
            best_this_gen = float(np.max(fitness))
            best_history.append(best_this_gen)
            if len(best_history) >= PLATEAU_WINDOW:
                old_best = best_history[-PLATEAU_WINDOW]
                if old_best > 0 and (best_this_gen - old_best) / old_best < PLATEAU_THRESHOLD:
                    print(
                        f"\n  *** PLATEAU DETECTED: <{PLATEAU_THRESHOLD*100:.0f}% improvement "
                        f"over last {PLATEAU_WINDOW} generations. ***"
                        f"\n  *** Consider transitioning to Phase 2 (Adjoint Optimization). ***\n"
                    )

            prev_best = best_this_gen

            # --- Breed Next Generation ---
            if gen < start_gen + n_generations - 1:
                # Elitism: top n_elite pass unchanged
                elite_indices = np.argsort(fitness)[-n_elite:]
                elite = population[elite_indices].copy()

                # Selection
                n_parents = n_offspring  # Select enough parents
                parents = tournament_selection(
                    population, fitness, n_parents, TOURNAMENT_SIZE, rng
                )

                # Crossover + Mutation → offspring
                offspring = np.empty((n_offspring, dna_length))
                for i in range(0, n_offspring - 1, 2):
                    p1 = parents[rng.integers(0, n_parents)]
                    p2 = parents[rng.integers(0, n_parents)]
                    c1, c2 = sbx_crossover(p1, p2, SBX_ETA, rng)
                    offspring[i] = polynomial_mutation(c1, bounds, PM_ETA, rng=rng)
                    if i + 1 < n_offspring:
                        offspring[i + 1] = polynomial_mutation(c2, bounds, PM_ETA, rng=rng)
                # Handle odd offspring count
                if n_offspring % 2 == 1:
                    p = parents[rng.integers(0, n_parents)]
                    offspring[-1] = polynomial_mutation(p, bounds, PM_ETA, rng=rng)

                # Clip to bounds
                offspring = np.clip(offspring, bounds[0], bounds[1])

                # Merge: elite + offspring
                population = np.vstack([elite, offspring])
                assert population.shape == (pop_size, dna_length)

    # --- Final Summary ---
    best_idx = int(np.argmax(fitness))
    print(f"\n{'='*60}")
    print(f" GA Search Complete after {n_generations} generations.")
    print(f" Best Enstrophy: {fitness[best_idx]:,.1f}")
    print(f" Best DNA Index: #{gen:04d}-{best_idx:03d}")
    print(f" Run `python phase2_adjoint.py` to refine this candidate.")
    print(f"{'='*60}\n")


# ============================================================================
# CLI Entry Point
# ============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Phase 1: Genetic Algorithm search for enstrophy-maximizing vortex configurations."
    )
    parser.add_argument("--pop-size", type=int, default=DEFAULT_POP_SIZE,
                        help=f"Population size (default: {DEFAULT_POP_SIZE})")
    parser.add_argument("--n-generations", type=int, default=DEFAULT_N_GENERATIONS,
                        help=f"Number of generations to run (default: {DEFAULT_N_GENERATIONS})")
    parser.add_argument("--checkpoint-dir", type=str, default="checkpoints",
                        help="Directory for checkpoint files")
    parser.add_argument("--log-dir", type=str, default="logs",
                        help="Directory for CSV log files")
    parser.add_argument("--no-resume", action="store_true",
                        help="Start fresh, ignore existing checkpoints")
    parser.add_argument("--n-vortices", type=int, default=N_VORTICES_DEFAULT(),
                        help="Number of vortex rings per candidate")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for reproducibility")
    args = parser.parse_args()

    run_ga(
        pop_size=args.pop_size,
        n_generations=args.n_generations,
        checkpoint_dir=args.checkpoint_dir,
        log_dir=args.log_dir,
        resume=not args.no_resume,
        n_vortices=args.n_vortices,
        seed=args.seed,
    )


def N_VORTICES_DEFAULT():
    """Get default N_VORTICES from dna_config without importing at top-level."""
    try:
        from dna_config import N_VORTICES
        return N_VORTICES
    except ImportError:
        return 2


if __name__ == "__main__":
    main()
