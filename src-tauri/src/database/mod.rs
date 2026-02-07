//! Database module - SQLite contacts storage

mod contacts;

pub use contacts::{Contact, ContactsDatabase, DatabaseError, NewContact};
