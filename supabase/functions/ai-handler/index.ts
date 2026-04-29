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

        while (retryCount < maxRetries) {
            response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [ { role: "user", parts: [{ text: userPrompt }] } ],
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 4096,
                    },
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

