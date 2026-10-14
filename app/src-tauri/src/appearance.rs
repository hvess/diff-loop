//! Follows the desktop's light or dark preference on Linux, which GTK 3 does
//! not read, through the XDG settings portal (ADR 0010 §4).

use std::fmt;

use gio::{
    BusType, Cancellable, DBusCallFlags, DBusProxy, DBusProxyFlags,
    glib::{Value, Variant, VariantTy},
    prelude::*,
};
use tauri::{AppHandle, Theme};

const NAMESPACE: &str = "org.freedesktop.appearance";
const KEY: &str = "color-scheme";

/// The portal's proxy, whose signal handler applies each change; `run`
/// keeps it as managed state.
pub(crate) struct Portal {
    /// Dropping it stops the updates.
    _proxy: DBusProxy,
}

impl fmt::Debug for Portal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Portal").finish_non_exhaustive()
    }
}

/// Applies the portal's colour scheme now and whenever it changes; `None`
/// without a session bus, when GTK's own guess stays.
pub(crate) fn follow(app: &AppHandle) -> Option<Portal> {
    // Connecting to the session bus is local; the portal is first asked in `read`.
    let proxy = DBusProxy::for_bus_sync(
        BusType::Session,
        DBusProxyFlags::DO_NOT_LOAD_PROPERTIES,
        None,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Settings",
        None::<&Cancellable>,
    )
    .ok()?;
    read(app, &proxy);
    let changed = app.clone();
    proxy.connect_local("g-signal", false, move |values| {
        if let Some(value) = setting_changed(values) {
            apply(&changed, &value);
        }
        None
    });
    Some(Portal { _proxy: proxy })
}

/// The new `color-scheme` from a `g-signal` emission's values (proxy, sender,
/// signal name, parameters), when it is a `SettingChanged` for it.
fn setting_changed(values: &[Value]) -> Option<Variant> {
    let [_, _, name, parameters] = values else {
        return None;
    };
    if name.get::<String>().ok()? != "SettingChanged" {
        return None;
    }
    let (namespace, key, value) = parameters
        .get::<Variant>()
        .ok()?
        .get::<(String, String, Variant)>()?;
    (namespace == NAMESPACE && key == KEY).then_some(value)
}

/// Reads the scheme once; `ReadOne` answers `(v)`.
fn read(app: &AppHandle, proxy: &DBusProxy) {
    let app = app.clone();
    proxy.call(
        "ReadOne",
        Some(&(NAMESPACE, KEY).to_variant()),
        DBusCallFlags::NONE,
        -1,
        None::<&Cancellable>,
        move |reply| {
            if let Some(value) = reply.ok().and_then(|r| r.try_child_value(0)) {
                apply(&app, &value);
            }
        },
    );
}

/// Sets the app's theme from a `color-scheme` value.
fn apply(app: &AppHandle, value: &Variant) {
    app.set_theme(scheme_of(value).and_then(theme_of));
}

/// A `color-scheme` value: `ReadOne` and `SettingChanged` send it bare, older
/// portals boxed in a `v`.
fn scheme_of(value: &Variant) -> Option<u32> {
    if value.type_() == VariantTy::VARIANT {
        value.as_variant()?.get()
    } else {
        value.get()
    }
}

/// The portal's `color-scheme`: 1 prefers dark, 2 prefers light, 0 (or
/// anything newer) states no preference.
fn theme_of(scheme: u32) -> Option<Theme> {
    match scheme {
        1 => Some(Theme::Dark),
        2 => Some(Theme::Light),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_portal_scheme_maps_to_a_theme() {
        assert_eq!(theme_of(0), None);
        assert_eq!(theme_of(1), Some(Theme::Dark));
        assert_eq!(theme_of(2), Some(Theme::Light));
        assert_eq!(theme_of(3), None);
    }

    #[test]
    fn a_boxed_or_bare_scheme_reads_the_same() {
        let bare = 1u32.to_variant();
        let boxed = Variant::from_variant(&bare);
        assert_eq!(scheme_of(&bare), Some(1));
        assert_eq!(scheme_of(&boxed), Some(1));
    }

    fn emission(name: &str, namespace: &str) -> [Value; 4] {
        let parameters = (namespace, KEY, 1u32.to_variant().to_variant()).to_variant();
        [
            0u32.to_value(),
            ":1.2".to_value(),
            name.to_value(),
            parameters.to_value(),
        ]
    }

    #[test]
    fn only_a_change_to_the_colour_scheme_is_applied() {
        let changed = setting_changed(&emission("SettingChanged", NAMESPACE));
        assert_eq!(changed.as_ref().and_then(scheme_of), Some(1));
        assert!(setting_changed(&emission("SettingChanged", "org.gnome.desktop.a11y")).is_none());
        assert!(setting_changed(&emission("Other", NAMESPACE)).is_none());
    }
}
