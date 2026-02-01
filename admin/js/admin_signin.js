
import { APIcall } from '../../js/APIcallFunction.js';

$(document).ready(function () {
    const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

    $('#admin-signin-form').on('submit', async function (e) {
        e.preventDefault();

        const email = $('#admin-email').val().trim();
        const password = $('#admin-password').val().trim();

        if (!email || !password) {
            alert('이메일과 비밀번호를 모두 입력해주세요.');
            return;
        }

        const $btn = $('.btn-login');
        const originalText = $btn.text();
        $btn.prop('disabled', true).text('로그인 중...');

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
                alert('로그인 실패: ' + data.error);
                return;
            }

            // 이메일로 사용자 찾기
            // 'read' action returns an array of users matching the filter (email)
            const user = (Array.isArray(data) ? data : []).find(u => u.email === email);

            if (!user) {
                alert('등록되지 않은 관리자 계정입니다.');
                return;
            }

            // 비밀번호 확인 (Simple check as in signin.js)
            if (user.password !== password) {
                alert('비밀번호가 올바르지 않습니다.');
                return;
            }

            // [Fix] Check for admin role
            if (user.role !== 'admin') {
                alert('관리자 권한이 없는 계정입니다.');
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
            alert('시스템 오류가 발생했습니다.');
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });
});
