use sqlx::{Row, SqlitePool};

use crate::domain::Hotkey;

fn serialize_keys(keys: &[String]) -> Result<String, sqlx::Error> {
    serde_json::to_string(keys).map_err(|err| sqlx::Error::Decode(Box::new(err)))
}

fn deserialize_keys(keys: String) -> Result<Vec<String>, sqlx::Error> {
    serde_json::from_str(&keys).map_err(|err| sqlx::Error::Decode(Box::new(err)))
}

fn row_to_hotkey(row: &sqlx::sqlite::SqliteRow) -> Result<Hotkey, sqlx::Error> {
    let keys_json = row.get::<String, _>("keys");
    let keys = deserialize_keys(keys_json)?;
    Ok(Hotkey {
        id: row.get::<String, _>("id"),
        action_name: row.get::<String, _>("action_name"),
        keys,
        is_deleted: row.get::<Option<i64>, _>("is_deleted").map_or(false, |v| v != 0),
        updated_at: row.get::<Option<String>, _>("updated_at"),
    })
}

pub async fn upsert_hotkey(pool: SqlitePool, hotkey: &Hotkey) -> Result<Hotkey, sqlx::Error> {
    let keys_json = serialize_keys(&hotkey.keys)?;

    sqlx::query(
        "INSERT INTO hotkeys (id, action_name, keys)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET action_name = excluded.action_name, keys = excluded.keys, updated_at = datetime('now')",
    )
    .bind(&hotkey.id)
    .bind(&hotkey.action_name)
    .bind(keys_json)
    .execute(&pool)
    .await?;

    Ok(hotkey.clone())
}

pub async fn fetch_hotkeys(pool: SqlitePool) -> Result<Vec<Hotkey>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, action_name, keys, is_deleted, updated_at
         FROM hotkeys
         WHERE is_deleted = 0
         ORDER BY action_name ASC, id ASC",
    )
    .fetch_all(&pool)
    .await?;

    rows.iter().map(row_to_hotkey).collect()
}

pub async fn fetch_hotkeys_all(pool: SqlitePool) -> Result<Vec<Hotkey>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, action_name, keys, is_deleted, updated_at
         FROM hotkeys
         ORDER BY action_name ASC, id ASC",
    )
    .fetch_all(&pool)
    .await?;

    rows.iter().map(row_to_hotkey).collect()
}

pub async fn delete_hotkey(pool: SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE hotkeys SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1")
        .bind(id)
        .execute(&pool)
        .await?;

    Ok(())
}
