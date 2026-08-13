use reqwest::{RequestBuilder, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeSet, HashMap},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    time::Duration,
};
use tauri::State;
use tokio::task::AbortHandle;

const DEFAULT_REQUEST_URL: &str = "https://api.openai.com/v1/responses";
const DEFAULT_MODELS_URL: &str = "https://api.openai.com/v1/models";
const DEFAULT_MODEL: &str = "gpt-5.6";
const MAX_URL_LENGTH: usize = 2_048;
const MAX_MODEL_LENGTH: usize = 256;
const MAX_MODELS: usize = 1_000;
const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const JSON_FORMAT_INSTRUCTION: &str = r#"Return only one valid JSON object. Do not use Markdown fences or add prose outside the JSON. The exact shape is {"cards":[{"type":"idea|question|assumption|decision","title":"short title","content":"useful standalone content"}],"privateSummary":"optional short memory for the active agent only"}. Return between 1 and 3 cards. Use the same natural language as the user's request unless explicitly asked otherwise."#;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
enum AiProtocol {
    #[serde(rename = "openai-chat-completions")]
    OpenAiChatCompletions,
    #[serde(rename = "openai-responses")]
    OpenAiResponses,
}

impl AiProtocol {
    fn parse(value: &str) -> Result<Self, CommandError> {
        match value.trim() {
            "openai-chat-completions" => Ok(Self::OpenAiChatCompletions),
            "openai-responses" => Ok(Self::OpenAiResponses),
            _ => Err(CommandError::new(
                "INVALID_PROTOCOL",
                "请求协议必须是 openai-chat-completions 或 openai-responses。",
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum AuthMode {
    Bearer,
    None,
}

impl AuthMode {
    fn parse(value: &str) -> Result<Self, CommandError> {
        match value.trim() {
            "bearer" => Ok(Self::Bearer),
            "none" => Ok(Self::None),
            _ => Err(CommandError::new(
                "INVALID_AUTH_MODE",
                "认证方式必须是 bearer 或 none。",
            )),
        }
    }
}

#[derive(Clone)]
struct AiRuntimeConfig {
    // Deliberately private and never Debug/Serialize. The credential lives only in this process.
    api_key: Option<String>,
    auth_mode: AuthMode,
    protocol: AiProtocol,
    request_url: String,
    models_url: String,
    model: String,
    json_mode: bool,
    thinking: bool,
    verified: bool,
}

struct AiRuntimeState {
    config: Mutex<Option<AiRuntimeConfig>>,
    active_runs: Mutex<HashMap<String, ActiveRun>>,
    next_run_token: AtomicU64,
    client: reqwest::Client,
}

struct ActiveRun {
    token: u64,
    handle: AbortHandle,
}

impl AiRuntimeState {
    fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(180))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Idea-Workspace/0.1")
            .build()
            .expect("failed to create the AI HTTP client");

        Self {
            config: Mutex::new(None),
            active_runs: Mutex::new(HashMap::new()),
            next_run_token: AtomicU64::new(1),
            client,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandError {
    code: &'static str,
    message: String,
}

impl CommandError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

// Do not derive Debug or Serialize: this command input may contain a credential.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiRuntimeConfigInput {
    #[serde(default)]
    api_key: String,
    auth_mode: String,
    protocol: String,
    request_url: String,
    models_url: String,
    model: String,
    #[serde(default)]
    json_mode: bool,
    #[serde(default)]
    thinking: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiRuntimeStatus {
    configured: bool,
    verified: bool,
    protocol: AiProtocol,
    auth_mode: AuthMode,
    request_url: String,
    models_url: String,
    model: String,
    json_mode: bool,
    thinking: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    key_hint: Option<String>,
    active_run_count: usize,
    message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiRequest {
    run_id: String,
    messages: Vec<ChatMessage>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
}

#[derive(Debug, Deserialize, Serialize)]
struct GeneratedCard {
    #[serde(rename = "type")]
    card_type: String,
    title: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedEnvelope {
    cards: Vec<GeneratedCard>,
    #[serde(default, alias = "summary")]
    private_summary: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
    total_tokens: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiResponse {
    cards: Vec<GeneratedCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    private_summary: Option<String>,
    usage: TokenUsage,
    model: String,
    protocol: AiProtocol,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiModelsResult {
    models: Vec<String>,
    source_url: String,
    message: String,
}

struct ParsedModelList {
    models: Vec<String>,
    truncated: bool,
}

fn lock<'a, T>(mutex: &'a Mutex<T>) -> Result<MutexGuard<'a, T>, CommandError> {
    mutex
        .lock()
        .map_err(|_| CommandError::new("INTERNAL_STATE_ERROR", "AI 内核状态不可用，请重启应用。"))
}

fn validate_url(value: &str, field_name: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_URL_LENGTH {
        return Err(CommandError::new(
            "INVALID_URL",
            format!("{field_name}为空或长度超过限制。"),
        ));
    }

    let parsed = reqwest::Url::parse(value).map_err(|_| {
        CommandError::new("INVALID_URL", format!("{field_name}不是有效的网址。"))
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(CommandError::new(
            "INVALID_URL",
            format!("{field_name}只允许 http 或 https。"),
        ));
    }
    if parsed.host_str().is_none() {
        return Err(CommandError::new(
            "INVALID_URL",
            format!("{field_name}必须包含主机名。"),
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(CommandError::new(
            "INVALID_URL",
            format!("{field_name}不得在网址中包含用户名或密码。"),
        ));
    }
    if parsed.fragment().is_some() {
        return Err(CommandError::new(
            "INVALID_URL",
            format!("{field_name}不得包含 URL 片段。"),
        ));
    }
    if parsed.query().is_some() {
        return Err(CommandError::new(
            "INVALID_URL",
            format!("{field_name}不得包含查询参数。"),
        ));
    }
    if parsed.scheme() == "http" && !is_loopback_host(parsed.host_str().unwrap_or_default()) {
        return Err(CommandError::new(
            "INSECURE_URL",
            format!("{field_name}使用非本机地址时必须启用 https。"),
        ));
    }

    Ok(parsed.to_string())
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn urls_have_same_origin(left: &str, right: &str) -> bool {
    let (Ok(left), Ok(right)) = (reqwest::Url::parse(left), reqwest::Url::parse(right)) else {
        return false;
    };
    left.scheme() == right.scheme()
        && left.host() == right.host()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn validate_model(model: &str) -> Result<String, CommandError> {
    let model = model.trim();
    if model.is_empty() || model.chars().count() > MAX_MODEL_LENGTH {
        return Err(CommandError::new(
            "INVALID_MODEL",
            "模型名称为空或长度超过限制。",
        ));
    }
    if model.chars().any(char::is_control) {
        return Err(CommandError::new(
            "INVALID_MODEL",
            "模型名称不能包含控制字符。",
        ));
    }
    Ok(model.to_owned())
}

fn resolve_config_input(
    input: AiRuntimeConfigInput,
    existing: Option<&AiRuntimeConfig>,
) -> Result<AiRuntimeConfig, CommandError> {
    resolve_config_input_inner(input, existing, true)
}

fn resolve_fetch_config_input(
    input: AiRuntimeConfigInput,
    existing: Option<&AiRuntimeConfig>,
) -> Result<AiRuntimeConfig, CommandError> {
    resolve_config_input_inner(input, existing, false)
}

fn resolve_config_input_inner(
    input: AiRuntimeConfigInput,
    existing: Option<&AiRuntimeConfig>,
    require_model: bool,
) -> Result<AiRuntimeConfig, CommandError> {
    let auth_mode = AuthMode::parse(&input.auth_mode)?;
    let protocol = AiProtocol::parse(&input.protocol)?;
    let request_url = validate_url(&input.request_url, "请求地址")?;
    let models_url = validate_url(&input.models_url, "模型列表地址")?;
    let model = if !require_model && input.model.trim().is_empty() {
        String::new()
    } else {
        validate_model(&input.model)?
    };
    if auth_mode == AuthMode::Bearer && !urls_have_same_origin(&request_url, &models_url) {
        return Err(CommandError::new(
            "CROSS_ORIGIN_AUTH_URL",
            "Bearer 认证时，请求地址与模型列表地址必须属于同一来源。",
        ));
    }

    let supplied_key = input.api_key.trim();
    if supplied_key.len() > 4_096 || supplied_key.chars().any(char::is_control) {
        return Err(CommandError::new("INVALID_API_KEY", "API Key 格式无效。"));
    }
    let api_key = match auth_mode {
        AuthMode::None => None,
        AuthMode::Bearer if supplied_key.is_empty() => existing
            .filter(|config| {
                config.request_url == request_url
                    && config.models_url == models_url
                    && config.protocol == protocol
            })
            .and_then(|config| config.api_key.clone()),
        AuthMode::Bearer => Some(supplied_key.to_owned()),
    };
    if auth_mode == AuthMode::Bearer && api_key.is_none() {
        return Err(CommandError::new(
            "MISSING_API_KEY",
            "Bearer 认证首次配置时必须填写 API Key。",
        ));
    }

    Ok(AiRuntimeConfig {
        api_key,
        auth_mode,
        protocol,
        request_url,
        models_url,
        model,
        json_mode: input.json_mode,
        thinking: input.thinking,
        verified: false,
    })
}

fn masked_key_hint(api_key: &str) -> String {
    let char_count = api_key.chars().count();
    if char_count <= 4 {
        return "••••".into();
    }
    let suffix: String = api_key.chars().skip(char_count - 4).collect();
    format!("••••{suffix}")
}

fn validate_request(request: &AiRequest) -> Result<(), CommandError> {
    let run_id = request.run_id.trim();
    if run_id.is_empty() || run_id.len() > 128 {
        return Err(CommandError::new(
            "INVALID_RUN_ID",
            "运行标识为空或过长。",
        ));
    }
    if request.messages.is_empty() {
        return Err(CommandError::new(
            "EMPTY_MESSAGES",
            "至少需要一条消息才能运行 AI。",
        ));
    }

    let mut total_chars = 0usize;
    for message in &request.messages {
        if !matches!(message.role.as_str(), "system" | "user" | "assistant") {
            return Err(CommandError::new(
                "INVALID_MESSAGE_ROLE",
                "消息角色只能是 system、user 或 assistant。",
            ));
        }
        if message.content.trim().is_empty() {
            return Err(CommandError::new(
                "EMPTY_MESSAGE_CONTENT",
                "消息内容不能为空。",
            ));
        }
        total_chars = total_chars.saturating_add(message.content.chars().count());
    }
    if total_chars > 300_000 {
        return Err(CommandError::new(
            "CONTEXT_TOO_LARGE",
            "本次上下文过大，请减少卡片或文件内容后再试。",
        ));
    }
    if request.max_tokens.is_some_and(|value| !(64..=16_384).contains(&value)) {
        return Err(CommandError::new(
            "INVALID_MAX_TOKENS",
            "maxTokens 必须在 64 到 16384 之间。",
        ));
    }
    if request
        .temperature
        .is_some_and(|value| !value.is_finite() || !(0.0..=2.0).contains(&value))
    {
        return Err(CommandError::new(
            "INVALID_TEMPERATURE",
            "temperature 必须在 0 到 2 之间。",
        ));
    }
    Ok(())
}

fn json_instruction_messages(request: &AiRequest) -> Vec<ChatMessage> {
    let mut messages = Vec::with_capacity(request.messages.len() + 1);
    messages.push(ChatMessage {
        role: "system".into(),
        content: JSON_FORMAT_INSTRUCTION.into(),
    });
    messages.extend(request.messages.iter().cloned());
    messages
}

fn build_chat_payload(config: &AiRuntimeConfig, request: &AiRequest) -> Value {
    let mut payload = Map::new();
    payload.insert("model".into(), json!(config.model));
    payload.insert("messages".into(), json!(json_instruction_messages(request)));
    payload.insert("stream".into(), json!(false));
    payload.insert(
        "max_completion_tokens".into(),
        json!(request.max_tokens.unwrap_or(2_048)),
    );
    if let Some(temperature) = request.temperature {
        payload.insert("temperature".into(), json!(temperature));
    }
    if config.json_mode {
        payload.insert(
            "response_format".into(),
            json!({ "type": "json_object" }),
        );
    }
    if config.thinking {
        payload.insert("thinking".into(), json!(true));
    }
    Value::Object(payload)
}

fn build_responses_payload(config: &AiRuntimeConfig, request: &AiRequest) -> Value {
    let mut system_parts: Vec<&str> = request
        .messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect();
    system_parts.push(JSON_FORMAT_INSTRUCTION);

    let input: Vec<Value> = request
        .messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content,
            })
        })
        .collect();

    let mut payload = Map::new();
    payload.insert("model".into(), json!(config.model));
    payload.insert("instructions".into(), json!(system_parts.join("\n\n")));
    payload.insert("input".into(), json!(input));
    payload.insert(
        "max_output_tokens".into(),
        json!(request.max_tokens.unwrap_or(2_048)),
    );
    payload.insert("store".into(), json!(false));
    if config.json_mode {
        payload.insert(
            "text".into(),
            json!({ "format": { "type": "json_object" } }),
        );
    }
    if let Some(temperature) = request.temperature {
        payload.insert("temperature".into(), json!(temperature));
    }
    Value::Object(payload)
}

fn build_request_payload(config: &AiRuntimeConfig, request: &AiRequest) -> Value {
    match config.protocol {
        AiProtocol::OpenAiChatCompletions => build_chat_payload(config, request),
        AiProtocol::OpenAiResponses => build_responses_payload(config, request),
    }
}

fn current_config(state: &AiRuntimeState) -> Result<AiRuntimeConfig, CommandError> {
    lock(&state.config)?
        .clone()
        .ok_or_else(|| CommandError::new("NOT_CONFIGURED", "请先配置 AI 请求。"))
}

fn default_status(active_run_count: usize) -> AiRuntimeStatus {
    AiRuntimeStatus {
        configured: false,
        verified: false,
        protocol: AiProtocol::OpenAiResponses,
        auth_mode: AuthMode::Bearer,
        request_url: DEFAULT_REQUEST_URL.into(),
        models_url: DEFAULT_MODELS_URL.into(),
        model: DEFAULT_MODEL.into(),
        json_mode: true,
        thinking: false,
        key_hint: None,
        active_run_count,
        message: "尚未配置 AI 请求。API Key 只会保存在本次应用进程的内存中。".into(),
    }
}

fn status_from_state(state: &AiRuntimeState) -> Result<AiRuntimeStatus, CommandError> {
    let config = lock(&state.config)?.clone();
    let active_run_count = lock(&state.active_runs)?.len();
    Ok(match config {
        Some(config) => AiRuntimeStatus {
            configured: true,
            verified: config.verified,
            protocol: config.protocol,
            auth_mode: config.auth_mode,
            request_url: config.request_url,
            models_url: config.models_url,
            model: config.model,
            json_mode: config.json_mode,
            thinking: config.thinking,
            key_hint: config.api_key.as_deref().map(masked_key_hint),
            active_run_count,
            message: if config.verified {
                "模型列表地址与认证已经验证；生成请求地址会在首次运行时验证。API Key 只保存在本次应用进程的内存中。".into()
            } else {
                "AI 请求已经配置但尚未验证，请执行连接测试。".into()
            },
        },
        None => default_status(active_run_count),
    })
}

fn with_auth(builder: RequestBuilder, config: &AiRuntimeConfig) -> RequestBuilder {
    match (config.auth_mode, config.api_key.as_deref()) {
        (AuthMode::Bearer, Some(api_key)) => builder.bearer_auth(api_key),
        _ => builder,
    }
}

#[tauri::command]
fn configure_ai_runtime(
    state: State<'_, AiRuntimeState>,
    config: AiRuntimeConfigInput,
) -> Result<AiRuntimeStatus, CommandError> {
    let existing = lock(&state.config)?.clone();
    let resolved = resolve_config_input(config, existing.as_ref())?;
    *lock(&state.config)? = Some(resolved);
    status_from_state(&state)
}

#[tauri::command]
fn get_ai_runtime_status(
    state: State<'_, AiRuntimeState>,
) -> Result<AiRuntimeStatus, CommandError> {
    status_from_state(&state)
}

#[tauri::command]
fn clear_ai_runtime_config(
    state: State<'_, AiRuntimeState>,
) -> Result<AiRuntimeStatus, CommandError> {
    *lock(&state.config)? = None;
    let mut runs = lock(&state.active_runs)?;
    for (_, active) in runs.drain() {
        active.handle.abort();
    }
    drop(runs);
    status_from_state(&state)
}

#[tauri::command]
async fn fetch_ai_models(
    state: State<'_, AiRuntimeState>,
    config: AiRuntimeConfigInput,
) -> Result<AiModelsResult, CommandError> {
    let existing = lock(&state.config)?.clone();
    let config = resolve_fetch_config_input(config, existing.as_ref())?;
    fetch_models(&state.client, &config).await
}

#[tauri::command]
async fn test_ai_connection(
    state: State<'_, AiRuntimeState>,
) -> Result<AiRuntimeStatus, CommandError> {
    let config = current_config(&state)?;
    let result = fetch_models(&state.client, &config).await?;
    let model_is_listed = result.models.iter().any(|model| model == &config.model);

    let mut stored = lock(&state.config)?;
    let mut result_applied = false;
    if let Some(current) = stored.as_mut() {
        if same_config(current, &config) {
            current.verified = true;
            result_applied = true;
        }
    }
    drop(stored);

    let mut status = status_from_state(&state)?;
    if !result_applied {
        status.message = "测试期间配置已经改变，本次模型列表结果未应用；请重新测试当前配置。".into();
        return Ok(status);
    }
    status.message = if model_is_listed {
        format!("模型列表地址连接成功，模型 {} 已在返回列表中。", config.model)
    } else {
        format!(
            "模型列表地址连接成功，但列表中没有 {}。仍可继续使用该自定义模型名；实际生成请求是否受支持尚未验证。",
            config.model
        )
    };
    Ok(status)
}

fn same_config(left: &AiRuntimeConfig, right: &AiRuntimeConfig) -> bool {
    left.api_key == right.api_key
        && left.auth_mode == right.auth_mode
        && left.protocol == right.protocol
        && left.request_url == right.request_url
        && left.models_url == right.models_url
        && left.model == right.model
        && left.json_mode == right.json_mode
        && left.thinking == right.thinking
}

#[tauri::command]
async fn run_ai_request(
    state: State<'_, AiRuntimeState>,
    request: AiRequest,
) -> Result<AiResponse, CommandError> {
    validate_request(&request)?;
    let config = current_config(&state)?;
    let run_id = request.run_id.trim().to_owned();
    let payload = build_request_payload(&config, &request);

    let client = state.client.clone();
    let task_config = config.clone();
    let run_token = state.next_run_token.fetch_add(1, Ordering::Relaxed);
    let task = {
        let mut runs = lock(&state.active_runs)?;
        if runs.contains_key(&run_id) {
            return Err(CommandError::new(
                "DUPLICATE_RUN_ID",
                "相同运行标识的请求仍在执行。",
            ));
        }
        let task = tauri::async_runtime::spawn(async move {
            perform_ai_request(client, task_config, payload).await
        });
        runs.insert(
            run_id.clone(),
            ActiveRun {
                token: run_token,
                handle: task.inner().abort_handle(),
            },
        );
        task
    };

    let task_result = match task.await {
        Ok(result) => result,
        Err(_) => Err(CommandError::new("RUN_CANCELLED", "本次 AI 运行已中断。")),
    };

    let mut runs = lock(&state.active_runs)?;
    let is_current = runs
        .get(&run_id)
        .is_some_and(|active| active.token == run_token);
    if is_current {
        runs.remove(&run_id);
    }
    drop(runs);

    if !is_current {
        return Err(CommandError::new("RUN_CANCELLED", "本次 AI 运行已中断。"));
    }
    task_result
}

#[tauri::command]
fn cancel_ai_run(
    state: State<'_, AiRuntimeState>,
    run_id: String,
) -> Result<bool, CommandError> {
    let mut runs = lock(&state.active_runs)?;
    if let Some(active) = runs.remove(run_id.trim()) {
        active.handle.abort();
        Ok(true)
    } else {
        Ok(false)
    }
}

async fn fetch_models(
    client: &reqwest::Client,
    config: &AiRuntimeConfig,
) -> Result<AiModelsResult, CommandError> {
    let response = with_auth(client.get(&config.models_url), config)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(map_network_error)?;
    let status = response.status();
    let bytes = read_limited_body(response).await?;
    if !status.is_success() {
        return Err(map_api_error(status, &bytes, config.api_key.as_deref()));
    }

    let parsed = parse_model_list(&bytes)?;
    let count = parsed.models.len();
    Ok(AiModelsResult {
        models: parsed.models,
        source_url: config.models_url.clone(),
        message: if parsed.truncated {
            format!("模型列表超过 {MAX_MODELS} 项，已按上限显示前 {count} 个模型。")
        } else {
            format!("已从模型列表地址获取 {count} 个模型。")
        },
    })
}

async fn perform_ai_request(
    client: reqwest::Client,
    config: AiRuntimeConfig,
    payload: Value,
) -> Result<AiResponse, CommandError> {
    let response = with_auth(client.post(&config.request_url), &config)
        .json(&payload)
        .send()
        .await
        .map_err(map_network_error)?;
    let status = response.status();
    let bytes = read_limited_body(response).await?;
    if !status.is_success() {
        return Err(map_api_error(status, &bytes, config.api_key.as_deref()));
    }

    match config.protocol {
        AiProtocol::OpenAiChatCompletions => parse_chat_response(&bytes, &config.model),
        AiProtocol::OpenAiResponses => parse_responses_response(&bytes, &config.model),
    }
}

async fn read_limited_body(mut response: reqwest::Response) -> Result<Vec<u8>, CommandError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(CommandError::new(
            "RESPONSE_TOO_LARGE",
            "AI 请求返回内容过大，已停止处理。",
        ));
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(map_network_error)? {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(CommandError::new(
                "RESPONSE_TOO_LARGE",
                "AI 请求返回内容过大，已停止处理。",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn parse_model_list(bytes: &[u8]) -> Result<ParsedModelList, CommandError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| {
        CommandError::new("INVALID_API_RESPONSE", "请求地址返回了无法识别的模型列表。")
    })?;

    let list = if let Some(array) = value.as_array() {
        array
    } else if let Some(object) = value.as_object() {
        object
            .get("data")
            .or_else(|| object.get("models"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                CommandError::new(
                    "INVALID_API_RESPONSE",
                    "模型列表响应中缺少 data 或 models 数组。",
                )
            })?
    } else {
        return Err(CommandError::new(
            "INVALID_API_RESPONSE",
            "请求地址返回了无法识别的模型列表。",
        ));
    };

    let mut models = BTreeSet::new();
    let mut truncated = false;
    for item in list {
        let candidate = item.as_str().or_else(|| {
            item.as_object().and_then(|object| {
                object
                    .get("id")
                    .or_else(|| object.get("model"))
                    .or_else(|| object.get("name"))
                    .and_then(Value::as_str)
            })
        });
        if let Some(candidate) = candidate {
            let candidate = candidate.trim();
            if !candidate.is_empty()
                && candidate.chars().count() <= MAX_MODEL_LENGTH
                && !candidate.chars().any(char::is_control)
            {
                if models.len() < MAX_MODELS {
                    models.insert(candidate.to_owned());
                } else if !models.contains(candidate) {
                    truncated = true;
                }
            }
        }
    }
    Ok(ParsedModelList {
        models: models.into_iter().collect(),
        truncated,
    })
}

fn parse_chat_response(bytes: &[u8], fallback_model: &str) -> Result<AiResponse, CommandError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| {
        CommandError::new("INVALID_API_RESPONSE", "请求地址返回了无法识别的响应。")
    })?;
    let first_choice = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or_else(|| CommandError::new("EMPTY_MODEL_OUTPUT", "AI 未返回内容，请重试。"))?;
    match first_choice.get("finish_reason").and_then(Value::as_str) {
        Some("length") => {
            return Err(CommandError::new(
                "INCOMPLETE_MODEL_OUTPUT",
                "AI 输出因长度限制而被截断，请减少上下文或提高输出上限。",
            ));
        }
        Some("content_filter") => {
            return Err(CommandError::new(
                "MODEL_REFUSAL",
                "AI 输出被内容过滤器拦截。",
            ));
        }
        _ => {}
    }
    let content_value = first_choice
        .get("message")
        .and_then(|message| message.get("content"))
        .ok_or_else(|| CommandError::new("EMPTY_MODEL_OUTPUT", "AI 未返回内容，请重试。"))?;
    let content = extract_text(content_value)
        .ok_or_else(|| CommandError::new("EMPTY_MODEL_OUTPUT", "AI 未返回内容，请重试。"))?;
    let (cards, private_summary) = parse_generated_output(&content)?;
    let usage = value.get("usage");
    let prompt_tokens = usage
        .and_then(|usage| usage.get("prompt_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let completion_tokens = usage
        .and_then(|usage| usage.get("completion_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total_tokens = usage
        .and_then(|usage| usage.get("total_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or_else(|| prompt_tokens.saturating_add(completion_tokens));

    Ok(AiResponse {
        cards,
        private_summary,
        usage: TokenUsage {
            prompt_tokens,
            completion_tokens,
            total_tokens,
        },
        model: response_model(&value, fallback_model),
        protocol: AiProtocol::OpenAiChatCompletions,
    })
}

fn parse_responses_response(
    bytes: &[u8],
    fallback_model: &str,
) -> Result<AiResponse, CommandError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| {
        CommandError::new("INVALID_API_RESPONSE", "请求地址返回了无法识别的响应。")
    })?;
    if let Some(status) = value.get("status").and_then(Value::as_str) {
        match status {
            "completed" => {}
            "incomplete" => {
                return Err(CommandError::new(
                    "INCOMPLETE_MODEL_OUTPUT",
                    "AI 响应未完成，请调整请求后重试。",
                ));
            }
            _ => {
                return Err(CommandError::new(
                    "FAILED_MODEL_OUTPUT",
                    "AI 响应未成功完成，请稍后重试。",
                ));
            }
        }
    }
    if contains_responses_refusal(&value) {
        return Err(CommandError::new(
            "MODEL_REFUSAL",
            "AI 拒绝了本次生成请求。",
        ));
    }
    let content = value
        .get("output_text")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(str::to_owned)
        .or_else(|| extract_responses_output(&value))
        .ok_or_else(|| CommandError::new("EMPTY_MODEL_OUTPUT", "AI 未返回内容，请重试。"))?;
    let (cards, private_summary) = parse_generated_output(&content)?;
    let usage = value.get("usage");
    let prompt_tokens = usage
        .and_then(|usage| usage.get("input_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let completion_tokens = usage
        .and_then(|usage| usage.get("output_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total_tokens = usage
        .and_then(|usage| usage.get("total_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or_else(|| prompt_tokens.saturating_add(completion_tokens));

    Ok(AiResponse {
        cards,
        private_summary,
        usage: TokenUsage {
            prompt_tokens,
            completion_tokens,
            total_tokens,
        },
        model: response_model(&value, fallback_model),
        protocol: AiProtocol::OpenAiResponses,
    })
}

fn extract_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_owned());
    }
    let parts: Vec<&str> = value
        .as_array()?
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .filter(|text| !text.trim().is_empty())
        .collect();
    (!parts.is_empty()).then(|| parts.join("\n"))
}

fn extract_responses_output(value: &Value) -> Option<String> {
    let texts: Vec<&str> = value
        .get("output")?
        .as_array()?
        .iter()
        .filter(|output| output.get("type").and_then(Value::as_str) == Some("message"))
        .filter_map(|output| output.get("content").and_then(Value::as_array))
        .flatten()
        .filter(|content| {
            content.get("type").and_then(Value::as_str) == Some("output_text")
        })
        .filter_map(|content| content.get("text").and_then(Value::as_str))
        .filter(|text| !text.trim().is_empty())
        .collect();
    (!texts.is_empty()).then(|| texts.join("\n"))
}

fn contains_responses_refusal(value: &Value) -> bool {
    if value
        .get("refusal")
        .and_then(Value::as_str)
        .is_some_and(|refusal| !refusal.trim().is_empty())
    {
        return true;
    }
    value
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|output| output.get("content").and_then(Value::as_array))
        .flatten()
        .any(|content| content.get("type").and_then(Value::as_str) == Some("refusal"))
}

fn response_model(value: &Value, fallback_model: &str) -> String {
    value
        .get("model")
        .and_then(Value::as_str)
        .filter(|model| !model.trim().is_empty())
        .unwrap_or(fallback_model)
        .to_owned()
}

fn parse_generated_output(
    content: &str,
) -> Result<(Vec<GeneratedCard>, Option<String>), CommandError> {
    let content = strip_json_fence(content);
    let mut generated: GeneratedEnvelope = serde_json::from_str(content).map_err(|_| {
        CommandError::new(
            "INVALID_MODEL_OUTPUT",
            "AI 未按卡片 JSON 格式返回结果，请重试。",
        )
    })?;
    validate_generated_cards(&mut generated.cards)?;
    let private_summary = generated.private_summary.and_then(|summary| {
        let summary = summary.trim().to_owned();
        (!summary.is_empty()).then_some(summary)
    });
    if private_summary
        .as_ref()
        .is_some_and(|summary| summary.chars().count() > 8_000)
    {
        return Err(CommandError::new(
            "INVALID_MODEL_OUTPUT",
            "AI 返回的私有记忆摘要过长。",
        ));
    }
    Ok((generated.cards, private_summary))
}

fn strip_json_fence(content: &str) -> &str {
    let trimmed = content.trim();
    if !trimmed.starts_with("```") || !trimmed.ends_with("```") {
        return trimmed;
    }
    let Some(first_newline) = trimmed.find('\n') else {
        return trimmed;
    };
    trimmed[first_newline + 1..trimmed.len() - 3].trim()
}

fn validate_generated_cards(cards: &mut [GeneratedCard]) -> Result<(), CommandError> {
    if cards.is_empty() || cards.len() > 5 {
        return Err(CommandError::new(
            "INVALID_MODEL_OUTPUT",
            "AI 返回的卡片数量必须在 1 到 5 之间。",
        ));
    }
    for card in cards {
        card.card_type = card.card_type.trim().to_lowercase();
        card.title = card.title.trim().to_owned();
        card.content = card.content.trim().to_owned();
        if !matches!(
            card.card_type.as_str(),
            "idea" | "question" | "assumption" | "decision"
        ) {
            return Err(CommandError::new(
                "INVALID_MODEL_OUTPUT",
                "AI 返回了不支持的卡片类型。",
            ));
        }
        if card.title.is_empty()
            || card.content.is_empty()
            || card.title.chars().count() > 160
            || card.content.chars().count() > 20_000
        {
            return Err(CommandError::new(
                "INVALID_MODEL_OUTPUT",
                "AI 返回的卡片标题或内容为空，或长度超出限制。",
            ));
        }
    }
    Ok(())
}

fn map_network_error(error: reqwest::Error) -> CommandError {
    if error.is_timeout() {
        CommandError::new("NETWORK_TIMEOUT", "AI 请求超时，请稍后重试。")
    } else if error.is_connect() {
        CommandError::new(
            "NETWORK_ERROR",
            "无法连接请求地址，请检查网络、防火墙或中转站设置。",
        )
    } else {
        CommandError::new("NETWORK_ERROR", "AI 请求失败，请稍后重试。")
    }
}

fn map_api_error(status: StatusCode, _bytes: &[u8], _api_key: Option<&str>) -> CommandError {
    let fixed = match status.as_u16() {
        400 => Some(("BAD_REQUEST", "请求地址拒绝了请求，请检查协议、模型或上下文设置。")),
        401 => Some(("UNAUTHORIZED", "API Key 无效、已失效或认证方式不匹配。")),
        402 => Some(("INSUFFICIENT_BALANCE", "服务账户余额不足。")),
        403 => Some(("FORBIDDEN", "当前凭据无权访问所选模型。")),
        404 => Some(("NOT_FOUND", "请求地址不存在，请检查自定义地址和协议。")),
        429 => Some(("RATE_LIMITED", "请求过于频繁，请稍后重试。")),
        500..=599 => Some(("PROVIDER_ERROR", "请求服务暂时不可用，请稍后重试。")),
        _ => None,
    };
    if let Some((code, message)) = fixed {
        return CommandError::new(code, message);
    }

    CommandError::new(
        "PROVIDER_ERROR",
        format!("AI 请求失败（HTTP {}）。", status.as_u16()),
    )
}

#[cfg(test)]
fn redact_sensitive(input: &str, api_key: Option<&str>) -> String {
    let mut output = match api_key.filter(|key| !key.is_empty()) {
        Some(api_key) => input.replace(api_key, "[REDACTED]"),
        None => input.to_owned(),
    };

    loop {
        let lower = output.to_ascii_lowercase();
        let Some(start) = lower.find("sk-") else {
            break;
        };
        let mut end = start + 3;
        for byte in output.as_bytes().iter().skip(end) {
            if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b'.') {
                end += 1;
            } else {
                break;
            }
        }
        output.replace_range(start..end, "[REDACTED]");
    }

    let mut cursor = 0usize;
    loop {
        let lower = output.to_ascii_lowercase();
        let Some(relative_start) = lower[cursor..].find("bearer ") else {
            break;
        };
        let marker_start = cursor + relative_start;
        let start = marker_start + "bearer ".len();
        if output[start..].starts_with("[REDACTED]") {
            cursor = start + "[REDACTED]".len();
            continue;
        }
        let mut end = start;
        for byte in output.as_bytes().iter().skip(start) {
            if byte.is_ascii_whitespace() || matches!(*byte, b'\"' | b'\'' | b',' | b';') {
                break;
            }
            end += 1;
        }
        if end == start {
            break;
        }
        output.replace_range(start..end, "[REDACTED]");
        cursor = start + "[REDACTED]".len();
    }
    output
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AiRuntimeState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            configure_ai_runtime,
            get_ai_runtime_status,
            clear_ai_runtime_config,
            fetch_ai_models,
            test_ai_connection,
            run_ai_request,
            cancel_ai_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running Idea Workspace");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(protocol: AiProtocol) -> AiRuntimeConfig {
        AiRuntimeConfig {
            api_key: Some("TEST_SECRET_NEVER_IN_PAYLOAD".into()),
            auth_mode: AuthMode::Bearer,
            protocol,
            request_url: DEFAULT_REQUEST_URL.into(),
            models_url: DEFAULT_MODELS_URL.into(),
            model: "gpt-test".into(),
            json_mode: true,
            thinking: true,
            verified: false,
        }
    }

    fn test_request(temperature: Option<f32>) -> AiRequest {
        AiRequest {
            run_id: "run-test".into(),
            messages: vec![
                ChatMessage {
                    role: "system".into(),
                    content: "Improve ideas carefully.".into(),
                },
                ChatMessage {
                    role: "user".into(),
                    content: "Develop this idea.".into(),
                },
            ],
            max_tokens: Some(1_024),
            temperature,
        }
    }

    #[test]
    fn validates_protocol_auth_url_and_freeform_model() {
        assert!(AiProtocol::parse("openai-chat-completions").is_ok());
        assert!(AiProtocol::parse("openai-responses").is_ok());
        assert!(AiProtocol::parse("other").is_err());
        assert!(AuthMode::parse("bearer").is_ok());
        assert!(AuthMode::parse("none").is_ok());
        assert!(AuthMode::parse("basic").is_err());
        assert!(validate_url("http://localhost:11434/v1/chat/completions", "test").is_ok());
        assert!(validate_url("https://gateway.example/v1/responses", "test").is_ok());
        assert!(validate_url("file:///tmp/model", "test").is_err());
        assert!(validate_url("https://user:pass@example.com/v1", "test").is_err());
        assert!(validate_url("https://example.com/v1?token=secret", "test").is_err());
        assert!(validate_url("http://example.com/v1", "test").is_err());
        assert!(validate_url("http://127.0.0.1:8080/v1", "test").is_ok());
        assert!(urls_have_same_origin(
            "https://example.com/v1/responses",
            "https://example.com:443/v1/models"
        ));
        assert!(!urls_have_same_origin(
            "https://example.com/v1/responses",
            "https://models.example.com/v1/models"
        ));
        assert!(validate_model("custom/model:latest").is_ok());
        assert!(validate_model("  ").is_err());
    }

    #[test]
    fn only_reuses_a_bearer_key_for_the_same_endpoints() {
        let existing = test_config(AiProtocol::OpenAiChatCompletions);
        let same_endpoints = AiRuntimeConfigInput {
            api_key: String::new(),
            auth_mode: "bearer".into(),
            protocol: "openai-chat-completions".into(),
            request_url: DEFAULT_REQUEST_URL.into(),
            models_url: DEFAULT_MODELS_URL.into(),
            model: "another-model".into(),
            json_mode: true,
            thinking: false,
        };
        let resolved = resolve_config_input(same_endpoints, Some(&existing)).unwrap();
        assert_eq!(resolved.api_key.as_deref(), Some("TEST_SECRET_NEVER_IN_PAYLOAD"));

        let changed_endpoint = AiRuntimeConfigInput {
            api_key: String::new(),
            auth_mode: "bearer".into(),
            protocol: "openai-chat-completions".into(),
            request_url: "https://different.example/v1/chat/completions".into(),
            models_url: "https://different.example/v1/models".into(),
            model: "another-model".into(),
            json_mode: true,
            thinking: false,
        };
        match resolve_config_input(changed_endpoint, Some(&existing)) {
            Err(error) => assert_eq!(error.code, "MISSING_API_KEY"),
            Ok(_) => panic!("a key must not be reused for changed endpoints"),
        }

        let changed_protocol = AiRuntimeConfigInput {
            api_key: String::new(),
            auth_mode: "bearer".into(),
            protocol: "openai-responses".into(),
            request_url: DEFAULT_REQUEST_URL.into(),
            models_url: DEFAULT_MODELS_URL.into(),
            model: "another-model".into(),
            json_mode: true,
            thinking: false,
        };
        match resolve_config_input(changed_protocol, Some(&existing)) {
            Err(error) => assert_eq!(error.code, "MISSING_API_KEY"),
            Ok(_) => panic!("a key must not be reused for a changed protocol"),
        }

        let cross_origin = AiRuntimeConfigInput {
            api_key: "TEST_SECRET_NEW_KEY".into(),
            auth_mode: "bearer".into(),
            protocol: "openai-chat-completions".into(),
            request_url: "https://request.example/v1/chat/completions".into(),
            models_url: "https://models.example/v1/models".into(),
            model: "another-model".into(),
            json_mode: true,
            thinking: false,
        };
        match resolve_config_input(cross_origin, Some(&existing)) {
            Err(error) => assert_eq!(error.code, "CROSS_ORIGIN_AUTH_URL"),
            Ok(_) => panic!("bearer endpoints must use one origin"),
        }

        let no_auth = AiRuntimeConfigInput {
            api_key: "should-not-be-kept".into(),
            auth_mode: "none".into(),
            protocol: "openai-responses".into(),
            request_url: "http://localhost:11434/v1/responses".into(),
            models_url: "http://localhost:11434/v1/models".into(),
            model: "local-model".into(),
            json_mode: false,
            thinking: false,
        };
        assert!(resolve_config_input(no_auth, Some(&existing))
            .unwrap()
            .api_key
            .is_none());
    }

    #[test]
    fn builds_chat_payload_with_optional_features_and_no_credentials() {
        let config = test_config(AiProtocol::OpenAiChatCompletions);
        let payload = build_chat_payload(&config, &test_request(Some(0.4)));
        assert_eq!(payload["model"], "gpt-test");
        assert_eq!(payload["response_format"]["type"], "json_object");
        assert_eq!(payload["thinking"], true);
        assert_eq!(payload["max_completion_tokens"], 1_024);
        assert!(payload.get("max_tokens").is_none());
        assert!((payload["temperature"].as_f64().unwrap() - 0.4).abs() < 0.000_001);
        assert_eq!(payload["stream"], false);
        assert!(!payload.to_string().contains("TEST_SECRET_NEVER_IN_PAYLOAD"));

        let mut without_options = config.clone();
        without_options.json_mode = false;
        without_options.thinking = false;
        let mut no_sampling_options = test_request(None);
        no_sampling_options.max_tokens = None;
        let payload = build_chat_payload(&without_options, &no_sampling_options);
        assert!(payload.get("response_format").is_none());
        assert!(payload.get("thinking").is_none());
        assert!(payload.get("temperature").is_none());
        assert_eq!(payload["max_completion_tokens"], 2_048);
    }

    #[test]
    fn model_list_fetch_allows_an_empty_unsaved_model() {
        let existing = test_config(AiProtocol::OpenAiResponses);
        let input = AiRuntimeConfigInput {
            api_key: String::new(),
            auth_mode: "bearer".into(),
            protocol: "openai-responses".into(),
            request_url: DEFAULT_REQUEST_URL.into(),
            models_url: DEFAULT_MODELS_URL.into(),
            model: "  ".into(),
            json_mode: true,
            thinking: false,
        };
        assert!(resolve_fetch_config_input(input, Some(&existing))
            .unwrap()
            .model
            .is_empty());

        let status = default_status(0);
        assert_eq!(status.protocol, AiProtocol::OpenAiResponses);
        assert_eq!(status.model, DEFAULT_MODEL);
        assert_eq!(status.request_url, DEFAULT_REQUEST_URL);
    }

    #[test]
    fn builds_responses_payload_and_only_sends_explicit_temperature() {
        let config = test_config(AiProtocol::OpenAiResponses);
        let payload = build_responses_payload(&config, &test_request(None));
        assert_eq!(payload["model"], "gpt-test");
        assert_eq!(payload["store"], false);
        assert_eq!(payload["text"]["format"]["type"], "json_object");
        assert_eq!(payload["input"].as_array().unwrap().len(), 1);
        assert!(payload["instructions"]
            .as_str()
            .unwrap()
            .contains("Improve ideas carefully."));
        assert!(payload.get("temperature").is_none());
        assert!(payload.get("thinking").is_none());
        assert!(!payload.to_string().contains("TEST_SECRET_NEVER_IN_PAYLOAD"));

        let payload = build_responses_payload(&config, &test_request(Some(0.7)));
        assert!((payload["temperature"].as_f64().unwrap() - 0.7).abs() < 0.000_001);

        let mut without_json_mode = config.clone();
        without_json_mode.json_mode = false;
        let payload = build_responses_payload(&without_json_mode, &test_request(None));
        assert!(payload.get("text").is_none());
    }

    #[test]
    fn keeps_custom_instruction_at_user_level_for_both_protocols() {
        const MARKER: &str = "CUSTOM_USER_INSTRUCTION_MARKER";
        let mut request = test_request(None);
        request.messages.insert(
            1,
            ChatMessage {
                role: "user".into(),
                content: MARKER.into(),
            },
        );

        let chat = build_chat_payload(
            &test_config(AiProtocol::OpenAiChatCompletions),
            &request,
        );
        let chat_messages = chat["messages"].as_array().unwrap();
        assert!(chat_messages.iter().any(|message| {
            message["role"] == "user" && message["content"] == MARKER
        }));
        assert!(!chat_messages.iter().any(|message| {
            message["role"] == "system"
                && message["content"].as_str().unwrap_or_default().contains(MARKER)
        }));

        let responses = build_responses_payload(
            &test_config(AiProtocol::OpenAiResponses),
            &request,
        );
        assert!(!responses["instructions"]
            .as_str()
            .unwrap()
            .contains(MARKER));
        assert!(responses["input"].as_array().unwrap().iter().any(|message| {
            message["role"] == "user" && message["content"] == MARKER
        }));
    }

    #[test]
    fn parses_chat_completion_cards_and_usage() {
        let body = br#"{
          "model":"gateway-model",
          "choices":[{"message":{"content":"{\"cards\":[{\"type\":\"question\",\"title\":\"  Who is it for?  \",\"content\":\"  Define the first user.  \"}]}"}}],
          "usage":{"prompt_tokens":21,"completion_tokens":12,"total_tokens":33}
        }"#;
        let parsed = parse_chat_response(body, "fallback").expect("response should parse");
        assert_eq!(parsed.model, "gateway-model");
        assert_eq!(parsed.protocol, AiProtocol::OpenAiChatCompletions);
        assert_eq!(parsed.cards[0].title, "Who is it for?");
        assert_eq!(parsed.usage.total_tokens, 33);
    }

    #[test]
    fn accepts_up_to_five_generated_cards_and_rejects_six() {
        let make_cards = |count: usize| {
            (0..count)
                .map(|index| GeneratedCard {
                    card_type: "idea".into(),
                    title: format!("Card {}", index + 1),
                    content: "A concrete idea.".into(),
                })
                .collect::<Vec<_>>()
        };

        let mut five = make_cards(5);
        assert!(validate_generated_cards(&mut five).is_ok());

        let mut six = make_cards(6);
        let error = validate_generated_cards(&mut six).unwrap_err();
        assert_eq!(error.code, "INVALID_MODEL_OUTPUT");
        assert!(error.message.contains("1 到 5"));
    }

    #[test]
    fn parses_responses_output_text_and_nested_content() {
        let output_text = br#"{
          "model":"response-model",
          "output_text":"{\"cards\":[{\"type\":\"idea\",\"title\":\"A\",\"content\":\"B\"}]}",
          "usage":{"input_tokens":8,"output_tokens":5,"total_tokens":13}
        }"#;
        let parsed = parse_responses_response(output_text, "fallback").unwrap();
        assert_eq!(parsed.model, "response-model");
        assert_eq!(parsed.protocol, AiProtocol::OpenAiResponses);
        assert_eq!(parsed.usage.prompt_tokens, 8);

        let nested = br#"{
          "output":[{"type":"message","content":[{"type":"output_text","text":"{\"cards\":[{\"type\":\"decision\",\"title\":\"Ship\",\"content\":\"Test it\"}]}"}]}]
        }"#;
        let parsed = parse_responses_response(nested, "fallback-model").unwrap();
        assert_eq!(parsed.model, "fallback-model");
        assert_eq!(parsed.cards[0].card_type, "decision");
    }

    #[test]
    fn parses_and_normalizes_common_model_list_variants() {
        let openai = br#"{"data":[{"id":"z-model"},{"id":"a-model"},{"id":"a-model"}]}"#;
        assert_eq!(
            parse_model_list(openai).unwrap().models,
            vec!["a-model".to_string(), "z-model".to_string()]
        );
        let objects = br#"{"models":[{"name":"local-b"},{"model":"local-a"}]}"#;
        assert_eq!(
            parse_model_list(objects).unwrap().models,
            vec!["local-a".to_string(), "local-b".to_string()]
        );
        let strings = br#"["m2","m1","m1"]"#;
        assert_eq!(
            parse_model_list(strings).unwrap().models,
            vec!["m1".to_string(), "m2".to_string()]
        );

        let oversized = Value::Array(
            (0..1_100)
                .map(|index| Value::String(format!("model-{index:04}")))
                .collect(),
        );
        let parsed = parse_model_list(&serde_json::to_vec(&oversized).unwrap()).unwrap();
        assert_eq!(parsed.models.len(), MAX_MODELS);
        assert!(parsed.truncated);
    }

    #[test]
    fn rejects_incomplete_or_refused_provider_outputs() {
        let truncated_chat = br#"{
          "choices":[{"finish_reason":"length","message":{"content":"{\"cards\":[]}"}}]
        }"#;
        assert_eq!(
            parse_chat_response(truncated_chat, "fallback")
                .unwrap_err()
                .code,
            "INCOMPLETE_MODEL_OUTPUT"
        );

        let filtered_chat = br#"{
          "choices":[{"finish_reason":"content_filter","message":{"content":null}}]
        }"#;
        assert_eq!(
            parse_chat_response(filtered_chat, "fallback")
                .unwrap_err()
                .code,
            "MODEL_REFUSAL"
        );

        let incomplete_response = br#"{"status":"incomplete","output_text":"ignored"}"#;
        assert_eq!(
            parse_responses_response(incomplete_response, "fallback")
                .unwrap_err()
                .code,
            "INCOMPLETE_MODEL_OUTPUT"
        );

        let failed_response = br#"{"status":"failed","error":{"message":"secret provider details"}}"#;
        let error = parse_responses_response(failed_response, "fallback").unwrap_err();
        assert_eq!(error.code, "FAILED_MODEL_OUTPUT");
        assert!(!error.message.contains("provider details"));

        let refusal = br#"{
          "status":"completed",
          "output":[{"type":"message","content":[{"type":"refusal","refusal":"provider details"}]}]
        }"#;
        assert_eq!(
            parse_responses_response(refusal, "fallback")
                .unwrap_err()
                .code,
            "MODEL_REFUSAL"
        );
    }

    #[test]
    fn runtime_status_never_serializes_the_api_key() {
        let state = AiRuntimeState::new();
        let secret = "TEST_SECRET_PRIVATE_STATUS_9876";
        *state.config.lock().expect("config lock") = Some(AiRuntimeConfig {
            api_key: Some(secret.into()),
            auth_mode: AuthMode::Bearer,
            protocol: AiProtocol::OpenAiChatCompletions,
            request_url: DEFAULT_REQUEST_URL.into(),
            models_url: DEFAULT_MODELS_URL.into(),
            model: "gpt-test".into(),
            json_mode: true,
            thinking: false,
            verified: false,
        });
        let serialized = serde_json::to_string(&status_from_state(&state).unwrap()).unwrap();
        assert!(!serialized.contains(secret));
        assert!(serialized.contains("••••9876"));
    }

    #[test]
    fn redacts_credentials_from_provider_errors() {
        let key = "TEST_SECRET_VALUE";
        let prefixed_secret = ["s", "k-TEST-ONLY-other-token"].concat();
        let input = format!(
            "request used {prefixed_secret} and Bearer opaque-token plus {key}"
        );
        let redacted = redact_sensitive(&input, Some(key));
        assert!(!redacted.contains(key));
        assert!(!redacted.contains(&prefixed_secret));
        assert!(!redacted.contains("opaque-token"));
        assert_eq!(redacted.matches("[REDACTED]").count(), 3);

        let error = map_api_error(
            StatusCode::IM_A_TEAPOT,
            br#"{"error":{"message":"leaked TEST_SECRET_VALUE"}}"#,
            Some(key),
        );
        assert!(!format!("{error:?}").contains(key));
        assert!(!error.message.contains("leaked"));
    }
}
