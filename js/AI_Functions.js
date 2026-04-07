import { APIcall } from './APIcallFunction.js';

// tiktoken 로딩 실패 대비 로직
let tiktokenEncoding = null;
import("https://cdn.jsdelivr.net/npm/js-tiktoken@1.0.17/+esm")
    .then(m => { tiktokenEncoding = m.getEncoding("cl100k_base"); })
    .catch(e => console.warn("js-tiktoken ESM load failed, falling back to heuristic. This is usually okay."));

// window.config 안전 참조를 위한 헬퍼
const getConfig = () => window.config || { supabase: { uploadHandlerUrl: '', aiHandlerUrl: '' }, ai: { model: 'gpt-4o', tokenLimits: { 'gpt-4o': { maxContextTokens: 128000, maxOutputTokens: 4096, safetyMargin: 5000 } } } };

// countTokens 함수
export function countTokens(text) {
    if (typeof text !== 'string') return 0;
    try {
        if (tiktokenEncoding) {
            return tiktokenEncoding.encode(text).length;
        }
        return Math.ceil(text.length * 1.1);
    } catch (e) {
        return Math.ceil(text.length * 1.1);
    }
}

export function addAiResponse(userInput, sourceTexts) {
    const config = getConfig();
    const AI_ENDPOINT = config.supabase.aiHandlerUrl;
    const modelName = config.ai.model || 'gpt-4o';
    let modelConfig = config.ai.tokenLimits[modelName] || config.ai.tokenLimits['gpt-4o'];

    const MAX_TOKEN = modelConfig.maxContextTokens;
    const SAFETY_MARGIN = modelConfig.safetyMargin;

    console.log(`🤖 Using model: ${modelName} (Max: ${MAX_TOKEN} tokens)`);

    let truncatedSource = sourceTexts || "";
    if (countTokens(truncatedSource) > (MAX_TOKEN - SAFETY_MARGIN)) {
        const charLimit = Math.floor((MAX_TOKEN - SAFETY_MARGIN) / 1.1);
        truncatedSource = truncatedSource.substring(0, charLimit) + "\n\n... (Truncated) ...";
    }

    let prompts = `
        [Role]
        You are a professional investment analyst.
        [Context Documents]
        ${truncatedSource}
        [User Question]
        ${userInput}
        [Instructions]
        Answer in Korean. Professional tone.
    `.trim();

    const tokenCount = countTokens(prompts);
    if (tokenCount > MAX_TOKEN) {
        alert("Token limit exceeded.");
        return Promise.reject(new Error('Token limit exceeded'));
    }

    return APIcall({ body: prompts }, AI_ENDPOINT, { 'Content-Type': 'application/json' });
}

export async function searchVectorDB(query, companyId) {
    if (!query || !companyId) return "";
    const AI_HANDLER = getConfig().supabase.aiHandlerUrl;
    const payload = { action: 'search_vector', query, vectorNamespace: companyId, topK: 5 };

    try {
        const response = await APIcall(payload, AI_HANDLER, { 'Content-Type': 'application/json' });
        const data = await response.json();
        if (data.results && Array.isArray(data.results)) return data.results.join("\n\n");
        return "";
    } catch (error) {
        console.error("Vector Search Failed:", error);
        return "";
    }
}
