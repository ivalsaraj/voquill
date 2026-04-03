use sqlx::{Row, SqlitePool};

use crate::domain::Conversation;

pub async fn insert_conversation(
    pool: SqlitePool,
    conversation: &Conversation,
) -> Result<Conversation, sqlx::Error> {
    sqlx::query(
        "INSERT INTO conversations (id, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&conversation.id)
    .bind(&conversation.title)
    .bind(conversation.created_at)
    .bind(conversation.updated_at)
    .execute(&pool)
    .await?;

    Ok(conversation.clone())
}

fn row_to_conversation(row: &sqlx::sqlite::SqliteRow) -> Conversation {
    Conversation {
        id: row.get::<String, _>("id"),
        title: row.get::<String, _>("title"),
        created_at: row.get::<i64, _>("created_at"),
        updated_at: row.get::<i64, _>("updated_at"),
        is_deleted: row.get::<Option<i64>, _>("is_deleted").map_or(false, |v| v != 0),
    }
}

pub async fn fetch_conversations(pool: SqlitePool) -> Result<Vec<Conversation>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, title, created_at, updated_at, is_deleted
         FROM conversations
         WHERE is_deleted = 0
         ORDER BY updated_at DESC",
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows.iter().map(row_to_conversation).collect())
}

pub async fn fetch_conversations_all(pool: SqlitePool) -> Result<Vec<Conversation>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, title, created_at, updated_at, is_deleted
         FROM conversations
         ORDER BY updated_at DESC",
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows.iter().map(row_to_conversation).collect())
}

pub async fn update_conversation(
    pool: SqlitePool,
    conversation: &Conversation,
) -> Result<Conversation, sqlx::Error> {
    sqlx::query("UPDATE conversations SET title = ?2, updated_at = ?3 WHERE id = ?1")
        .bind(&conversation.id)
        .bind(&conversation.title)
        .bind(conversation.updated_at)
        .execute(&pool)
        .await?;

    Ok(conversation.clone())
}

pub async fn delete_conversation(pool: SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE chat_messages SET is_deleted = 1, updated_at = datetime('now') WHERE conversation_id = ?1")
        .bind(id)
        .execute(&pool)
        .await?;

    sqlx::query("UPDATE conversations SET is_deleted = 1, updated_at = strftime('%s','now') * 1000 WHERE id = ?1")
        .bind(id)
        .execute(&pool)
        .await?;

    Ok(())
}
