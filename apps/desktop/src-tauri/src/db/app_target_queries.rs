use chrono::Utc;
use sqlx::{Row, SqlitePool};

use crate::domain::AppTarget;

fn row_to_app_target(row: &sqlx::sqlite::SqliteRow) -> Result<AppTarget, sqlx::Error> {
    Ok(AppTarget {
        id: row.get("id"),
        name: row.get("name"),
        created_at: row.get("created_at"),
        tone_id: row.try_get("tone_id")?,
        icon_path: row.try_get("icon_path")?,
        paste_keybind: row.try_get("paste_keybind")?,
        is_deleted: row.get::<Option<i64>, _>("is_deleted").map_or(false, |v| v != 0),
        updated_at: row.get::<Option<String>, _>("updated_at"),
    })
}

pub async fn upsert_app_target(
    pool: SqlitePool,
    id: &str,
    name: &str,
    tone_id: Option<String>,
    icon_path: Option<String>,
    paste_keybind: Option<String>,
) -> Result<AppTarget, sqlx::Error> {
    let existing_created_at =
        sqlx::query_scalar::<_, Option<String>>("SELECT created_at FROM app_targets WHERE id = ?1")
            .bind(id)
            .fetch_optional(&pool)
            .await?;

    let created_at = existing_created_at
        .flatten()
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    sqlx::query(
        "INSERT INTO app_targets (id, name, created_at, tone_id, icon_path, paste_keybind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           tone_id = excluded.tone_id,
           icon_path = excluded.icon_path,
           paste_keybind = excluded.paste_keybind,
           updated_at = datetime('now')",
    )
    .bind(id)
    .bind(name)
    .bind(&created_at)
    .bind(tone_id)
    .bind(icon_path)
    .bind(paste_keybind)
    .execute(&pool)
    .await?;

    let row = sqlx::query(
        "SELECT id, name, created_at, tone_id, icon_path, paste_keybind, is_deleted, updated_at FROM app_targets WHERE id = ?1",
    )
        .bind(id)
        .fetch_one(&pool)
        .await?;

    row_to_app_target(&row)
}

pub async fn fetch_app_targets(pool: SqlitePool) -> Result<Vec<AppTarget>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, name, created_at, tone_id, icon_path, paste_keybind, is_deleted, updated_at
         FROM app_targets
         WHERE is_deleted = 0
         ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await?;

    rows.iter().map(row_to_app_target).collect()
}

pub async fn fetch_app_targets_all(pool: SqlitePool) -> Result<Vec<AppTarget>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, name, created_at, tone_id, icon_path, paste_keybind, is_deleted, updated_at
         FROM app_targets
         ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await?;

    rows.iter().map(row_to_app_target).collect()
}

pub async fn delete_app_target(pool: SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE app_targets SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1")
        .bind(id)
        .execute(&pool)
        .await?;

    Ok(())
}
