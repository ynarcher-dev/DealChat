import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { S3Client, GetObjectCommand } from "https://esm.sh/@aws-sdk/client-s3@3.540.0";
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3.540.0";

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

const s3Client = new S3Client({
    region: Deno.env.get("AWS_REGION") || "ap-northeast-2",
    credentials: {
        accessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID") || "",
        secretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY") || "",
    },
});

const S3_BUCKET = Deno.env.get("S3_BUCKET_NAME") || "dealchat-uploads";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: getCorsHeaders(req) });
    }

    try {
        const { storagePath } = await req.json();

        if (!storagePath) {
            return new Response(JSON.stringify({ error: "storagePath is required" }), {
                status: 400,
                headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
            });
        }

        // Generate Pre-signed URL (Valid for 1 hour)
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: storagePath,
        });

        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        return new Response(JSON.stringify({ url: signedUrl }), {
            status: 200,
            headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });

    } catch (error: any) {
        console.error("get-s3-url error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
    }
});
