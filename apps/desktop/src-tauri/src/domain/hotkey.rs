use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hotkey {
    pub id: String,
    pub action_name: String,
    pub keys: Vec<String>,
    #[serde(default)]
    pub is_deleted: bool,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositorBinding {
    pub action_name: String,
    pub keys: Vec<String>,
}
