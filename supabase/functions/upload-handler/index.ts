import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE, PUT, PATCH",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        const contentType = req.headers.get("content-type") || "";

        if (contentType.includes("multipart/form-data")) {
            const formData = await req.formData();
            const file = formData.get("file") as File;
            const userId = formData.get("user_id") as string;
            const action = formData.get("action") as string || "upload";
            const table = formData.get("table") as string || "files";

            if (action === "upload" && file) {
                const fileName = file.name;
                const storagePath = `${userId}/${fileName}`;

                // Upload to Storage
                const { error: uploadError } = await supabase.storage
                    .from("uploads")
                    .upload(storagePath, file, {
                        contentType: file.type,
                        upsert: true,
                    });

                if (uploadError) throw uploadError;

                // Update Database
                const fileMetadata = {
                    file_name: fileName,
                    location: storagePath,
                    userId: userId,
                    summary: formData.get("summary") as string || "",
                };

                const { data, error: dbError } = await supabase
                    .from(table)
                    .insert(fileMetadata)
                    .select();

                if (dbError) throw dbError;

                return new Response(JSON.stringify({ message: "Upload success", data }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
        }

        // JSON handling
        let body;
        try {
            body = await req.json();
        } catch (e) {
            return new Response(JSON.stringify({ error: "Invalid JSON" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const { action, table } = body;

        if (!action || !table) {
            return new Response(JSON.stringify({ error: "Missing action or table" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const query = supabase.from(table);

        if (action === "get" || action === "read") {
            const { id, userId, keyword, ...filters } = body;

            if (id) {
                const { data, error } = await query.select("*").eq("id", id).single();
                if (error) throw error;
                return new Response(JSON.stringify(data), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            } else {
                let select = query.select("*");

                // Direct equality filters
                for (const [key, value] of Object.entries(filters)) {
                    if (key !== "action" && key !== "table" && value !== undefined && value !== null && value !== "") {
                        select = select.eq(key, value);
                    }
                }

                // User filter
                if (userId) {
                    select = select.eq("userId", userId);
                }

                // Search keyword
                if (keyword && typeof keyword === 'string' && keyword.trim() !== "") {
                    const cleanKw = keyword.trim();
                    // 한글 검색 시 맥(NFD)과 윈도우(NFC) 차이로 인한 검색 누락 방지
                    const nfcKw = cleanKw.normalize('NFC');
                    const nfdKw = cleanKw.normalize('NFD');

                    if (table === 'files') {
                        select = select.or(`file_name.ilike.%${nfcKw}%,file_name.ilike.%${nfdKw}%`);
                    } else if (['companies', 'sellers', 'buyers'].includes(table)) {
                        select = select.or(`companyName.ilike.%${nfcKw}%,companyName.ilike.%${nfdKw}%`);
                    } else if (table === 'users') {
                        select = select.ilike('email', `%${cleanKw}%`);
                    }
                }

                const { data, error } = await select;
                if (error) throw error;
                return new Response(JSON.stringify(data), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
        } else if (action === "upload" || action === "create") {
            const { action: _, table: __, ...rawData } = body;

            // Handle Base64 Upload (often from File_Functions.js)
            if (rawData.is_base64 && rawData.content) {
                const { content, file_name, content_type, userId, is_base64: _is_base64, ...metadata } = rawData;

                // [RAG] Parsing Parameters
                const parsedText = metadata.parsedText;
                const vectorNamespace = metadata.vectorNamespace || metadata.companyId;

                // Create safe filename for storage (remove special chars, keep extension)
                const timestamp = Date.now();
                const ext = file_name.substring(file_name.lastIndexOf('.'));
                const safeFileName = `${timestamp}${ext}`;
                const storagePath = `${userId}/${safeFileName}`;

                // Decode base64
                const binaryStr = atob(content);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) {
                    bytes[i] = binaryStr.charCodeAt(i);
                }

                // 1. Upload to Storage
                const { error: uploadError } = await supabase.storage
                    .from("uploads")
                    .upload(storagePath, bytes, {
                        contentType: content_type || 'application/octet-stream',
                        upsert: true,
                    });
                if (uploadError) throw uploadError;

                // 2. Insert into Database
                const now = new Date().toISOString();
                const dbRow: Record<string, any> = {
                    file_name: file_name, // Keep original filename for display
                    location: storagePath, // Use safe path for storage
                    userId: userId,
                    created_at: now,
                    updated_at: now,
                };

                // Filter metadata to only include known/safe fields
                const excludedFields = ['vectorNamespace', 'scanMode', 'companyId', 'parsedText', 'is_base64', 'content', 'content_type', 'action', 'table', 'createdAt', 'updatedAt', 'created_at', 'updated_at'];

                for (const [key, value] of Object.entries(metadata)) {
                    if (!excludedFields.includes(key) && value !== undefined && value !== null && value !== "") {
                        dbRow[key] = value;
                    }
                }

                const { data: result, error: dbError } = await query.insert(dbRow).select();
                if (dbError) throw dbError;

                // [RAG] 3. Generate Embeddings & Save to Vector DB
                if (parsedText && vectorNamespace) {
                    try {
                        const apiKey = Deno.env.get("OPENAI_API_KEY");
                        if (!apiKey) {
                            console.warn("OPENAI_API_KEY is missing. Skipping vector indexing.");
                        } else {
                            const chunkSize = 1000;
                            const overlap = 200;
                            const textLength = parsedText.length;
                            const uploadedFileId = result[0].id;

                            console.log(`Starting indexing for file ${uploadedFileId}. Namespace: ${vectorNamespace}`);

                            for (let i = 0; i < textLength; i += (chunkSize - overlap)) {
                                const chunk = parsedText.substring(i, i + chunkSize);
                                if (chunk.length < 50) continue;

                                const embeddingResp = await fetch("https://api.openai.com/v1/embeddings", {
                                    method: "POST",
                                    headers: {
                                        "Authorization": `Bearer ${apiKey}`,
                                        "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                        model: "text-embedding-3-small",
                                        input: chunk,
                                    }),
                                });

                                if (!embeddingResp.ok) {
                                    const errText = await embeddingResp.text();
                                    throw new Error(`Embedding API error: ${embeddingResp.status} ${errText}`);
                                }

                                const embeddingData = await embeddingResp.json();

                                if (embeddingData.data && embeddingData.data[0]) {
                                    const embedding = embeddingData.data[0].embedding;

                                    const { error: insErr } = await supabase.from('document_sections').insert({
                                        content: chunk,
                                        embedding: embedding,
                                        company_id: vectorNamespace,
                                        metadata: {
                                            file_id: uploadedFileId,
                                            file_name: file_name,
                                            user_id: userId,
                                            company_id: vectorNamespace // Filter consistency
                                        }
                                    });
                                    if (insErr) throw insErr;
                                }
                            }
                            console.log(`Vector indexing completed for file ${uploadedFileId}`);
                        }
                    } catch (vecErr: any) {
                        console.error("Vector generation failed:", vecErr);
                    }
                }

                return new Response(JSON.stringify(result), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }

            // Normal JSON create/upload (not base64)
            const now = new Date().toISOString();
            const data: Record<string, any> = {
                created_at: now,
                updated_at: now,
            };
            const globalExcluded = ['scanMode', 'companyId', 'createdAt', 'updatedAt', 'created_at', 'updated_at'];

            for (const [key, value] of Object.entries(rawData)) {
                if (!globalExcluded.includes(key) && value !== undefined && value !== null && value !== "") {
                    data[key] = value;
                }
            }

            const { data: result, error } = await query.insert(data).select();
            if (error) throw error;
            return new Response(JSON.stringify(result), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        } else if (action === "update") {
            const { id, action: _upd, table: __upd, ...updRawData } = body;

            const now = new Date().toISOString();
            const data: Record<string, any> = {
                updated_at: now, // Always update the modification time
            };
            const globalExcluded = ['scanMode', 'companyId', 'createdAt', 'updatedAt', 'created_at', 'updated_at'];

            for (const [key, value] of Object.entries(updRawData)) {
                if (!globalExcluded.includes(key) && value !== undefined && value !== null && value !== "") {
                    data[key] = value;
                }
            }

            const { data: result, error } = await query.update(data).eq("id", id).select();
            if (error) throw error;
            return new Response(JSON.stringify(result), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        } else if (action === "delete") {
            const targetId = body.id || body.fileId;
            const { data: result, error } = await query.delete().eq("id", targetId).select();
            if (error) throw error;
            return new Response(JSON.stringify(result), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        } else if (action === "index_existing") {
            const { parsedText, vectorNamespace, fileId, file_name, userId } = body;

            if (!parsedText || !vectorNamespace || !fileId) {
                return new Response(JSON.stringify({ error: "Missing parsedText, vectorNamespace, or fileId" }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }

            try {
                const apiKey = Deno.env.get("OPENAI_API_KEY");
                if (!apiKey) {
                    return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured on the server" }), {
                        status: 500,
                        headers: { ...corsHeaders, "Content-Type": "application/json" },
                    });
                }

                const chunkSize = 1000;
                const overlap = 200;
                const textLength = parsedText.length;

                console.log(`Starting index_existing for file ${fileId}. Namespace: ${vectorNamespace}`);

                for (let i = 0; i < textLength; i += (chunkSize - overlap)) {
                    const chunk = parsedText.substring(i, i + chunkSize);
                    if (chunk.length < 50) continue;

                    const embeddingResp = await fetch("https://api.openai.com/v1/embeddings", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${apiKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            model: "text-embedding-3-small",
                            input: chunk,
                        }),
                    });

                    if (!embeddingResp.ok) {
                        const errText = await embeddingResp.text();
                        throw new Error(`Embedding API error: ${embeddingResp.status} ${errText}`);
                    }

                    const embeddingData = await embeddingResp.json();

                    if (embeddingData.data && embeddingData.data[0]) {
                        const embedding = embeddingData.data[0].embedding;

                        const { error: insErr } = await supabase.from('document_sections').insert({
                            content: chunk,
                            embedding: embedding,
                            company_id: vectorNamespace,
                            metadata: {
                                file_id: fileId,
                                file_name: file_name || "Unknown",
                                user_id: userId,
                                company_id: vectorNamespace // Filter consistency
                            }
                        });
                        if (insErr) throw insErr;
                    }
                }

                console.log(`index_existing completed successfully for file ${fileId}`);
                return new Response(JSON.stringify({ message: "Indexing success" }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            } catch (vecErr: any) {
                console.error("Vector generation failed:", vecErr);
                return new Response(JSON.stringify({ error: vecErr.message }), {
                    status: 500,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
        } else if (action === "delete_vector") {
            // [RAG] Vector Deletion Action
            const { fileId, vectorNamespace } = body;

            if (!fileId || !vectorNamespace) {
                return new Response(JSON.stringify({ error: "Missing fileId or vectorNamespace" }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }

            // Delete from document_sections using metadata filter
            // Note: Supabase JS library doesn't support JSON containment filtering well in .delete().match(), 
            // so we might need a workaround or ensure metadata column is indexed properly if we use contains.
            // Using RPC or raw SQL is better, or just filtering client side logic? No, must be server.
            // For now, let's try assuming we have permissions. 
            // Better approach: Use the postgres json selector in filter if possible, or use a custom RPC like 'delete_document_sections'.
            // Alternatively, use `filter` syntax if supabase-js supports it for delete.
            // Let's use metadata->>'file_id' eq syntax.

            const { error } = await supabase
                .from('document_sections')
                .delete()
                .eq('company_id', vectorNamespace)
                .filter('metadata->>file_id', 'eq', fileId);

            if (error) throw error;

            return new Response(JSON.stringify({ message: "Vectors deleted" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: any) {
        console.error(error);
        return new Response(JSON.stringify({ error: error.message || String(error) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
