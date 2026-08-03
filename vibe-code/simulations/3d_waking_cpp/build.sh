#!/bin/bash
# build.sh — three binaries, no dependencies, no build system.
#
# Unity build on purpose: the whole simulator is header-only and every hot
# function (terrain sampling, contact, the spatial-algebra kernels, the network's
# inner loop) has to inline across what would otherwise be translation-unit
# boundaries. Splitting it into objects and linking costs more than it saves at
# this size, and -flto would only get the inlining back.
#
# WHAT IS DELIBERATELY NOT HERE: -ffast-math. It licenses the compiler to
# reassociate floating-point arithmetic, assume no NaN, and flush denormals — and
# this code TESTS for NaN (MultiBody::blown) to retire a walker whose dynamics
# blew up rather than let it poison the gene pool. With -ffast-math that test is
# dead code the optimiser is entitled to delete, and a blown walker would be
# scored instead of retired. It would also make the oracle comparison meaningless,
# which is the only evidence the port is correct.
#
#   ./build.sh            optimised
#   ./build.sh debug      -O0 -g -fsanitize=address,undefined
set -euo pipefail
cd "$(dirname "$0")"

CXX="${CXX:-g++}"
MODE="${1:-release}"

COMMON="-std=c++17 -Wall -Wextra -Wno-unused-parameter -pthread"
case "$MODE" in
  debug)
    FLAGS="$COMMON -O0 -g -fsanitize=address,undefined"
    SUFFIX="_dbg"
    ;;
  *)
    # -march=native is safe here because the binary is built on the machine it
    # runs on. If that ever stops being true, drop to -march=x86-64-v3.
    FLAGS="$COMMON -O3 -march=native -fno-math-errno -funroll-loops -DNDEBUG"
    SUFFIX=""
    ;;
esac

echo "building with $CXX ($MODE)"
# Each compile is waited on BY PID. A bare `wait` returns 0 no matter what the
# background jobs did, so `set -e` never saw a failure: a broken compile printed
# "built:" and left the PREVIOUS binaries on disk, and the verify run that
# followed reported "all checks passed" for code that no longer existed. Found
# exactly that way.
pids=()
$CXX $FLAGS src/train.cpp  -o "walk3d_train$SUFFIX"  & pids+=($!)
$CXX $FLAGS src/exam.cpp   -o "walk3d_exam$SUFFIX"   & pids+=($!)
$CXX $FLAGS src/verify.cpp -o "walk3d_verify$SUFFIX" & pids+=($!)
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if [ "$fail" -ne 0 ]; then
    echo "BUILD FAILED — any binaries still on disk are STALE. Do not run them." >&2
    exit 1
fi
echo "built: walk3d_train$SUFFIX walk3d_exam$SUFFIX walk3d_verify$SUFFIX"
