export function APIcall(prompts, Furl, Fheaders, Fmethod = 'POST') {
    let body;
    if (prompts instanceof FormData) {
        body = prompts;
    } else {
        body = JSON.stringify(prompts);
    }

    // Use global config if URL is not provided (or matches the old Lambda URL)
    const endpoint = Furl && !Furl.includes('lambda-url') ? Furl : window.config.supabase.endpoint;

    const headers = {
        ...Fheaders,
        'apikey': window.config.supabase.anonKey,
        'Authorization': `Bearer ${window.config.supabase.anonKey}`
    };

    // Remove Content-Type if body is FormData (browser will set it with boundary)
    if (body instanceof FormData && headers['Content-Type']) {
        delete headers['Content-Type'];
    }

    return fetch(endpoint, {
        method: Fmethod,
        headers: headers,
        body: body,
        mode: 'cors'
    }).then(response => {
        if (!response.ok) {
            return response.text().then(text => {
                throw new Error(`HTTP ${response.status}: ${text}`);
            });
        }
        return response;
    });
}