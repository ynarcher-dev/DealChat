
import { APIcall } from '../../js/APIcallFunction.js';

$(document).ready(function () {
    const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

    $('#admin-signin-form').on('submit', async function (e) {
        e.preventDefault();

        const email = $('#admin-email').val().trim();
        const password = $('#admin-password').val().trim();

        if (!email || !password) {
            alert('?´ë©”?¼ê³¼ ë¹„ë?ë²ˆí˜¸ë¥?ëª¨ë‘ ?…ë ¥?´ì£¼?¸ìš”.');
            return;
        }

        const $btn = $('.btn-login');
        const originalText = $btn.text();
        $btn.prop('disabled', true).text('ë¡œê·¸??ì¤?..');

        try {
            // Admin auth logic here. 
            // For now, using standard user login but checking for specific admin flag/role would be better.
            // Or assuming a specific admin table.
            // Reusing 'signin' action for now.

            const payload = {
                action: 'read',
                table: 'users',
                email: email,
                password: password
            };

            const response = await APIcall(payload, SUPABASE_ENDPOINT, {
                'Content-Type': 'application/json'
            });
            const data = await response.json();

            if (data.error) {
                alert('ë¡œê·¸???¤íŒ¨: ' + data.error);
                return;
            }

            // ?´ë©”?¼ë¡œ ?¬ìš©??ì°¾ê¸°
            // 'read' action returns an array of users matching the filter (email)
            const user = (Array.isArray(data) ? data : []).find(u => u.email === email);

            if (!user) {
                alert('?±ë¡?˜ì? ?Šì? ê´€ë¦¬ì ê³„ì •?…ë‹ˆ??');
                return;
            }

            // ë¹„ë?ë²ˆí˜¸ ?•ì¸ (Simple check as in signin.js)
            if (user.password !== password) {
                alert('ë¹„ë?ë²ˆí˜¸ê°€ ?¬ë°”ë¥´ì? ?ŠìŠµ?ˆë‹¤.');
                return;
            }

            // [Fix] Check for admin role
            if (user.role !== 'admin') {
                alert('ê´€ë¦¬ì ê¶Œí•œ???†ëŠ” ê³„ì •?…ë‹ˆ??');
                return;
            }

            const userData = {
                id: user.id,
                email: user.email,
                name: user.name || 'Admin',
                // token: result.token, // Token logic removed as signin.js doesn't use it
                role: user.role,
                isLoggedIn: true
            };

            localStorage.setItem('dealchat_admin_user', JSON.stringify(userData));

            // Redirect to admin dashboard
            window.location.href = './dashboard.html';
        } catch (error) {
            console.error('Admin Login Error:', error);
            alert('?œìŠ¤???¤ë¥˜ê°€ ë°œìƒ?ˆìŠµ?ˆë‹¤.');
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });
});
