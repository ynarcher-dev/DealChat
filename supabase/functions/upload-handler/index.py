import os
import json
from supabase import create_client, Client

# standard response helper
def create_response(body, status=200):
    res_body = json.dumps(body) if isinstance(body, (dict, list)) else json.dumps({"message": str(body)})
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE, PUT, PATCH",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
    }
    
    # Try to use global Response object, fallback to dict if needed
    try:
        return Response(res_body, status=status, headers=headers)
    except NameError:
        return {
            "status": status,
            "headers": headers,
            "body": res_body
        }

def main(req):
    # 1. Handle OPTIONS immediately to avoid any req.json() failures
    try:
        if req.method == "OPTIONS":
            return create_response({"message": "ok"})
    except Exception as e:
        return {"status": 200, "headers": {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*"}, "body": "ok"}

    try:
        url = os.environ.get("SUPABASE_URL")
        # Use service role key to bypass RLS for administrative tasks if needed, 
        # but better to use the user's token for RLS consistency.
        # For simplicity and mirroring Lambda behavior, we use service_role.
        service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        
        supabase: Client = create_client(url, service_role_key)

        # Handle Multipart Form Data (Files)
        if "multipart/form-data" in req.headers.get("content-type", ""):
            form = req.form_data()
            file_obj = form.get("file")
            user_id = form.get("user_id")
            action = form.get("action", "upload")
            table = form.get("table", "files")

            if action == "upload" and file_obj:
                filename = file_obj.name
                file_content = file_obj.read()
                content_type = file_obj.content_type
                storage_path = f"{user_id}/{filename}"
                
                # Upload to Storage
                supabase.storage.from_("uploads").upload(
                    path=storage_path,
                    file=file_content,
                    file_options={"content-type": content_type, "upsert": "true"}
                )
                
                # Update Database (Mirroring lambda.py logic)
                file_metadata = {
                    "file_name": filename,
                    "location": storage_path,
                    "userId": user_id,
                    "summary": form.get("summary", ""),
                }
                res = supabase.table("files").insert(file_metadata).execute()
                
                return create_response({"message": "Upload success", "data": res.data})

        # Handle JSON (CRUD operations)
        body = req.json()
        action = body.get("action")
        table_name = body.get("table")
        
        if not action or not table_name:
            return create_response({"error": "Missing action or table"}, 400)

        query = supabase.table(table_name)

        if action == "get" or action == "read":
            user_id = body.get("userId")
            target_id = body.get("id")
            email = body.get("email")
            
            # Start query
            if target_id:
                res = query.select("*").eq("id", target_id).single().execute()
            else:
                # Apply filters dynamically if provided
                for key, value in body.items():
                    if key not in ["action", "table", "userId", "shareType"]:
                        query = query.eq(key, value)
                
                share_type_param = body.get("shareType")
                if share_type_param:
                    query = query.eq("share_type", share_type_param)

                if user_id:
                    if table_name in ["sellers", "buyers"]:
                        # For sellers/buyers, show My Data OR Public Data
                        # Use raw filter string for complicated OR logic if referencing dynamic values, 
                        # but Supabase-py uses .or_("field.eq.value,field2.eq.value") syntax.
                        filter_str = f"userId.eq.{user_id},share_type.eq.public"
                        query = query.or_(filter_str)
                    else:
                        query = query.eq("userId", user_id)
                
                res = query.select("*").execute()
            return create_response(res.data)

        elif action == "upload" or action == "create":
            # For non-file creates
            data = {k: v for k, v in body.items() if k not in ["action", "table"]}
            res = query.insert(data).execute()
            return create_response(res.data)

        elif action == "update":
            target_id = body.get("id")
            data = {k: v for k, v in body.items() if k not in ["action", "table", "id"]}
            res = query.update(data).eq("id", target_id).execute()
            return create_response(res.data)

        elif action == "delete":
            target_id = body.get("id") or body.get("fileId")
            res = query.delete().eq("id", target_id).execute()
            return create_response(res.data)

        return create_response({"error": f"Unknown action: {action}"}, 400)

    except Exception as e:
        return create_response({"error": str(e)}, 500)
