/**
 * Profile Modal Component
 * 어느 페이지에서든 유저 정보를 팝업으로 보여주는 기능을 제공합니다.
 * 호출 방법: showProfileModal(userId)
 */

(function () {
    // 1. 모달 HTML 구조 정의
    const modalHtml = `
    <div class="modal fade" id="profile-modal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" style="max-width: 380px;">
            <div class="modal-content" style="background: #ffffff !important; border-radius: 24px; border: none; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.12);">
                <div class="modal-body p-0">
                    <!-- 상단 배경 & 아바타 -->
                    <div style="height: 100px; background: linear-gradient(135deg, #1E293B 0%, #334155 100%); position: relative;"></div>
                    <div style="text-align: center; margin-top: -50px; position: relative; z-index: 1;">
                        <div style="width: 100px; height: 100px; border-radius: 50%; background: #fff; padding: 4px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
                            <img id="profile-modal-avatar" src="../img/avatars/default-avatar.png" 
                                 style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover; background: #f1f5f9;">
                        </div>
                    </div>

                    <!-- 정보 영역 -->
                    <div style="padding: 24px 32px 40px 32px; text-align: center;">
                        <h3 id="profile-modal-name" style="margin: 0; font-size: 22px; font-weight: 800; color: #000000; letter-spacing: -0.5px;">사용자 이름</h3>
                        <p id="profile-modal-company-header" style="margin: 4px 0 24px 0; color: #64748b; font-size: 14px; font-weight: 500;">회사명</p>
                        
                        <div style="text-align: left; background: #f8fafc; border-radius: 16px; padding: 20px; border: 1px solid #f1f5f9;">
                            <div class="mb-3">
                                <label style="display: block; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">소속 / 부서</label>
                                <div id="profile-modal-department" style="font-size: 14px; font-weight: 600; color: #334155;">-</div>
                            </div>
                            <div>
                                <label style="display: block; font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">이메일</label>
                                <div id="profile-modal-email" style="font-size: 14px; font-weight: 600; color: #334155;">-</div>
                            </div>
                        </div>

                        <button type="button" class="btn w-100 mt-4" data-bs-dismiss="modal" 
                                style="background: #1e293b; color: #fff; border-radius: 12px; padding: 12px; font-weight: 700; font-size: 15px; border: none; transition: all 0.2s;">
                            닫기
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;

    // 2. 전역 노출 함수
    window.showProfileModal = async function (userId) {
        if (!userId) return;

        // 모달 요소가 없으면 추가
        if (!document.getElementById('profile-modal')) {
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }

        const modalEl = document.getElementById('profile-modal');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

        // 초기화 (로딩 상태)
        document.getElementById('profile-modal-name').textContent = '로딩 중...';
        document.getElementById('profile-modal-company-header').textContent = '-';
        document.getElementById('profile-modal-department').textContent = '-';
        document.getElementById('profile-modal-email').textContent = '-';
        document.getElementById('profile-modal-avatar').src = '../img/avatars/default-avatar.png';

        modal.show();

        try {
            const _supabase = window.supabaseClient || (window.supabase ? window.supabase.createClient(window.config.supabase.url, window.config.supabase.anonKey) : null);
            if (!_supabase) throw new Error('Supabase client not found');

            const { data: user, error } = await _supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .maybeSingle();

            const DEFAULT_MANAGER = {
                name: '딜챗',
                company: '딜챗 주식회사',
                affiliation: '딜챗 주식회사',
                department: 'M&A팀',
                email: 'info@dealchat.co.kr',
                avatar: 'img/dealchat-favicon.png'
            };

            if (error || !user) {
                // 데이터 반영 (매니저 정보)
                document.getElementById('profile-modal-name').textContent = DEFAULT_MANAGER.name;
                document.getElementById('profile-modal-company-header').textContent = DEFAULT_MANAGER.company;
                document.getElementById('profile-modal-department').textContent = DEFAULT_MANAGER.department;
                document.getElementById('profile-modal-email').textContent = DEFAULT_MANAGER.email;
                document.getElementById('profile-modal-avatar').src = '../' + DEFAULT_MANAGER.avatar;
                return;
            }

            // 데이터 반영 (실제 사용자 정보)
            document.getElementById('profile-modal-name').textContent = user.name || '정보 없음';
            document.getElementById('profile-modal-company-header').textContent = user.company || '딜챗인베스트먼트';
            document.getElementById('profile-modal-department').textContent = user.department || '경영지원팀';
            document.getElementById('profile-modal-email').textContent = user.email || '-';
            
            // 아바타 처리
            let avatarUrl = user.avatar_url || user.avatar;
            if (avatarUrl) {
                if (!avatarUrl.startsWith('http') && !avatarUrl.startsWith('data:') && !avatarUrl.startsWith('../')) {
                    avatarUrl = '../' + avatarUrl;
                }
                document.getElementById('profile-modal-avatar').src = avatarUrl;
            } else {
                document.getElementById('profile-modal-avatar').src = '../img/avatars/default-avatar.png';
            }

        } catch (err) {
            console.error('Failed to load profile:', err);
            // 오류 발생 시에도 매니저 정보 표시
            document.getElementById('profile-modal-name').textContent = '딜챗';
            document.getElementById('profile-modal-company-header').textContent = '딜챗 주식회사';
            document.getElementById('profile-modal-department').textContent = 'M&A팀';
            document.getElementById('profile-modal-email').textContent = 'info@dealchat.co.kr';
            document.getElementById('profile-modal-avatar').src = '../img/dealchat-favicon.png';
        }
    };
})();
