// OS credential store for the BYOK provider API keys — one generic-password
// entry per provider, a thin transport for the TypeScript persistence policy
// (stores/secret-config.ts). On macOS it prefers the data-protection keychain
// with a legacy-keychain fallback and one-time migration; see the keychain
// section of specs/ARCHITECTURE.md for the rationale.

use std::sync::OnceLock;

use keyring::Entry;

// Keep in sync with `identifier` in tauri.conf.json: it namespaces the entries,
// so renaming the bundle id would silently orphan every stored key. Reused as
// the protected-store service too — the string there is just a label (the access
// group grants access), and reusing it keeps migration a same-name move.
const SERVICE: &str = "app.capybudget.desktop";

#[derive(Debug)]
enum StoreError {
    /// The build lacks the entitlement the data-protection keychain requires
    /// (`errSecMissingEntitlement`, -34018) — the signal to fall back to legacy.
    MissingEntitlement,
    Other(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::MissingEntitlement => f.write_str("keychain entitlement missing"),
            StoreError::Other(msg) => f.write_str(msg),
        }
    }
}

type StoreResult<T> = Result<T, StoreError>;

/// A single credential backend keyed by account (the service is baked in).
trait RawStore {
    fn get(&self, account: &str) -> StoreResult<Option<String>>;
    fn set(&self, account: &str, secret: &str) -> StoreResult<()>;
    fn delete(&self, account: &str) -> StoreResult<()>;
}

/// The cross-platform `keyring` backend: macOS legacy file-based keychain,
/// Windows Credential Manager, Linux secret-service.
struct KeyringStore {
    service: String,
}

impl KeyringStore {
    fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }

    fn entry(&self, account: &str) -> StoreResult<Entry> {
        Entry::new(&self.service, account).map_err(|e| StoreError::Other(e.to_string()))
    }
}

impl RawStore for KeyringStore {
    fn get(&self, account: &str) -> StoreResult<Option<String>> {
        match self.entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(StoreError::Other(e.to_string())),
        }
    }

    fn set(&self, account: &str, secret: &str) -> StoreResult<()> {
        self.entry(account)?
            .set_password(secret)
            .map_err(|e| StoreError::Other(e.to_string()))
    }

    fn delete(&self, account: &str) -> StoreResult<()> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(StoreError::Other(e.to_string())),
        }
    }
}

#[cfg(target_os = "macos")]
mod protected {
    use super::{RawStore, StoreError, StoreResult};
    use security_framework::passwords::{
        delete_generic_password_options, generic_password, set_generic_password_options,
        PasswordOptions,
    };

    // Apple OSStatus codes we branch on. Defined locally so the crate doesn't
    // take a direct dependency on security-framework-sys just for two constants.
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
    const ERR_SEC_MISSING_ENTITLEMENT: i32 = -34018;

    /// The macOS data-protection keychain. Access-group is left implicit: with a
    /// single `keychain-access-groups` entry the system uses it as the default
    /// group, which keeps the app's Team ID out of the compiled binary.
    pub struct ProtectedStore {
        service: String,
    }

    impl ProtectedStore {
        pub fn new(service: impl Into<String>) -> Self {
            Self { service: service.into() }
        }

        fn options(&self, account: &str) -> PasswordOptions {
            let mut options = PasswordOptions::new_generic_password(&self.service, account);
            options.use_protected_keychain();
            options
        }
    }

    fn classify(err: &security_framework::base::Error) -> StoreError {
        if err.code() == ERR_SEC_MISSING_ENTITLEMENT {
            StoreError::MissingEntitlement
        } else {
            StoreError::Other(err.to_string())
        }
    }

    impl RawStore for ProtectedStore {
        fn get(&self, account: &str) -> StoreResult<Option<String>> {
            match generic_password(self.options(account)) {
                Ok(bytes) => String::from_utf8(bytes)
                    .map(Some)
                    .map_err(|_| StoreError::Other("keychain secret is not valid UTF-8".into())),
                Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
                Err(e) => Err(classify(&e)),
            }
        }

        fn set(&self, account: &str, secret: &str) -> StoreResult<()> {
            set_generic_password_options(secret.as_bytes(), self.options(account))
                .map_err(|e| classify(&e))
        }

        fn delete(&self, account: &str) -> StoreResult<()> {
            match delete_generic_password_options(self.options(account)) {
                Ok(()) => Ok(()),
                Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
                Err(e) => Err(classify(&e)),
            }
        }
    }
}

/// Prefers a protected backend, falling back to a legacy one for the whole
/// process the first time protected reports it isn't entitled. On the way it
/// migrates any key still sitting in the legacy store into the protected one.
#[cfg(any(target_os = "macos", test))]
struct Deferred<P, L> {
    protected: P,
    legacy: L,
    // Cached once the first op learns whether the build is entitled. `None`
    // until then; the entitlement can't change within a process.
    entitled: OnceLock<bool>,
}

#[cfg(any(target_os = "macos", test))]
impl<P: RawStore, L: RawStore> Deferred<P, L> {
    fn new(protected: P, legacy: L) -> Self {
        Self { protected, legacy, entitled: OnceLock::new() }
    }

    fn entitled(&self) -> Option<bool> {
        self.entitled.get().copied()
    }

    fn mark(&self, entitled: bool) {
        let _ = self.entitled.set(entitled);
    }

    /// Protected is reachable but has nothing for `account`. Move a legacy key
    /// over if one exists. A denied or failed legacy read means "no legacy key"
    /// — it must never fail the caller's get. The legacy copy is dropped only
    /// after the protected write lands, so an interrupted migration simply
    /// retries next time rather than losing the key.
    fn migrate(&self, account: &str) -> StoreResult<Option<String>> {
        let secret = match self.legacy.get(account) {
            Ok(Some(secret)) => secret,
            _ => return Ok(None),
        };
        if self.protected.set(account, &secret).is_ok() {
            let _ = self.legacy.delete(account);
        }
        Ok(Some(secret))
    }
}

#[cfg(any(target_os = "macos", test))]
impl<P: RawStore, L: RawStore> RawStore for Deferred<P, L> {
    fn get(&self, account: &str) -> StoreResult<Option<String>> {
        if self.entitled() == Some(false) {
            return self.legacy.get(account);
        }
        match self.protected.get(account) {
            Ok(Some(secret)) => {
                self.mark(true);
                Ok(Some(secret))
            }
            Ok(None) => {
                self.mark(true);
                self.migrate(account)
            }
            Err(StoreError::MissingEntitlement) => {
                self.mark(false);
                self.legacy.get(account)
            }
            Err(e) => Err(e),
        }
    }

    fn set(&self, account: &str, secret: &str) -> StoreResult<()> {
        if self.entitled() == Some(false) {
            return self.legacy.set(account, secret);
        }
        match self.protected.set(account, secret) {
            Ok(()) => {
                self.mark(true);
                Ok(())
            }
            Err(StoreError::MissingEntitlement) => {
                self.mark(false);
                self.legacy.set(account, secret)
            }
            Err(e) => Err(e),
        }
    }

    fn delete(&self, account: &str) -> StoreResult<()> {
        if self.entitled() == Some(false) {
            return self.legacy.delete(account);
        }
        match self.protected.delete(account) {
            Ok(()) => {
                self.mark(true);
                // Drop any legacy copy too: otherwise the migration path would
                // resurrect the just-deleted key on the next get.
                let _ = self.legacy.delete(account);
                Ok(())
            }
            Err(StoreError::MissingEntitlement) => {
                self.mark(false);
                self.legacy.delete(account)
            }
            Err(e) => Err(e),
        }
    }
}

#[cfg(target_os = "macos")]
fn backend() -> &'static (dyn RawStore + Send + Sync) {
    static BACKEND: OnceLock<Deferred<protected::ProtectedStore, KeyringStore>> = OnceLock::new();
    BACKEND.get_or_init(|| {
        Deferred::new(protected::ProtectedStore::new(SERVICE), KeyringStore::new(SERVICE))
    })
}

#[cfg(not(target_os = "macos"))]
fn backend() -> &'static (dyn RawStore + Send + Sync) {
    static BACKEND: OnceLock<KeyringStore> = OnceLock::new();
    BACKEND.get_or_init(|| KeyringStore::new(SERVICE))
}

/// Read a secret, or `None` when no entry exists.
#[tauri::command]
pub fn keychain_get(account: String) -> Result<Option<String>, String> {
    backend().get(&account).map_err(|e| e.to_string())
}

/// Create or overwrite a secret.
#[tauri::command]
pub fn keychain_set(account: String, secret: String) -> Result<(), String> {
    backend().set(&account, &secret).map_err(|e| e.to_string())
}

/// Remove a secret. Absent entries are treated as already-removed.
#[tauri::command]
pub fn keychain_delete(account: String) -> Result<(), String> {
    backend().delete(&account).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;

    #[derive(Default)]
    struct Fake {
        items: RefCell<HashMap<String, String>>,
        missing_entitlement: bool,
        deny_get: bool,
        fail_set: bool,
        gets: Cell<usize>,
        sets: Cell<usize>,
        deletes: Cell<usize>,
    }

    impl Fake {
        fn with(items: &[(&str, &str)]) -> Self {
            let fake = Fake::default();
            for (account, secret) in items {
                fake.items.borrow_mut().insert((*account).into(), (*secret).into());
            }
            fake
        }

        fn unentitled() -> Self {
            Fake { missing_entitlement: true, ..Fake::default() }
        }

        fn has(&self, account: &str) -> bool {
            self.items.borrow().contains_key(account)
        }
    }

    impl RawStore for Fake {
        fn get(&self, account: &str) -> StoreResult<Option<String>> {
            self.gets.set(self.gets.get() + 1);
            if self.missing_entitlement {
                return Err(StoreError::MissingEntitlement);
            }
            if self.deny_get {
                return Err(StoreError::Other("denied".into()));
            }
            Ok(self.items.borrow().get(account).cloned())
        }

        fn set(&self, account: &str, secret: &str) -> StoreResult<()> {
            self.sets.set(self.sets.get() + 1);
            if self.missing_entitlement {
                return Err(StoreError::MissingEntitlement);
            }
            if self.fail_set {
                return Err(StoreError::Other("write failed".into()));
            }
            self.items.borrow_mut().insert(account.into(), secret.into());
            Ok(())
        }

        fn delete(&self, account: &str) -> StoreResult<()> {
            self.deletes.set(self.deletes.get() + 1);
            if self.missing_entitlement {
                return Err(StoreError::MissingEntitlement);
            }
            self.items.borrow_mut().remove(account);
            Ok(())
        }
    }

    const ACC: &str = "anthropic-api-key";

    #[test]
    fn serves_protected_without_touching_legacy() {
        let store = Deferred::new(Fake::with(&[(ACC, "sk-prot")]), Fake::default());
        assert_eq!(store.get(ACC).unwrap().as_deref(), Some("sk-prot"));
        assert_eq!(store.legacy.gets.get(), 0);
    }

    #[test]
    fn migrates_legacy_into_protected_once() {
        let store = Deferred::new(Fake::default(), Fake::with(&[(ACC, "sk-old")]));
        assert_eq!(store.get(ACC).unwrap().as_deref(), Some("sk-old"));
        // Moved into protected, removed from legacy.
        assert!(store.protected.has(ACC));
        assert!(!store.legacy.has(ACC));
        // Second read is served from protected — no further legacy access (the
        // one-time legacy read is where a prompt could ever occur).
        assert_eq!(store.get(ACC).unwrap().as_deref(), Some("sk-old"));
        assert_eq!(store.legacy.gets.get(), 1);
    }

    #[test]
    fn denied_legacy_read_during_migration_is_absent_not_error() {
        let legacy = Fake { deny_get: true, ..Fake::default() };
        let store = Deferred::new(Fake::default(), legacy);
        assert_eq!(store.get(ACC).unwrap(), None);
    }

    #[test]
    fn missing_entitlement_falls_back_and_caches() {
        let store = Deferred::new(Fake::unentitled(), Fake::with(&[(ACC, "sk-legacy")]));
        assert_eq!(store.get(ACC).unwrap().as_deref(), Some("sk-legacy"));
        // Decision cached: later ops skip the protected store entirely.
        store.set("openai-api-key", "sk-new").unwrap();
        assert_eq!(store.protected.gets.get(), 1);
        assert_eq!(store.protected.sets.get(), 0);
        assert_eq!(store.legacy.items.borrow().get("openai-api-key").map(String::as_str), Some("sk-new"));
    }

    #[test]
    fn delete_clears_legacy_so_no_resurrection() {
        // A stale legacy copy (e.g. an earlier migration whose delete was denied)
        // alongside the protected one.
        let store = Deferred::new(Fake::with(&[(ACC, "sk")]), Fake::with(&[(ACC, "sk")]));
        store.delete(ACC).unwrap();
        assert!(!store.protected.has(ACC));
        assert!(!store.legacy.has(ACC));
        assert_eq!(store.get(ACC).unwrap(), None);
    }

    #[test]
    fn interrupted_migration_keeps_legacy_copy() {
        // Protected is reachable but its migration write fails. The legacy key
        // must survive so the next read retries rather than losing it.
        let protected = Fake { fail_set: true, ..Fake::default() };
        let store = Deferred::new(protected, Fake::with(&[(ACC, "sk-old")]));
        assert_eq!(store.get(ACC).unwrap().as_deref(), Some("sk-old"));
        assert!(!store.protected.has(ACC));
        assert!(store.legacy.has(ACC));
        // The legacy copy is still there to serve the next read.
        assert_eq!(store.get(ACC).unwrap().as_deref(), Some("sk-old"));
    }

    #[test]
    fn set_then_get_roundtrips_on_protected() {
        let store = Deferred::new(Fake::default(), Fake::default());
        store.set(ACC, "sk-123").unwrap();
        assert_eq!(store.get(ACC).unwrap().as_deref(), Some("sk-123"));
        assert_eq!(store.legacy.sets.get(), 0);
    }
}
