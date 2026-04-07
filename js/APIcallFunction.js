export function APIcall(prompts, Furl, Fheaders, Fmethod = 'POST') {
    const supabaseUrl = window.config.supabase.url;
    const anonKey = window.config.supabase.anonKey;
    const aiHandlerUrl = window.config.supabase.aiHandlerUrl;
    const uploadHandlerUrl = window.config.supabase.uploadHandlerUrl;

    let body;
    let method = Fmethod;
    let endpoint = Furl || uploadHandlerUrl;

    // 0. 인증 토큰 확보 (로그인된 사용자가 있다면 JWT 사용)
    let authHeader = `Bearer ${anonKey}`;
    try {
        const projectId = supabaseUrl.split('://')[1].split('.')[0];
        const sessionKey = `sb-${projectId}-auth-token`;
        const sessionData = JSON.parse(localStorage.getItem(sessionKey));
        if (sessionData && sessionData.access_token) {
            authHeader = `Bearer ${sessionData.access_token}`;
        }
    } catch (e) {
        console.warn('Auth token retrieval failed:', e);
    }

    let headers = {
        'apikey': anonKey,
        'Authorization': authHeader,
        ...Fheaders
    };

    // 1. AI/Vector Search 관련 요청 라우팅
    if (prompts && (prompts.action === 'search_vector' || prompts.body)) {
        endpoint = aiHandlerUrl;
    } 
    // 2. 일반 CRUD 요청을 직접 Supabase REST API로 변환 (Edge Function 없이 작동하게 함)
    else if (prompts && prompts.table && prompts.action) {
        endpoint = `${supabaseUrl}/rest/v1/${prompts.table}`;
        
        // 데이터 정제: DB 컬럼이 아닌 제어용 필드(table, action) 제거
        const dataOnly = { ...prompts };
        delete dataOnly.table;
        delete dataOnly.action;

        switch (prompts.action) {
            case 'create':
            case 'upload':
                method = 'POST';
                headers['Prefer'] = 'return=representation';
                headers['Content-Type'] = 'application/json';
                body = JSON.stringify(dataOnly);
                break;
            case 'read':
            case 'get':
                method = 'GET';
                let queryParams = new URLSearchParams();
                queryParams.append('select', '*');
                
                Object.keys(dataOnly).forEach(key => {
                    const val = dataOnly[key];
                    if (val !== undefined && val !== "") {
                        if (val === "is.null") {
                            queryParams.append(key, "is.null");
                        } else {
                            queryParams.append(key, `eq.${val}`);
                        }
                    }
                });
                endpoint += `?${queryParams.toString()}`;
                body = undefined;
                break;
            case 'update':
                method = 'PATCH';
                if (prompts.id) {
                    endpoint += `?id=eq.${prompts.id}`;
                }
                headers['Prefer'] = 'return=representation';
                headers['Content-Type'] = 'application/json';
                body = JSON.stringify(dataOnly);
                break;
            case 'delete':
                method = 'DELETE';
                const deleteId = prompts.id || prompts.fileId;
                if (deleteId) {
                    endpoint += `?id=eq.${deleteId}`;
                }
                body = undefined;
                break;
        }
    } else {
        // 일반 body 처리
        if (prompts instanceof FormData) {
            body = prompts;
            if (headers['Content-Type']) delete headers['Content-Type'];
        } else {
            body = JSON.stringify(prompts);
            if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        }
    }

    return fetch(endpoint, {
        method: method,
        headers: headers,
        body: body,
        mode: 'cors'
    }).then(async response => {
        if (!response.ok) {
            const text = await response.text();
            let errMsg = text;
            try { 
                const errJson = JSON.parse(text);
                errMsg = errJson.message || errJson.error || text;
            } catch(e) {}
            throw new Error(`[DB Error] ${errMsg}`);
        }
        return response;
    });
}