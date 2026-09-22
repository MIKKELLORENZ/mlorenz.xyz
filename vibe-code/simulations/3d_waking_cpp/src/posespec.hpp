/* posespec.hpp — start poses by NAME or by SPEC, shared by the search, the
 * distillation harness and (through WorldOpts::riseTrial) the trainer.
 *
 *   "prone" / "kneel" / …          a pose from groundPoses / startPoses (by name)
 *   "crouch:0.75"                  M.crouchAt(0.75)   the stage's own crouch ramp
 *   "seat:0.5"                     M.seatAt(0.5)
 *   "rise:0.8"                     M.riseAt(0.8)
 *   "lerp:kneel:quadruped:0.3"     a blend between two poses (reverse-curriculum rung)
 *
 * Every form is resolved by Model::poseBySpec inside World::init, so pinning a
 * pose is one line: set WorldOpts::riseTrial. (Specs used to be applied after
 * init by resetting the walker; the two paths were measured equivalent and
 * the single path is what lets the trainer's --rise-pose take a spec.)
 */
#pragma once
#include <string>
#include "world.hpp"

inline bool isPoseSpec(const std::string& s) {
    return s.rfind("crouch:", 0) == 0 || s.rfind("seat:", 0) == 0 || s.rfind("rise:", 0) == 0 || s.rfind("lerp:", 0) == 0 || s.rfind("fall:", 0) == 0 || s.rfind("jit:", 0) == 0;
}
inline Pose poseFromSpec(const Model& M, const std::string& s) {
    Pose p; M.poseBySpec(s, p); return p;
}
/* Prepare a WorldOpts for a start pose: everything goes through riseTrial. */
inline void poseOpts(WorldOpts& o, const std::string& pose) { o.riseTrial = pose; }
/* Kept for the callers; World::init already placed the pose. */
inline void poseApply(World&, const Model&, const std::string&) {}
