use sqlx::{Row, SqlitePool};

use crate::domain::ChatMessage;

pub async fn insert_chat_message(
    pool: SqlitePool,
    message: &ChatMessage,
) -> Result<ChatMessage, sqlx::Error> {
    sqlx::query(
        "INSERT INTO chat_messages (id, conversation_id, role, content, created_at, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&message.id)
    .bind(&message.conversation_id)
    .bind(&message.role)
    .bind(&message.content)
    .bind(message.created_at)
    .bind(&message.metadata)
    .execute(&pool)
    .await?;

    Ok(message.clone())
}

fn row_to_chat_message(row: &sqlx::sqlite::SqliteRow) -> ChatMessage {
    ChatMessage {
        id: row.get::<String, _>("id"),
        conversation_id: row.get::<String, _>("conversation_id"),
        role: row.get::<String, _>("role"),
        content: row.get::<String, _>("content"),
        created_at: row.get::<i64, _>("created_at"),
        metadata: row.get::<Option<String>, _>("metadata"),
        is_deleted: row.get::<Option<i64>, _>("is_deleted").map_or(false, |v| v != 0),
        updated_at: row.get::<Option<String>, _>("updated_at"),
    }
}

pub async fn fetch_chat_messages_by_conversation(
    pool: SqlitePool,
    conversation_id: &str,
) -> Result<Vec<ChatMessage>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, conversation_id, role, content, created_at, metadata, is_deleted, updated_at
         FROM chat_messages
         WHERE conversation_id = ?1 AND is_deleted = 0
         ORDER BY created_at ASC",
    )
    .bind(conversation_id)
    .fetch_all(&pool)
    .await?;

    Ok(rows.iter().map(row_to_chat_message).collect())
}

pub async fn fetch_chat_messages_by_conversation_all(
    pool: SqlitePool,
    conversation_id: &str,
) -> Result<Vec<ChatMessage>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, conversation_id, role, content, created_at, metadata, is_deleted, updated_at
         FROM chat_messages
         WHERE conversation_id = ?1
         ORDER BY created_at ASC",
    )
    .bind(conversation_id)
    .fetch_all(&pool)
    .await?;

    Ok(rows.iter().map(row_to_chat_message).collect())
}

pub async fn update_chat_message(
    pool: SqlitePool,
    message: &ChatMessage,
) -> Result<ChatMessage, sqlx::Error> {
    sqlx::query("UPDATE chat_messages SET content = ?2, metadata = ?3, updated_at = datetime('now') WHERE id = ?1")
        .bind(&message.id)
        .bind(&message.content)
        .bind(&message.metadata)
        .execute(&pool)
        .await?;

    Ok(message.clone())
}

pub async fn delete_chat_messages(pool: SqlitePool, ids: &[String]) -> Result<(), sqlx::Error> {
    for id in ids {
        sqlx::query("UPDATE chat_messages SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?1")
            .bind(id)
            .execute(&pool)
            .await?;
    }

    Ok(())
}
