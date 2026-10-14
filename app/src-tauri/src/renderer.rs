//! Chooses WebKitGTK's renderer before the first window exists (ADR 0010 §3).

use std::{env, path::Path};

/// Settings a person may already have chosen; any of them is left as it is.
const CHOSEN: [&str; 3] = [
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    FORCE_SHM,
];

/// Keeps the composited renderer but moves its buffers through shared memory,
/// which NVIDIA's driver accepts where it refuses DMA-BUF ("Error 71").
const FORCE_SHM: &str = "WEBKIT_DMABUF_RENDERER_FORCE_SHM";

/// Sets [`FORCE_SHM`] where [`forces_shm`] says so.
///
/// Must run before any other thread starts: `run` calls it first.
pub(crate) fn choose() {
    let nvidia = Path::new("/sys/module/nvidia").exists();
    if forces_shm(nvidia, |name| env::var_os(name).is_some()) {
        // SAFETY: called first in `run`, while this is the process's only thread.
        unsafe { env::set_var(FORCE_SHM, "1") };
    }
}

/// Whether to set [`FORCE_SHM`]: only under NVIDIA's own driver, and only when
/// none of [`CHOSEN`] is set already.
fn forces_shm(nvidia: bool, is_set: impl Fn(&str) -> bool) -> bool {
    nvidia && !CHOSEN.into_iter().any(is_set)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_nvidia_gets_shared_memory_buffers() {
        assert!(forces_shm(true, |_| false));
        assert!(!forces_shm(false, |_| false));
    }

    #[test]
    fn a_renderer_setting_already_chosen_is_kept() {
        for chosen in CHOSEN {
            assert!(!forces_shm(true, |name| name == chosen), "{chosen}");
        }
    }
}
