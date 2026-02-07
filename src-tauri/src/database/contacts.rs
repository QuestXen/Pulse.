//! Contacts Database
//!
//! SQLite-Datenbank für lokale Kontaktverwaltung.
//! Speichert peer_id, username und online-status.

use parking_lot::Mutex;
use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

// ============================================================================
// ERROR TYPES
// ============================================================================

#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Failed to create database directory: {0}")]
    DirectoryCreation(#[from] std::io::Error),

    #[error("Contact not found: {0}")]
    ContactNotFound(String),
}

// ============================================================================
// CONTACT STRUCT
// ============================================================================

/// Lokaler Kontakt mit cached Online-Status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: i64,
    pub peer_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub is_online: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Neuer Kontakt ohne ID (für INSERT)
#[derive(Debug, Clone)]
pub struct NewContact {
    pub peer_id: String,
    pub username: String,
    pub display_name: Option<String>,
}

// ============================================================================
// DATABASE
// ============================================================================

/// SQLite-Datenbank für Kontakte (Thread-safe durch Mutex)
pub struct ContactsDatabase {
    conn: Mutex<Connection>,
}

// Explizit Send + Sync implementieren da Mutex bereits thread-safe ist
unsafe impl Send for ContactsDatabase {}
unsafe impl Sync for ContactsDatabase {}

impl ContactsDatabase {
    /// Öffnet oder erstellt die Datenbank
    pub fn open() -> Result<Self, DatabaseError> {
        let db_path = Self::get_database_path()?;

        // Parent-Verzeichnis erstellen
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        tracing::info!("Opening database at {:?}", db_path);

        let conn = Connection::open(&db_path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;

        Ok(db)
    }

    /// In-Memory Datenbank für Tests
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, DatabaseError> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    /// Ermittelt den Pfad zur Datenbank-Datei
    fn get_database_path() -> Result<PathBuf, DatabaseError> {
        let proj_dirs =
            directories::ProjectDirs::from("com", "kaufm", "call-app").ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Could not determine app data directory",
                )
            })?;

        let mut path = proj_dirs.data_dir().to_path_buf();
        path.push("contacts.db");
        Ok(path)
    }

    /// Initialisiert das Datenbank-Schema
    fn init_schema(&self) -> Result<(), DatabaseError> {
        let conn = self.conn.lock();
        conn.execute(
            r#"
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                peer_id TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL,
                display_name TEXT,
                is_online INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            "#,
            [],
        )?;

        // Index für schnelle Suche
        conn.execute(
            r#"
            CREATE INDEX IF NOT EXISTS idx_contacts_peer_id ON contacts(peer_id)
            "#,
            [],
        )?;

        conn.execute(
            r#"
            CREATE INDEX IF NOT EXISTS idx_contacts_username ON contacts(username)
            "#,
            [],
        )?;

        Ok(())
    }

    /// Fügt einen neuen Kontakt hinzu
    pub fn add_contact(&self, contact: NewContact) -> Result<Contact, DatabaseError> {
        let conn = self.conn.lock();
        conn.execute(
            r#"
            INSERT INTO contacts (peer_id, username, display_name, is_online)
            VALUES (?1, ?2, ?3, 0)
            ON CONFLICT(peer_id) DO UPDATE SET
                username = excluded.username,
                display_name = COALESCE(excluded.display_name, display_name),
                updated_at = datetime('now')
            "#,
            params![contact.peer_id, contact.username, contact.display_name],
        )?;

        Self::get_contact_by_peer_id_inner(&conn, &contact.peer_id)
    }

    /// Interne Hilfsfunktion mit Connection-Referenz
    fn get_contact_by_peer_id_inner(
        conn: &Connection,
        peer_id: &str,
    ) -> Result<Contact, DatabaseError> {
        conn.query_row(
            r#"
            SELECT id, peer_id, username, display_name, is_online, created_at, updated_at
            FROM contacts
            WHERE peer_id = ?1
            "#,
            params![peer_id],
            |row| {
                Ok(Contact {
                    id: row.get(0)?,
                    peer_id: row.get(1)?,
                    username: row.get(2)?,
                    display_name: row.get(3)?,
                    is_online: row.get::<_, i32>(4)? != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                DatabaseError::ContactNotFound(peer_id.to_string())
            }
            other => DatabaseError::Sqlite(other),
        })
    }

    /// Holt einen Kontakt anhand der Peer-ID
    pub fn get_contact_by_peer_id(&self, peer_id: &str) -> Result<Contact, DatabaseError> {
        let conn = self.conn.lock();
        Self::get_contact_by_peer_id_inner(&conn, peer_id)
    }

    /// Holt alle Kontakte
    pub fn get_all_contacts(&self) -> Result<Vec<Contact>, DatabaseError> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            r#"
            SELECT id, peer_id, username, display_name, is_online, created_at, updated_at
            FROM contacts
            ORDER BY username ASC
            "#,
        )?;

        let contacts = stmt
            .query_map([], |row| {
                Ok(Contact {
                    id: row.get(0)?,
                    peer_id: row.get(1)?,
                    username: row.get(2)?,
                    display_name: row.get(3)?,
                    is_online: row.get::<_, i32>(4)? != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })?
            .collect::<SqliteResult<Vec<Contact>>>()?;

        Ok(contacts)
    }

    /// Aktualisiert den Online-Status eines Kontakts
    pub fn set_online_status(&self, peer_id: &str, is_online: bool) -> Result<(), DatabaseError> {
        let conn = self.conn.lock();
        conn.execute(
            r#"
            UPDATE contacts
            SET is_online = ?2, updated_at = datetime('now')
            WHERE peer_id = ?1
            "#,
            params![peer_id, is_online as i32],
        )?;
        Ok(())
    }

    /// Setzt alle Kontakte auf offline
    pub fn set_all_offline(&self) -> Result<(), DatabaseError> {
        let conn = self.conn.lock();
        conn.execute(
            r#"
            UPDATE contacts
            SET is_online = 0, updated_at = datetime('now')
            "#,
            [],
        )?;
        Ok(())
    }

    /// Aktualisiert den Display-Namen eines Kontakts
    pub fn set_display_name(
        &self,
        peer_id: &str,
        display_name: Option<&str>,
    ) -> Result<(), DatabaseError> {
        let conn = self.conn.lock();
        conn.execute(
            r#"
            UPDATE contacts
            SET display_name = ?2, updated_at = datetime('now')
            WHERE peer_id = ?1
            "#,
            params![peer_id, display_name],
        )?;
        Ok(())
    }

    /// Löscht einen Kontakt
    pub fn delete_contact(&self, peer_id: &str) -> Result<(), DatabaseError> {
        let conn = self.conn.lock();
        conn.execute(
            r#"
            DELETE FROM contacts
            WHERE peer_id = ?1
            "#,
            params![peer_id],
        )?;
        Ok(())
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_and_get_contact() {
        let db = ContactsDatabase::open_in_memory().unwrap();

        let new_contact = NewContact {
            peer_id: "test-peer-id".to_string(),
            username: "alice".to_string(),
            display_name: Some("Alice".to_string()),
        };

        let contact = db.add_contact(new_contact).unwrap();
        assert_eq!(contact.username, "alice");
        assert_eq!(contact.display_name, Some("Alice".to_string()));
        assert!(!contact.is_online);
    }

    #[test]
    fn test_online_status() {
        let db = ContactsDatabase::open_in_memory().unwrap();

        let new_contact = NewContact {
            peer_id: "test-peer".to_string(),
            username: "bob".to_string(),
            display_name: None,
        };

        db.add_contact(new_contact).unwrap();

        db.set_online_status("test-peer", true).unwrap();
        let contact = db.get_contact_by_peer_id("test-peer").unwrap();
        assert!(contact.is_online);
    }
}
