"""
dna_config.py — DNA Parameterization for Vortex Ring Initial Conditions
=========================================================================
Defines the "genetic code" for 3D vortex ring configurations used in the
singularity search. Each vortex ring is parameterized by 12 floats:

    Position:      (x, y, z)           — center of ring in [0, 2π]³
    Orientation:   (theta, phi)        — polar/azimuthal angles of ring normal
    Geometry:      (R, sigma)          — major radius, Gaussian core thickness
    Physics:       (Gamma,)            — signed circulation strength
    Perturbation:  (a1, p1, a2, p2)   — Fourier mode amplitudes/phases on core line

For N_VORTICES=2 (anti-parallel collision default), total DNA = 24 floats.

The key function `dna_to_vorticity(dna, N, L)` constructs a divergence-free
3D vorticity field on an N³ grid from flat DNA parameters. This field can
then be fed directly into the pseudo-spectral solver.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any

import jax
import jax.numpy as jnp
import numpy as np

# ============================================================================
# Global Configuration
# ============================================================================
N_VORTICES: int = 2           # Default: anti-parallel pair
PARAMS_PER_VORTEX: int = 12
DNA_LENGTH: int = N_VORTICES * PARAMS_PER_VORTEX
L_DOMAIN: float = 2.0 * np.pi  # Periodic domain [0, 2π]³

# Parameter names (per vortex) — ordering matches flat array layout
PARAM_NAMES = [
    "center_x", "center_y", "center_z",   # Position
    "theta", "phi_orient",                  # Orientation
    "radius", "core_thickness",             # Geometry
    "circulation",                          # Physics
    "amp_k1", "phase_k1",                  # Perturbation mode k=1
    "amp_k2", "phase_k2",                  # Perturbation mode k=2
]

# ============================================================================
# Parameter Bounds — physically realistic constraints
# ============================================================================
# Each row: (lower_bound, upper_bound) for that parameter index within a vortex.
PARAM_BOUNDS_PER_VORTEX = np.array([
    [0.5,  L_DOMAIN - 0.5],   # center_x
    [0.5,  L_DOMAIN - 0.5],   # center_y
    [0.5,  L_DOMAIN - 0.5],   # center_z
    [0.0,  np.pi],            # theta  (polar angle of normal)
    [0.0,  2.0 * np.pi],     # phi    (azimuthal angle of normal)
    [0.3,  1.2],              # radius R
    [0.05, 0.3],              # core thickness sigma
    [-15.0, 15.0],            # circulation Gamma
    [0.0,  0.15],             # amp_k1 (perturbation amplitude)
    [0.0,  2.0 * np.pi],     # phase_k1
    [0.0,  0.10],             # amp_k2
    [0.0,  2.0 * np.pi],     # phase_k2
], dtype=np.float64)

def get_bounds(n_vortices: int = N_VORTICES) -> np.ndarray:
    """Return (2, DNA_LENGTH) array of [lower_bounds, upper_bounds]."""
    lower = np.tile(PARAM_BOUNDS_PER_VORTEX[:, 0], n_vortices)
    upper = np.tile(PARAM_BOUNDS_PER_VORTEX[:, 1], n_vortices)
    return np.stack([lower, upper], axis=0)


def clip_to_bounds(dna: np.ndarray, n_vortices: int = N_VORTICES) -> np.ndarray:
    """Clip DNA parameters to physical bounds."""
    bounds = get_bounds(n_vortices)
    return np.clip(dna, bounds[0], bounds[1])


# ============================================================================
# DNA ↔ Dictionary Conversion
# ============================================================================
def dna_to_dict(dna_flat: np.ndarray, n_vortices: int = N_VORTICES) -> dict:
    """Unpack flat DNA array into a readable nested dictionary."""
    result = {}
    ppv = PARAMS_PER_VORTEX
    for v in range(n_vortices):
        segment = dna_flat[v * ppv : (v + 1) * ppv]
        vortex = {}
        for i, name in enumerate(PARAM_NAMES):
            vortex[name] = float(segment[i])
        result[f"vortex_{v}"] = vortex
    return result


def dict_to_dna(d: dict, n_vortices: int = N_VORTICES) -> np.ndarray:
    """Pack a nested dictionary back into a flat DNA array."""
    dna = np.zeros(n_vortices * PARAMS_PER_VORTEX)
    ppv = PARAMS_PER_VORTEX
    for v in range(n_vortices):
        vortex = d[f"vortex_{v}"]
        for i, name in enumerate(PARAM_NAMES):
            dna[v * ppv + i] = vortex[name]
    return dna


# ============================================================================
# Random DNA Initialization
# ============================================================================
def random_dna(rng_key: jax.Array, n_vortices: int = N_VORTICES) -> jnp.ndarray:
    """Generate a single random DNA within physical bounds."""
    bounds = get_bounds(n_vortices)
    dna_len = n_vortices * PARAMS_PER_VORTEX
    u = jax.random.uniform(rng_key, shape=(dna_len,), dtype=jnp.float64)
    return jnp.array(bounds[0]) + u * jnp.array(bounds[1] - bounds[0])


def random_population(
    rng_key: jax.Array,
    pop_size: int,
    n_vortices: int = N_VORTICES,
) -> jnp.ndarray:
    """Generate an entire population of random DNA candidates."""
    keys = jax.random.split(rng_key, pop_size)
    return jax.vmap(lambda k: random_dna(k, n_vortices))(keys)


# ============================================================================
# Vortex Ring Construction in Physical Space
# ============================================================================
def _rodrigues_rotation_matrix(theta: float, phi: float) -> jnp.ndarray:
    """
    Build the 3×3 rotation matrix that maps the z-axis [0,0,1] to the
    unit vector n = (sin θ cos φ, sin θ sin φ, cos θ).

    Uses Rodrigues' rotation formula:  R = I + sin(α) K + (1 − cos α) K²
    where K is the skew-symmetric matrix of the rotation axis and α is
    the rotation angle between z-hat and n.
    """
    # Target normal vector
    nx = jnp.sin(theta) * jnp.cos(phi)
    ny = jnp.sin(theta) * jnp.sin(phi)
    nz = jnp.cos(theta)
    n = jnp.array([nx, ny, nz])

    z = jnp.array([0.0, 0.0, 1.0])

    # Rotation axis: k = z × n (normalized)
    cross = jnp.cross(z, n)
    sin_alpha = jnp.linalg.norm(cross)
    cos_alpha = jnp.dot(z, n)

    # Handle near-identity (theta ≈ 0) and near-flip (theta ≈ π) cases
    # by adding a tiny perturbation to avoid division by zero.
    safe_sin = jnp.where(sin_alpha < 1e-12, 1e-12, sin_alpha)
    k = cross / safe_sin

    # Skew-symmetric matrix K
    K = jnp.array([
        [0.0,   -k[2],  k[1]],
        [k[2],   0.0,  -k[0]],
        [-k[1],  k[0],  0.0],
    ])

    R = (jnp.eye(3)
         + sin_alpha * K
         + (1.0 - cos_alpha) * (K @ K))

    # At theta ≈ 0 the rotation is identity; at theta ≈ π it's a flip.
    # Correct for theta ≈ π: reflect through an arbitrary perpendicular axis.
    R_flip = jnp.diag(jnp.array([-1.0, -1.0, 1.0]))
    is_flip = (sin_alpha < 1e-10) & (cos_alpha < 0.0)
    R = jnp.where(is_flip, R_flip, R)

    return R


def _single_vortex_ring(
    X: jnp.ndarray, Y: jnp.ndarray, Z: jnp.ndarray,
    cx: float, cy: float, cz: float,
    theta: float, phi: float,
    R: float, sigma: float, Gamma: float,
    a1: float, p1: float, a2: float, p2: float,
) -> jnp.ndarray:
    """
    Construct the vorticity field ω(x) for a single perturbed vortex ring.

    The ring lies in the plane perpendicular to n(θ,φ), centered at (cx,cy,cz),
    with major radius R modulated by Fourier perturbations on the core line:
        r(α) = R + a₁ cos(α + p₁) + a₂ cos(2α + p₂)

    The core has a Gaussian profile:
        |ω| = (Γ / π σ²) exp(−d² / σ²)
    where d is the distance from each grid point to the nearest point on the
    (perturbed) core curve.

    Returns:
        omega: (3, Nx, Ny, Nz) float64 — vorticity components in Cartesian coords.
    """
    # Shift grid to ring center
    dx = X - cx
    dy = Y - cy
    dz = Z - cz

    # Rotation matrix: maps z-axis to ring normal
    Rot = _rodrigues_rotation_matrix(theta, phi)
    Rot_inv = Rot.T  # orthogonal → inverse = transpose

    # Rotate grid into ring-local frame (ring lies in x'-y' plane)
    # r_local = Rot_inv @ r_shifted
    x_loc = Rot_inv[0, 0] * dx + Rot_inv[0, 1] * dy + Rot_inv[0, 2] * dz
    y_loc = Rot_inv[1, 0] * dx + Rot_inv[1, 1] * dy + Rot_inv[1, 2] * dz
    z_loc = Rot_inv[2, 0] * dx + Rot_inv[2, 1] * dy + Rot_inv[2, 2] * dz

    # Cylindrical coordinates in ring-local frame
    rho = jnp.sqrt(x_loc**2 + y_loc**2)
    alpha = jnp.arctan2(y_loc, x_loc)  # azimuthal angle around ring axis

    # Perturbed core radius as function of azimuthal angle
    R_perturbed = R + a1 * jnp.cos(alpha + p1) + a2 * jnp.cos(2.0 * alpha + p2)

    # Distance from each grid point to the perturbed core line
    # Core line point in cylindrical: (R_perturbed(α), 0, α)
    # Grid point in cylindrical:     (rho, z_loc, α)
    # Distance²: (rho − R_perturbed)² + z_loc²
    d_sq = (rho - R_perturbed)**2 + z_loc**2

    # Gaussian vortex core amplitude
    amplitude = (Gamma / (jnp.pi * sigma**2)) * jnp.exp(-d_sq / sigma**2)

    # Vorticity direction: tangent to the core line → azimuthal direction φ̂
    # In ring-local Cartesian: φ̂ = (-sin α, cos α, 0)
    omega_x_loc = -amplitude * jnp.sin(alpha)
    omega_y_loc =  amplitude * jnp.cos(alpha)
    omega_z_loc =  jnp.zeros_like(amplitude)

    # Rotate back to global Cartesian frame
    omega_x = Rot[0, 0] * omega_x_loc + Rot[0, 1] * omega_y_loc + Rot[0, 2] * omega_z_loc
    omega_y = Rot[1, 0] * omega_x_loc + Rot[1, 1] * omega_y_loc + Rot[1, 2] * omega_z_loc
    omega_z = Rot[2, 0] * omega_x_loc + Rot[2, 1] * omega_y_loc + Rot[2, 2] * omega_z_loc

    return jnp.stack([omega_x, omega_y, omega_z], axis=0)


def dna_to_vorticity(
    dna: jnp.ndarray,
    N: int,
    L: float = L_DOMAIN,
    n_vortices: int = N_VORTICES,
) -> jnp.ndarray:
    """
    Construct the full 3D vorticity field from a flat DNA array.

    Parameters
    ----------
    dna : (DNA_LENGTH,) float64
        Flat array of DNA parameters.
    N : int
        Grid resolution per axis.
    L : float
        Domain side length (default 2π).
    n_vortices : int
        Number of vortex rings encoded in DNA.

    Returns
    -------
    omega : (3, N, N, N) float64
        Initial vorticity field. Approximately divergence-free by construction
        (exact for σ → 0; enforced spectrally by the solver after loading).
    """
    dx = L / N
    coords = jnp.arange(N) * dx
    X, Y, Z = jnp.meshgrid(coords, coords, coords, indexing="ij")

    omega = jnp.zeros((3, N, N, N), dtype=jnp.float64)
    ppv = PARAMS_PER_VORTEX

    for v in range(n_vortices):
        seg = dna[v * ppv : (v + 1) * ppv]
        cx, cy, cz = seg[0], seg[1], seg[2]
        th, ph = seg[3], seg[4]
        R, sigma, Gamma = seg[5], seg[6], seg[7]
        a1, p1, a2, p2 = seg[8], seg[9], seg[10], seg[11]

        omega_v = _single_vortex_ring(
            X, Y, Z, cx, cy, cz, th, ph, R, sigma, Gamma, a1, p1, a2, p2
        )
        omega = omega + omega_v

    return omega


# ============================================================================
# Checkpoint Persistence (JSON)
# ============================================================================
def save_population(
    population: np.ndarray,
    fitness: np.ndarray,
    generation: int,
    path: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    Save a GA generation to a JSON checkpoint file.

    Parameters
    ----------
    population : (pop_size, dna_length) ndarray
    fitness : (pop_size,) ndarray
        Fitness scores (peak enstrophy).
    generation : int
    path : str
        File path, e.g. "checkpoints/gen_0042.json".
    metadata : dict, optional
        Extra fields (hyperparameters, timings, etc.)
    """
    pop_list = population.tolist() if hasattr(population, "tolist") else list(population)
    fit_list = fitness.tolist() if hasattr(fitness, "tolist") else list(fitness)

    best_idx = int(np.argmax(fitness))
    checkpoint = {
        "generation": generation,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "population_size": len(pop_list),
        "dna_length": len(pop_list[0]) if pop_list else 0,
        "n_vortices": N_VORTICES,
        "best_dna_index": best_idx,
        "best_fitness": float(fitness[best_idx]),
        "best_dna_dict": dna_to_dict(np.array(pop_list[best_idx])),
        "fitness": fit_list,
        "population": pop_list,
    }
    if metadata is not None:
        checkpoint["metadata"] = metadata

    os.makedirs(os.path.dirname(path), exist_ok=True)

    # Atomic write: write to temp file, then rename
    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(checkpoint, f, indent=2)
    os.replace(tmp_path, path)


def load_population(path: str) -> tuple[np.ndarray, np.ndarray, int]:
    """
    Load a GA generation from a JSON checkpoint.

    Returns
    -------
    population : (pop_size, dna_length) ndarray
    fitness : (pop_size,) ndarray
    generation : int
    """
    with open(path, "r") as f:
        data = json.load(f)
    population = np.array(data["population"], dtype=np.float64)
    fitness = np.array(data["fitness"], dtype=np.float64)
    generation = int(data["generation"])
    return population, fitness, generation


def find_latest_checkpoint(checkpoint_dir: str = "checkpoints") -> str | None:
    """Find the most recent generation checkpoint file, or None if empty."""
    if not os.path.isdir(checkpoint_dir):
        return None
    files = sorted(
        [f for f in os.listdir(checkpoint_dir) if f.startswith("gen_") and f.endswith(".json")]
    )
    if not files:
        return None
    return os.path.join(checkpoint_dir, files[-1])


def load_best_dna(checkpoint_dir: str = "checkpoints") -> np.ndarray | None:
    """Load the single best DNA from the latest checkpoint."""
    path = find_latest_checkpoint(checkpoint_dir)
    if path is None:
        return None
    population, fitness, _ = load_population(path)
    best_idx = int(np.argmax(fitness))
    return population[best_idx]


# ============================================================================
# Utility: Print DNA Summary
# ============================================================================
def print_dna_summary(dna: np.ndarray, n_vortices: int = N_VORTICES) -> None:
    """Pretty-print a DNA configuration."""
    d = dna_to_dict(dna, n_vortices)
    for name, params in d.items():
        print(f"  {name}:")
        for k, v in params.items():
            print(f"    {k:20s} = {v:+.6f}")


# ============================================================================
# Self-test
# ============================================================================
if __name__ == "__main__":
    print("=== DNA Config Self-Test ===\n")

    # Generate random DNA
    key = jax.random.PRNGKey(42)
    dna = random_dna(key)
    print(f"DNA length: {dna.shape[0]} ({N_VORTICES} vortices × {PARAMS_PER_VORTEX} params)")
    print_dna_summary(np.array(dna))

    # Roundtrip: dna → dict → dna
    d = dna_to_dict(np.array(dna))
    dna_back = dict_to_dna(d)
    err = np.max(np.abs(np.array(dna) - dna_back))
    print(f"\nDict roundtrip error: {err:.2e}")
    assert err < 1e-14, "Dict roundtrip failed!"

    # Generate vorticity field at low resolution
    N_test = 32
    omega = dna_to_vorticity(dna, N_test)
    print(f"\nVorticity field shape: {omega.shape}")
    print(f"  max |ω|: {float(jnp.max(jnp.abs(omega))):.4f}")
    enstrophy = 0.5 * float(jnp.sum(omega**2)) * (L_DOMAIN / N_test)**3
    print(f"  Enstrophy: {enstrophy:.4f}")

    # Save/load roundtrip
    pop = np.array(random_population(jax.random.PRNGKey(0), 10))
    fit = np.random.rand(10)
    save_population(pop, fit, 0, "checkpoints/test_gen.json")
    pop2, fit2, gen2 = load_population("checkpoints/test_gen.json")
    assert np.allclose(pop, pop2), "Population roundtrip failed!"
    assert np.allclose(fit, fit2), "Fitness roundtrip failed!"
    os.remove("checkpoints/test_gen.json")
    print("\nCheckpoint save/load roundtrip: OK")

    print("\n=== All self-tests passed ===")
