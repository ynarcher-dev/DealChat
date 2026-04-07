/**
 * auth_utils.js 테스트
 *
 * 목적: 리팩토링 전 인증 유틸리티의 현재 동작을 기록한다.
 *   - checkAuth: 로그인 상태 확인 + 미로그인 시 리다이렉트
 *   - resolveAvatarUrl: 아바타 URL 경로 변환 로직
 *   - DEFAULT_MANAGER: 기본 담당자 상수값 검증
 */
import { checkAuth, resolveAvatarUrl, DEFAULT_MANAGER } from '../js/auth_utils.js';

// ─── checkAuth ───────────────────────────────────────────────────────────────

describe('checkAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    global.alert = jest.fn();
    // location.href 할당이 jsdom에서 에러 내지 않도록 처리
    Object.defineProperty(window, 'location', {
      value: { pathname: '/', href: '' },
      writable: true
    });
  });

  test('localStorage에 데이터 없음 → null 반환, alert 호출', () => {
    const result = checkAuth();
    expect(result).toBeNull();
    expect(global.alert).toHaveBeenCalledWith('로그인 후 이용해주세요.');
  });

  test('isLoggedIn=false → null 반환', () => {
    localStorage.setItem('dealchat_users', JSON.stringify({ isLoggedIn: false, id: 'u-1' }));
    const result = checkAuth();
    expect(result).toBeNull();
  });

  test('잘못된 JSON → null 반환 (크래시 없음)', () => {
    localStorage.setItem('dealchat_users', 'invalid-json{{{');
    const result = checkAuth();
    expect(result).toBeNull();
  });

  test('유효한 로그인 상태 → userData 반환', () => {
    const userData = { isLoggedIn: true, id: 'u-1', name: '홍길동' };
    localStorage.setItem('dealchat_users', JSON.stringify(userData));
    const result = checkAuth();
    expect(result).toEqual(userData);
  });

  test('로그인 상태에서는 alert 미호출', () => {
    localStorage.setItem('dealchat_users', JSON.stringify({ isLoggedIn: true }));
    checkAuth();
    expect(global.alert).not.toHaveBeenCalled();
  });
});

// ─── resolveAvatarUrl ────────────────────────────────────────────────────────

describe('resolveAvatarUrl', () => {
  test('null/빈 값 → 기본 아바타 경로 반환', () => {
    expect(resolveAvatarUrl(null)).toBe('../img/avatars/default-avatar.png');
    expect(resolveAvatarUrl('')).toBe('../img/avatars/default-avatar.png');
  });

  test('depth=2이면 ../../ 프리픽스', () => {
    expect(resolveAvatarUrl(null, 2)).toBe('../../img/avatars/default-avatar.png');
  });

  test('http URL → 그대로 반환', () => {
    const url = 'https://example.com/avatar.jpg';
    expect(resolveAvatarUrl(url)).toBe(url);
  });

  test('data: URL → 그대로 반환', () => {
    const dataUrl = 'data:image/png;base64,abc123';
    expect(resolveAvatarUrl(dataUrl)).toBe(dataUrl);
  });

  test('../ 로 시작하는 경로 → 그대로 반환 (이중 프리픽스 방지)', () => {
    expect(resolveAvatarUrl('../img/avatars/user.png')).toBe('../img/avatars/user.png');
  });

  test('딜챗 매니저 이미지 → depth 기반 ../  프리픽스 추가', () => {
    expect(resolveAvatarUrl('img/dealchat-manager.png', 1)).toBe('../img/dealchat-manager.png');
    expect(resolveAvatarUrl('img/dealchat-favicon.png', 2)).toBe('../../img/dealchat-favicon.png');
  });

  test('일반 상대 경로 → ../ 프리픽스 추가', () => {
    expect(resolveAvatarUrl('img/avatars/user.png', 1)).toBe('../img/avatars/user.png');
    expect(resolveAvatarUrl('img/avatars/user.png', 2)).toBe('../../img/avatars/user.png');
  });
});

// ─── DEFAULT_MANAGER ─────────────────────────────────────────────────────────

describe('DEFAULT_MANAGER', () => {
  test('필수 필드 존재', () => {
    expect(DEFAULT_MANAGER).toHaveProperty('name');
    expect(DEFAULT_MANAGER).toHaveProperty('email');
    expect(DEFAULT_MANAGER).toHaveProperty('avatar');
  });

  test('이메일 형식 유효', () => {
    expect(DEFAULT_MANAGER.email).toMatch(/@/);
  });
});
