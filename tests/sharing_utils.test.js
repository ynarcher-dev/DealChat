/**
 * sharing_utils.js 테스트
 *
 * 목적: 리팩토링 전 공유 유틸리티의 현재 동작을 기록한다.
 *   - generateRandomKey: 랜덤 키 생성 로직 (길이, 문자셋)
 */
import { generateRandomKey } from '../js/sharing_utils.js';

describe('generateRandomKey', () => {
  test('기본 길이 6자리 반환', () => {
    const key = generateRandomKey();
    expect(key).toHaveLength(6);
  });

  test('지정 길이 반환', () => {
    expect(generateRandomKey(4)).toHaveLength(4);
    expect(generateRandomKey(10)).toHaveLength(10);
  });

  test('허용 문자셋만 사용 (대문자 + 숫자, 혼동 문자 제외)', () => {
    // 허용: ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (0, O, 1, I 제외)
    const forbidden = /[01OI]/;
    for (let i = 0; i < 50; i++) {
      expect(generateRandomKey(20)).not.toMatch(forbidden);
    }
  });

  test('소문자 미포함', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRandomKey(20)).not.toMatch(/[a-z]/);
    }
  });

  test('매 호출마다 다른 값 (확률적)', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateRandomKey()));
    // 20개 중 최소 10개 이상 유니크해야 함 (같은 값이 나올 확률은 극히 낮음)
    expect(keys.size).toBeGreaterThan(10);
  });

  test('길이 0 → 빈 문자열', () => {
    expect(generateRandomKey(0)).toBe('');
  });
});
