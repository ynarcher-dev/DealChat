
$(document).ready(function () {
    const $form = $('#admin-signin-form');
    const $btn = $('.btn-login');

    $form.on('submit', async function (e) {
        e.preventDefault();

        const email = $('#admin-email').val().trim();
        const password = $('#admin-password').val().trim();

        if (!email || !password) {
            alert('이메일과 비밀번호를 모두 입력해주세요.');
            return;
        }

        const originalText = $btn.text();
        $btn.prop('disabled', true).text('로그인 중...');

        try {
            const _supabase = window.supabaseClient || supabase.createClient(
                window.config.supabase.url,
                window.config.supabase.anonKey
            );
            window.supabaseClient = _supabase;

            // 1. Supabase Auth로 로그인 (비밀번호 평문 비교 없음)
            const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;

            // 2. users 테이블에서 role 확인
            const { data: dbUser, error: dbError } = await _supabase
                .from('users')
                .select('role, name')
                .eq('id', data.user.id)
                .single();

            if (dbError || !dbUser) {
                await _supabase.auth.signOut();
                alert('사용자 정보를 확인할 수 없습니다.');
                return;
            }

            if (dbUser.role !== 'admin') {
                await _supabase.auth.signOut();
                alert('관리자 권한이 없는 계정입니다.');
                return;
            }

            // 3. 대시보드로 이동 (세션은 Supabase가 자동 관리)
            window.location.href = './dashboard.html';

        } catch (err) {
            console.error('Admin Login Error:', err);
            if (err.message && err.message.includes('Invalid login credentials')) {
                alert('이메일 또는 비밀번호가 올바르지 않습니다.');
            } else {
                alert('로그인 처리 중 오류가 발생했습니다: ' + (err.message || err));
            }
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });
});
