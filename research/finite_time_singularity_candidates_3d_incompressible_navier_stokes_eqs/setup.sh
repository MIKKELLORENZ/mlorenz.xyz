#!/usr/bin/env bash
# ============================================================================
# setup.sh — Environment Setup for 3D Navier-Stokes Singularity Hunter
# ============================================================================
# Configures a headless Linux server with JAX (CPU), creates the project
# directory structure, and validates the installation.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh
#
# After setup, source the environment before running any phase:
#   source env.sh
#   source .venv/bin/activate
# ============================================================================
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${PROJ_DIR}/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "============================================================"
echo " Navier-Stokes Singularity Hunter — Environment Setup"
echo "============================================================"
echo "Project directory: ${PROJ_DIR}"
echo ""

# ---- 1. System Dependencies (optional, skip if already present) -----------
echo "[1/5] Checking system dependencies..."
if command -v apt-get &>/dev/null; then
    echo "  Debian/Ubuntu detected. Installing build essentials if missing..."
    sudo apt-get update -qq 2>/dev/null || echo "  WARNING: apt-get update had errors (broken third-party repos?). Continuing..."
    sudo apt-get install -y -qq python3-dev python3-venv libhdf5-dev \
        libopenmpi-dev build-essential pkg-config 2>/dev/null || true
elif command -v dnf &>/dev/null; then
    echo "  Fedora/RHEL detected."
    sudo dnf install -y python3-devel hdf5-devel openmpi-devel gcc gcc-c++ \
        2>/dev/null || true
else
    echo "  Unknown package manager. Ensure python3-dev, HDF5, and MPI headers"
    echo "  are installed manually."
fi
echo ""

# ---- 2. Python Virtual Environment ----------------------------------------
echo "[2/5] Creating Python virtual environment..."
if [ -d "${VENV_DIR}" ]; then
    echo "  Virtual environment already exists at ${VENV_DIR}. Skipping creation."
else
    ${PYTHON_BIN} -m venv "${VENV_DIR}"
    echo "  Created ${VENV_DIR}"
fi

source "${VENV_DIR}/bin/activate"
pip install --upgrade pip setuptools wheel -q
echo "  Python: $(python --version)"
echo "  pip:    $(pip --version | awk '{print $2}')"
echo ""

# ---- 3. Install Python Packages -------------------------------------------
echo "[3/5] Installing Python packages..."

# JAX CPU-only (latest stable)
pip install -q "jax[cpu]"

# Scientific stack
pip install -q numpy scipy h5py

# MPI bindings (optional, future multi-node)
pip install -q mpi4py 2>/dev/null || {
    echo "  WARNING: mpi4py install failed (MPI headers missing?). Skipping."
    echo "  This is only needed for future multi-node runs."
}

echo "  Installed packages:"
pip list --format=columns | grep -iE "jax|numpy|scipy|h5py|mpi4py" || true
echo ""

# ---- 4. Directory Structure ------------------------------------------------
echo "[4/5] Creating project directories..."
mkdir -p "${PROJ_DIR}/checkpoints"
mkdir -p "${PROJ_DIR}/logs"
mkdir -p "${PROJ_DIR}/results"
echo "  checkpoints/  — GA population snapshots (JSON)"
echo "  logs/         — CSV telemetry and run logs"
echo "  results/      — HDF5 output from Phase 3 verification"
echo ""

# ---- 5. Write env.sh (sourced before each phase) --------------------------
echo "[5/5] Writing env.sh..."
cat > "${PROJ_DIR}/env.sh" << 'ENVEOF'
#!/usr/bin/env bash
# ============================================================================
# env.sh — Runtime environment variables for the singularity hunter.
# Source this file before running any phase script.
#
# Usage:
#   source env.sh
#
# Per-phase thread tuning:
#   Phase 1 (GA):    120 processes × 1 thread each  → set by phase1_ga.py
#   Phase 2 (Adjoint): 1 process × 120 threads       → uses defaults below
#   Phase 3 (Verify):  1 process × 120 threads       → uses defaults below
# ============================================================================

export PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- JAX Configuration ---
export JAX_PLATFORM_NAME="cpu"
export JAX_ENABLE_X64="True"                # 64-bit precision (critical for BKM tracking)
export XLA_FLAGS="--xla_cpu_multi_thread_eigen=true intra_op_parallelism_threads=120"

# --- Threading defaults (Phase 2 & 3: single process, all cores) ---
export OMP_NUM_THREADS=120
export MKL_NUM_THREADS=120
export OPENBLAS_NUM_THREADS=120
export NUMEXPR_MAX_THREADS=120

# --- Suppress JAX info spam ---
export TF_CPP_MIN_LOG_LEVEL=2

# --- HDF5 threading ---
export HDF5_USE_FILE_LOCKING="FALSE"

echo "Environment loaded: JAX CPU x64, ${OMP_NUM_THREADS} threads."
ENVEOF
chmod +x "${PROJ_DIR}/env.sh"

echo ""
echo "============================================================"
echo " Validating installation..."
echo "============================================================"

# Quick validation: import JAX, run a small 3D FFT
python -c "
import os
os.environ['JAX_PLATFORM_NAME'] = 'cpu'
os.environ['JAX_ENABLE_X64'] = 'True'

import jax
import jax.numpy as jnp
from jax.numpy.fft import rfftn, irfftn

print(f'  JAX version:    {jax.__version__}')
print(f'  JAX platform:   {jax.default_backend()}')
print(f'  Float64:        {jnp.ones(1).dtype}')
print(f'  Devices:        {jax.devices()}')

# Small FFT benchmark (32^3)
key = jax.random.PRNGKey(0)
x = jax.random.normal(key, (32, 32, 32))
xh = rfftn(x)
x_back = irfftn(xh, s=(32, 32, 32))
err = float(jnp.max(jnp.abs(x - x_back)))
assert err < 1e-12, f'FFT roundtrip error {err} too large!'
print(f'  FFT roundtrip:  error = {err:.2e} (OK)')

# Gradient test
def f(x):
    return jnp.sum(rfftn(x).real ** 2)
g = jax.grad(f)(x)
assert g.shape == (32, 32, 32), 'Gradient shape mismatch'
print(f'  jax.grad(FFT):  shape {g.shape} (OK)')
print()
print('  All checks passed.')
"

echo ""
echo "============================================================"
echo " Setup complete."
echo ""
echo " Next steps:"
echo "   source env.sh"
echo "   source .venv/bin/activate"
echo "   python phase1_ga.py            # Launch 120-thread GA search"
echo "   python phase2_adjoint.py       # Adjoint refinement of best DNA"
echo "   python phase3_verify.py        # High-res 1024^3 BKM test"
echo "============================================================"
