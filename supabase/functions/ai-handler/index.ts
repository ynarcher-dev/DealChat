import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Rate Limiter: JWT user_id 기반 (스푸핑 불가) + IP 폴백
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 30; // 분당 최대 요청 수
const RATE_WINDOW = 60 * 1000; // 1분 (밀리초)

function checkRateLimit(identifier: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(identifier);
    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(identifier, { count: 1, resetTime: now + RATE_WINDOW });
        return true;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT) {
        return false;
    }
    return true;
}

// JWT에서 user_id 추출 (스푸핑 불가능한 식별자)
function extractUserIdFromJwt(req: Request): string | null {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return null;
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return payload.sub || null;
    } catch {
        return null;
    }
}

// Rate limit 식별자: JWT user_id > cf-connecting-ip > x-forwarded-for
function getRateLimitKey(req: Request): string {
    const userId = extractUserIdFromJwt(req);
    if (userId) return `user:${userId}`;
    return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const ALLOWED_ORIGINS = [
    "https://afitwguexwihnepyutqw.supabase.co",
    "http://dealchat-web.s3-website.ap-northeast-2.amazonaws.com",
    "https://dealchat.co.kr",
    "https://www.dealchat.co.kr",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
];

function getCorsHeaders(req: Request) {
    const origin = req.headers.get("origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };
}

serve(async (req) => {
    // Rate Limiting
    const rateLimitKey = getRateLimitKey(req);
    if (!checkRateLimit(rateLimitKey)) {
        return new Response(JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "60" },
        });
    }
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: getCorsHeaders(req) });
    }

    try {
        const body = await req.json();
        // 동적 모델 선택 지원: body.model이 있으면 사용, 없으면 기본값 설정
        const model = body.model || "gemini-2.5-flash";
        const prompts = body.body || body.prompts;
        const action = body.action;

        const apiKey = Deno.env.get("GEMINI_API_KEY");
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!apiKey || !supabaseUrl || !supabaseServiceKey) {
            throw new Error("Missing Environment Variables (GEMINI_API_KEY, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY)");
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 1-A. OCR Action: PDF를 Gemini 멀티모달로 텍스트 추출 (스캔/이미지 PDF 폴백)
        if (action === 'ocr_pdf') {
            const content = body.content; // base64 (no data URI prefix)
            const contentType = body.content_type || 'application/pdf';
            const fileName = body.file_name || 'document.pdf';

            if (!content) {
                return new Response(JSON.stringify({ error: 'Missing content (base64 PDF)' }), {
                    status: 400,
                    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
                });
            }

            // 안전 한도: Gemini inlineData는 ~20MB 권장
            const estimatedBytes = Math.ceil(content.length * 3 / 4);
            if (estimatedBytes > 20 * 1024 * 1024) {
                return new Response(JSON.stringify({
                    error: 'OCR 대상 파일이 20MB를 초과합니다. 더 작은 파일이나 일반 텍스트 추출을 사용해주세요.'
                }), {
                    status: 413,
                    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
                });
            }

            const ocrPrompt = `당신은 한국어/영문 PDF에서 텍스트를 정확하게 추출하는 OCR 엔진입니다.

[지시사항]
- 문서의 모든 텍스트를 위에서 아래, 왼쪽에서 오른쪽 순서로 추출하세요.
- 표가 있을 경우 행은 줄바꿈으로, 같은 행 내 열은 탭(\\t)으로 구분하세요.
- 표의 첫 행은 헤더로 간주하고, 각 데이터 행이 헤더와 같은 열 개수가 되도록 유지하세요.
- 회계/재무 문서의 단위(예: "(단위: 백만원)", "(단위: 천원)")는 해당 표 바로 위에 반드시 표기하세요.
- 숫자에서 천 단위 쉼표는 유지하고, 음수는 괄호 또는 마이너스 부호 그대로 두세요.
- 페이지가 여러 개면 페이지 사이에 빈 줄 두 개로 구분하세요.
- 헤더/푸터, 페이지 번호는 생략해도 됩니다.
- 어떤 설명이나 추가 코멘트도 출력하지 마세요. 오로지 추출된 텍스트만 출력하세요.`;

            // OCR은 정확도를 위해 2.5-flash 고정 (멀티모달 + 안정성)
            const ocrModel = body.model || 'gemini-2.5-flash';

            const ocrResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${ocrModel}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [
                            { text: ocrPrompt },
                            { inlineData: { mimeType: contentType, data: content } }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.0,
                        topK: 1,
                        topP: 0.1,
                        maxOutputTokens: 32768,
                    },
                    safetySettings: [
                        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
                    ]
                })
            });

            const ocrData = await ocrResp.json();
            if (!ocrResp.ok || ocrData.error) {
                console.error('[ai-handler ocr_pdf]', ocrData.error || ocrData);
                return new Response(JSON.stringify({
                    error: ocrData.error?.message || 'OCR 처리 중 오류가 발생했습니다.',
                    file_name: fileName
                }), {
                    status: ocrResp.status || 500,
                    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
                });
            }

            const text = ocrData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return new Response(JSON.stringify({ text, file_name: fileName }), {
                headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' }
            });
        }

        // 1. Vector Search Action (Gemini Embedding)
        if (action === 'search_vector') {
            const query = body.query;
            const vectorNamespace = body.vectorNamespace;
            const topK = body.topK || 5;

            if (!query) throw new Error("Missing query for vector search");

            // Gemini Embedding Retry Logic
            let embeddingResponse;
            let embeddingData;
            for (let i = 0; i < 3; i++) {
                embeddingResponse = await fetch(`https://generativelanguage.googleapis.com/v1/models/embedding-001:embedContent?key=${apiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: { parts: [{ text: query }] } }),
                });
                embeddingData = await embeddingResponse.json();
                if (embeddingResponse.ok) break;
                if (embeddingResponse.status !== 503 && embeddingResponse.status !== 429) break;
                await new Promise(r => setTimeout(r, 1000 * (i + 1))); // 지수 백오프
            }

            if (!embeddingData.embedding || !embeddingData.embedding.values) {
                throw new Error("Failed to generate Gemini embedding: " + JSON.stringify(embeddingData));
            }
            const queryEmbedding = embeddingData.embedding.values;

            // 1-2. Search in Supabase (RPC call)
            const { data: documents, error } = await supabase.rpc('match_documents', {
                query_embedding: queryEmbedding,
                match_threshold: 0.3,
                match_count: topK,
                filter: vectorNamespace ? { company_id: vectorNamespace } : {}
            });

            if (error) throw error;

            // 결과 텍스트만 추출해서 배열로 반환
            const results = documents ? documents.map((doc: any) => doc.content) : [];

            return new Response(JSON.stringify({ results }), {
                headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
            });
        }

        // 2. Default: Chat Completion (Dynamic Model Loading + Retry Logic)
        const userPrompt = prompts || body.query || "";
        let retryCount = 0;
        const maxRetries = 3;
        let response;
        let data;

        // 클라이언트가 전달한 max_tokens 우선 사용, 없으면 모델 기본값 (Gemini 2.5는 65536까지 지원)
        const requestedMaxTokens = Number(body.max_tokens) || 16384;
        // 클라이언트가 temperature를 전달했으면 사용 (자동 채우기 등은 낮은 값으로 일관성 유지)
        const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;

        // JSON 모드 활성화 여부: 명시적 플래그 또는 프롬프트에 "JSON" 언급이 있으면 ON
        // → Gemini가 응답을 strict JSON으로 강제하므로 마크다운 펜스/설명 잡음이 사라짐
        const wantsJson = body.response_format === 'json'
            || /\bJSON\b/i.test(userPrompt);

        const generationConfig: Record<string, any> = {
            temperature,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: requestedMaxTokens,
        };
        if (wantsJson) {
            generationConfig.responseMimeType = 'application/json';
        }

        while (retryCount < maxRetries) {
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [ { role: "user", parts: [{ text: userPrompt }] } ],
                    generationConfig,
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ]
                }),
            });

            data = await response.json();

            if (response.ok) break;
            
            // 503 (Unavailable) 또는 429 (Rate Limit)인 경우 재시도
            if (response.status === 503 || response.status === 429) {
                retryCount++;
                if (retryCount < maxRetries) {
                    await new Promise(r => setTimeout(r, 1000 * retryCount)); // 1초, 2초... 대기
                    continue;
                }
            }
            break;
        }

        if (data.error) {
            return new Response(JSON.stringify({ error: data.error, model_used: model }), {
                status: response.status,
                headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
            });
        }

        // Gemini response parsing: candidates[0].content.parts[0].text
        const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";

        return new Response(JSON.stringify({ answer }), {
            headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });

    } catch (error: any) {
        console.error("[ai-handler error]", error);
        const message = error.message || String(error);
        const safeMessage = message.includes("API_KEY") || message.includes("env")
            ? "AI 서비스 오류가 발생했습니다."
            : message;
        return new Response(JSON.stringify({ error: safeMessage }), {
            status: 500,
            headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
    }
});

