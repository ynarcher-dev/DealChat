
import { APIcall } from './js/APIcallFunction.js';
const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

APIcall({ action: 'get', table: 'sellers', limit: 1 }, SUPABASE_ENDPOINT, { 'Content-Type': 'application/json' })
    .then(res => res.json())
    .then(data => {
        console.log('Sample Seller Record Keys:', Object.keys(Array.isArray(data) ? data[0] : (data.data ? data.data[0] : data)));
        console.log('Sample Seller Record:', Array.isArray(data) ? data[0] : (data.data ? data.data[0] : data));
    })
    .catch(err => console.error('Test Fetch Error:', err));
