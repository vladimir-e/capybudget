// OS credential store for the BYOK provider API keys. One generic-password
// entry per provider. Under the App Sandbox these items are app-private because
// the code signature's application-identifier scopes them to this app — the
// SERVICE string is just naming, not what grants the isolation — so no
// keychain-access-groups entitlement is needed. All the persistence policy —
// what to store, migration, the on-disk fallback — lives on the TypeScript side
// (see stores/secret-config.ts); these commands are the thin transport.

use keyring::{Entry, Error};

// Keep in sync with `identifier` in tauri.conf.json: it namespaces the entries,
// so renaming the bundle id would silently orphan every stored key.
const SERVICE: &str = "app.capybudget.desktop";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

/// Read a secret, or `None` when no entry exists.
#[tauri::command]
pub fn keychain_get(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Create or overwrite a secret.
#[tauri::command]
pub fn keychain_set(account: String, secret: String) -> Result<(), String> {
    entry(&account)?
        .set_password(&secret)
        .map_err(|e| e.to_string())
}

/// Remove a secret. Absent entries are treated as already-removed.
#[tauri::command]
pub fn keychain_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real round-trip against the OS credential store. Ignored by default: it
    // touches the login keychain (absent/locked in CI) and an unsigned test
    // binary may raise an access prompt. Run it on a dev machine with:
    //   cargo test --lib keychain -- --ignored
    #[test]
    #[ignore]
    fn set_get_delete_round_trips() {
        let account = "capy-test-roundtrip";
        keychain_set(account.into(), "sk-test-123".into()).unwrap();
        assert_eq!(
            keychain_get(account.into()).unwrap().as_deref(),
            Some("sk-test-123"),
        );
        keychain_delete(account.into()).unwrap();
        assert_eq!(keychain_get(account.into()).unwrap(), None);
        // Deleting an absent entry is a no-op, not an error.
        keychain_delete(account.into()).unwrap();
    }
}
