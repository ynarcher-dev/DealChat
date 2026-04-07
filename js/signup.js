import { APIcall } from './APIcallFunction.js';

const SUPABASE_ENDPOINT = window.config.supabase.uploadHandlerUrl;

$(document).ready(function () {
    const $form = $('#signup-form');
    const $signupBtn = $('.btn-signup');
    const $agreeAll = $('#agree-all');
    const $agreeItems = $('.agree-item');

    // 전체 동의 체크박스 처리
    $agreeAll.on('change', function () {
        const isChecked = $(this).prop('checked');
        $agreeItems.prop('checked', isChecked);
    });

    // 개별 체크박스 처리
    $agreeItems.on('change', function () {
        const allChecked = $agreeItems.filter(':checked').length === $agreeItems.length;
        $agreeAll.prop('checked', allChecked);
    });

    // 비밀번호 유효성 검사
    function validatePassword(password) {
        // 8자 이상, 영문/숫자/특수문자 조합
        const minLength = password.length >= 8;
        const hasLetter = /[a-zA-Z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        return minLength && hasLetter && hasNumber && hasSpecial;
    }

    // 이메일 유효성 검사
    function validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // 전화번호 포맷팅 (010-0000-0000)
    $('#user-phone').on('input', function() {
        let val = $(this).val().replace(/[^0-9]/g, '');
        if (val.length > 3 && val.length <= 7) {
            val = val.slice(0, 3) + '-' + val.slice(3);
        } else if (val.length > 7) {
            val = val.slice(0, 3) + '-' + val.slice(3, 7) + '-' + val.slice(7);
        }
        $(this).val(val);
    });

    // 인증번호 발송 및 타이머
    let isPhoneVerified = false;
    let timerInterval = null;

    $('#btn-send-code').on('click', function() {
        const phone = $('#user-phone').val().trim();
        if (phone.length < 12) {
            alert('올바른 휴대폰 번호를 입력해주세요.');
            return;
        }

        $(this).text('재발송').prop('disabled', true);
        setTimeout(() => $(this).prop('disabled', false), 5000); // 5초 후 재발송 가능

        $('#verification-area').fadeIn();
        startTimer();
        alert('인증번호가 발송되었습니다. (테스트용: 123456)');
    });

    function startTimer() {
        let timeLeft = 180; // 3분
        clearInterval(timerInterval);
        
        const $timer = $('#verification-timer');
        
        timerInterval = setInterval(() => {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            $timer.text(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
            
            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                alert('인증 시간이 만료되었습니다. 다시 시도해 주세요.');
                $('#verification-area').hide();
            }
            timeLeft--;
        }, 1000);
    }

    // 인증번호 확인
    $('#btn-verify-code').on('click', function() {
        const code = $('#verification-code').val().trim();
        if (code === '123456') { // 테스트용 고정 번호
            clearInterval(timerInterval);
            isPhoneVerified = true;
            $('#verification-area').hide();
            $('#verified-badge').css('display', 'flex');
            $('#user-phone').prop('readonly', true).css('background', '#f1f5f9');
            $('#btn-send-code').hide();
            alert('인증이 완료되었습니다.');
        } else {
            alert('인증번호가 일치하지 않습니다.');
        }
    });

    $form.on('submit', async function (e) {
        e.preventDefault();

        const email = $('#user-email').val().trim();
        const password = $('#user-password').val();
        const passwordConfirm = $('#user-password-confirm').val();
        const name = $('#user-name').val().trim();
        const phone = $('#user-phone').val().trim();
        const company = $('#user-company').val().trim();
        const department = $('#user-department').val().trim();
        const agreeTerms = $('#agree-terms').prop('checked');
        const agreePrivacy = $('#agree-privacy').prop('checked');
        const agreeMarketing = $('#agree-marketing').prop('checked');

        // 유효성 검사
        if (!email || !password || !passwordConfirm || !name || !phone) {
            alert('필수 항목을 모두 입력해주세요.');
            return;
        }

        if (!isPhoneVerified) {
            alert('휴대폰 본인 인증을 완료해주세요.');
            return;
        }

        if (!validateEmail(email)) {
            alert('올바른 이메일 주소를 입력해주세요.');
            return;
        }

        if (!validatePassword(password)) {
            alert('비밀번호는 8자 이상, 영문/숫자/특수문자를 포함해야 합니다.');
            return;
        }

        if (password !== passwordConfirm) {
            alert('비밀번호가 일치하지 않습니다.');
            return;
        }

        if (!agreeTerms || !agreePrivacy) {
            alert('필수 약관에 동의해주세요.');
            return;
        }

        // 로딩 상태
        const originalText = $signupBtn.text();
        $signupBtn.prop('disabled', true).text('가입 처리 중...');

        try {
            // 수파베이스 클라이언트 초기화
            const _supabase = window.supabaseClient || supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey);
            window.supabaseClient = _supabase;

            // 1. 수파베이스 인증 회원가입
            const { data, error } = await _supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        name: name,
                        phone: phone,
                        company: company || '',
                        department: department || '',
                        agree_terms: agreeTerms,
                        agree_privacy: agreePrivacy,
                        agree_marketing: agreeMarketing
                    }
                }
            });

            if (error) throw error;

            // 2. public.users 테이블 저장은 이제 Supabase Trigger(handle_new_user)가 자동으로 처리합니다.
            // 클라이언트 사이드에서의 중복 insert는 'Duplicate Key' 오류를 발생시킬 수 있으므로 생략합니다.
            /*
            if (data.user) {
                ...
            }
            */

            alert('회원가입이 성공적으로 완료되었습니다!\n로그인 페이지로 이동합니다.');
            location.href = './signin.html';

        } catch (err) {
            console.error('Signup Error:', err);
            if (err.message.includes('already registered')) {
                alert('이미 가입된 이메일입니다.');
            } else {
                alert('회원가입 처리 중 오류가 발생했습니다: ' + err.message);
            }
        } finally {
            $signupBtn.prop('disabled', false).text(originalText);
        }
    });
});
